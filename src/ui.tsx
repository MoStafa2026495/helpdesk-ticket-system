import type { Priority, Status } from './lib/policy'
import { isOverdue } from './lib/policy'

export const STATUS_LABEL: Record<Status, string> = {
  open: 'Open', in_progress: 'In progress', waiting_customer: 'Waiting for customer', resolved: 'Resolved', closed: 'Closed',
}
const STATUS_STYLE: Record<Status, string> = {
  open: 'bg-sky-100 text-sky-800', in_progress: 'bg-indigo-100 text-indigo-800', waiting_customer: 'bg-amber-100 text-amber-800',
  resolved: 'bg-emerald-100 text-emerald-800', closed: 'bg-slate-200 text-slate-700',
}
const PRIORITY_STYLE: Record<Priority, string> = {
  low: 'bg-slate-100 text-slate-700', normal: 'bg-slate-100 text-slate-800', high: 'bg-orange-100 text-orange-800', urgent: 'bg-red-100 text-red-800',
}
const pill = 'inline-block rounded-full px-2 py-0.5 text-xs font-medium'

export const StatusBadge = ({ s }: { s: Status }) => <span className={`${pill} ${STATUS_STYLE[s]}`}>{STATUS_LABEL[s]}</span>
export const PriorityBadge = ({ p }: { p: Priority }) => <span className={`${pill} capitalize ${PRIORITY_STYLE[p]}`}>{p}</span>

export function SlaBadge({ t }: { t: { status: Status; due_at: number } }) {
  if (t.status === 'resolved' || t.status === 'closed') return <span className="text-xs text-slate-400">-</span>
  const late = isOverdue(t, Date.now())
  return <span className={`${pill} ${late ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-700'}`}>{late ? 'Overdue' : 'Due ' + timeFromNow(t.due_at)}</span>
}

export function timeFromNow(ms: number) {
  const diff = ms - Date.now()
  const h = Math.round(Math.abs(diff) / 3_600_000)
  const text = h < 1 ? 'under 1h' : h < 48 ? `${h}h` : `${Math.round(h / 24)}d`
  return diff >= 0 ? `in ${text}` : `${text} ago`
}
export const fmt = (ms: number) => new Date(ms).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

export const inputCls = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-2 focus:outline-indigo-500'
export const btnPrimary = 'rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50'
export const btnGhost = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-100 disabled:opacity-50'
export const card = 'rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200'
