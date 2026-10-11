'use client'

import { FormEvent, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  BellRing,
  Check,
  ChevronDown,
  Clock,
  ExternalLink,
  Flame,
  Link2,
  Loader2,
  LogOut,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  TrendingDown,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { OfferCard } from '@/components/offer-card'
import { StoreMark, storeLabel } from '@/components/store-mark'
import { ThemeToggle } from '@/components/theme-toggle'
import type { CompareOffer } from '@/lib/compare'
import { formatPrice } from '@/lib/scraper/price'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api'

type Product = {
  id: number
  url: string
  offerUrl: string
  title: string
  store: string
  image?: string
  price: string
  target: string
  priceValue: number
  targetValue: number
  currency: string
  status: 'Monitoring' | 'Price Dropped!'
  change?: string
  scannedAt?: string
  checkIntervalHours: number
}

type User = { id: number; email: string; name: string | null }

type HistoryPoint = { priceValue: number; price: string; checkedAt: string }
type Notice = { text: string; tone: 'ok' | 'error' }

type SearchResults = { query: string; source: string; offers: CompareOffer[] }

const FREQUENCIES = [
  { hours: 1, label: 'Every hour' },
  { hours: 6, label: 'Every 6 hours' },
  { hours: 12, label: 'Every 12 hours' },
  { hours: 24, label: 'Every 24 hours' },
]

async function readErrorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string | { message?: string } } | null
  const error = body?.error
  if (typeof error === 'string') return error || `Request failed (HTTP ${response.status}). Please try again.`
  if (error && typeof error.message === 'string') return error.message
  return `Request failed (HTTP ${response.status}). Please try again.`
}

