// lib/scraper/bing.ts
// Bing Shopping (www.bing.com/shop) as a free price aggregator.
//
// Like Google Shopping, one search surfaces live listings from Amazon,
// Flipkart, Walmart, eBay and more — but Bing serves the results as plain
// server-rendered HTML (no JS wall), which makes it the most reliable free
// source from datacenter IPs such as Vercel's.

import * as cheerio from 'cheerio'
import { paceAggregator, makeDeadline } from './pace'
import { attempt, blockError } from './fetcher'
import type { Candidate } from './fetcher'
import { detectCurrency, parsePrice, type Currency } from './price'
import type { ShoppingOffer } from './google'

export function buildBingShopUrl(query: string): string {
  return `https://www.bing.com/shop?q=${encodeURIComponent(query.trim())}`
}

function absoluteBingUrl(href: string | undefined, base: string): string | null {
  if (!href) return null
  try {
    const url = new URL(href, base)
    if (/^https?:$/.test(url.protocol)) return url.toString()
  } catch {
    return null
  }
  return null
}

function cleanTitle(raw: string): string {
  return raw.replace(/…$/, '').replace(/\s+/g, ' ').trim()
}

// Seller labels like "Best Buy" / "Amazon.in" / "Reliance Digital Store" are
// mapped back to short platform keys; anything else keeps its first word.
const PLATFORM_PREFIXES = [
  'reliancedigital',
  'aliexpress',
  'snapdeal',
  'shopclues',
  'flipkart',
  'bestbuy',
  'homedepot',
  'amazon',
  'walmart',
  'myntra',
  'costco',
  'alibaba',
  'target',
  'nykaa',
  'rakuten',
  'ebay',
  'ajio',
  'croma',
  'meesho',
  'etsy',
  'ikea',
]

function merchantFromSeller(label: string): string {
  const flat = label.toLowerCase().replace(/[^a-z0-9]+/g, '')
  for (const platform of PLATFORM_PREFIXES) {
    if (flat.startsWith(platform)) return platform
  }
  const firstWord = label
    .toLowerCase()
    .split(/[\s.,]+/)[0]
    ?.replace(/[^a-z0-9]/g, '')
  return firstWord || 'unknown'
}

// Parses Bing Shopping results into the shared ShoppingOffer shape.
export function parseBingResults(html: string, pageUrl: string): ShoppingOffer[] {
  const $ = cheerio.load(html)
  const cards = $('.br-item')
  const offers: ShoppingOffer[] = []
  const seen = new Set<string>()

  cards.each((_, element) => {
    const card = $(element)

    const linkText = cleanTitle(card.find('.br-titlelink').first().text())
    const imgAlt = cleanTitle(card.find('img').first().attr('alt') || '')
    // Bing truncates the link text with "…"; the image alt holds the full name.
    const title = imgAlt.length > linkText.length ? imgAlt : linkText
    if (title.length < 4) return

    const priceText = card.find('.br-price').first().text().replace(/\s+/g, ' ').trim()
    const price = parsePrice(priceText)
    if (!price || price <= 0) return
    const currency: Currency = detectCurrency(priceText)

    const link = absoluteBingUrl(card.find('.br-titlelink').first().attr('href'), pageUrl)
    if (!link) return

    const dedupeKey = `${title.toLowerCase()}|${price}|${link}`
    if (seen.has(dedupeKey)) return
    seen.add(dedupeKey)
    const sellerLabel =
      card.find('.br-sellerName').first().text().replace(/\s+/g, ' ').trim() || 'Unknown retailer'
    const merchant = merchantFromSeller(sellerLabel)

    const imageSrc = card.find('img').first().attr('src') || card.find('img').first().attr('data-src') || null

    offers.push({
      title,
      price,
      currency,
      merchant,
      merchantLabel: sellerLabel,
      link,
      image: imageSrc && /^https?:\/\//.test(imageSrc) ? imageSrc : null,
    })
  })

  return offers
}

function bingCandidates(searchUrl: string): Candidate[] {
  const encoded = encodeURIComponent(searchUrl)
  return [
    attempt('bing (direct)', searchUrl, 9000),
    attempt('bing (allorigins proxy)', `https://api.allorigins.win/raw?url=${encoded}`, 12000),
    attempt('bing (codetabs proxy)', `https://api.codetabs.com/v1/proxy?quest=${encoded}`, 12000),
  ]
}

// Downloads + parses one Bing Shopping search. Throws when every route
// fails or the page contains no usable offers.
export async function searchBing(
  query: string,
  options: { batch?: boolean; preferredCurrency?: string | null; deadline?: () => boolean } = {},
): Promise<{ searchUrl: string; offers: ShoppingOffer[] }> {
  const searchUrl = buildBingShopUrl(query)
  const failures: string[] = []
  const deadline = options.deadline ?? makeDeadline(45_000)

  for (const candidate of bingCandidates(searchUrl)) {
    if (deadline()) {
      failures.push('time budget exhausted')
      break
    }
    await paceAggregator(Boolean(options.batch))
    try {
      const html = await candidate.run()
      const offers = parseBingResults(html, searchUrl)
      if (offers.length === 0) throw new Error('no parseable offers in the results')
      console.log(`[scraper] bing OK via ${candidate.label}: ${offers.length} offers`)
      return { searchUrl, offers }
    } catch (error) {
      failures.push(`${candidate.label}=${(error as Error).message}`)
      console.warn(`[scraper] bing ${candidate.label} failed: ${(error as Error).message}`)
    }
  }

  console.error(`[scraper] all bing routes failed for "${query}" -> ${failures.join(' | ')}`)
  throw blockError()
}
