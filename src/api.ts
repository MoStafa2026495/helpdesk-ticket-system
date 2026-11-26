import type { AuditItem, Dashboard, Me, Page, Staff, TicketDetail } from './types'

export class ApiError extends Error {
  status: number
  constructor(status: number, code: string) {
    super(code)
    this.status = status
  }
}

let token = localStorage.getItem('hd-token') ?? ''
export const getToken = () => token
export function setToken(t: string) {
  token = t
  if (t) localStorage.setItem('hd-token', t)
  else localStorage.removeItem('hd-token')
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = res.status === 204 ? null : await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, data?.error ?? 'server_error')
  return data as T
}

export const api = {
  login: (email: string, password: string) => request<{ token: string }>('POST', '/api/auth/login', { email, password }),
  register: (name: string, email: string, password: string) => request<{ token: string }>('POST', '/api/auth/register', { name, email, password }),
  logout: () => request<null>('POST', '/api/auth/logout'),
  me: () => request<Me>('GET', '/api/me'),
  staff: () => request<Staff[]>('GET', '/api/staff'),
  dashboard: () => request<Dashboard>('GET', '/api/dashboard'),
  tickets: (params: Record<string, string>) => request<Page>('GET', '/api/tickets?' + new URLSearchParams(params)),
  ticket: (id: number) => request<TicketDetail>('GET', `/api/tickets/${id}`),
  createTicket: (subject: string, description: string) => request<{ id: number }>('POST', '/api/tickets', { subject, description }),
  update: (id: number, patch: object) => request<TicketDetail>('PATCH', `/api/tickets/${id}`, patch),
  comment: (id: number, body: string, internal: boolean) => request<TicketDetail>('POST', `/api/tickets/${id}/comments`, { body, internal }),
  audit: () => request<AuditItem[]>('GET', '/api/audit'),
}

const MESSAGES: Record<string, string> = {
  bad_credentials: 'Wrong email or password.',
  email_taken: 'That email is already registered.',
  invalid_email: 'Enter a valid email.',
  weak_password: 'Password must be at least 8 characters.',
  invalid_name: 'Enter your name.',
  too_many_attempts: 'Too many attempts. Wait a few minutes and try again.',
  conflict: 'Someone else changed this ticket. It was reloaded, try again.',
  invalid_transition: 'That status change is not allowed from the current status.',
  ticket_closed: 'This ticket is closed.',
  invalid_subject: 'Subject must be 3 to 120 characters.',
  invalid_description: 'Description must be at least 5 characters.',
  invalid_body: 'Write a message first.',
  forbidden: 'You are not allowed to do that.',
}
export const errorText = (e: unknown) => (e instanceof ApiError ? (MESSAGES[e.message] ?? 'Something went wrong.') : 'Could not reach the server.')
