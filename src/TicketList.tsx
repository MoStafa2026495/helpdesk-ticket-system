import { useCallback, useEffect, useState } from 'react'
import { api, errorText } from './api'
import { PRIORITIES, STATUSES, isStaff } from './lib/policy'
import type { Dashboard, Me, Page } from './types'
import { btnGhost, card, fmt, inputCls, PriorityBadge, SlaBadge, STATUS_LABEL, StatusBadge } from './ui'

export function TicketList({ me, onOpen }: { me: Me; onOpen: (id: number) => void }) {
  const staff = isStaff(me.role)
  const [filters, setFilters] = useState({ status: '', priority: '', assignee: '', overdue: '', q: '' })
  const [page, setPage] = useState(1)
  const [data, setData] = useState<Page | null>(null)
  const [dash, setDash] = useState<Dashboard | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const params: Record<string, string> = { page: String(page) }
      for (const [k, v] of Object.entries(filters)) if (v) params[k] = v
      const [d, dsh] = await Promise.all([api.tickets(params), staff ? api.dashboard() : Promise.resolve(null)])
      setData(d); setDash(dsh); setError('')
    } catch (e) {
      setError(errorText(e))
    }
  }, [filters, page, staff])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const set = (k: keyof typeof filters, v: string) => { setFilters({ ...filters, [k]: v }); setPage(1) }
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <div>
      {dash && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Mine (active)" value={dash.mine} onClick={() => setFilters({ status: '', priority: '', assignee: 'me', overdue: '', q: '' })} />
          <Tile label="Unassigned" value={dash.unassigned} onClick={() => setFilters({ status: '', priority: '', assignee: 'unassigned', overdue: '', q: '' })} />
          <Tile label="Overdue" value={dash.overdue} danger onClick={() => setFilters({ status: '', priority: '', assignee: '', overdue: '1', q: '' })} />
          <Tile label="Open" value={dash.byStatus.open} onClick={() => setFilters({ status: 'open', priority: '', assignee: '', overdue: '', q: '' })} />
        </div>
      )}
      <div className={`${card} mb-4 flex flex-wrap items-end gap-3`}>
        <label className="grow text-xs">Search
          <input className={inputCls} placeholder="Subject or description" value={filters.q} onChange={(e) => set('q', e.target.value)} />
        </label>
        <label className="text-xs">Status
          <select className={inputCls} value={filters.status} onChange={(e) => set('status', e.target.value)}>
            <option value="">All</option>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        {staff && (
          <>
            <label className="text-xs">Priority
              <select className={inputCls} value={filters.priority} onChange={(e) => set('priority', e.target.value)}>
                <option value="">All</option>{PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label className="text-xs">Assignee
              <select className={inputCls} value={filters.assignee} onChange={(e) => set('assignee', e.target.value)}>
                <option value="">Anyone</option><option value="me">Me</option><option value="unassigned">Unassigned</option>
              </select>
            </label>
          </>
        )}
        <button className={btnGhost} onClick={() => { setFilters({ status: '', priority: '', assignee: '', overdue: '', q: '' }); setPage(1) }}>Reset</button>
      </div>
      {filters.overdue && <p className="mb-2 text-sm text-red-700">Showing overdue tickets only.</p>}
      {error && <p role="alert" className="mb-3 text-sm text-red-600">{error}</p>}
      <div className={`${card} overflow-x-auto p-0`}>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
            <tr><th className="p-3">#</th><th className="p-3">Subject</th><th className="p-3">Status</th>{staff && <th className="p-3">Priority</th>}{staff && <th className="p-3">Customer</th>}{staff && <th className="p-3">Assignee</th>}{staff && <th className="p-3">SLA</th>}<th className="p-3">Updated</th></tr>
          </thead>
          <tbody>
            {data?.items.map((t) => (
              <tr key={t.id} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50" onClick={() => onOpen(t.id)}>
                <td className="p-3 text-slate-400">{t.id}</td>
                <td className="p-3 font-medium"><button className="text-left hover:underline" onClick={() => onOpen(t.id)}>{t.subject}</button></td>
                <td className="p-3"><StatusBadge s={t.status} /></td>
                {staff && <td className="p-3"><PriorityBadge p={t.priority} /></td>}
                {staff && <td className="p-3">{t.customer_name}</td>}
                {staff && <td className="p-3">{t.assignee_name ?? <span className="text-slate-400">Unassigned</span>}</td>}
                {staff && <td className="p-3"><SlaBadge t={t} /></td>}
                <td className="p-3 text-slate-500">{fmt(t.updated_at)}</td>
              </tr>
            ))}
            {data && data.items.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-slate-500">No tickets match.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
        <span>{data?.total ?? 0} tickets</span>
        <div className="flex items-center gap-2">
          <button className={btnGhost} disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span>Page {page} of {pages}</span>
          <button className={btnGhost} disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      </div>
    </div>
  )
}

function Tile({ label, value, danger, onClick }: { label: string; value: number; danger?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`${card} text-left hover:ring-indigo-300`}>
      <div className="text-sm text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${danger && value > 0 ? 'text-red-600' : ''}`}>{value}</div>
    </button>
  )
}
