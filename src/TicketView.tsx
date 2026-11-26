import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError, errorText } from './api'
import { canTransition, isStaff, PRIORITIES, STATUSES, type Status } from './lib/policy'
import type { Me, Staff, TicketDetail } from './types'
import { btnGhost, btnPrimary, card, fmt, inputCls, PriorityBadge, SlaBadge, STATUS_LABEL, StatusBadge } from './ui'

const ACTION_TEXT: Record<string, string> = {
  ticket_created: 'created the ticket', status_changed: 'changed status', ticket_reopened: 'reopened the ticket', priority_changed: 'changed priority',
  assigned: 'changed the assignee', reply_added: 'sent a reply', internal_note_added: 'added an internal note',
}

export function TicketView({ id, me, onBack }: { id: number; me: Me; onBack: () => void }) {
  const staff = isStaff(me.role)
  const [t, setT] = useState<TicketDetail | null>(null)
  const [team, setTeam] = useState<Staff[]>([])
  const [body, setBody] = useState('')
  const [internal, setInternal] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try { setT(await api.ticket(id)) } catch (e) { setError(errorText(e)) }
  }, [id])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
    if (staff) api.staff().then(setTeam).catch(() => undefined)
  }, [load, staff])

  async function change(patch: object) {
    if (!t) return
    setBusy(true); setError('')
    try {
      setT(await api.update(id, { version: t.version, ...patch }))
    } catch (e) {
      setError(errorText(e))
      if (e instanceof ApiError && e.status === 409) await load()
    } finally { setBusy(false) }
  }

  async function reply(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError('')
    try { setT(await api.comment(id, body, internal)); setBody(''); setInternal(false) } catch (err) { setError(errorText(err)) } finally { setBusy(false) }
  }

  if (!t) return <p className="text-slate-500">{error || 'Loading...'}</p>
  const nextStatuses = STATUSES.filter((s) => canTransition(me.role, t.status, s))

  return (
    <div>
      <button onClick={onBack} className="mb-3 text-sm text-indigo-700 hover:underline">&larr; Back to tickets</button>
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div>
          <div className={card}>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold">#{t.id} {t.subject}</h2>
              <StatusBadge s={t.status} />
            </div>
            <p className="mt-1 text-xs text-slate-500">Opened by {t.customer_name} on {fmt(t.created_at)}</p>
            <p className="mt-3 whitespace-pre-wrap text-sm">{t.description}</p>
          </div>

          <h3 className="mb-2 mt-5 text-sm font-semibold text-slate-600">Conversation</h3>
          <ul className="space-y-3">
            {t.comments.map((c) => (
              <li key={c.id} className={`rounded-xl p-3 text-sm ring-1 ${c.internal ? 'bg-amber-50 ring-amber-200' : c.author_role === 'customer' ? 'bg-white ring-slate-200' : 'bg-indigo-50 ring-indigo-100'}`}>
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="font-medium text-slate-700">{c.author_name}</span>
                  <span className="capitalize">{c.author_role}</span>
                  {c.internal === 1 && <span className="rounded bg-amber-200 px-1.5 text-amber-900">Internal note, customer cannot see</span>}
                  <span>{fmt(c.created_at)}</span>
                </div>
                <p className="whitespace-pre-wrap">{c.body}</p>
              </li>
            ))}
            {t.comments.length === 0 && <li className="text-sm text-slate-500">No replies yet.</li>}
          </ul>

          {t.status !== 'closed' && (
            <form onSubmit={reply} className={`${card} mt-4`}>
              <textarea required rows={3} maxLength={4000} aria-label="Message" placeholder={internal ? 'Internal note (staff only)' : 'Write a reply'} className={inputCls} value={body} onChange={(e) => setBody(e.target.value)} />
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button disabled={busy} className={btnPrimary}>{internal ? 'Add note' : 'Send reply'}</button>
                {staff && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note (staff only)</label>}
              </div>
            </form>
          )}
          {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
        </div>

        <aside className="space-y-4">
          <div className={card}>
            <h3 className="mb-3 text-sm font-semibold text-slate-600">Details</h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Priority</dt><dd><PriorityBadge p={t.priority} /></dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">SLA</dt><dd><SlaBadge t={t} /></dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Assignee</dt><dd>{t.assignee_name ?? 'Unassigned'}</dd></div>
            </dl>
            {staff ? (
              <div className="mt-4 space-y-3">
                <label className="block text-xs">Status
                  <select className={inputCls} disabled={busy} value={t.status} onChange={(e) => change({ status: e.target.value })}>
                    <option value={t.status}>{STATUS_LABEL[t.status]}</option>
                    {nextStatuses.map((s: Status) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </select>
                </label>
                <label className="block text-xs">Priority
                  <select className={inputCls} disabled={busy} value={t.priority} onChange={(e) => change({ priority: e.target.value })}>
                    {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </label>
                <label className="block text-xs">Assignee
                  <select className={inputCls} disabled={busy || (me.role === 'agent' && t.assignee_id !== null && t.assignee_id !== me.id)} value={t.assignee_id ?? ''} onChange={(e) => change({ assigneeId: e.target.value === '' ? null : Number(e.target.value) })}>
                    <option value="">Unassigned</option>
                    {team.filter((s) => me.role === 'admin' || s.id === me.id || s.id === t.assignee_id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
                {t.assignee_id !== me.id && <button className={btnGhost} disabled={busy || (me.role === 'agent' && t.assignee_id !== null)} onClick={() => change({ assigneeId: me.id })}>Assign to me</button>}
              </div>
            ) : (
              <div className="mt-4 flex gap-2">
                {t.status === 'resolved' && <button className={btnGhost} disabled={busy} onClick={() => change({ status: 'open' })}>Reopen</button>}
                {t.status !== 'closed' && <button className={btnGhost} disabled={busy} onClick={() => change({ status: 'closed' })}>Close ticket</button>}
              </div>
            )}
          </div>

          {staff && (
            <div className={card}>
              <h3 className="mb-3 text-sm font-semibold text-slate-600">Audit trail</h3>
              <ol className="space-y-2 text-xs">
                {t.history.map((h) => (
                  <li key={h.id}>
                    <span className="font-medium">{h.actor_name}</span> {ACTION_TEXT[h.action] ?? h.action}
                    {'from' in h.detail && 'to' in h.detail && h.action !== 'assigned' && <span className="text-slate-500">: {String(h.detail.from)} &rarr; {String(h.detail.to)}</span>}
                    <div className="text-slate-400">{fmt(h.created_at)}</div>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
