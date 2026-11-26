import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'
import { createApp } from './app.ts'
import { openDb } from './db.ts'
import { DEMO_PASSWORD, seedDemo } from './seedData.ts'

let base = ''
let server: ReturnType<ReturnType<typeof createApp>['listen']>
let db: ReturnType<typeof openDb>
const tokens: Record<string, string> = {}

async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers }
}
const login = async (email: string) => (await call('POST', '/api/auth/login', { email, password: DEMO_PASSWORD })).body.token as string

before(async () => {
  db = openDb(':memory:')
  seedDemo(db)
  server = createApp(db, { maxRegistrations: 100, maxLoginFails: 100 }).listen(0)
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  tokens.admin = await login('admin@demo.test')
  tokens.sam = await login('sam@demo.test')
  tokens.lee = await login('lee@demo.test')
  tokens.maya = await login('maya@customer.test')
  tokens.omar = await login('omar@customer.test')
})
after(() => server.close())

const newTicket = async (token: string, subject = 'Printer is on fire') =>
  (await call('POST', '/api/tickets', { subject, description: 'Smoke everywhere, please help' }, token)).body.id as number

describe('auth', () => {
  it('public sign-up always creates a customer, never staff', async () => {
    const r = await call('POST', '/api/auth/register', { email: 'new@x.test', name: 'New', password: 'password1', role: 'admin' })
    assert.equal(r.status, 201)
    assert.equal((await call('GET', '/api/me', undefined, r.body.token)).body.role, 'customer')
  })
  it('rejects duplicates, weak input and wrong passwords', async () => {
    assert.equal((await call('POST', '/api/auth/register', { email: 'MAYA@customer.test', name: 'x', password: 'password1' })).status, 409)
    assert.equal((await call('POST', '/api/auth/register', { email: 'bad', name: 'x', password: 'password1' })).status, 400)
    assert.equal((await call('POST', '/api/auth/register', { email: 'a@b.test', name: 'x', password: 'short' })).status, 400)
    assert.equal((await call('POST', '/api/auth/login', { email: 'maya@customer.test', password: 'nope-nope-1' })).status, 401)
  })
  it('requires a token, and logout invalidates it', async () => {
    assert.equal((await call('GET', '/api/tickets')).status, 401)
    const t = await login('lee@demo.test')
    assert.equal((await call('POST', '/api/auth/logout', undefined, t)).status, 204)
    assert.equal((await call('GET', '/api/tickets', undefined, t)).status, 401)
  })
  it('only admins create staff accounts', async () => {
    const body = { email: 'newagent@x.test', name: 'N', role: 'agent', password: 'password1' }
    assert.equal((await call('POST', '/api/users', body, tokens.sam)).status, 403)
    assert.equal((await call('POST', '/api/users', body, tokens.maya)).status, 403)
    assert.equal((await call('POST', '/api/users', body, tokens.admin)).status, 201)
  })
})

describe('ticket visibility', () => {
  it("customers only see their own tickets and others look 'not found'", async () => {
    const mine = (await call('GET', '/api/tickets', undefined, tokens.maya)).body
    assert.ok(mine.total > 0)
    assert.ok(mine.items.every((t: { customer_name: string }) => t.customer_name === 'Maya Customer'))
    const omarsId = (await call('GET', '/api/tickets', undefined, tokens.omar)).body.items[0].id
    assert.equal((await call('GET', `/api/tickets/${omarsId}`, undefined, tokens.maya)).status, 404)
    assert.equal((await call('POST', `/api/tickets/${omarsId}/comments`, { body: 'hi' }, tokens.maya)).status, 404)
    assert.equal((await call('PATCH', `/api/tickets/${omarsId}`, { version: 1, status: 'closed' }, tokens.maya)).status, 404)
  })
  it('staff see all tickets', async () => {
    const all = (await call('GET', '/api/tickets', undefined, tokens.sam)).body
    assert.ok(all.total >= 10)
    assert.equal(all.items.length, 10)
  })
  it('internal notes and history are hidden from customers', async () => {
    const id = await newTicket(tokens.maya)
    await call('POST', `/api/tickets/${id}/comments`, { body: 'secret note', internal: true }, tokens.sam)
    await call('POST', `/api/tickets/${id}/comments`, { body: 'public reply' }, tokens.sam)
    const asCustomer = (await call('GET', `/api/tickets/${id}`, undefined, tokens.maya)).body
    assert.deepEqual(asCustomer.comments.map((c: { body: string }) => c.body), ['public reply'])
    assert.deepEqual(asCustomer.history, [])
    const asStaff = (await call('GET', `/api/tickets/${id}`, undefined, tokens.sam)).body
    assert.equal(asStaff.comments.length, 2)
    assert.ok(asStaff.history.length >= 3)
  })
  it('customers cannot post internal notes or set priority', async () => {
    const id = await newTicket(tokens.maya)
    assert.equal((await call('POST', `/api/tickets/${id}/comments`, { body: 'x', internal: true }, tokens.maya)).status, 403)
    assert.equal((await call('POST', '/api/tickets', { subject: 'abc', description: 'abcde', priority: 'urgent' }, tokens.maya)).status, 403)
  })
})

