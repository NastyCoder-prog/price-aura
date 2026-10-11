// app/api/products/[id]/emails/route.ts
// POST /api/products/:id/emails -> tag an email onto a product

import { NextRequest, NextResponse } from 'next/server'
import { classifyError } from '@/lib/api-error'
import { addEmail, getProduct } from '@/lib/db'
import { clientIp, rateLimit } from '@/lib/ratelimit'

export const dynamic = 'force-dynamic'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const limit = await rateLimit(`add-email:${clientIp(request.headers)}`, 15, 60 * 60 * 1000)
  if (!limit.ok) {
    return NextResponse.json(
      { error: { code: 'rate_limited', message: 'Too many requests. Try again shortly.' } },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    )
  }

  try {
    const { id } = await context.params
    const productId = Number(id)
    if (!Number.isInteger(productId) || productId <= 0) {
      return NextResponse.json({ error: { code: 'bad_id', message: 'Unknown product.' } }, { status: 400 })
    }

    const product = await getProduct(productId)
    if (!product)
      return NextResponse.json(
        { error: { code: 'not_found', message: 'Product not found.' } },
        { status: 404 },
      )

    const body = (await request.json().catch(() => ({}))) as { email?: unknown }
    const email = String(body.email ?? '')
      .trim()
      .toLowerCase()
    if (!EMAIL_RE.test(email) || email.length > 254) {
      return NextResponse.json(
        { error: { code: 'bad_email', message: 'Please provide a valid email address.' } },
        { status: 400 },
      )
    }

    await addEmail(product.id, email)
    return NextResponse.json({ ok: true, email })
  } catch (error) {
    return errorResponse('api/products/emails', error)
  }
}

function errorResponse(scope: string, error: unknown) {
  const { message, status, code } = classifyError(scope, error)
  return NextResponse.json({ error: { code, message } }, { status })
}
