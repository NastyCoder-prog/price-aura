// app/api/auth/register/route.ts
// POST /api/auth/register -> create an account and sign in { email, password, name? }

import { NextRequest, NextResponse } from 'next/server'
import { classifyError } from '@/lib/api-error'
import {
  SESSION_COOKIE,
  assertValidEmail,
  assertValidPassword,
  createSessionToken,
  hashPassword,
  sessionCookieOptions,
  sessionExpiryDate,
  sessionTokenHash,
} from '@/lib/auth'
import { createSession, createUser } from '@/lib/db'
import { clientIp, rateLimit } from '@/lib/ratelimit'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const limit = await rateLimit(`auth-register:${clientIp(request.headers)}`, 10, 60 * 60 * 1000)
  if (!limit.ok) {
    return NextResponse.json(
      { error: { code: 'rate_limited', message: 'Too many attempts. Try again shortly.' } },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    )
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      email?: unknown
      password?: unknown
      name?: unknown
    }

    const email = assertValidEmail(String(body.email ?? ''))
    const password = assertValidPassword(String(body.password ?? ''))
    const name = String(body.name ?? '').trim().slice(0, 80) || null

    const passwordHash = await hashPassword(password)
    const user = await createUser({ email, passwordHash, name })
    if (!user) {
      return NextResponse.json(
        { error: { code: 'email_in_use', message: 'An account with that email already exists.' } },
        { status: 409 },
      )
    }

    const token = createSessionToken()
    await createSession(sessionTokenHash(token), user.id, sessionExpiryDate())

    const response = NextResponse.json({ user }, { status: 201 })
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions())
    return response
  } catch (error) {
    const { message, status, code } = classifyError('api/auth/register', error)
    return NextResponse.json({ error: { code, message } }, { status })
  }
}
