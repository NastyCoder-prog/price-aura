// app/api/products/[id]/route.ts
// PATCH /api/products/:id -> update the alert price { targetValue }
// DELETE /api/products/:id -> stop tracking

import { NextRequest, NextResponse } from 'next/server'
import { classifyError } from '@/lib/api-error'
import { deleteProduct, getOwnedProduct, updateProductTarget } from '@/lib/db'
import { clientIp, rateLimit } from '@/lib/ratelimit'
import { currentUser } from '@/lib/session'

export const dynamic = 'force-dynamic'

function errorResponse(scope: string, error: unknown) {
  const { message, status, code } = classifyError(scope, error)
  return NextResponse.json({ error: { code, message } }, { status })
}

function authRequired() {
  return NextResponse.json(
    { error: { code: 'auth_required', message: 'Please sign in to manage your watchlist.' } },
    { status: 401 },
  )
}

function notFound() {
  return NextResponse.json(
    { error: { code: 'not_found', message: 'Product not found.' } },
    { status: 404 },
  )
}

async function guard(request: NextRequest) {
  const limit = await rateLimit(`manage-product:${clientIp(request.headers)}`, 60, 60 * 60 * 1000)
  if (!limit.ok) {
    return NextResponse.json(
      { error: { code: 'rate_limited', message: 'Too many requests. Try again shortly.' } },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    )
  }
  return null
}

function parseId(raw: string): number | null {
  const productId = Number(raw)
  return Number.isInteger(productId) && productId > 0 ? productId : null
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const blocked = await guard(request)
  if (blocked) return blocked

  try {
    const user = await currentUser(request)
    if (!user) return authRequired()

    const { id } = await context.params
    const productId = parseId(id)
    if (!productId) {
      return NextResponse.json({ error: { code: 'bad_id', message: 'Unknown product.' } }, { status: 400 })
    }

    const body = (await request.json().catch(() => ({}))) as { targetValue?: unknown }
    const targetValue = Number(body.targetValue)
    if (!Number.isFinite(targetValue) || targetValue <= 0 || targetValue > 100_000_000) {
      return NextResponse.json(
        { error: { code: 'bad_target', message: 'Enter a valid alert price greater than zero.' } },
        { status: 400 },
      )
    }

    const product = await updateProductTarget(productId, Math.round(targetValue * 100) / 100, user.id)
    if (!product) return notFound()
    return NextResponse.json({ product })
  } catch (error) {
    return errorResponse('api/products/patch', error)
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const blocked = await guard(request)
  if (blocked) return blocked

  try {
    const user = await currentUser(request)
    if (!user) return authRequired()

    const { id } = await context.params
    const productId = parseId(id)
    if (!productId) {
      return NextResponse.json({ error: { code: 'bad_id', message: 'Unknown product.' } }, { status: 400 })
    }

    const product = await getOwnedProduct(productId, user.id)
    if (!product) return notFound()

    await deleteProduct(productId, user.id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return errorResponse('api/products/delete', error)
  }
}
