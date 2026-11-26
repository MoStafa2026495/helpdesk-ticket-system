import { useEffect, useState } from 'react'
import { api, errorText } from './api'
import type { AuditItem } from './types'
import { card, fmt } from './ui'

export function AuditPage({ onOpen }: { onOpen: (id: number) => void }) {
  const [rows, setRows] = useState<AuditItem[]>([])
  const [error, setError] = useState('')
  useEffect(() => { api.audit().then(setRows).catch((e) => setError(errorText(e))) }, [])
  return (
    <div className={card}>
      <h2 className="mb-3 text-lg font-semibold">Audit log (latest 100, admin only)</h2>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">When</th><th>Who</th><th>Action</th><th>Ticket</th><th>Detail</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-slate-100">
              <td className="py-2 text-slate-500">{fmt(r.created_at)}</td><td>{r.actor_name}</td><td>{r.action}</td>
              <td><button className="text-indigo-700 hover:underline" onClick={() => onOpen(r.ticket_id)}>#{r.ticket_id}</button></td>
              <td className="text-xs text-slate-500">{JSON.stringify(r.detail)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
