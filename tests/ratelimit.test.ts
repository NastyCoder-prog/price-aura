import { describe, expect, it } from 'vitest'
import { clientIp, rateLimit } from '@/lib/ratelimit'

describe('rateLimit (in-memory fallback)', () => {
  it('allows up to the limit then blocks', async () => {
    const key = `unit-${Math.random()}`
    const windowMs = 60_000

    expect((await rateLimit(key, 3, windowMs)).ok).toBe(true)
    expect((await rateLimit(key, 3, windowMs)).ok).toBe(true)
    expect((await rateLimit(key, 3, windowMs)).ok).toBe(true)

    const blocked = await rateLimit(key, 3, windowMs)
    expect(blocked.ok).toBe(false)
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('tracks independent keys separately', async () => {
    const windowMs = 60_000
    await rateLimit(`unit-a-${Math.random()}`, 1, windowMs)
    const other = await rateLimit(`unit-b-${Math.random()}`, 1, windowMs)
    expect(other.ok).toBe(true)
  })
})

describe('clientIp', () => {
  it('reads the first forwarded hop', () => {
    const headers = new Headers({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' })
    expect(clientIp(headers)).toBe('1.2.3.4')
  })

  it('falls back safely', () => {
    expect(clientIp(new Headers())).toBe('unknown')
  })
})
