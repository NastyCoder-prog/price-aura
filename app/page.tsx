'use client'

import { FormEvent, useEffect, useState } from 'react'
import {
  BellRing,
  Check,
  ChevronDown,
  CircleUserRound,
  ExternalLink,
  Flame,
  Link2,
  Plus,
  Sparkles,
  TrendingDown,
  Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

// Where the Express backend lives (server/index.js).
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'

type Product = {
  id?: number
  url?: string
  title: string
  store: string
  image?: string
  price: string
  target: string
  priceValue?: number
  targetValue?: number
  status: 'Monitoring' | 'Price Dropped!'
  change?: string
  scannedAt?: string
  emails?: string[]
}

const initialProducts: Product[] = [
  {
    title: 'Apple AirPods Pro (2nd Generation)',
    store: 'amazon',
    price: '₹19,990',
    target: '₹18,500',
    status: 'Monitoring',
  },
  {
    title: 'Sony WH-1000XM5 Wireless Headphones',
    store: 'amazon',
    price: '₹24,990',
    target: '₹26,000',
    status: 'Price Dropped!',
    change: '−8.4%',
  },
  {
    title: 'Samsung Galaxy S24 Ultra 5G',
    store: 'flipkart',
    price: '₹1,09,999',
    target: '₹1,00,000',
    status: 'Monitoring',
  },
  {
    title: 'Logitech MX Master 3S Wireless Mouse',
    store: 'flipkart',
    price: '₹7,495',
    target: '₹6,999',
    status: 'Price Dropped!',
    change: '−12.1%',
  },
]

const STORE_LABELS: Record<string, string> = {
  amazon: 'Amazon.in',
  flipkart: 'Flipkart',
  myntra: 'Myntra',
  ajio: 'Ajio',
  nykaa: 'Nykaa',
  croma: 'Croma',
  meesho: 'Meesho',
}

function storeLabel(store: string) {
  return STORE_LABELS[store] ?? store.charAt(0).toUpperCase() + store.slice(1)
}

function StoreMark({ store }: { store: string }) {
  return (
    <span className={`store-mark ${store}`} aria-label={storeLabel(store)}>
      {store.charAt(0)}
    </span>
  )
}

function ProductCard({ product }: { product: Product }) {
  return (
    <article className="product-card group">
      <div className="product-art">
        <img src={product.image || '/placeholder.jpg'} alt="" />
        <div className="product-glow" />
        <button className="icon-button product-link" aria-label={`Open ${product.title}`}>
          <ExternalLink aria-hidden="true" />
        </button>
      </div>
      <div className="product-details">
        <div className="product-heading">
          <div className="store-line"><StoreMark store={product.store} /><span>{storeLabel(product.store)}</span></div>
          <span className={`status-badge ${product.status === 'Price Dropped!' ? 'dropped' : ''}`}>
            <span className="status-dot" />{product.status}
          </span>
        </div>
        <h3>{product.title}</h3>
        <div className="price-grid">
          <div><span>Current price</span><strong>{product.price}</strong></div>
          <div><span>Your alert price</span><strong>{product.target}</strong></div>
          {product.change && <span className="price-change"><TrendingDown aria-hidden="true" /> {product.change}</span>}
        </div>
        <div className="card-footer"><span><BellRing aria-hidden="true" /> Alerts on</span><button>Manage <ChevronDown aria-hidden="true" /></button></div>
      </div>
    </article>
  )
}

export default function Page() {
  const [url, setUrl] = useState('')
  const [frequency, setFrequency] = useState('Every 6 Hours')
  const [products, setProducts] = useState(initialProducts)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  // On page load, ask the backend for anything it has already saved.
  useEffect(() => {
    fetch(`${API_BASE}/products`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('Backend error'))))
      .then((data: { products?: Product[] }) => {
        const fromServer = data.products ?? []
        if (fromServer.length === 0) return
        setProducts((current) => {
          const knownUrls = new Set(current.map((product) => product.url).filter(Boolean))
          return [...fromServer.filter((product) => product.url && !knownUrls.has(product.url)), ...current]
        })
      })
      .catch(() => setNotice('Tip: run `pnpm server` in a second terminal so your links get saved.'))
  }, [])

  async function startTracking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = url.trim()
    if (!trimmed) {
      setNotice('Paste a product URL to start tracking.')
      return
    }

    setBusy(true)
    setNotice('Scanning the live product page… this can take a few seconds.')

    try {
      const response = await fetch(`${API_BASE}/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed, frequency }),
      })
      const data = await response.json()

      if (!response.ok) {
        setNotice(data.error || 'Something went wrong. Is the backend running?')
        return
      }

      const saved = data.product as Product
      setProducts((current) => [saved, ...current.filter((product) => product.url !== saved.url)])
      setUrl('')
      setNotice(`Tracking started · checking ${frequency.toLowerCase()}`)
    } catch {
      setNotice('Could not reach the backend. Start it with `pnpm server`.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="dashboard-shell">
      <div className="dashboard-grid" aria-hidden="true" />
      <header className="topbar">
        <a href="#top" className="brand" aria-label="PriceAura home"><span className="brand-icon"><Sparkles aria-hidden="true" /></span><span>Price<span>Aura</span></span></a>
        <div className="topbar-actions"><div className="live-pill"><span /> AI monitoring active</div><Button className="premium-button"><Zap data-icon="inline-start" /> Upgrade to Premium</Button><button className="profile-button" aria-label="Open profile menu"><CircleUserRound aria-hidden="true" /></button></div>
      </header>

      <section className="hero-section" id="top">
        <div className="eyebrow"><span className="eyebrow-line" /> PRICE INTELLIGENCE, REIMAGINED</div>
        <div className="hero-copy"><div><h1>Never overpay<br /><em>again.</em></h1><p>PriceAura watches the web for you, so you can buy at the right moment.</p></div><div className="hero-stat"><span className="stat-number">₹12,480</span><span className="stat-label">saved by our members this week <TrendingDown aria-hidden="true" /></span></div></div>
      </section>

      <section className="track-panel" aria-labelledby="track-heading">
        <div className="section-label"><span className="number-label">01</span><div><h2 id="track-heading">Track a new product</h2><p>Paste a product link and we’ll watch the price for you.</p></div></div>
        <form className="tracking-form" onSubmit={startTracking}>
          <label className="url-field"><Link2 aria-hidden="true" /><span className="sr-only">Product URL</span><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="Paste an Amazon or Flipkart product URL" /></label>
          <label className="frequency-field"><span className="sr-only">Tracking frequency</span><select value={frequency} onChange={(event) => setFrequency(event.target.value)}><option>Every 1 Hour</option><option>Every 6 Hours</option><option>Every 12 Hours</option><option>Every 24 Hours</option></select><ChevronDown aria-hidden="true" /></label>
          <Button type="submit" className="start-button" disabled={busy}><Plus data-icon="inline-start" /> {busy ? 'Tracking…' : 'Start tracking'}</Button>
        </form>
        <div className="form-meta"><span><Check aria-hidden="true" /> Works with Amazon &amp; Flipkart</span><span><Flame aria-hidden="true" /> Smart alerts, zero noise</span>{notice && <span className="notice" role="status">{notice}</span>}</div>
      </section>

      <section className="products-section" aria-labelledby="products-heading">
        <div className="products-header"><div className="section-label"><span className="number-label">02</span><div><h2 id="products-heading">Currently tracked products</h2><p>Your watchlist, all in one calm place.</p></div></div><span className="product-count">{products.length} products <span>·</span> all active</span></div>
        <div className="products-grid">{products.map((product, index) => <ProductCard product={product} key={product.id ?? `${product.title}-${index}`} />)}</div>
      </section>

      <footer className="dashboard-footer"><span>PriceAura / Personal price intelligence</span><span>Data refreshed moments ago <span className="footer-dot" /></span></footer>
    </main>
  )
}

