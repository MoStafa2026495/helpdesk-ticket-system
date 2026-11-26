import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, getToken, setToken } from './api'
import { AuditPage } from './AuditPage'
import { isStaff } from './lib/policy'
import { Login } from './Login'
import { NewTicket } from './NewTicket'
import { TicketList } from './TicketList'
import { TicketView } from './TicketView'
import type { Me } from './types'
import { btnGhost, btnPrimary } from './ui'

type View = { name: 'list' } | { name: 'new' } | { name: 'audit' } | { name: 'ticket'; id: number }

export default function App() {
  const [me, setMe] = useState<Me | null>(null)
  const [checking, setChecking] = useState(!!getToken())
  const [view, setView] = useState<View>({ name: 'list' })

  const loadMe = useCallback(async () => {
    if (!getToken()) return setChecking(false)
    try { setMe(await api.me()) } catch (e) { if (e instanceof ApiError && e.status === 401) setToken('') } finally { setChecking(false) }
  }, [])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadMe()
  }, [loadMe])

  async function logout() {
    await api.logout().catch(() => undefined)
    setToken(''); setMe(null); setView({ name: 'list' })
  }

  if (checking) return <p className="p-6 text-center text-slate-500">Loading...</p>

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <button onClick={() => setView({ name: 'list' })} className="text-left">
          <h1 className="text-2xl font-bold">Helpdesk</h1>
          <p className="text-xs text-slate-500">Support ticket system, demo project with fictional data</p>
        </button>
        {me && (
          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-slate-600 sm:inline">{me.name} <span className="rounded bg-slate-200 px-1.5 text-xs capitalize">{me.role}</span></span>
            {!isStaff(me.role) && <button className={btnPrimary} onClick={() => setView({ name: 'new' })}>New ticket</button>}
            {me.role === 'admin' && <button className={btnGhost} onClick={() => setView({ name: 'audit' })}>Audit log</button>}
            <button className={btnGhost} onClick={logout}>Log out</button>
          </div>
        )}
      </header>
      {!me ? (
        <Login onDone={loadMe} />
      ) : view.name === 'new' ? (
        <NewTicket onCreated={(id) => setView({ name: 'ticket', id })} onCancel={() => setView({ name: 'list' })} />
      ) : view.name === 'ticket' ? (
        <TicketView key={view.id} id={view.id} me={me} onBack={() => setView({ name: 'list' })} />
      ) : view.name === 'audit' ? (
        <AuditPage onOpen={(id) => setView({ name: 'ticket', id })} />
      ) : (
        <TicketList me={me} onOpen={(id) => setView({ name: 'ticket', id })} />
      )}
      <footer className="mt-10 text-center text-xs text-slate-500">Demo project built with AI assistance. No real users or customer data.</footer>
    </div>
  )
}
