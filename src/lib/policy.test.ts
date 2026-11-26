import { describe, expect, it } from 'vitest'
import { canTransition, dueAt, isOverdue, statusAfterCustomerReply } from './policy'

describe('policy', () => {
  it('staff follow the allowed flow', () => {
    expect(canTransition('agent', 'open', 'in_progress')).toBe(true)
    expect(canTransition('agent', 'open', 'closed')).toBe(false)
    expect(canTransition('admin', 'resolved', 'closed')).toBe(true)
    expect(canTransition('agent', 'closed', 'open')).toBe(false)
  })
  it('customers can only close or reopen', () => {
    expect(canTransition('customer', 'open', 'closed')).toBe(true)
    expect(canTransition('customer', 'open', 'resolved')).toBe(false)
    expect(canTransition('customer', 'resolved', 'open')).toBe(true)
    expect(canTransition('customer', 'closed', 'open')).toBe(false)
  })
  it('computes SLA deadlines and overdue state', () => {
    const h = 3_600_000
    expect(dueAt(0, 'urgent')).toBe(4 * h)
    expect(dueAt(0, 'low')).toBe(72 * h)
    expect(isOverdue({ status: 'open', due_at: 10 }, 20)).toBe(true)
    expect(isOverdue({ status: 'resolved', due_at: 10 }, 20)).toBe(false)
  })
  it('customer reply puts waiting tickets back in the queue', () => {
    expect(statusAfterCustomerReply('waiting_customer', true)).toBe('in_progress')
    expect(statusAfterCustomerReply('waiting_customer', false)).toBe('open')
    expect(statusAfterCustomerReply('resolved', true)).toBe('open')
    expect(statusAfterCustomerReply('open', false)).toBe('open')
  })
})
