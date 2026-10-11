// lib/scraper/google.ts
// Google Shopping (tbm=shop) as a free price aggregator.
//
// One search surfaces live listings from Amazon, Flipkart, Walmart, eBay and
// more, so a single request observes many storefronts without ever touching
// their anti-bot walls directly. Google's result markup changes often, so
// parsing is layered: precise card selectors first, then a generic scan, and
// the page is downloaded through the same fallback chain as direct scrapes
// (direct fetch -> free proxies -> Jina Reader).

import * as cheerio from 'cheerio'
import type { CheerioAPI } from 'cheerio'
import { ApiError } from '../api-error'
import { attempt, blockError } from './fetcher'
import type { Candidate } from './fetcher'
import { detectCurrency, parsePrice, type Currency } from './price'
import { storeLabel } from './parsers'
import { searchBing } from './bing'
import { searchSerpApi, serpApiAvailable } from './serpapi'
import { makeDeadline, paceAggregator } from './pace'

export interface ShoppingOffer {
  title: string
  price: number
  currency: Currency
  merchant: string
  merchantLabel: string
  link: string
  image: string | null
}

// Merchants that are prioritised when several offers tie the search.
const PREFERRED_MERCHANTS = new Set([
  'amazon',
  'flipkart',
  'walmart',
  'ebay',
  'bestbuy',
  'target',
  'costco',
  'croma',
  'reliancedigital',
  'myntra',
  'ajio',
  'nykaa',
  'snapdeal',
  'meesho',
  'shopclues',
  'aliexpress',
  'alibaba',
  'etsy',
  'rakuten',
])

const TITLE_SELECTORS = ['h3', '.sh-np__product-title', '[role="heading"]', '.tAxDx', '.Rla6bc']
const PRICE_SELECTORS = [
  '.a8335b',
  '.OFF1z',
  '.a98u7b',
  '.xvKjre',
  '.a3s4b4',
  '.sh-pr__pricing .nwmsh-C', // pricing block variants
  'span[aria-hidden="true"]',
]
const MERCHANT_SELECTORS = [
  '.aULbyc',
  '.Iu7jCc',
  '.sh-merchants-module__header',
  '.s2cVJb',
  '.s79Pee',
  '.sPQDcc',
]

// "$1,299.99", "₹1,49,999", "US $349", "€ 29,99" …
const MONEY_RE =
  /(?:US\s?\$|A\$|C\$|S\$|CN¥|₹|€|£|¥|\$|AED)\s?\d[\d., ]*(?:\.\d{1,2})?|\b(?:INR|USD|EUR|GBP|JPY|AUD|CAD|SGD)\s?\d[\d., ]*(?:\.\d{1,2})?/i

// EMI / instalment snippets ("EMI from ₹1,458/month") are not the selling
// price. Whole segments are removed before the generic price scan.
const EMI_SEGMENT_RE = /EMI.{0,40}?(?:\/mo(?:nth)?\b|month\b|per month\b)|\bEMI\b.{0,30}?\d[\d.,]*/gi
const EMI_BEFORE_RE = /\bemi\b|installment|instalment|per month/i

const GOOGLE_HOST_RE = /^www\.google\.[a-z]{2,3}(?:\.[a-z]{2})?$/

export function isGoogleUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return GOOGLE_HOST_RE.test(url.hostname) && url.pathname === '/search'
  } catch {
    return false
  }
}

export function isGoogleShoppingUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return isGoogleUrl(raw) && url.searchParams.get('tbm') === 'shop'
  } catch {
    return false
  }
}

// Canonical search URL — same query always maps to the same product row.
export function buildSearchUrl(query: string): string {
  return `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(query.trim())}&hl=en&gl=in`
}

export function queryFromGoogleUrl(raw: string): string | null {
  try {
    return new URL(raw).searchParams.get('q')?.trim() || null
  } catch {
    return null
  }
}