describe('ticket workflow', () => {
  it('validates new tickets', async () => {
    assert.equal((await call('POST', '/api/tickets', { subject: 'a', description: 'long enough' }, tokens.maya)).status, 400)
    assert.equal((await call('POST', '/api/tickets', { subject: 'Fine', description: 'x' }, tokens.maya)).status, 400)
  })
  it('follows the status flow and rejects illegal jumps', async () => {
    const id = await newTicket(tokens.maya)
    let v = 1
    assert.equal((await call('PATCH', `/api/tickets/${id}`, { version: v, status: 'closed' }, tokens.sam)).status, 422) // open -> closed not allowed for staff
    const ok = await call('PATCH', `/api/tickets/${id}`, { version: v, status: 'in_progress' }, tokens.sam)
    assert.equal(ok.status, 200)
    assert.equal(ok.body.status, 'in_progress')
    v = ok.body.version
    assert.equal(v, 2)
    assert.equal((await call('PATCH', `/api/tickets/${id}`, { version: v, status: 'resolved' }, tokens.sam)).status, 200)
  })
  it('detects conflicting edits with the version number', async () => {
    const id = await newTicket(tokens.maya)
    assert.equal((await call('PATCH', `/api/tickets/${id}`, { version: 1, priority: 'high' }, tokens.sam)).status, 200)
    const stale = await call('PATCH', `/api/tickets/${id}`, { version: 1, priority: 'low' }, tokens.lee)
    assert.equal(stale.status, 409)
    assert.equal((await call('PATCH', `/api/tickets/${id}`, { priority: 'low' }, tokens.lee)).status, 400)
  })
  it('recomputes the SLA deadline when priority changes', async () => {
    const id = await newTicket(tokens.maya)
    const before = (await call('GET', `/api/tickets/${id}`, undefined, tokens.sam)).body
    const after = (await call('PATCH', `/api/tickets/${id}`, { version: before.version, priority: 'urgent' }, tokens.sam)).body
    assert.equal(before.due_at - before.created_at, 24 * 3_600_000)
    assert.equal(after.due_at - after.created_at, 4 * 3_600_000)
  })
  it('lets agents take tickets for themselves but only admins reassign others', async () => {
    const id = await newTicket(tokens.maya)
    const lee = (await call('GET', '/api/staff', undefined, tokens.sam)).body.find((s: { name: string }) => s.name === 'Lee Agent').id
    assert.equal((await call('PATCH', `/api/tickets/${id}`, { version: 1, assigneeId: lee }, tokens.sam)).status, 403)
    const me = (await call('GET', '/api/me', undefined, tokens.sam)).body.id
    const taken = await call('PATCH', `/api/tickets/${id}`, { version: 1, assigneeId: me }, tokens.sam)
    assert.equal(taken.status, 200)
    assert.equal((await call('PATCH', `/api/tickets/${id}`, { version: 2, assigneeId: lee }, tokens.admin)).status, 200)
    assert.equal((await call('PATCH', `/api/tickets/${id}`, { version: 3, assigneeId: 99999 }, tokens.admin)).status, 400)
  })
  it('customers can close or reopen but not do staff actions', async () => {
    const id = await newTicket(tokens.maya)
    assert.equal((await call('PATCH', `/api/tickets/${id}`, { version: 1, status: 'resolved' }, tokens.maya)).status, 422)
    assert.equal((await call('PATCH', `/api/tickets/${id}`, { version: 1, priority: 'urgent' }, tokens.maya)).status, 403)
    assert.equal((await call('PATCH', `/api/tickets/${id}`, { version: 1, status: 'closed' }, tokens.maya)).status, 200)
    assert.equal((await call('POST', `/api/tickets/${id}/comments`, { body: 'still there?' }, tokens.maya)).status, 422)
  })
  it('a customer reply moves a waiting ticket back to the agent', async () => {
    const id = await newTicket(tokens.maya)
    const me = (await call('GET', '/api/me', undefined, tokens.sam)).body.id
    await call('PATCH', `/api/tickets/${id}`, { version: 1, assigneeId: me, status: 'waiting_customer' }, tokens.sam)
    const r = await call('POST', `/api/tickets/${id}/comments`, { body: 'here is the info' }, tokens.maya)
    assert.equal(r.body.status, 'in_progress')
  })
})

