// app/api/cron/check-prices/route.ts
// GET /api/cron/check-prices
// Vercel Cron pings this on a schedule (see vercel.json). It re-scans every
// DUE product, updates the database, and emails anyone tagged on a drop.
//
// Hardened for production:
//   - FAILS CLOSED in production when CRON_SECRET is unset
//   - only scans products whose check interval has elapsed (oldest first)
//   - bounded concurrency + a hard time budget so one slow scan can't kill
//     the run — unfinished products simply stay due for the next invocation
//   - Google Shopping requests are spaced 3–7 seconds apart (batch mode)

import { NextRequest, NextResponse } from 'next/server'
import { listDueProducts, saveProduct, type ApiProduct } from '@/lib/db'
import { scrapeProduct, errorStatus } from '@/lib/scraper'
import { sendPriceDropEmail } from '@/lib/mailer'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // highest value allowed on all Vercel plans

const TIME_BUDGET_MS = 50_000
const CONCURRENCY = 3
const BATCH_SIZE = 40

export async function GET(request: NextRequest) {
  // ---- 1. Only Vercel Cron (or you, with the secret) may run this ----
  const secret = process.env.CRON_SECRET
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[cron] refusing to run: CRON_SECRET is not set')
      return NextResponse.json({ error: 'Cron is not configured.' }, { status: 500 })
    }
    console.warn('[cron] running WITHOUT auth because CRON_SECRET is unset (development only)')
  } else {
    const auth = request.headers.get('authorization')
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
    }
  }

  // ---- 2. Scan due products with bounded concurrency ----
  const due = await listDueProducts(BATCH_SIZE)
  const startedAt = Date.now()

  const stats = { updated: 0, dropped: 0, failed: 0, emailed: 0, skipped: 0 }

  let cursor = 0

  async function worker() {
    while (cursor < due.length) {
      const product = due[cursor++]
      if (!product) continue
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        stats.skipped += 1
        continue
      }
      await checkOne(product, stats)
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, due.length) }, () => worker()))

  const summary = {
    scanned: due.length - stats.skipped,
    due: due.length,
    updated: stats.updated,
    dropped: stats.dropped,
    failed: stats.failed,
    emailed: stats.emailed,
    skipped: stats.skipped,
    durationMs: Date.now() - startedAt,
  }
  console.log('[cron] finished', summary)
  return NextResponse.json(summary)
}

async function checkOne(
  product: ApiProduct,
  stats: { updated: number; dropped: number; failed: number; emailed: number },
) {
  try {
    const scraped = await scrapeProduct(product.url, {
      batch: true, // human-paced Google requests
      preferredCurrency: product.currency,
    })
    const saved = await saveProduct(scraped)
    stats.updated += 1

    if (saved.status === 'Price Dropped!') {
      stats.dropped += 1
      console.log(`[cron] ${saved.title} -> ${saved.price} (${saved.change})`)
      for (const email of saved.emails) {
        try {
          await sendPriceDropEmail(email, saved)
          stats.emailed += 1
        } catch (mailError) {
          console.error(`[cron] email to ${email} failed:`, (mailError as Error).message)
        }
      }
    }
  } catch (error) {
    stats.failed += 1
    console.error(
      `[cron] ${product.url} failed (HTTP ${errorStatus(error as Error)}):`,
      (error as Error).message,
    )
  }
}
