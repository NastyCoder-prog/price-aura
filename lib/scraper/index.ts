// lib/scraper/index.ts
// The one function the API routes call: scrapeProduct(url).

import { fetchHtml, errorStatus } from './fetcher'
import { extractProduct, storeLabel } from './parsers'
import { formatPrice } from './price'

export interface ScrapedProduct {
  url: string
  title: string
  store: string
  image: string | null
  price: string
  target: string
  priceValue: number
  targetValue: number
  scannedAt: string
}

function normalizeUrl(raw: string): string {
  const trimmed = String(raw).trim()
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

export async function scrapeProduct(rawUrl: string): Promise<ScrapedProduct> {
  const url = normalizeUrl(rawUrl)

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    const error = new Error('That does not look like a valid URL.')
    ;(error as Error & { status: number }).status = 400
    throw error
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    const error = new Error('Only http(s) links are supported.')
    ;(error as Error & { status: number }).status = 400
    throw error
  }

  const html = await fetchHtml(parsed.href)
  const { title, priceValue, image } = extractProduct(parsed.href, html)

  // Default alert price: ~10% under the current price (round to tens).
  const targetValue = Math.round((priceValue * 0.9) / 10) * 10

  return {
    url: parsed.href,
    title,
    store: storeLabel(parsed.href),
    image,
    price: formatPrice(priceValue),
    target: formatPrice(targetValue),
    priceValue,
    targetValue,
    scannedAt: new Date().toISOString(),
  }
}

export { errorStatus }
