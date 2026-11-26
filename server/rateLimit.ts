/** Fixed-window counter kept in memory. Good enough for a single-process demo. */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>()
  private max: number
  private windowMs: number
  private now: () => number

  constructor(max: number, windowMs: number, now: () => number = Date.now) {
    this.max = max
    this.windowMs = windowMs
    this.now = now
  }

  private entry(key: string) {
    const e = this.hits.get(key)
    if (e && e.resetAt > this.now()) return e
    this.hits.delete(key)
    return undefined
  }

  /** True when the key has used up its allowance. */
  blocked(key: string): boolean {
    return (this.entry(key)?.count ?? 0) >= this.max
  }

  /** Seconds until the window resets (for the Retry-After header). */
  retryAfter(key: string): number {
    const e = this.entry(key)
    return e ? Math.ceil((e.resetAt - this.now()) / 1000) : 0
  }

  hit(key: string): void {
    const e = this.entry(key)
    if (e) e.count++
    else this.hits.set(key, { count: 1, resetAt: this.now() + this.windowMs })
    if (this.hits.size > 10_000) this.sweep()
  }

  reset(key: string): void {
    this.hits.delete(key)
  }

  private sweep() {
    for (const k of this.hits.keys()) this.entry(k)
  }
}
