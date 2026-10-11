// lib/mailer.ts
// Price-drop emails through Resend's plain HTTP API (free tier: 3,000/month).
// No SDK needed — just fetch. Without a key, emails are logged instead of
// sent, so nothing crashes while you are still setting things up.

import { createHmac, timingSafeEqual } from 'node:crypto'
import type { ApiProduct } from './db'

const RESEND_API_KEY = process.env.RESEND_API_KEY || ''
const EMAIL_FROM = process.env.EMAIL_FROM || 'PriceAura <onboarding@resend.dev>'

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '')
}

// Escapes user/scraped content before it goes into email HTML.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function signingSecret(): string {
  return process.env.EMAIL_SIGNING_SECRET || process.env.CRON_SECRET || ''
}

// One-click unsubscribe tokens: HMAC(productId:email) so nobody can remove
// someone else's alert without the secret.
export function unsubscribeToken(productId: number, email: string): string {
  const secret = signingSecret()
  if (!secret) return ''
  return createHmac('sha256', secret).update(`${productId}:${email.toLowerCase()}`).digest('hex').slice(0, 40)
}

export function verifyUnsubscribeToken(productId: number, email: string, token: string): boolean {
  const expected = unsubscribeToken(productId, email)
  if (!expected || !token || expected.length !== token.length) return false
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(token))
  } catch {
    return false
  }
}

// Why an alert fired: a drop vs the last scan, a new all-time low, or the
// price crossing the user's own alert price.
export type AlertReason = 'price_drop' | 'all_time_low' | 'alert_price'

const REASON_COPY: Record<AlertReason, { heading: string }> = {
  price_drop: { heading: 'Price dropped' },
  all_time_low: { heading: 'All-time low' },
  alert_price: { heading: 'Price alert' },
}

export function buildPriceDropEmail(
  to: string,
  product: ApiProduct,
  reason: AlertReason = 'price_drop',
): { subject: string; html: string } {
  const heading = REASON_COPY[reason].heading
  const subject =
    reason === 'price_drop'
      ? `Price dropped: ${product.title}`
      : `${heading}: ${product.title}`
  const token = unsubscribeToken(product.id, to)
  const unsubscribeUrl = token
    ? `${siteUrl()}/api/products/${product.id}/unsubscribe?email=${encodeURIComponent(to)}&token=${token}`
    : ''
  const changeHtml = product.change
    ? ` <span style="color:#16a34a">(${escapeHtml(product.change)})</span>`
    : ''
  const reasonNote =
    reason === 'all_time_low'
      ? '<p style="color:#16a34a"><strong>This is the lowest price we have ever seen for this product.</strong></p>'
      : reason === 'alert_price'
        ? '<p style="color:#16a34a"><strong>It is at or below your alert price.</strong></p>'
        : ''

  const html = `
    <div style="font-family:sans-serif;max-width:520px;margin:auto">
      <h2 style="color:#0f766e">${escapeHtml(heading)}</h2>
      <p><strong>${escapeHtml(product.title)}</strong></p>
      ${reasonNote}
      <p>Now <strong>${escapeHtml(product.price)}</strong>${changeHtml}</p>
      <p>Your alert price: ${escapeHtml(product.target)}</p>
      <p><a href="${escapeHtml(product.offerUrl || product.url)}">View product →</a></p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0" />
      <p style="font-size:12px;color:#6b7280">
        You are receiving this because you asked for a price alert on PriceAura.
        ${unsubscribeUrl ? `<a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe</a> · ` : ''}
        <a href="${escapeHtml(siteUrl())}/privacy">Privacy</a>
      </p>
    </div>
  `.trim()

  return { subject, html }
}

export async function sendPriceDropEmail(
  to: string,
  product: ApiProduct,
  reason: AlertReason = 'price_drop',
): Promise<void> {
  const { subject, html } = buildPriceDropEmail(to, product, reason)

  if (!RESEND_API_KEY) {
    // No key yet: pretend-sent, so the flow is still visible in the logs.
    console.log(`[email] (no RESEND_API_KEY) would send to ${to}: "${subject}"`)
    return
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, html }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Resend failed (HTTP ${response.status}): ${body.slice(0, 200)}`)
  }

  console.log(`[email] sent "${subject}" to ${to}`)
}
