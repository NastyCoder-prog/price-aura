// app/api/auth/session/route.ts
// GET /api/auth/session -> the signed-in user, or { user: null }

import { NextRequest, NextResponse } from 'next/server'
import { classifyError } from '@/lib/api-error'
import { currentUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    return NextResponse.json({ user: await currentUser(request) })
  } catch (error) {
    const { message, status, code } = classifyError('api/auth/session', error)
    return NextResponse.json({ error: { code, message } }, { status })
  }
}
