// app/login/page.tsx
// Account screen: sign in or create an account, then land on the dashboard.

'use client'

import { FormEvent, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2, Sparkles } from 'lucide-react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api'

type Mode = 'login' | 'register'

async function readErrorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string | { message?: string } } | null
  const error = body?.error
  if (typeof error === 'string') return error || `Request failed (HTTP ${response.status}). Please try again.`
  if (error && typeof error.message === 'string') return error.message
  return `Request failed (HTTP ${response.status}). Please try again.`
}

export default function LoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch(`${API_BASE}/auth/session`)
      .then((response) => (response.ok ? response.json() : { user: null }))
      .then((data: { user?: { email?: string } | null }) => {
        if (!cancelled && data.user) router.replace('/')
      })
      .catch(() => {
        // no session — stay on the sign-in screen
      })
      .finally(() => {
        if (!cancelled) setChecking(false)
      })
    return () => {
      cancelled = true
    }
  }, [router])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    if (!email.trim()) {
      setError('Enter your email address.')
      return
    }
    if (password.length < 8) {
      setError('Passwords are at least 8 characters.')
      return
    }

    setBusy(true)
    try {
      const response = await fetch(`${API_BASE}/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          password,
          name: mode === 'register' ? name.trim() || undefined : undefined,
        }),
      })
      if (!response.ok) {
        setError(await readErrorMessage(response))
        return
      }
      router.replace('/')
      router.refresh()
    } catch {
      setError('Could not reach the server. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-shell">
      <div className="auth-card">
        <Link href="/" className="auth-brand">
          <span className="brand-icon">
            <Sparkles aria-hidden="true" />
          </span>
          <span>
            Price<span>Aura</span>
          </span>
        </Link>

        <h1>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
        <p className="auth-sub">
          {mode === 'login'
            ? 'Sign in to see your watchlist and price alerts.'
            : 'Track products across stores and get emailed the moment the price drops.'}
        </p>

        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}

        <form className="auth-form" onSubmit={submit}>
          {mode === 'register' && (
            <div className="auth-field">
              <label htmlFor="name">Name (optional)</label>
              <input
                id="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Priya"
                autoComplete="name"
              />
            </div>
          )}
          <div className="auth-field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </div>
          <div className="auth-field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 8 characters"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
            />
          </div>
          <button type="submit" className="auth-submit" disabled={busy || checking}>
            {busy && <Loader2 className="spin" data-icon="inline-start" aria-hidden="true" />}
            {busy ? 'One moment…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p className="auth-switch">
          {mode === 'login' ? 'New to PriceAura?' : 'Already have an account?'}{' '}
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login')
              setError(null)
            }}
          >
            {mode === 'login' ? 'Create an account' : 'Sign in'}
          </button>
        </p>
        <Link href="/" className="auth-back">
          ← Back to the dashboard
        </Link>
      </div>
    </main>
  )
}
