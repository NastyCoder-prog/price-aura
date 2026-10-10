// lib/scraper/index.ts
// The one function the API routes call: scrapeProduct(url).

import { getCandidates, blockError, errorStatus } from './fetcher'
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

  // Try every route in order: download AND parse must both succeed.
  // Failures are collected so the function logs show exactly what happened.
  const failures: string[] = []

  for (const candidate of getCandidates(parsed.href)) {
    try {
      const html = await candidate.run()
      const { title, priceValue, image } = extractProduct(parsed.href, html)

      // Default alert price: ~10% under the current price (round to tens).
      const targetValue = Math.round((priceValue * 0.9) / 10) * 10

      console.log(`[scraper] OK via ${candidate.label}: "${title}" ${formatPrice(priceValue)}`)

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
    } catch (error) {
      const err = error as Error & { fatal?: boolean }
      if (err.fatal) throw err // dead link: stop the whole chain
      failures.push(`${candidate.label}=${err.message}`)
      console.warn(`[scraper] ${candidate.label} failed: ${err.message}`)
    }
  }

  console.error(`[scraper] all routes failed for ${parsed.href} -> ${failures.join(' | ')}`)
  throw blockError()
}

export { errorStatus }
