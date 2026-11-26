import type { Priority, Role, Status } from './lib/policy'

export interface Me { id: number; email: string; name: string; role: Role }
export interface TicketRow {
  id: number; subject: string; status: Status; priority: Priority; version: number
  created_at: number; updated_at: number; due_at: number
  customer_id: number; customer_name: string; assignee_id: number | null; assignee_name: string | null
}
export interface Comment { id: number; body: string; internal: 0 | 1; created_at: number; author_id: number; author_name: string; author_role: Role }
export interface HistoryItem { id: number; action: string; detail: Record<string, unknown>; created_at: number; actor_name: string }
export interface TicketDetail extends TicketRow { description: string; comments: Comment[]; history: HistoryItem[] }
export interface Page { items: TicketRow[]; total: number; page: number; pageSize: number }
export interface Staff { id: number; name: string; role: Role }
export interface Dashboard { byStatus: Record<Status, number>; overdue: number; unassigned: number; mine: number }
export interface AuditItem { id: number; ticket_id: number; action: string; detail: Record<string, unknown>; created_at: number; actor_name: string }
