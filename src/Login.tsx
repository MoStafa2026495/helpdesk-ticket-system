import { useState, type FormEvent } from 'react'
import { api, errorText, setToken } from './api'
import { btnPrimary, card, inputCls } from './ui'

export function Login({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      const r = mode === 'login' ? await api.login(email, password) : await api.register(name, email, password)
      setToken(r.token)
      onDone()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className={`${card} mx-auto mt-12 max-w-sm`}>
      <h2 className="mb-4 text-lg font-semibold">{mode === 'login' ? 'Log in' : 'Create a customer account'}</h2>
      {mode === 'register' && (
        <label className="mb-3 block text-sm">Name
          <input required className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
      )}
      <label className="block text-sm">Email
        <input type="email" required autoComplete="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="mt-3 block text-sm">Password
        <input type="password" required minLength={8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
      <button disabled={busy} className={`${btnPrimary} mt-4 w-full`}>{mode === 'login' ? 'Log in' : 'Sign up'}</button>
      <button type="button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')} className="mt-3 w-full text-sm text-indigo-700 hover:underline">
        {mode === 'login' ? 'New customer? Create an account' : 'Have an account? Log in'}
      </button>
    </form>
  )
}
