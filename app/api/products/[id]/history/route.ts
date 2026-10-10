// app/api/products/[id]/history/route.ts
// GET /api/products/:id/history -> product + its price history

import { NextRequest, NextResponse } from 'next/server'
import { getProduct, priceHistory } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const product = await getProduct(Number(id))
    if (!product) return NextResponse.json({ error: 'Product not found.' }, { status: 404 })

    return NextResponse.json({ product, history: await priceHistory(product.id) })
  } catch (error) {
    console.error('[api/products/history]', error)
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}
