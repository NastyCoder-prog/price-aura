// lib/mailer.ts
// Price-drop emails through Resend's plain HTTP API (free tier: 3,000/month).
// No SDK needed — just fetch. Without a key, emails are logged instead of
// sent, so nothing crashes while you are still setting things up.

import type { ApiProduct } from './db'

const RESEND_API_KEY = process.env.RESEND_API_KEY || ''
const EMAIL_FROM = process.env.EMAIL_FROM || 'PriceAura <onboarding@resend.dev>'

export async function sendPriceDropEmail(to: string, product: ApiProduct): Promise<void> {
  const subject = `Price dropped: ${product.title}`
  const html = `
    <div style="font-family:sans-serif;max-width:520px;margin:auto">
      <h2 style="color:#0f766e">Price dropped</h2>
      <p><strong>${product.title}</strong></p>
      <p>Now <strong>${product.price}</strong>${product.change ? ` <span style="color:#16a34a">(${product.change})</span>` : ''}</p>
      <p>Your alert price: ${product.target}</p>
      <p><a href="${product.url}">View product →</a></p>
    </div>
  `.trim()

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
