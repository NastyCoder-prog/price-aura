// lib/scraper/serpapi.ts
// SerpAPI's `google_shopping` engine — a paid-with-free-tier API that returns
// Google Shopping results as structured JSON (no HTML scraping). The free
// tier covers ~100 searches/month, which comfortably absorbs PriceAura's
// interactive traffic; the cron falls through to Bing when the quota dries up.
// Env-gated: skipped entirely when SERPAPI_API_KEY is unset.

import { paceAggregator } from './pace'
import { blockError } from './fetcher'
import { detectCurrency, parsePrice, type Currency } from './price'
import type { ShoppingOffer } from './google'

interface SerpApiShoppingResult {
  title?: string
  price?: string
  extracted_price?: number
  link?: string
  product_link?: string
  source?: string
  thumbnail?: string
}

interface SerpApiResponse {
  shopping_results?: SerpApiShoppingResult[]
  error?: string
}

export function serpApiAvailable(): boolean {
  return Boolean(process.env.SERPAPI_API_KEY)
}

function merchantFromSourceLabel(label: string): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '')
  if (slug.startsWith('amazon')) return 'amazon'
  if (slug.startsWith('flipkart')) return 'flipkart'
  if (slug.startsWith('walmart')) return 'walmart'
  if (slug.startsWith('bestbuy')) return 'bestbuy'
  if (slug.startsWith('ebay')) return 'ebay'
  if (slug.startsWith('myntra')) return 'myntra'
  if (slug.startsWith('reliancedigital')) return 'reliancedigital'
  if (slug.startsWith('reliance')) return 'reliancedigital'
  if (slug.startsWith('croma')) return 'croma'
  if (slug.startsWith('ajio')) return 'ajio'
  if (slug.startsWith('nykaa')) return 'nykaa'
  if (slug.startsWith('vijaysales')) return 'vijay'
  if (slug.startsWith('snapdeal')) return 'snapdeal'
  if (slug.startsWith('meesho')) return 'meesho'
  return slug.slice(0, 24) || 'unknown'
}

// Maps one SerpAPI shopping row into the shared ShoppingOffer shape.
export function parseSerpApiResults(payload: SerpApiResponse): ShoppingOffer[] {
  const rows = payload.shopping_results ?? []
  const offers: ShoppingOffer[] = []
  const seen = new Set<string>()

  for (const row of rows) {
    const title = (row.title ?? '').replace(/\s+/g, ' ').trim()
    if (title.length < 4) continue

    const priceText = (row.price ?? '').trim()
    const price =
      parsePrice(priceText) ??
      (typeof row.extracted_price === 'number' && row.extracted_price > 0 ? row.extracted_price : null)
    if (!price || price <= 0) continue
    const currency: Currency = detectCurrency(priceText)

    const link = row.product_link ?? row.link ?? null
    if (!link || !/^https?:\/\//.test(link)) continue

    const merchantLabel = (row.source ?? 'Unknown retailer').trim()
    const key = `${title.toLowerCase()}|${price}|${link}`
    if (seen.has(key)) continue
    seen.add(key)

    offers.push({
      title,
      price,
      currency,
      merchant: merchantFromSourceLabel(merchantLabel),
      merchantLabel,
      link,
      image: row.thumbnail && /^https?:\/\//.test(row.thumbnail) ? row.thumbnail : null,
    })
  }

  return offers
}

// Fetches Google Shopping results through SerpAPI.
export async function searchSerpApi(
  query: string,
  options: { batch?: boolean } = {},
): Promise<{ searchUrl: string; offers: ShoppingOffer[] }> {
  const apiKey = process.env.SERPAPI_API_KEY || ''
  if (!apiKey) throw blockError()

  const searchUrl = `https://serpapi.com/search.json?engine=google_shopping&q=${encodeURIComponent(query.trim())}&hl=en&gl=in&api_key=${apiKey}`
  await paceAggregator(Boolean(options.batch))

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  let payload: SerpApiResponse
  try {
    const res = await fetch(searchUrl, {
      headers: { Accept: 'application/json', 'User-Agent': 'PriceAura/1.0 (price tracker)' },
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`serpapi HTTP ${res.status}`)
    payload = (await res.json()) as SerpApiResponse
  } catch (error) {
    console.warn(`[scraper] serpapi failed: ${(error as Error).message}`)
    throw blockError()
  } finally {
    clearTimeout(timer)
  }

  if (payload.error) {
    console.warn(`[scraper] serpapi error: ${payload.error}`)
    throw blockError()
  }

  const offers = parseSerpApiResults(payload)
  if (offers.length === 0) throw blockError()

  console.log(`[scraper] serpapi OK: ${offers.length} offers`)
  return { searchUrl: 'https://serpapi.com/search.json?engine=google_shopping', offers }
}
