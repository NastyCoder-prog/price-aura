// app/api/products/[id]/history/route.ts
// GET /api/products/:id/history -> product + its price history

import { NextRequest, NextResponse } from 'next/server'
import { classifyError } from '@/lib/api-error'
import { getProduct, priceHistory } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
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

    return NextResponse.json({ product, history: await priceHistory(product.id) })
  } catch (error) {
    const { message, status, code } = classifyError('api/products/history', error)
    return NextResponse.json({ error: { code, message } }, { status })
  }
}
