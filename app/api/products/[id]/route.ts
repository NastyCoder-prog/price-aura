// app/api/products/[id]/route.ts
// PATCH /api/products/:id -> update the alert price { targetValue }
// DELETE /api/products/:id -> stop tracking

import { NextRequest, NextResponse } from 'next/server'
import { classifyError } from '@/lib/api-error'
import { deleteProduct, getProduct, updateProductTarget } from '@/lib/db'
import { clientIp, rateLimit } from '@/lib/ratelimit'

export const dynamic = 'force-dynamic'

function errorResponse(scope: string, error: unknown) {
  const { message, status, code } = classifyError(scope, error)
  return NextResponse.json({ error: { code, message } }, { status })
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

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const blocked = await guard(request)
  if (blocked) return blocked

  try {
    const { id } = await context.params
    const productId = Number(id)
    if (!Number.isInteger(productId) || productId <= 0) {
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

    const product = await updateProductTarget(productId, Math.round(targetValue * 100) / 100)
    if (!product)
      return NextResponse.json(
        { error: { code: 'not_found', message: 'Product not found.' } },
        { status: 404 },
      )
    return NextResponse.json({ product })
  } catch (error) {
    return errorResponse('api/products/patch', error)
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const blocked = await guard(request)
  if (blocked) return blocked

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

    await deleteProduct(productId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return errorResponse('api/products/delete', error)
  }
}