// Google wraps merchant links in /aclk redirects; decode them back to the
// real storefront URL. Relative /shopping/… links stay on Google (they open
// the offers comparison page) and are returned as absolute URLs.
export function resolveGoogleHref(href: string | undefined, base = 'https://www.google.com'): string | null {
  if (!href) return null
  const trimmed = href.trim()
  if (!trimmed) return null

  let url: URL
  try {
    url = new URL(trimmed, base)
  } catch {
    return null
  }

  if (url.hostname.startsWith('google.') || GOOGLE_HOST_RE.test(url.hostname)) {
    if (url.pathname === '/aclk' || url.pathname === '/url') {
      const target = url.searchParams.get('adurl') || url.searchParams.get('q') || url.searchParams.get('url')
      if (target) {
        try {
          const outer = new URL(target, base)
          if (/^https?:$/.test(outer.protocol)) return outer.toString()
        } catch {
          return null
        }
      }
    }
    return url.toString()
  }

  if (!/^https?:$/.test(url.protocol)) return null
  return url.toString()
}

function firstText($: CheerioAPI, root: ReturnType<CheerioAPI>, selectors: string[]): string {
  for (const selector of selectors) {
    const text = root.find(selector).first().text().replace(/\s+/g, ' ').trim()
    if (text) return text
  }
  return ''
}

