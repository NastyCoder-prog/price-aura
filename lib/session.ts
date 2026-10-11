// lib/session.ts
// Reads the signed-in user straight from the request cookie. Route handlers
// call `requireUser` so an unauthenticated request gets a clean 401 instead
// of falling through to the database.

import { NextRequest, NextResponse } from 'next/server'
import { ApiError } from './api-error'
import { SESSION_COOKIE, sessionTokenHash } from './auth'
import { getSessionUser, type ApiUser } from './db'

export async function currentUser(request: NextRequest): Promise<ApiUser | null> {
  const token = request.cookies.get(SESSION_COOKIE)?.value
  if (!token) return null
  return getSessionUser(sessionTokenHash(token))
}

// Throws ApiError(401) when nobody is signed in.
export async function requireUser(request: NextRequest): Promise<ApiUser> {
  const user = await currentUser(request)
  if (!user) {
    throw new ApiError('Please sign in to manage your watchlist.', 401, 'auth_required')
  }
  return user
}

export function unauthorized() {
  return NextResponse.json(
    { error: { code: 'auth_required', message: 'Please sign in to manage your watchlist.' } },
    { status: 401 },
  )
}
