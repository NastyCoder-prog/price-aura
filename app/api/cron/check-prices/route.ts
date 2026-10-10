// app/api/cron/check-prices/route.ts
// GET /api/cron/check-prices
// Vercel Cron pings this on a schedule (see vercel.json). It re-scans every
// tracked product, updates the database, and emails anyone tagged on a drop.
// Protected by CRON_SECRET — Vercel sends it automatically as a Bearer token.

import { NextRequest, NextResponse } from 'next/server'
import { listProducts, saveProduct } from '@/lib/db'
import { scrapeProduct, errorStatus } from '@/lib/scraper'
import { sendPriceDropEmail } from '@/lib/mailer'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // highest value allowed on all Vercel plans

export async function GET(request: NextRequest) {
  // ---- 1. Only Vercel Cron (or you, with the secret) may run this ----
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = request.headers.get('authorization')
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
    }
  }

  // ---- 2. Re-scan every product ----
  const products = await listProducts()
  let updated = 0
  let dropped = 0
  let failed = 0
  let emailed = 0

  for (const product of products) {
    try {
      const scraped = await scrapeProduct(product.url)
      const saved = await saveProduct(scraped)
      updated += 1

      // ---- 3. On a price drop, email everyone tagged on this product ----
      if (saved.status === 'Price Dropped!') {
        dropped += 1
        console.log(`[cron] ${saved.title} -> ${saved.price} (${saved.change})`)
        for (const email of saved.emails) {
          try {
            await sendPriceDropEmail(email, saved)
            emailed += 1
          } catch (mailError) {
            console.error(`[cron] email to ${email} failed:`, (mailError as Error).message)
          }
        }
      }
    } catch (error) {
      failed += 1
      console.error(`[cron] ${product.url} failed (HTTP ${errorStatus(error as Error)}):`, (error as Error).message)
    }
  }

  const summary = { scanned: products.length, updated, dropped, failed, emailed }
  console.log('[cron] finished', summary)
  return NextResponse.json(summary)
}
