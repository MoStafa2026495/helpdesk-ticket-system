import type { DatabaseSync } from 'node:sqlite'
import { hashPassword } from './auth.ts'
import { dueAt, type Priority, type Status } from '../src/lib/policy.ts'

export const DEMO_PASSWORD = 'demo-password-1'

/** Fictional demo data for a made-up company. Not real people. */
export function seedDemo(db: DatabaseSync, now = Date.now()) {
  const h = 3_600_000
  const hash = hashPassword(DEMO_PASSWORD)
  const user = (email: string, name: string, role: string) =>
    Number(db.prepare('INSERT INTO users (email, name, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(email, name, role, hash, now - 30 * 24 * h).lastInsertRowid)
  const admin = user('admin@demo.test', 'Dana Admin', 'admin')
  const sam = user('sam@demo.test', 'Sam Agent', 'agent')
  const lee = user('lee@demo.test', 'Lee Agent', 'agent')
  const c1 = user('maya@customer.test', 'Maya Customer', 'customer')
  const c2 = user('omar@customer.test', 'Omar Customer', 'customer')
  const c3 = user('nina@customer.test', 'Nina Customer', 'customer')

  const audit = (tid: number, actor: number, action: string, at: number, detail: object = {}) =>
    db.prepare('INSERT INTO audit_log (ticket_id, actor_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?)').run(tid, actor, action, JSON.stringify(detail), at)
  const comment = (tid: number, author: number, body: string, at: number, internal = 0) =>
    db.prepare('INSERT INTO comments (ticket_id, author_id, body, internal, created_at) VALUES (?, ?, ?, ?, ?)').run(tid, author, body, internal, at)

  function ticket(customer: number, subject: string, description: string, priority: Priority, status: Status, ageH: number, assignee: number | null) {
    const created = now - ageH * h
    const id = Number(db.prepare('INSERT INTO tickets (subject, description, priority, status, customer_id, assignee_id, created_at, updated_at, due_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(subject, description, priority, status, customer, assignee, created, created + h, dueAt(created, priority)).lastInsertRowid)
    audit(id, customer, 'ticket_created', created, { priority })
    return { id, created }
  }

  let t = ticket(c1, 'Cannot log in to the billing portal', 'I get "invalid session" every time I sign in since this morning.', 'high', 'in_progress', 5, sam)
  audit(t.id, sam, 'assigned', t.created + h, { from: null, to: sam }); audit(t.id, sam, 'status_changed', t.created + h, { from: 'open', to: 'in_progress' })
  comment(t.id, sam, 'Thanks Maya, I can see the error in our logs. Looking into it now.', t.created + h)
  comment(t.id, sam, 'Session cookie domain was changed in last deploy. Needs a config fix.', t.created + 2 * h, 1)

  t = ticket(c2, 'Invoice shows the wrong VAT number', 'Our VAT number on invoice #2041 is missing a digit.', 'normal', 'waiting_customer', 20, lee)
  audit(t.id, lee, 'status_changed', t.created + h, { from: 'open', to: 'waiting_customer' })
  comment(t.id, lee, 'Could you send the VAT number exactly as it should appear?', t.created + h)

  t = ticket(c3, 'Server down, production outage', 'Our API has returned 503 for 10 minutes.', 'urgent', 'open', 6, null)
  t = ticket(c1, 'Export to CSV is slow', 'Exporting 10k rows takes more than a minute.', 'low', 'open', 30, null)
  t = ticket(c2, 'Request: dark mode', 'Would love a dark theme for the dashboard.', 'low', 'resolved', 50, sam)
  audit(t.id, sam, 'status_changed', t.created + 5 * h, { from: 'open', to: 'resolved' })
  comment(t.id, sam, 'Added to the roadmap, closing this as resolved. Thanks!', t.created + 5 * h)
  t = ticket(c3, 'Password reset email never arrives', 'I tried three times, checked spam too.', 'high', 'in_progress', 30, lee)
  audit(t.id, lee, 'assigned', t.created + h, { from: null, to: lee })
  comment(t.id, lee, 'Mail provider shows a bounce for your domain. Checking with them.', t.created + 3 * h)
  ticket(c1, 'How do I add a team member?', 'Looking for the place to invite colleagues.', 'normal', 'open', 2, null)
  ticket(c2, 'Wrong currency on checkout', 'Prices show USD instead of SAR.', 'normal', 'open', 12, sam)
  ticket(c3, 'Typo on the pricing page', 'The word "enterprise" is misspelled in the footer.', 'low', 'open', 8, null)
  t = ticket(c3, 'Close my old account', 'Please close the account created by mistake.', 'low', 'closed', 90, admin)
  audit(t.id, admin, 'status_changed', t.created + h, { from: 'open', to: 'closed' })
  return { admin, sam, lee, c1, c2, c3 }
                                                                                                                     }