function relativeTime(iso?: string): string | undefined {
  if (!iso) return undefined
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return 'moments ago'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

function Sparkline({ points, currency }: { points: HistoryPoint[]; currency: string }) {
  if (points.length === 0) return <p className="history-empty">No scans recorded yet.</p>
  const asc = [...points].reverse()
  const values = asc.map((point) => point.priceValue)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const width = 100
  const height = 36
  const pad = 3
  const coords = values.map((value, index) => {
    const x = pad + (index / Math.max(1, values.length - 1)) * (width - pad * 2)
    const y = pad + (1 - (value - min) / range) * (height - pad * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const last = asc[asc.length - 1]!

  return (
    <div className="history-panel-body">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="sparkline"
        role="img"
        aria-label="Price history chart"
      >
        <polyline
          points={coords.join(' ')}
          fill="none"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="history-stats">
        <span>
          Low <strong>{formatPrice(min, currency)}</strong>
        </span>
        <span>
          High <strong>{formatPrice(max, currency)}</strong>
        </span>
        <span>
          Latest <strong>{last.price}</strong>
        </span>
        <span>
          Checked <strong>{relativeTime(last.checkedAt) ?? 'just now'}</strong>
        </span>
      </div>
    </div>
  )
}

function ProductCard({
  product,
  onUpdated,
  onDeleted,
  onNotice,
}: {
  product: Product
  onUpdated: (product: Product) => void
  onDeleted: (id: number) => void
  onNotice: (notice: Notice) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [targetDraft, setTargetDraft] = useState(String(product.targetValue))
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [history, setHistory] = useState<HistoryPoint[] | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [emailDraft, setEmailDraft] = useState('')
  const [addedEmails, setAddedEmails] = useState<string[]>([])
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    function onDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  async function saveTarget(event: FormEvent) {
    event.preventDefault()
    const value = Number(targetDraft.replace(/[^0-9.]/g, ''))
    if (!Number.isFinite(value) || value <= 0) {
      onNotice({ text: 'Enter a valid alert price greater than zero.', tone: 'error' })
      return
    }
    setSaving(true)
    try {
      const response = await fetch(`${API_BASE}/products/${product.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetValue: value }),
      })
      if (!response.ok) {
        onNotice({ text: await readErrorMessage(response), tone: 'error' })
        return
      }
      const data = (await response.json()) as { product: Product }
      onUpdated(data.product)
      setEditing(false)
      onNotice({ text: `Alert price updated for “${data.product.title}”.`, tone: 'ok' })
    } catch {
      onNotice({ text: 'Could not reach the server. Please try again.', tone: 'error' })
    } finally {
      setSaving(false)
    }
  }

  async function toggleHistory() {
    if (historyOpen) {
      setHistoryOpen(false)
      return
    }
    setHistoryOpen(true)
    if (history) return
    setHistoryLoading(true)
    try {
      const response = await fetch(`${API_BASE}/products/${product.id}/history`)
      if (!response.ok) {
        onNotice({ text: await readErrorMessage(response), tone: 'error' })
        setHistoryOpen(false)
        return
      }
      const data = (await response.json()) as { history: HistoryPoint[] }
      setHistory(data.history)
    } catch {
      onNotice({ text: 'Could not load price history.', tone: 'error' })
      setHistoryOpen(false)
    } finally {
      setHistoryLoading(false)
    }
  }

  async function addEmail(event: FormEvent) {
    event.preventDefault()
    const email = emailDraft.trim().toLowerCase()
    if (!email) return
    try {
      const response = await fetch(`${API_BASE}/products/${product.id}/emails`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (!response.ok) {
        onNotice({ text: await readErrorMessage(response), tone: 'error' })
        return
      }
      setAddedEmails((current) => (current.includes(email) ? current : [...current, email]))
      setEmailDraft('')
      onNotice({ text: `Price-drop alerts will be emailed to ${email}.`, tone: 'ok' })
    } catch {
      onNotice({ text: 'Could not add the alert email.', tone: 'error' })
    }
  }

  async function remove() {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setSaving(true)
    try {
      const response = await fetch(`${API_BASE}/products/${product.id}`, { method: 'DELETE' })
      if (!response.ok) {
        onNotice({ text: await readErrorMessage(response), tone: 'error' })
        return
      }
      onDeleted(product.id)
      onNotice({ text: `Stopped tracking “${product.title}”.`, tone: 'ok' })
    } catch {
      onNotice({ text: 'Could not delete the product.', tone: 'error' })
    } finally {
      setSaving(false)
      setConfirmDelete(false)
      setMenuOpen(false)
    }
  }

  const dropped = product.status === 'Price Dropped!'

  return (
    <article className="product-card group">
      <div className="product-art">
        <img src={product.image || '/placeholder.jpg'} alt="" loading="lazy" width={200} height={140} />
        <div className="product-glow" />
        <a
          className="icon-button product-link"
          href={product.offerUrl || product.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${product.title} on ${storeLabel(product.store)}`}
        >
          <ExternalLink aria-hidden="true" />
        </a>
      </div>
      <div className="product-details">
        <div className="product-heading">
          <div className="store-line">
            <StoreMark store={product.store} />
            <span>{storeLabel(product.store)}</span>
          </div>
          <span className={`status-badge ${dropped ? 'dropped' : ''}`}>
            <span className="status-dot" />
            {product.status}
          </span>
        </div>
        <h3>{product.title}</h3>
        <div className="price-grid">
          <div>
            <span>Current price</span>
            <strong>{product.price}</strong>
          </div>
          <div>
            <span>Your alert price</span>
            <strong>{product.target}</strong>
          </div>
          {product.change && (
            <span className="price-change">
              <TrendingDown aria-hidden="true" /> {product.change}
            </span>
          )}
        </div>
        <div className="card-footer">
          <span>
            <Clock aria-hidden="true" /> Every {product.checkIntervalHours}h
          </span>
          <div className="manage-wrap" ref={menuRef}>
            <button
              type="button"
              onClick={() => {
                setMenuOpen((open) => !open)
                setConfirmDelete(false)
              }}
              aria-expanded={menuOpen}
            >
              Manage <ChevronDown aria-hidden="true" />
            </button>
            {menuOpen && (
              <div className="manage-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  onClick={() => {
                    setEditing((value) => !value)
                    setTargetDraft(String(product.targetValue))
                    setHistoryOpen(false)
                  }}
                >
                  <Pencil aria-hidden="true" /> Edit alert price
                </button>
                <button type="button" role="menuitem" className="menu-item" onClick={toggleHistory}>
                  <TrendingDown aria-hidden="true" /> {historyOpen ? 'Hide price history' : 'Price history'}
                </button>
                <div className="menu-sep" />
                <form className="menu-email" onSubmit={addEmail}>
                  <label className="sr-only" htmlFor={`email-${product.id}`}>
                    Alert email
                  </label>
                  <input
                    id={`email-${product.id}`}
                    type="email"
                    value={emailDraft}
                    onChange={(event) => setEmailDraft(event.target.value)}
                    placeholder="you@example.com"
                  />
                  <button type="submit">Add</button>
                </form>
                {addedEmails.length > 0 && (
                  <p className="menu-emails">
                    Alerts on:{' '}
                    {addedEmails.map((email) => (
                      <span key={email}>{email}</span>
                    ))}
                  </p>
                )}
                <div className="menu-sep" />
                <button
                  type="button"
                  role="menuitem"
                  className={`menu-item danger ${confirmDelete ? 'armed' : ''}`}
                  onClick={remove}
                >
                  <Trash2 aria-hidden="true" />{' '}
                  {saving ? 'Working…' : confirmDelete ? 'Confirm delete' : 'Delete product'}
                </button>
              </div>
            )}
          </div>
        </div>
        {editing && (
          <form className="target-edit" onSubmit={saveTarget}>
            <label htmlFor={`target-${product.id}`}>New alert price ({product.currency})</label>
            <div>
              <input
                id={`target-${product.id}`}
                inputMode="decimal"
                value={targetDraft}
                onChange={(event) => setTargetDraft(event.target.value)}
              />
              <button type="submit" disabled={saving}>
                {saving ? <Loader2 className="spin" aria-hidden="true" /> : 'Save'}
              </button>
              <button type="button" className="ghost" onClick={() => setEditing(false)}>
                <X aria-hidden="true" />
              </button>
            </div>
          </form>
        )}
        {historyOpen && (
          <div className="history-panel">
            {historyLoading || !history ? (
              <p className="history-empty">
                <Loader2 className="spin" aria-hidden="true" /> Loading history…
              </p>
            ) : (
              <Sparkline points={history} currency={product.currency} />
            )}
          </div>
        )}
      </div>
    </article>
  )
}

function AccountMenu({
  user,
  onSignedOut,
}: {
  user: User
  onSignedOut: () => void
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function signOut() {
    try {
      await fetch(`${API_BASE}/auth/logout`, { method: 'POST' })
    } finally {
      setOpen(false)
      onSignedOut()
    }
  }

  const initial = (user.name || user.email).trim().charAt(0).toUpperCase()

  return (
    <div className="account-wrap" ref={wrapRef}>
      <button
        type="button"
        className="account-chip"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="account-avatar">{initial}</span>
        {user.name || user.email.split('@')[0]}
        <ChevronDown aria-hidden="true" />
      </button>
      {open && (
        <div className="account-menu" role="menu">
          <p>{user.email}</p>
          <button type="button" role="menuitem" className="menu-item" onClick={signOut}>
            <LogOut aria-hidden="true" /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}

export default function Page() {
  const [mode, setMode] = useState<'search' | 'link'>('search')
  const [input, setInput] = useState('')
  const [email, setEmail] = useState('')
  const [frequency, setFrequency] = useState(6)
  const [products, setProducts] = useState<Product[]>([])
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [busy, setBusy] = useState(false)
  const [comparing, setComparing] = useState(false)
  const [results, setResults] = useState<SearchResults | null>(null)
  const [trackingOffer, setTrackingOffer] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`${API_BASE}/products`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await readErrorMessage(response))
        return (await response.json()) as { products: Product[]; user: User | null }
      })
      .then((data) => {
        if (cancelled) return
        setProducts(data.products ?? [])
        setUser(data.user ?? null)
      })
      .catch((error: Error) => {
        if (!cancelled) setNotice({ text: error.message, tone: 'error' })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const droppedCount = products.filter((product) => product.status === 'Price Dropped!').length
  const newestScan = products
    .map((product) => product.scannedAt)
    .filter(Boolean)
    .sort()
    .at(-1) as string | undefined

  async function trackProduct(payload: Record<string, unknown>): Promise<Product | null> {
    const response = await fetch(`${API_BASE}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, email: email.trim() || undefined, frequency }),
    })
    const data = (await response.json().catch(() => ({}))) as { product?: Product }
    if (!response.ok || !data.product) {
      setNotice({ text: await readErrorMessage(response), tone: 'error' })
      return null
    }
    const saved = data.product
    setProducts((current) => [
      saved,
      ...current.filter((product) => product.id !== saved.id && product.url !== saved.url),
    ])
    return saved
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = input.trim()
    if (!value) {
      setNotice({
        text:
          mode === 'search' ? 'Type a product name to search.' : 'Paste a product link to start tracking.',
        tone: 'error',
      })
      return
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setNotice({ text: 'That email address does not look valid.', tone: 'error' })
      return
    }

    if (mode === 'link') {
      if (!user) {
        setNotice({ text: 'Sign in to start tracking products.', tone: 'error' })
        return
      }
      setBusy(true)
      setNotice({ text: 'Scanning the live product page… this can take a few seconds.', tone: 'ok' })
      try {
        const saved = await trackProduct({ url: value })
        if (saved) {
          setInput('')
          setEmail('')
          setNotice({
            text: `Now tracking “${saved.title}” at ${saved.price} · checked every ${saved.checkIntervalHours}h`,
            tone: 'ok',
          })
        }
      } catch {
        setNotice({ text: 'Could not reach the server. Please try again.', tone: 'error' })
      } finally {
        setBusy(false)
      }
      return
    }

    // Search mode: run the unified comparison across every store.
    setComparing(true)
    setResults(null)
    setNotice({
      text: 'Comparing live prices across stores… this can take a few seconds.',
      tone: 'ok',
    })
    try {
      const response = await fetch(`${API_BASE}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: value }),
      })
      const data = (await response.json().catch(() => ({}))) as {
        offers?: CompareOffer[]
        query?: string
        source?: string
      }
      if (!response.ok || !data.offers || data.offers.length === 0) {
        setNotice({ text: await readErrorMessage(response), tone: 'error' })
        return
      }
      setResults({ query: data.query ?? value, source: data.source ?? 'search', offers: data.offers })
      setNotice(null)
    } catch {
      setNotice({ text: 'Could not reach the server. Please try again.', tone: 'error' })
    } finally {
      setComparing(false)
    }
  }

  async function trackOffer(offer: CompareOffer) {
    if (!user) {
      setNotice({ text: 'Sign in to track this product and get price alerts.', tone: 'error' })
      return
    }
    setTrackingOffer(offer.link)
    try {
      const saved = await trackProduct({ url: offer.link })
      if (saved) {
        setEmail('')
        setNotice({
          text: `Now tracking “${saved.title}” at ${saved.price} from ${saved.store}.`,
          tone: 'ok',
        })
      }
    } catch {
      setNotice({ text: 'Could not reach the server. Please try again.', tone: 'error' })
    } finally {
      setTrackingOffer(null)
    }
  }

  return (
    <main className="dashboard-shell">
      <div className="dashboard-grid" aria-hidden="true" />
      <header className="topbar">
        <a href="#top" className="brand" aria-label="PriceAura home">
          <span className="brand-icon">
            <Sparkles aria-hidden="true" />
          </span>
          <span>
            Price<span>Aura</span>
          </span>
        </a>
        <div className="topbar-actions">
          <div className="live-pill">
            <span />
            {products.length > 0
              ? `${products.length} product${products.length === 1 ? '' : 's'} monitored`
              : 'Ready to track'}
          </div>
          <ThemeToggle />
          {user ? (
            <AccountMenu
              user={user}
              onSignedOut={() => {
                setUser(null)
                setProducts([])
                setResults(null)
              }}
            />
          ) : (
            <Link href="/login" className="account-chip">
              <span className="account-avatar">
                <Plus aria-hidden="true" style={{ width: 12, height: 12 }} />
              </span>
              Sign in
            </Link>
          )}
          <Button
            className="premium-button"
            onClick={() => document.getElementById('track')?.scrollIntoView({ behavior: 'smooth' })}
          >
            <Plus data-icon="inline-start" /> Track a product
          </Button>
        </div>
      </header>

      <section className="hero-section" id="top">
        <div className="eyebrow">
          <span className="eyebrow-line" /> PRICE INTELLIGENCE, REIMAGINED
        </div>
        <div className="hero-copy">
          <div>
            <h1>
              Never overpay
              <br />
              <em>again.</em>
            </h1>
            <p>
              Search any product and PriceAura compares live listings across Amazon, Flipkart, Walmart, eBay
              and more — then watches the price for you.
            </p>
          </div>
          <div className="hero-stat">
            <span className="stat-number">{products.length}</span>
            <span className="stat-label">
              {droppedCount > 0
                ? `${droppedCount} price drop${droppedCount === 1 ? '' : 's'} ready right now`
                : 'products on your watchlist'}{' '}
              <TrendingDown aria-hidden="true" />
            </span>
          </div>
        </div>
      </section>

      <section className="track-panel" id="track" aria-labelledby="track-heading">
        <div className="section-label">
          <span className="number-label">01</span>
          <div>
            <h2 id="track-heading">Search & compare</h2>
            <p>
              Search by name to compare live offers across stores, or paste a direct product link to start
              tracking it.
            </p>
          </div>
        </div>
        <form className="tracking-form" onSubmit={handleSubmit}>
          <div className="mode-toggle" role="tablist" aria-label="Tracking mode">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'search'}
              className={mode === 'search' ? 'active' : ''}
              onClick={() => setMode('search')}
            >
              <Search aria-hidden="true" /> Search by name
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'link'}
              className={mode === 'link' ? 'active' : ''}
              onClick={() => setMode('link')}
            >
              <Link2 aria-hidden="true" /> Paste a link
            </button>
          </div>
          <label className="url-field">
            {mode === 'search' ? <Search aria-hidden="true" /> : <Link2 aria-hidden="true" />}
            <span className="sr-only">{mode === 'search' ? 'Product name' : 'Product URL'}</span>
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={
                mode === 'search'
                  ? 'e.g. Sony WH-1000XM5 headphones'
                  : 'Paste an Amazon, Flipkart or eBay product URL'
              }
            />
          </label>
          <label className="frequency-field">
            <span className="sr-only">Check frequency</span>
            <select value={frequency} onChange={(event) => setFrequency(Number(event.target.value))}>
              {FREQUENCIES.map((option) => (
                <option key={option.hours} value={option.hours}>
                  {option.label}
                </option>
              ))}
            </select>
            <ChevronDown aria-hidden="true" />
          </label>
          <Button type="submit" className="start-button" disabled={busy || comparing}>
            {busy || comparing ? (
              <Loader2 className="spin" data-icon="inline-start" aria-hidden="true" />
            ) : (
              <Plus data-icon="inline-start" />
            )}
            {comparing ? 'Comparing…' : busy ? 'Tracking…' : mode === 'search' ? 'Compare prices' : 'Start tracking'}
          </Button>
          <label className="email-field">
            <BellRing aria-hidden="true" />
            <span className="sr-only">Alert email (optional)</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Email me when it drops (optional) — you can unsubscribe anytime"
            />
          </label>
        </form>
        <div className="form-meta">
          <span>
            <Check aria-hidden="true" /> Compares Amazon, Flipkart, Walmart, eBay &amp; more
          </span>
          <span>
            <Flame aria-hidden="true" /> Email alerts on price drops &amp; all-time lows
          </span>
          {notice && (
            <span className={`notice ${notice.tone === 'error' ? 'error' : ''}`} role="status">
              {notice.text}
            </span>
          )}
        </div>
      </section>

      {results && (
        <section className="compare-panel" aria-labelledby="compare-heading">
          <div className="section-label">
            <span className="number-label">02</span>
            <div>
              <h2 id="compare-heading">Price comparison</h2>
              <p>
                Live offers for “<strong>{results.query}</strong>”, cheapest first.
              </p>
            </div>
          </div>
          <div className="compare-meta">
            <span className="source-pill">
              <Sparkles aria-hidden="true" /> {results.source}
            </span>
            <span>
              <strong>{results.offers.length}</strong> store
              {results.offers.length === 1 ? '' : 's'} found
            </span>
            {!user && (
              <div className="signin-nudge">
                <span>Sign in to track any of these offers and get alerted when the price drops.</span>
                <Link href="/login">Sign in</Link>
              </div>
            )}
          </div>
          <div className="offer-grid">
            {results.offers.map((offer) => (
              <OfferCard key={offer.link} offer={offer} tracking={trackingOffer} onTrack={trackOffer} />
            ))}
          </div>
        </section>
      )}

      <section className="products-section" aria-labelledby="products-heading">
        <div className="products-header">
          <div className="section-label">
            <span className="number-label">{results ? '03' : '02'}</span>
            <div>
              <h2 id="products-heading">Currently tracked products</h2>
              <p>Your watchlist, all in one calm place.</p>
            </div>
          </div>
          <span className="product-count">
            {products.length} product{products.length === 1 ? '' : 's'}
            {droppedCount > 0 ? (
              <>
                {' '}
                <span>·</span> {droppedCount} drop{droppedCount === 1 ? '' : 's'} detected
              </>
            ) : null}
          </span>
        </div>
        {loading ? (
          <div className="products-grid" aria-hidden="true">
            {Array.from({ length: 4 }, (_, index) => (
              <div className="skeleton-card" key={index}>
                <div className="skeleton-art" />
                <div className="skeleton-lines">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="empty-state">
            <Sparkles aria-hidden="true" />
            <h3>{user ? 'Nothing tracked yet' : 'Your watchlist lives here'}</h3>
            <p>
              {user
                ? 'Search for any product above — we compare live offers across major stores and alert you when the price drops.'
                : 'Sign in to track products, get email alerts on price drops and all-time lows, and keep your watchlist in one place.'}
            </p>
            {!user && (
              <div className="signin-nudge">
                <span>It takes a few seconds to create an account.</span>
                <Link href="/login">Create account</Link>
              </div>
            )}
          </div>
        ) : (
          <div className="products-grid">
            {products.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                onUpdated={(updated) =>
                  setProducts((current) => current.map((item) => (item.id === updated.id ? updated : item)))
                }
                onDeleted={(id) => setProducts((current) => current.filter((item) => item.id !== id))}
                onNotice={setNotice}
              />
            ))}
          </div>
        )}
      </section>

      <footer className="dashboard-footer">
        <span>
          PriceAura / Personal price intelligence · <Link href="/privacy">Privacy</Link>
          {' · '}
          <Link href="/terms">Terms</Link>
        </span>
        <span>
          {products.length > 0 ? (
            <>Data refreshed {relativeTime(newestScan) ?? 'moments ago'}</>
          ) : (
            'Waiting for first scan'
          )}{' '}
          <span className="footer-dot" />
        </span>
      </footer>
    </main>
  )
}
