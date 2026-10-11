import { describe, expect, it, vi } from 'vitest'
import { buildPriceDropEmail, escapeHtml, verifyUnsubscribeToken } from '@/lib/mailer'
import type { ApiProduct } from '@/lib/db'

const product: ApiProduct = {
  id: 42,
  url: 'https://www.google.com/search?tbm=shop&q=sony&hl=en&gl=in',
  offerUrl: 'https://www.amazon.in/dp/B09XS7JWHH',
  title: '<img src=x onerror=alert(1)> Sony WH-1000XM5',
  store: 'amazon',
  price: '₹19,990',
  target: '₹22,490',
  priceValue: 19990,
  targetValue: 22490,
  currency: 'INR',
  status: 'Price Dropped!',
  change: '−8.4%',
  checkIntervalHours: 6,
  emails: [],
}

describe('escapeHtml', () => {
  it('neutralises markup characters', () => {
    expect(escapeHtml('<b>"x"</b> & \'y\'')).toBe('&lt;b&gt;&quot;x&quot;&lt;/b&gt; &amp; &#39;y&#39;')
  })
})

describe('buildPriceDropEmail', () => {
  it('escapes scraped titles so hostile HTML cannot execute', () => {
    process.env.CRON_SECRET = 'test-secret'
    const { html } = buildPriceDropEmail('user@example.com', product)
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).toContain('https://www.amazon.in/dp/B09XS7JWHH')
  })

  it('includes a working unsubscribe link when a secret is configured', () => {
    process.env.CRON_SECRET = 'test-secret'
    const { html } = buildPriceDropEmail('user@example.com', product)
    const match = html.match(/\/api\/products\/42\/unsubscribe\?email=[^"&]+&(?:amp;)?token=([a-f0-9]+)/)
    expect(match).toBeTruthy()
    expect(verifyUnsubscribeToken(42, 'user@example.com', match![1]!)).toBe(true)
  })

  it('rejects tampered unsubscribe tokens', () => {
    process.env.CRON_SECRET = 'test-secret'
    expect(verifyUnsubscribeToken(42, 'user@example.com', 'deadbeef')).toBe(false)
    expect(verifyUnsubscribeToken(43, 'user@example.com', 'deadbeef')).toBe(false)
  })

  it('omits the unsubscribe link when no secret is configured', () => {
    vi.stubEnv('CRON_SECRET', '')
    vi.stubEnv('EMAIL_SIGNING_SECRET', '')
    const { html } = buildPriceDropEmail('user@example.com', product)
    expect(html).not.toContain('/unsubscribe')
    vi.unstubAllEnvs()
  })
})
