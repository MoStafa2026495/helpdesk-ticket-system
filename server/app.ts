import express, { type NextFunction, type Request, type Response } from 'express'
import type { DatabaseSync } from 'node:sqlite'
import {
  canTransition, dueAt, isStaff, PRIORITIES, statusAfterCustomerReply,
  type Priority, type Role, type Status, STATUSES,
} from '../src/lib/policy.ts'
import { hashPassword, hashToken, newToken, verifyPassword } from './auth.ts'
import { RateLimiter } from './rateLimit.ts'

type Row = Record<string, unknown>
interface User { id: number; email: string; name: string; role: Role }
type Authed = Request & { user: User }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PAGE_SIZE = 10

export interface AppOptions {
  staticDir?: string
  now?: () => number
  tokenTtlMs?: number
  maxLoginFails?: number
  maxRegistrations?: number
  windowMs?: number
  trustProxy?: boolean
}

export function createApp(db: DatabaseSync, opts: AppOptions = {}) {
  const now = opts.now ?? Date.now
  const ttl = opts.tokenTtlMs ?? 7 * 24 * 3_600_000
  const windowMs = opts.windowMs ?? 15 * 60_000
  const loginFails = new RateLimiter(opts.maxLoginFails ?? 5, windowMs, now)
  const registrations = new RateLimiter(opts.maxRegistrations ?? 10, 3_600_000, now)
  const app = express()
  if (opts.trustProxy) app.set('trust proxy', 1)
  app.use(express.json({ limit: '20kb' }))

  const fail = (res: Response, status: number, error: string) => void res.status(status).json({ error })

  // ---------- helpers ----------
  /** Runs fn in one database transaction: all writes happen or none do. */
  function tx<T>(fn: () => T): T {
    db.exec('BEGIN IMMEDIATE')
    try {
      const out = fn()
      db.exec('COMMIT')
      return out
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }

  function audit(ticketId: number, actorId: number, action: string, detail: object = {}) {
    db.prepare('INSERT INTO audit_log (ticket_id, actor_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(ticketId, actorId, action, JSON.stringify(detail), now())
  }

  function issueToken(userId: number) {
    const token = newToken()
    db.prepare('DELETE FROM auth_tokens WHERE expires_at <= ?').run(now())
    db.prepare('INSERT INTO auth_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(hashToken(token), userId, now() + ttl)
    return token
  }

  function tooMany(res: Response, sec: number) {
    res.set('Retry-After', String(sec)).status(429).json({ error: 'too_many_attempts' })
  }

  const getTicket = (id: number) => db.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as Row | undefined

  /** Customers only ever see their own tickets. Anything else looks like "not found". */
  const canSee = (u: User, t: Row) => isStaff(u.role) || t.customer_id === u.id

  // ---------- middleware ----------
  function requireAuth(req: Request, res: Response, next: NextFunction) {
    const h = req.get('authorization') ?? ''
    const token = h.startsWith('Bearer ') ? h.slice(7) : ''
    const user = token
      ? (db.prepare('SELECT u.id, u.email, u.name, u.role FROM auth_tokens a JOIN users u ON u.id = a.user_id WHERE a.token_hash = ? AND a.expires_at > ?')
          .get(hashToken(token), now()) as User | undefined)
      : undefined
    if (!user) return fail(res, 401, 'unauthorized')
    ;(req as Authed).user = user
    next()
  }
  const requireRole = (...roles: Role[]) => (req: Request, res: Response, next: NextFunction) =>
    roles.includes((req as Authed).user.role) ? next() : fail(res, 403, 'forbidden')
  const staffOnly = requireRole('agent', 'admin')

  // ---------- auth ----------
  app.post('/api/auth/register', (req, res) => {
    const ip = req.ip ?? 'unknown'
    if (registrations.blocked(ip)) return tooMany(res, registrations.retryAfter(ip))
    registrations.hit(ip)
    const { email, password, name } = req.body ?? {}
    if (typeof email !== 'string' || !EMAIL.test(email)) return fail(res, 400, 'invalid_email')
    if (typeof password !== 'string' || password.length < 8) return fail(res, 400, 'weak_password')
    if (typeof name !== 'string' || !name.trim() || name.length > 80) return fail(res, 400, 'invalid_name')
    const clean = email.trim().toLowerCase()
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(clean)) return fail(res, 409, 'email_taken')
    // Public sign-up always creates a customer. Staff are created by an admin.
    const info = db.prepare("INSERT INTO users (email, name, role, password_hash, created_at) VALUES (?, ?, 'customer', ?, ?)")
      .run(clean, name.trim(), hashPassword(password), now())
    res.status(201).json({ token: issueToken(Number(info.lastInsertRowid)) })
  })

  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body ?? {}
    const clean = String(email).trim().toLowerCase()
    const key = `${req.ip ?? 'unknown'}|${clean}`
    if (loginFails.blocked(key)) return tooMany(res, loginFails.retryAfter(key))
    const row = typeof email === 'string' && typeof password === 'string'
      ? (db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(clean) as Row | undefined)
      : undefined
    if (!row || !verifyPassword(password, row.password_hash as string)) {
      loginFails.hit(key)
      return fail(res, 401, 'bad_credentials')
    }
    loginFails.reset(key)
    res.json({ token: issueToken(row.id as number) })
  })

  app.post('/api/auth/logout', requireAuth, (req, res) => {
    db.prepare('DELETE FROM auth_tokens WHERE token_hash = ?').run(hashToken((req.get('authorization') ?? '').slice(7)))
    res.status(204).end()
  })

  app.get('/api/me', requireAuth, (req, res) => void res.json((req as Authed).user))

  // ---------- users (admin) ----------
  app.post('/api/users', requireAuth, requireRole('admin'), (req, res) => {
    const { email, name, role, password } = req.body ?? {}
    if (typeof email !== 'string' || !EMAIL.test(email)) return fail(res, 400, 'invalid_email')
    if (typeof name !== 'string' || !name.trim()) return fail(res, 400, 'invalid_name')
    if (role !== 'agent' && role !== 'admin' && role !== 'customer') return fail(res, 400, 'invalid_role')
    if (typeof password !== 'string' || password.length < 8) return fail(res, 400, 'weak_password')
    const clean = email.trim().toLowerCase()
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(clean)) return fail(res, 409, 'email_taken')
    const info = db.prepare('INSERT INTO users (email, name, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(clean, name.trim(), role, hashPassword(password), now())
    res.status(201).json({ id: Number(info.lastInsertRowid), email: clean, name: name.trim(), role })
  })

  app.get('/api/staff', requireAuth, staffOnly, (_req, res) => {
    res.json(db.prepare("SELECT id, name, role FROM users WHERE role IN ('agent','admin') ORDER BY name").all())
  })

  // ---------- tickets ----------
  const TICKET_SELECT = `
    SELECT t.id, t.subject, t.status, t.priority, t.version, t.created_at, t.updated_at, t.due_at,
           t.customer_id, c.name AS customer_name, t.assignee_id, a.name AS assignee_name
    FROM tickets t
    JOIN users c ON c.id = t.customer_id
    LEFT JOIN users a ON a.id = t.assignee_id`

  app.get('/api/tickets', requireAuth, (req, res) => {
    const u = (req as Authed).user
    const where: string[] = []
    const args: (string | number)[] = []
    if (!isStaff(u.role)) { where.push('t.customer_id = ?'); args.push(u.id) }
    const q = req.query
    if (typeof q.status === 'string' && q.status) {
      if (!STATUSES.includes(q.status as Status)) return fail(res, 400, 'invalid_status')
      where.push('t.status = ?'); args.push(q.status)
    }
    if (typeof q.priority === 'string' && q.priority) {
      if (!PRIORITIES.includes(q.priority as Priority)) return fail(res, 400, 'invalid_priority')
      where.push('t.priority = ?'); args.push(q.priority)
    }
    if (isStaff(u.role)) {
      if (q.assignee === 'me') { where.push('t.assignee_id = ?'); args.push(u.id) }
      else if (q.assignee === 'unassigned') where.push('t.assignee_id IS NULL')
    }
    if (q.overdue === '1') { where.push("t.status NOT IN ('resolved','closed') AND t.due_at < ?"); args.push(now()) }
    if (typeof q.q === 'string' && q.q.trim()) {
      const like = `%${q.q.trim().replace(/[%_\\]/g, (m) => '\\' + m)}%`
      where.push("(t.subject LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\')"); args.push(like, like)
    }
    const clause = where.length ? ' WHERE ' + where.join(' AND ') : ''
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM tickets t${clause}`).get(...args) as { n: number }).n
    const page = Math.max(1, Math.floor(Number(q.page)) || 1)
    const rows = db.prepare(`${TICKET_SELECT}${clause} ORDER BY t.updated_at DESC, t.id DESC LIMIT ? OFFSET ?`)
      .all(...args, PAGE_SIZE, (page - 1) * PAGE_SIZE)
    res.json({ items: rows, total, page, pageSize: PAGE_SIZE })
  })

  app.post('/api/tickets', requireAuth, (req, res) => {
    const u = (req as Authed).user
    const { subject, description } = req.body ?? {}
    if (typeof subject !== 'string' || subject.trim().length < 3 || subject.length > 120) return fail(res, 400, 'invalid_subject')
    if (typeof description !== 'string' || description.trim().length < 5 || description.length > 4000) return fail(res, 400, 'invalid_description')
    // Only staff choose a priority; customer tickets start as "normal".
    let priority: Priority = 'normal'
    if (req.body.priority !== undefined) {
      if (!isStaff(u.role)) return fail(res, 403, 'forbidden')
      if (!PRIORITIES.includes(req.body.priority)) return fail(res, 400, 'invalid_priority')
      priority = req.body.priority
    }
    const t = now()
    const id = tx(() => {
      const info = db.prepare('INSERT INTO tickets (subject, description, priority, customer_id, created_at, updated_at, due_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(subject.trim(), description.trim(), priority, u.id, t, t, dueAt(t, priority))
      const tid = Number(info.lastInsertRowid)
      audit(tid, u.id, 'ticket_created', { priority })
      return tid
    })
    res.status(201).json({ id })
  })

  function loadDetail(u: User, id: number) {
    const t = getTicket(id)
    if (!t || !canSee(u, t)) return undefined
    const staff = isStaff(u.role)
    const ticket = db.prepare(`${TICKET_SELECT} WHERE t.id = ?`).get(id) as Row
    const comments = db.prepare(`SELECT m.id, m.body, m.internal, m.created_at, m.author_id, u.name AS author_name, u.role AS author_role
        FROM comments m JOIN users u ON u.id = m.author_id
        WHERE m.ticket_id = ? ${staff ? '' : 'AND m.internal = 0'} ORDER BY m.id`).all(id)
    const history = staff
      ? db.prepare(`SELECT l.id, l.action, l.detail, l.created_at, u.name AS actor_name FROM audit_log l JOIN users u ON u.id = l.actor_id WHERE l.ticket_id = ? ORDER BY l.id`).all(id)
          .map((r) => ({ ...r, detail: JSON.parse((r as Row).detail as string) }))
      : []
    return { ...ticket, description: t.description, comments, history }
  }

  app.get('/api/tickets/:id', requireAuth, (req, res) => {
    const detail = loadDetail((req as Authed).user, Number(req.params.id))
    if (!detail) return fail(res, 404, 'not_found')
    res.json(detail)
  })

  app.patch('/api/tickets/:id', requireAuth, (req, res) => {
    const u = (req as Authed).user
    const id = Number(req.params.id)
    const t = getTicket(id)
    if (!t || !canSee(u, t)) return fail(res, 404, 'not_found')
    const { version, status, priority, assigneeId } = req.body ?? {}
    if (!Number.isInteger(version)) return fail(res, 400, 'version_required')
    if (version !== t.version) return fail(res, 409, 'conflict') // someone else changed it first
    const staff = isStaff(u.role)
    if (!staff && (priority !== undefined || assigneeId !== undefined)) return fail(res, 403, 'forbidden')

    const sets: string[] = []
    const args: (string | number | null)[] = []
    const events: [string, object][] = []
    const from = t.status as Status

    if (status !== undefined) {
      if (!STATUSES.includes(status)) return fail(res, 400, 'invalid_status')
      if (status !== from) {
        if (!canTransition(u.role, from, status)) return fail(res, 422, 'invalid_transition')
        sets.push('status = ?'); args.push(status)
        events.push([from === 'resolved' && status === 'open' ? 'ticket_reopened' : 'status_changed', { from, to: status }])
      }
    }
    if (priority !== undefined && priority !== t.priority) {
      if (!PRIORITIES.includes(priority)) return fail(res, 400, 'invalid_priority')
      sets.push('priority = ?', 'due_at = ?'); args.push(priority, dueAt(t.created_at as number, priority))
      events.push(['priority_changed', { from: t.priority, to: priority }])
    }
    if (assigneeId !== undefined && assigneeId !== t.assignee_id) {
      if (assigneeId !== null) {
        const a = db.prepare("SELECT id FROM users WHERE id = ? AND role IN ('agent','admin')").get(assigneeId)
        if (!a) return fail(res, 400, 'invalid_assignee')
      }
      // Agents can take a ticket for themselves or release their own; admins can reassign anyone.
      const ownAction = assigneeId === u.id || (assigneeId === null && t.assignee_id === u.id)
      if (u.role === 'agent' && !ownAction) return fail(res, 403, 'forbidden')
      sets.push('assignee_id = ?'); args.push(assigneeId)
      events.push(['assigned', { from: t.assignee_id, to: assigneeId }])
    }
    if (!sets.length) return fail(res, 400, 'no_changes')

    tx(() => {
      db.prepare(`UPDATE tickets SET ${sets.join(', ')}, version = version + 1, updated_at = ? WHERE id = ?`).run(...args, now(), id)
      for (const [action, detail] of events) audit(id, u.id, action, detail)
    })
    res.json(loadDetail(u, id))
  })

  app.post('/api/tickets/:id/comments', requireAuth, (req, res) => {
    const u = (req as Authed).user
    const id = Number(req.params.id)
    const t = getTicket(id)
    if (!t || !canSee(u, t)) return fail(res, 404, 'not_found')
    const { body } = req.body ?? {}
    const internal = req.body?.internal === true
    if (typeof body !== 'string' || !body.trim() || body.length > 4000) return fail(res, 400, 'invalid_body')
    if (internal && !isStaff(u.role)) return fail(res, 403, 'forbidden')
    if (t.status === 'closed') return fail(res, 422, 'ticket_closed')

    tx(() => {
      db.prepare('INSERT INTO comments (ticket_id, author_id, body, internal, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, u.id, body.trim(), internal ? 1 : 0, now())
      audit(id, u.id, internal ? 'internal_note_added' : 'reply_added')
      let status = t.status as Status
      if (!isStaff(u.role)) {
        status = statusAfterCustomerReply(status, t.assignee_id !== null)
        if (status !== t.status) audit(id, u.id, 'status_changed', { from: t.status, to: status, reason: 'customer_reply' })
      }
      db.prepare('UPDATE tickets SET status = ?, version = version + 1, updated_at = ? WHERE id = ?').run(status, now(), id)
    })
    res.status(201).json(loadDetail(u, id))
  })

  // ---------- staff dashboard and audit ----------
  app.get('/api/dashboard', requireAuth, staffOnly, (req, res) => {
    const u = (req as Authed).user
    const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]))
    for (const r of db.prepare('SELECT status, COUNT(*) AS n FROM tickets GROUP BY status').all() as { status: string; n: number }[]) byStatus[r.status] = r.n
    const count = (sql: string, ...a: number[]) => (db.prepare(sql).get(...a) as { n: number }).n
    res.json({
      byStatus,
      overdue: count("SELECT COUNT(*) AS n FROM tickets WHERE status NOT IN ('resolved','closed') AND due_at < ?", now()),
      unassigned: count("SELECT COUNT(*) AS n FROM tickets WHERE assignee_id IS NULL AND status NOT IN ('resolved','closed')"),
      mine: count("SELECT COUNT(*) AS n FROM tickets WHERE assignee_id = ? AND status NOT IN ('resolved','closed')", u.id),
    })
  })

  app.get('/api/audit', requireAuth, requireRole('admin'), (_req, res) => {
    const rows = db.prepare(`SELECT l.id, l.ticket_id, l.action, l.detail, l.created_at, u.name AS actor_name
      FROM audit_log l JOIN users u ON u.id = l.actor_id ORDER BY l.id DESC LIMIT 100`).all()
    res.json(rows.map((r) => ({ ...r, detail: JSON.parse((r as Row).detail as string) })))
  })

  app.use('/api', (_req, res) => fail(res, 404, 'not_found'))
  if (opts.staticDir) app.use(express.static(opts.staticDir))

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if ('type' in err && err.type === 'entity.parse.failed') return fail(res, 400, 'bad_json')
    console.error(err)
    fail(res, 500, 'server_error')
  })
  return app
}
