import { useState, type FormEvent } from 'react'
import { api, errorText } from './api'
import { btnGhost, btnPrimary, card, inputCls } from './ui'

export function NewTicket({ onCreated, onCancel }: { onCreated: (id: number) => void; onCancel: () => void }) {
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      onCreated((await api.createTicket(subject, description)).id)
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className={`${card} max-w-2xl`}>
      <h2 className="mb-4 text-lg font-semibold">New ticket</h2>
      <label className="block text-sm">Subject
        <input required maxLength={120} className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)} />
      </label>
      <label className="mt-3 block text-sm">What happened?
        <textarea required rows={6} maxLength={4000} className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
      <div className="mt-4 flex gap-2">
        <button disabled={busy} className={btnPrimary}>Submit ticket</button>
        <button type="button" onClick={onCancel} className={btnGhost}>Cancel</button>
      </div>
    </form>
  )
}
