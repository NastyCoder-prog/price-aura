// app/api/products/route.ts
// GET  /api/products      -> all tracked products (subscriber emails redacted)
// POST /api/products      -> start tracking: { url } or { query } (+ optional email)

import { NextRequest, NextResponse } from 'next/server'
import { classifyError } from '@/lib/api-error'
import { addEmail, getProduct, getProductByUrl, listProducts, normalizeInterval, saveProduct } from '@/lib/db'
import { canonicalIdentityUrl, scrapeProduct } from '@/lib/scraper'
import { clientIp, rateLimit } from '@/lib/ratelimit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // give the scraper room on Vercel

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function errorResponse(scope: string, error: unknown) {
  const { message, status, code } = classifyError(scope, error)
  return NextResponse.json({ error: { code, message } }, { status })
}

export async function GET() {
  try {
    return NextResponse.json({ products: await listProducts() })
  } catch (error) {
    return errorResponse('api/products', error)
  }
}

export async function POST(request: NextRequest) {
  const ip = clientIp(request.headers)
  const limit = await rateLimit(`post-products:${ip}`, 30, 60 * 60 * 1000)
  if (!limit.ok) {
    return NextResponse.json(
      {
        error: {
          code: 'rate_limited',
          message: `Too many scans from your network. Try again in ${limit.retryAfterSeconds} seconds.`,
        },
      },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    )
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      url?: unknown
      query?: unknown
      email?: unknown
      frequency?: unknown
    }
    const url = typeof body.url === 'string' ? body.url.trim() : ''
    const query = typeof body.query === 'string' ? body.query.trim() : ''
    const input = url || query

    if (!input) {
      return NextResponse.json(
        { error: { code: 'missing_input', message: 'Provide a product URL or a product name to search.' } },
        { status: 400 },
      )
    }

    const email = typeof body.email === 'string' ? body.email.trim() : ''
    if (email && !EMAIL_RE.test(email)) {
      return NextResponse.json(
        { error: { code: 'bad_email', message: 'That email address does not look valid.' } },
        { status: 400 },
      )
    }

    // Look up the existing row first (if any) so the scraper keeps the
    // product's currency and the user's alert price on re-submits.
    const existing = await getProductByUrl(canonicalIdentityUrl(input) ?? '')
    const scraped = await scrapeProduct(input, {
      preferredCurrency: existing?.currency ?? null,
    })
    const saved = await saveProduct(scraped, {
      checkIntervalHours: normalizeInterval(body.frequency ?? existing?.checkIntervalHours),
    })
    if (email) {
      await addEmail(saved.id, email)
      return NextResponse.json(
        { product: (await getProduct(saved.id)) ?? saved },
        { status: existing ? 200 : 201 },
      )
    }

    return NextResponse.json({ product: saved }, { status: existing ? 200 : 201 })
  } catch (error) {
    return errorResponse('api/products', error)
  }
}