describe('audit log and queries', () => {
  it('records who did what, in order', async () => {
    const id = await newTicket(tokens.maya)
    await call('PATCH', `/api/tickets/${id}`, { version: 1, status: 'in_progress', priority: 'high' }, tokens.sam)
    const h = (await call('GET', `/api/tickets/${id}`, undefined, tokens.sam)).body.history
    assert.deepEqual(h.map((x: { action: string }) => x.action), ['ticket_created', 'status_changed', 'priority_changed'])
    assert.equal(h[1].actor_name, 'Sam Agent')
    assert.deepEqual(h[1].detail, { from: 'open', to: 'in_progress' })
  })
  it('the database refuses to edit or delete audit rows', () => {
    assert.throws(() => db.exec("UPDATE audit_log SET action = 'x'"), /append-only/)
    assert.throws(() => db.exec('DELETE FROM audit_log'), /append-only/)
  })
  it('audit endpoint is admin only', async () => {
    assert.equal((await call('GET', '/api/audit', undefined, tokens.sam)).status, 403)
    assert.ok((await call('GET', '/api/audit', undefined, tokens.admin)).body.length > 0)
  })
  it('filters, searches and paginates', async () => {
    const urgent = (await call('GET', '/api/tickets?priority=urgent&status=open', undefined, tokens.sam)).body
    assert.ok(urgent.items.every((t: { priority: string }) => t.priority === 'urgent'))
    const search = (await call('GET', '/api/tickets?q=VAT', undefined, tokens.sam)).body
    assert.equal(search.total, 1)
    assert.equal((await call('GET', '/api/tickets?q=%25', undefined, tokens.sam)).body.total, 0) // % is not a wildcard
    const p2 = (await call('GET', '/api/tickets?page=2', undefined, tokens.sam)).body
    assert.equal(p2.page, 2)
    assert.ok(p2.items.length >= 1)
    assert.equal((await call('GET', '/api/tickets?status=bogus', undefined, tokens.sam)).status, 400)
    const overdue = (await call('GET', '/api/tickets?overdue=1', undefined, tokens.sam)).body
    assert.ok(overdue.total >= 1)
    assert.ok(overdue.items.every((t: { status: string }) => t.status !== 'resolved' && t.status !== 'closed'))
  })
  it('SQL injection text is treated as plain data', async () => {
    const r = await call('GET', `/api/tickets?q=${encodeURIComponent("' OR 1=1 --")}`, undefined, tokens.sam)
    assert.equal(r.status, 200)
    assert.equal(r.body.total, 0)
  })
  it('dashboard counts are staff only', async () => {
    assert.equal((await call('GET', '/api/dashboard', undefined, tokens.maya)).status, 403)
    const d = (await call('GET', '/api/dashboard', undefined, tokens.sam)).body
    assert.ok(d.overdue >= 1 && d.unassigned >= 1)
  })
})

describe('token expiry and rate limiting', () => {
  it('expires tokens', async () => {
    let clock = 1_000_000
    const d = openDb(':memory:'); seedDemo(d, clock)
    const s = createApp(d, { now: () => clock, tokenTtlMs: 60_000 }).listen(0)
    const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}`
    const r = await fetch(url + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'sam@demo.test', password: DEMO_PASSWORD }) })
    const { token } = (await r.json()) as { token: string }
    const get = () => fetch(url + '/api/me', { headers: { authorization: `Bearer ${token}` } })
    assert.equal((await get()).status, 200)
    clock += 61_000
    assert.equal((await get()).status, 401)
    s.close()
  })
  it('blocks repeated wrong passwords, then allows again after the window', async () => {
    let clock = 1_000_000
    const d = openDb(':memory:'); seedDemo(d, clock)
    const s = createApp(d, { now: () => clock, maxLoginFails: 3, windowMs: 60_000 }).listen(0)
    const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}`
    const post = (password: string) => fetch(url + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'sam@demo.test', password }) })
    for (let i = 0; i < 3; i++) assert.equal((await post('wrong-wrong')).status, 401)
    const blocked = await post(DEMO_PASSWORD)
    assert.equal(blocked.status, 429)
    assert.ok(Number(blocked.headers.get('retry-after')) > 0)
    clock += 61_000
    assert.equal((await post(DEMO_PASSWORD)).status, 200)
    s.close()
  })
  it('limits sign-ups per IP', async () => {
    const s = createApp(openDb(':memory:'), { maxRegistrations: 2 }).listen(0)
    const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}`
    const reg = (n: number) => fetch(url + '/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `u${n}@t.test`, name: 'U', password: 'password1' }) })
    assert.equal((await reg(1)).status, 201)
    assert.equal((await reg(2)).status, 201)
    assert.equal((await reg(3)).status, 429)
    s.close()
  })
})
