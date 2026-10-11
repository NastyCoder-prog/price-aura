// app/api/auth/logout/route.ts
// POST /api/auth/logout -> end the session and clear the cookie

import { NextRequest, NextResponse } from 'next/server'
import { classifyError } from '@/lib/api-error'
import { SESSION_COOKIE, sessionTokenHash } from '@/lib/auth'
import { deleteSession } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get(SESSION_COOKIE)?.value
    if (token) await deleteSession(sessionTokenHash(token))

    const response = NextResponse.json({ ok: true })
    response.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0, httpOnly: true, sameSite: 'lax' })
    return response
  } catch (error) {
    const { message, status, code } = classifyError('api/auth/logout', error)
    return NextResponse.json({ error: { code, message } }, { status })
  }
}
