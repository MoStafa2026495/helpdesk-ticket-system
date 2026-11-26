// Pure business rules, no database or HTTP. This is the part to learn first.

export type Role = 'customer' | 'agent' | 'admin'
export type Status = 'open' | 'in_progress' | 'waiting_customer' | 'resolved' | 'closed'
export type Priority = 'low' | 'normal' | 'high' | 'urgent'

export const STATUSES: Status[] = ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed']
export const PRIORITIES: Priority[] = ['low', 'normal', 'high', 'urgent']

/** Which status can follow which, for staff. */
const STAFF_FLOW: Record<Status, Status[]> = {
  open: ['in_progress', 'waiting_customer', 'resolved'],
  in_progress: ['open', 'waiting_customer', 'resolved'],
  waiting_customer: ['in_progress', 'resolved'],
  resolved: ['open', 'closed'],
  closed: [], // final
}

/** Customers can only close their own ticket, or reopen one that was resolved. */
const CUSTOMER_FLOW: Partial<Record<Status, Status[]>> = {
  open: ['closed'],
  in_progress: ['closed'],
  waiting_customer: ['closed'],
  resolved: ['open', 'closed'],
}

export const isStaff = (role: Role) => role === 'agent' || role === 'admin'

export function canTransition(role: Role, from: Status, to: Status): boolean {
  const flow = isStaff(role) ? STAFF_FLOW[from] : (CUSTOMER_FLOW[from] ?? [])
  return flow.includes(to)
}

/** Hours allowed to resolve a ticket, by priority. */
const SLA_HOURS: Record<Priority, number> = { urgent: 4, high: 8, normal: 24, low: 72 }

export const dueAt = (createdAt: number, priority: Priority) => createdAt + SLA_HOURS[priority] * 3_600_000

export const isOpenStatus = (s: Status) => s !== 'resolved' && s !== 'closed'

export const isOverdue = (t: { status: Status; due_at: number }, now: number) => isOpenStatus(t.status) && t.due_at < now

/** A customer replying to a ticket that was waiting on them puts it back in the queue. */
export function statusAfterCustomerReply(status: Status, hasAssignee: boolean): Status {
  if (status === 'waiting_customer') return hasAssignee ? 'in_progress' : 'open'
  if (status === 'resolved') return 'open'
  return status
}
