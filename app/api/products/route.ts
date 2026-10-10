// app/api/products/route.ts
// GET  /api/products      -> all tracked products
// POST /api/products      -> scrape a URL now and start tracking it

import { NextRequest, NextResponse } from 'next/server'
import { listProducts, saveProduct, addEmail, getProduct } from '@/lib/db'
import { scrapeProduct, errorStatus } from '@/lib/scraper'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // give the scraper room on Vercel

export async function GET() {
  try {
    return NextResponse.json({ products: await listProducts() })
  } catch (error) {
    console.error('[api/products]', error)
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { url?: string; email?: string }
    const { url, email } = body

    if (!url || typeof url !== 'string' || !url.trim()) {
      return NextResponse.json({ error: 'Please provide a product URL.' }, { status: 400 })
    }

    const scraped = await scrapeProduct(url)
    const saved = await saveProduct(scraped)

    if (email && typeof email === 'string' && email.includes('@')) {
      await addEmail(saved.id, email.trim())
      return NextResponse.json({ product: await getProduct(saved.id) }, { status: 201 })
    }

    return NextResponse.json({ product: saved }, { status: 201 })
  } catch (error) {
    console.error('[api/products]', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Something went wrong.' },
      { status: errorStatus(error as Error) }
    )
  }
}
