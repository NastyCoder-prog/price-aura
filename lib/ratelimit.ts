// lib/ratelimit.ts
// Best-effort abuse protection for the write endpoints.
//
// On Vercel each serverless instance has its own memory, so the in-memory
// fallback only limits bursts that land on the same instance. Setting
// UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN upgrades this to a real
// distributed limiter (free tier at upstash.com) with no code changes.

const memory = new Map<string, { count: number; resetAt: number }>()

const UPSTASH_URL = () => process.env.UPSTASH_REDIS_REST_URL || ''
const UPSTASH_TOKEN = () => process.env.UPSTASH_REDIS_REST_TOKEN || ''

export interface RateLimitResult {
  ok: boolean
  remaining: number
  retryAfterSeconds: number
}

async function upstashHit(
  key: string,
  windowMs: number,
): Promise<{ count: number; retryAfterSeconds: number }> {
  const url = UPSTASH_URL().replace(/\/$/, '')
  const response = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([
      ['INCR', key],
      ['PEXPIRE', key, String(windowMs)],
      ['PTTL', key],
    ]),
  })

  if (!response.ok) {
    throw new Error(`upstash HTTP ${response.status}`)
  }

  const results = (await response.json()) as { result?: number | string }[]
  const count = Number(results[0]?.result ?? 0)
  const ttlMs = Number(results[2]?.result ?? windowMs)
  return { count, retryAfterSeconds: Math.max(1, Math.ceil(ttlMs / 1000)) }
}

function memoryHit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now()
  const entry = memory.get(key)
  if (!entry || entry.resetAt <= now) {
    memory.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true, remaining: limit - 1, retryAfterSeconds: 0 }
  }
  entry.count += 1
  if (entry.count > limit) {
    return { ok: false, remaining: 0, retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000) }
  }
  return { ok: true, remaining: limit - entry.count, retryAfterSeconds: 0 }
}

// Records one hit against `key`. Returns ok=false when the caller should
// answer 429. `limit` requests are allowed per `windowMs`.
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const scopedKey = `priceaura:rl:${key}:${Math.floor(Date.now() / windowMs)}`

  if (UPSTASH_URL() && UPSTASH_TOKEN()) {
    try {
      const { count, retryAfterSeconds } = await upstashHit(scopedKey, windowMs)
      if (count > limit) {
        return { ok: false, remaining: 0, retryAfterSeconds }
      }
      return { ok: true, remaining: Math.max(0, limit - count), retryAfterSeconds: 0 }
    } catch (error) {
      // Redis outage must not take the API down — fail open.
      console.warn('[ratelimit] upstash error; allowing request', error)
      return { ok: true, remaining: 999, retryAfterSeconds: 0 }
    }
  }

  return memoryHit(key, limit, windowMs)
}

// Best-effort client IP from Vercel/proxy headers.
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]!.trim()
  return headers.get('x-real-ip') || 'unknown'
}