function cleanTitle(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

function imageFrom($: CheerioAPI, root: ReturnType<CheerioAPI>): string | null {
  const img = root.find('img').first()
  for (const attr of ['src', 'data-src']) {
    const value = img.attr(attr)
    if (value && /^https?:\/\//.test(value)) return value
  }
  return null
}

// Price extraction: precise selectors first, then a currency-pattern scan of
// the whole card (skipping EMI snippets and picking the lowest real price).
function priceFrom(
  $: CheerioAPI,
  root: ReturnType<CheerioAPI>,
): { text: string; value: number; currency: Currency } | null {
  for (const selector of PRICE_SELECTORS) {
    const text = root.find(selector).first().text().replace(/\s+/g, ' ').trim()
    if (!text || text.length > 40) continue
    const value = parsePrice(text)
    if (value && value > 0) return { text, value, currency: detectCurrency(text) }
  }

  const full = root.text().replace(/\s+/g, ' ').replace(EMI_SEGMENT_RE, ' ')
  const candidates: { text: string; value: number; currency: Currency }[] = []
  for (const match of full.matchAll(new RegExp(MONEY_RE, 'g'))) {
    const token = match[0]
    const before = full.slice(Math.max(0, match.index! - 20), match.index!)
    if (EMI_BEFORE_RE.test(before)) continue
    const value = parsePrice(token)
    if (value && value > 0) candidates.push({ text: token, value, currency: detectCurrency(token) })
  }
  if (candidates.length === 0) return null
  // Google shows the MRP first and the actual selling price after it; the
  // lowest non-EMI amount on the card is the price you can actually pay.
  candidates.sort((a, b) => a.value - b.value)
  return candidates[0]
}

function merchantFrom(
  $: CheerioAPI,
  root: ReturnType<CheerioAPI>,
  link: string | null,
): { merchant: string; label: string } {
  if (link) {
    try {
      const host = new URL(link).hostname.toLowerCase().replace(/^www\./, '')
      if (!GOOGLE_HOST_RE.test(host) && !host.startsWith('google.')) {
        const merchant = storeLabel(link)
        if (merchant) return { merchant, label: host }
      }
    } catch {
      // fall through to the text label
    }
  }
  const label = firstText($, root, MERCHANT_SELECTORS)
  if (label) {
    const merchant = label
      .toLowerCase()
      .replace(/^www\./, '')
      .split(/[.\s]/)[0]
      .replace(/[^a-z0-9]/g, '')
    return { merchant: merchant || 'unknown', label }
  }
  return { merchant: 'unknown', label: 'Unknown retailer' }
}

// Parses a Google Shopping results page into offers.
export function parseShoppingResults(html: string, pageUrl = 'https://www.google.com'): ShoppingOffer[] {
  const $ = cheerio.load(html)
  let cards = $('.sh-dgr__content')
  if (cards.length === 0) cards = $('.sh-dlr__list-result')
  if (cards.length === 0) cards = $('.sh-pr__result')
  if (cards.length === 0) cards = $('.g')

  const offers: ShoppingOffer[] = []
  const seen = new Set<string>()

  cards.each((_, element) => {
    const card = $(element)
    const title = cleanTitle(firstText($, card, TITLE_SELECTORS))
    const priced = priceFrom($, card)
    if (!title || !priced || title.length < 4) return

    const rawHref = card.find('a[href]').first().attr('href')
    const link = resolveGoogleHref(rawHref, pageUrl)
    if (!link) return

    const dedupeKey = `${title.toLowerCase()}|${priced.value}|${link}`
    if (seen.has(dedupeKey)) return
    seen.add(dedupeKey)

    const { merchant, label } = merchantFrom($, card, link)
    offers.push({
      title,
      price: priced.value,
      currency: priced.currency,
      merchant,
      merchantLabel: label,
      link,
      image: imageFrom($, card),
    })
  })

  return offers
}

// Detects Google's consent wall / JS wall / bot interstitial so callers can
// retry via another source instead of reporting a mysterious "no results".
export function looksLikeGoogleBlock(html: string): boolean {
  const head = html.slice(0, 12000).toLowerCase()
  return [
    'unusual traffic',
    'consent.google.com',
    'detected unusual traffic',
    'our systems have detected',
    'enable javascript',
    'enablejs',
    'gs_captcha',
    'before you continue to google',
    'httpservice/retry/enablejs',
    'if you are not redirected within a few seconds',
  ].some((marker) => head.includes(marker))
}

// One aggregate search = Bing first (plain server HTML, works from any IP),
// Google Shopping second (higher coverage, but often JS-walled from
// datacenter IPs — paid render APIs and free proxies bridge that gap).
// A single shared deadline keeps the whole chain inside the function budget.

export function googleCandidates(searchUrl: string): Candidate[] {
  const encoded = encodeURIComponent(searchUrl)
  const list: Candidate[] = [attempt('google (direct)', searchUrl, 9000)]

  const scraperApiKey = process.env.SCRAPERAPI_API_KEY || ''
  if (scraperApiKey) {
    const query = new URLSearchParams({
      api_key: scraperApiKey,
      url: searchUrl,
      country_code: 'in',
      premium: 'true',
      render: 'true', // Google needs JS rendered — that's what we pay for
    })
    list.push(attempt('google (ScraperAPI render)', `https://api.scraperapi.com/?${query}`, 20000))
  }

  const scrapingBeeKey = process.env.SCRAPINGBEE_API_KEY || ''
  if (scrapingBeeKey) {
    const query = new URLSearchParams({
      api_key: scrapingBeeKey,
      url: searchUrl,
      country_code: 'in',
      render_js: 'true',
      premium: 'true',
    })
    list.push(attempt('google (ScrapingBee render)', `https://app.scrapingbee.com/api/v1/?${query}`, 20000))
  }

  list.push(
    attempt('google (allorigins proxy)', `https://api.allorigins.win/raw?url=${encoded}`, 12000),
    attempt('google (codetabs proxy)', `https://api.codetabs.com/v1/proxy?quest=${encoded}`, 12000),
  )
  return list
}

async function searchGoogle(
  query: string,
  options: { batch?: boolean; preferredCurrency?: string | null; deadline: () => boolean },
): Promise<{ searchUrl: string; offers: ShoppingOffer[] }> {
  const searchUrl = buildSearchUrl(query)
  const failures: string[] = []

  for (const candidate of googleCandidates(searchUrl)) {
    if (options.deadline()) {
      failures.push('time budget exhausted')
      break
    }
    await paceAggregator(Boolean(options.batch))
    try {
      const html = await candidate.run()
      if (looksLikeGoogleBlock(html)) throw new Error('Google served a consent / JS / bot-check page')

      const offers = parseShoppingResults(html, searchUrl)
      if (offers.length === 0) throw new Error('no parseable offers in the results')

      console.log(`[scraper] google OK via ${candidate.label}: ${offers.length} offers`)
      return { searchUrl, offers }
    } catch (error) {
      failures.push(`${candidate.label}=${(error as Error).message}`)
      console.warn(`[scraper] google ${candidate.label} failed: ${(error as Error).message}`)
    }
  }

  console.error(`[scraper] all google routes failed for "${query}" -> ${failures.join(' | ')}`)
  throw blockError()
}

// Orchestrates the aggregate search across sources, free-first:
//   1. Bing Shopping — free, unlimited, server-rendered HTML
//   2. SerpAPI (optional key, ~100 free searches/mo) — real Google Shopping
//      JSON incl. Amazon/Flipkart listings
//   3. Google Shopping direct/proxies (free) + paid render APIs (optional keys)
export async function searchShopping(
  query: string,
  options: { batch?: boolean; preferredCurrency?: string | null } = {},
): Promise<{
  searchUrl: string
  offers: ShoppingOffer[]
  best: ShoppingOffer
  source: 'bing' | 'serpapi' | 'google'
}> {
  const deadline = makeDeadline(50_000)
  let currencyError: ApiError | null = null

  // ---- Source 1: Bing Shopping --------------------------------------------
  try {
    const { searchUrl, offers } = await searchBing(query, { ...options, deadline })
    const best = selectOffer(offers, options.preferredCurrency)
    if (best) return { searchUrl, offers, best, source: 'bing' }
    // Offers exist but none match the tracked currency — try the other
    // sources too before giving up.
    currencyError = noOffersError()
  } catch (error) {
    console.warn(`[scraper] bing source failed: ${(error as Error).message}`)
  }

  // ---- Source 2: SerpAPI google_shopping (optional key) -------------------
  if (serpApiAvailable() && !deadline()) {
    try {
      const { searchUrl, offers } = await searchSerpApi(query, { batch: options.batch })
      const best = selectOffer(offers, options.preferredCurrency)
      if (best) return { searchUrl, offers, best, source: 'serpapi' }
      currencyError ??= noOffersError()
    } catch (error) {
      console.warn(`[scraper] serpapi source failed: ${(error as Error).message}`)
    }
  }

  // ---- Source 3: Google Shopping direct / proxies / render APIs -----------
  if (!deadline()) {
    try {
      const { searchUrl, offers } = await searchGoogle(query, { ...options, deadline })
      const best = selectOffer(offers, options.preferredCurrency)
      if (best) return { searchUrl, offers, best, source: 'google' }
      currencyError ??= noOffersError()
    } catch (error) {
      console.warn(`[scraper] google source failed: ${(error as Error).message}`)
    }
  }

  throw currencyError ?? blockError()
}

function noOffersError(): ApiError {
  return new ApiError(
    'Live offers were found, but none in the currency this product tracks. Try again shortly.',
    502,
    'no_offers',
  )
}

// Picks the offer to track: valid price + resolvable link, same currency as
// the product's existing currency (when known — prevents fake "drops" from
// comparing ₹ against $), preferred merchants win, lowest price wins.
export function selectOffer(
  offers: ShoppingOffer[],
  preferredCurrency?: string | null,
): ShoppingOffer | null {
  const valid = offers.filter((offer) => offer.price > 0 && offer.link && offer.title)

  let currency: string
  if (preferredCurrency) {
    const sameCurrency = valid.filter((offer) => offer.currency === preferredCurrency)
    if (sameCurrency.length === 0) return null
    currency = preferredCurrency
  } else {
    const counts = new Map<string, number>()
    for (const offer of valid) counts.set(offer.currency, (counts.get(offer.currency) ?? 0) + 1)
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
    if (sorted.length === 0) return null
    currency = sorted[0][0]
  }

  const pool = valid.filter((offer) => offer.currency === currency)
  const preferred = pool.filter((offer) => PREFERRED_MERCHANTS.has(offer.merchant))
  const finalists = preferred.length > 0 ? preferred : pool
  finalists.sort((a, b) => a.price - b.price || a.title.localeCompare(b.title))
  return finalists[0] ?? null
}
