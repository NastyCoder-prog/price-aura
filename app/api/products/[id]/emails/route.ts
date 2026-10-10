// app/api/products/[id]/emails/route.ts
// POST /api/products/:id/emails -> tag an email onto a product

import { NextRequest, NextResponse } from 'next/server'
import { getProduct, addEmail } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const product = await getProduct(Number(id))
    if (!product) return NextResponse.json({ error: 'Product not found.' }, { status: 404 })

    const body = (await request.json().catch(() => ({}))) as { email?: string }
    const email = String(body.email || '').trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Please provide a valid email address.' }, { status: 400 })
    }

    return NextResponse.json({ product: await addEmail(product.id, email) })
  } catch (error) {
    console.error('[api/products/emails]', error)
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}
