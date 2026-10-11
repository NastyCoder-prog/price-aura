// lib/auth.ts
// Account security primitives: password hashing (scrypt via node:crypto — no
// native deps, safe on Vercel) and opaque session tokens stored server-side.

import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { ApiError } from './api-error'

export const SESSION_COOKIE = 'priceaura_session'
export const SESSION_TTL_DAYS = 30

const SCRYPT_KEYLEN = 64
const SCRYPT_COST = 16384 // ~32MB of memory per hash (OWASP floor for scrypt)

function runScrypt(password: Buffer, salt: Buffer, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, (error, derived) =>
      error ? reject(error) : resolve(derived),
    )
  })
}

// "scrypt$16384$<salt>$<hash>" — self-describing so cost can change later.
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const derived = await runScrypt(Buffer.from(password, 'utf8'), salt, SCRYPT_KEYLEN)
  return `scrypt$${SCRYPT_COST}$${salt.toString('base64url')}$${derived.toString('base64url')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, , saltB64, hashB64] = String(stored ?? '').split('$')
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false
  const salt = Buffer.from(saltB64, 'base64url')
  const expected = Buffer.from(hashB64, 'base64url')
  if (expected.length !== SCRYPT_KEYLEN) return false
  const derived = await runScrypt(Buffer.from(password, 'utf8'), salt, expected.length)
  return timingSafeEqual(derived, expected)
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Thrown as an ApiError so route handlers can surface it directly.
export function assertValidEmail(email: string): string {
  const normalized = String(email ?? '').trim().toLowerCase()
  if (!EMAIL_RE.test(normalized) || normalized.length > 254) {
    throw new ApiError('That email address does not look valid.', 400, 'bad_email')
  }
  return normalized
}

export function assertValidPassword(password: string): string {
  const value = String(password ?? '')
  if (value.length < 8) {
    throw new ApiError('Choose a password with at least 8 characters.', 400, 'weak_password')
  }
  if (value.length > 200) {
    throw new ApiError('That password is too long.', 400, 'weak_password')
  }
  return value
}

export function createSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

// Sessions are looked up by hashing the cookie value, so a database leak
// never exposes usable tokens.
export function sessionTokenHash(token: string): string {
  return createHash('sha256').update(String(token ?? '')).digest('hex')
}

export function sessionExpiryDate(): Date {
  return new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000)
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  }
}
