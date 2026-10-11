// lib/scraper/bing.ts
// Bing Shopping (www.bing.com/shop) as a free price aggregator.
//
// One search surfaces live listings from many stores at once, served as plain
// server-rendered HTML (no JS wall) — so it works from datacenter IPs such as
// Vercel's. Bing serves DIFFERENT card markup per region:
//   • US/global : .br-titlelink  + .br-price       + .br-sellerName
//   • Singapore : .br-pdItemName + .pd-price       + .br-sellersCite  (Vercel sin1)
// The parser below accepts both, plus falls back to the image alt / span title
// for the (truncated) product name.

import * as cheerio from 'cheerio'
import { paceAggregator, makeDeadline } from './pace'
import { attempt, blockError } from './fetcher'
import type { Candidate } from './fetcher'
import { detectCurrency, parsePrice, type Currency } from './price'
import type { ShoppingOffer } from './google'

// A single pinned desktop UA. Rotating UAs made Bing serve inconsistent
// regional layouts, so we lock one that reliably returns parseable cards.
const BING_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export function buildBingShopUrl(query: string): string {
  // mkt=en-IN pins the India market so an IN-focused tracker gets ₹ offers.
  // (Do NOT use cc=in — from datacenter IPs it makes Bing serve a ~100KB
  // JS-required shell with zero product cards.)
  return `https://www.bing.com/shop?q=${encodeURIComponent(query.trim())}&mkt=en-IN`
}

function cleanTitle(raw: string): string {
  return raw.replace(/…$/, '').replace(/\s+/g, ' ').trim()
}

// Decodes Bing's /ck/a click-tracking redirect (u=a1<base64url>) back to the
// real merchant URL; falls back to the redirect link itself when it can't.
function resolveBingHref(href: string | undefined, base: string): string | null {
  if (!href || href.startsWith('javascript:')) return null
  try {
    const url = new URL(href, base)
    if (url.hostname.includes('bing.com') && /\/ck\//.test(url.pathname)) {
      const u = url.searchParams.get('u') || ''
      const m = u.match(/^a1(.+)/)
      if (m) {
        const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/')
        const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
        const decoded = Buffer.from(padded, 'base64').toString('utf-8')
        if (/^https?:\/\//.test(decoded)) return decoded
      }
      return url.toString()
    }
    if (/^https?:$/.test(url.protocol)) return url.toString()
  } catch {
    return null
  }
  return null
}

// First usable real product URL among the card's anchors.
const CARD_LINK_SELECTORS = ['.br-titlelink[href]', '.br-titleClickWrap[href]', '.br-compareSellers[href]', 'a[href*="/ck/"]']

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
  // Domain-style sellers ("www.fruugo.sg") → use the second-level name.
  const domain = label
    .toLowerCase()
    .replace(/^www\./, '')
    .split(/[./]/)[0]
  if (domain && /^[a-z0-9-]+$/.test(domain)) return domain.replace(/[^a-z0-9]/g, '') || 'unknown'
  const firstWord = label
    .toLowerCase()
    .split(/[\s.,]+/)[0]
    ?.replace(/[^a-z0-9]/g, '')
  return firstWord || 'unknown'
}

// Parses Bing Shopping results (both regional layouts) into shared offers.
export function parseBingResults(html: string, pageUrl: string): ShoppingOffer[] {
  const $ = cheerio.load(html)
  const cards = $('.br-item')
  const offers: ShoppingOffer[] = []
  const seen = new Set<string>()

  cards.each((_, element) => {
    const card = $(element)

    // Title: the full name lives in span[title]; the visible text is "…"-truncated.
    const fullTitle =
      card
        .find('.br-pdItemName span[title], .br-pdItemName-noHover span[title], .br-titlelink span[title]')
        .first()
        .attr('title') || ''
    const visibleTitle = card.find('.br-pdItemName, .br-titlelink, .br-title').first().text()
    const imgAlt = card.find('img').first().attr('alt') || ''
    const title = cleanTitle([fullTitle, visibleTitle, imgAlt].sort((a, b) => b.length - a.length)[0] || '')
    if (title.length < 4) return

    // Price: .pd-price / .br-dealPrice are the live price; .br-pdOfferPrice is
    // the struck-through original and must never be picked.
    const priceText = card.find('.pd-price, .br-dealPrice, .br-price').first().text().replace(/\s+/g, ' ').trim()
    const price = parsePrice(priceText)
    if (!price || price <= 0) return
    const currency: Currency = detectCurrency(priceText)

    let link: string | null = null
    for (const sel of CARD_LINK_SELECTORS) {
      link = resolveBingHref(card.find(sel).first().attr('href'), pageUrl)
      if (link) break
    }
    link = link || pageUrl

    const dedupeKey = `${title.toLowerCase()}|${price}|${link}`
    if (seen.has(dedupeKey)) return
    seen.add(dedupeKey)

    // Seller: prefer the clean cite (domain on the sin1 layout), then the US
    // variant's .br-sellerName, else the seller block minus its decorative
    // initial-letter avatar so "M"+"Myntra" doesn't become "MMyntra".
    let sellerLabel =
      card.find('.br-sellersCite').first().text().replace(/\s+/g, ' ').trim() ||
      card.find('.br-sellerName').first().text().replace(/\s+/g, ' ').trim()
    if (!sellerLabel) {
      const block = card.find('.br-sellerBlock, .br-sllrBlckTb').first()
      const clone = block.clone()
      clone.find('.br-sellerImage, .fb-prvdr, [id^="favico-"], [class*="sellerImage"]').remove()
      sellerLabel = clone.text().replace(/\s+/g, ' ').trim()
    }
    if (!sellerLabel) sellerLabel = 'Unknown retailer'
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
  // Bing direct is reliable from Vercel with a lean header set (no Sec-Fetch
  // navigation headers, which trigger a consent page from datacenter IPs).
  // The free CORS proxies all time out on Bing's large pages, so we skip them.
  return [attempt('bing (direct)', searchUrl, 10000, { 'User-Agent': BING_USER_AGENT }, true)]
}

// Downloads + parses one Bing Shopping search. Throws when the fetch fails
// or the page contains no usable offers.
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
