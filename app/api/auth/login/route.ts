// app/api/auth/login/route.ts
// POST /api/auth/login -> sign in { email, password }

import { NextRequest, NextResponse } from 'next/server'
import { classifyError } from '@/lib/api-error'
import {
  SESSION_COOKIE,
  assertValidEmail,
  createSessionToken,
  hashPassword,
  sessionCookieOptions,
  sessionExpiryDate,
  sessionTokenHash,
  verifyPassword,
} from '@/lib/auth'
import { createSession, getUserAuth } from '@/lib/db'
import { clientIp, rateLimit } from '@/lib/ratelimit'

export const dynamic = 'force-dynamic'

const GENERIC_FAILURE = 'That email and password combination did not match an account.'

export async function POST(request: NextRequest) {
  const limit = await rateLimit(`auth-login:${clientIp(request.headers)}`, 15, 60 * 60 * 1000)
  if (!limit.ok) {
    return NextResponse.json(
      { error: { code: 'rate_limited', message: 'Too many attempts. Try again shortly.' } },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    )
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { email?: unknown; password?: unknown }
    const email = assertValidEmail(String(body.email ?? ''))
    const password = String(body.password ?? '')

    const account = await getUserAuth(email)
    // Hash even when the account is missing so response timing does not
    // reveal whether an email is registered.
    const valid = account
      ? await verifyPassword(password, account.passwordHash)
      : Boolean(await hashPassword(password))

    if (!account || !valid) {
      return NextResponse.json(
        { error: { code: 'invalid_credentials', message: GENERIC_FAILURE } },
        { status: 401 },
      )
    }

    const token = createSessionToken()
    await createSession(sessionTokenHash(token), account.id, sessionExpiryDate())

    const response = NextResponse.json({
      user: { id: account.id, email: account.email, name: account.name },
    })
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions())
    return response
  } catch (error) {
    const { message, status, code } = classifyError('api/auth/login', error)
    return NextResponse.json({ error: { code, message } }, { status })
  }
}
