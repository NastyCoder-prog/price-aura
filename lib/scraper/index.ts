// lib/scraper/index.ts
// The one function the API routes call: scrapeProduct(input, options).
//
// `input` can be:
//   1. A product URL on a supported storefront (Amazon, Flipkart, …)
//   2. A Google Shopping URL (tbm=shop) — used as a stable product identity
//   3. A free-text product name — routed through Google Shopping, which
//      aggregates live listings from every major marketplace at once

import { ApiError } from '../api-error'
import { getCandidates, blockError, errorStatus } from './fetcher'
import {
  buildSearchUrl,
  isGoogleShoppingUrl,
  queryFromGoogleUrl,
  searchShopping,
  type ShoppingOffer,
} from './google'
import { extractProduct, storeLabel } from './parsers'
import { defaultTargetPrice, formatPrice } from './price'

export interface ScrapedProduct {
  url: string
  offerUrl: string
  title: string
  store: string
  storeLabel: string
  image: string | null
  price: string
  target: string
  priceValue: number
  targetValue: number
  currency: string
  scannedAt: string
  source: 'search' | 'listing'
}

export interface ScrapeOptions {
  // Cron passes batch=true so Google requests are spaced 3–7s apart.
  batch?: boolean
  // When re-scraping, keep offers in the currency the product already uses
  // so a switch to foreign listings can't register as a fake price drop.
  preferredCurrency?: string | null
  // Existing alert price — preserved on re-scrapes.
  existingTargetValue?: number | null
}

// Hosts we may fetch directly. Everything else must go through the Shopping
// search path, which also keeps us off unknown sites' bot walls.
const ALLOWED_HOST_PATTERNS: RegExp[] = [
  /^(\w+\.)?amazon\.(in|com|co\.uk|de|fr|es|it|ca|com\.au|ae|sa|sg|nl|se|pl|com\.br|com\.mx)$/,
  /^(\w+\.)?flipkart\.com$/,
  /^(\w+\.)?myntra\.com$/,
  /^(\w+\.)?ajio\.com$/,
  /^(\w+\.)?nykaa\.com$/,
  /^(\w+\.)?croma\.com$/,
  /^(\w+\.)?reliancedigital\.in$/,
  /^(\w+\.)?vijaysales\.(in|com)$/,
  /^(\w+\.)?poorvika\.com$/,
  /^(\w+\.)?sangeethamobiles\.com$/,
  /^(\w+\.)?meesho\.com$/,
  /^(\w+\.)?snapdeal\.com$/,
  /^(\w+\.)?shopclues\.com$/,
  /^(\w+\.)?walmart\.(com|ca|com\.mx|co\.uk)$/,
  /^(\w+\.)?ebay\.(com|co\.uk|de|fr|it|es|com\.au|ca|in)$/,
  /^(\w+\.)?bestbuy\.com$/,
  /^(\w+\.)?target\.com$/,
  /^(\w+\.)?costco\.com$/,
  /^(\w+\.)?homedepot\.com$/,
  /^(\w+\.)?aliexpress\.com$/,
  /^(\w+\.)?alibaba\.com$/,
  /^(\w+\.)?etsy\.com$/,
  /^(\w+\.)?rakuten\.(co\.jp|com)$/,
  /^(\w+\.)?zara\.(com|in)$/,
  /^(\w+\.)?ikea\.[a-z.]+$/,
  /^(\w+\.)?apple\.[a-z.]+$/,
  /^(\w+\.)?samsung\.[a-z.]+$/,
  /^(\w+\.)?sony\.[a-z.]+$/,
  /^(\w+\.)?bose\.com$/,
  /^(\w+\.)?jbl\.com$/,
  /^(\w+\.)?oneplus\.(in|com|net)$/,
  /^(\w+\.)?mi\.com$/,
  /^(\w+\.)?realme\.com$/,
  /^(\w+\.)?boat-lifestyle\.com$/,
  /^(\w+\.)?decathlon\.[a-z.]+$/,
  /^(\w+\.)?dyson\.[a-z.]+$/,
]

export function isAllowedListingHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, '')
  return ALLOWED_HOST_PATTERNS.some((pattern) => pattern.test(host))
}

// Bing Shopping URLs (both /shop?q= searches and /shop/productdetails?goid=
// offer pages) carry the product query in `q` — they are search identities,
// not direct listings, so re-tracks run the full multi-store comparison.
function bingShopQuery(parsed: URL): string | null {
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
  if (host !== 'bing.com') return null
  if (!parsed.pathname.startsWith('/shop')) return null
  const q = parsed.searchParams.get('q')?.trim()
  return q && q.length >= 2 ? q : null
}

function looksLikeUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || /^[\w-]+(\.[\w-]+)+(\/|$)/.test(value)
}

function normalizeUrl(raw: string): string {
  const trimmed = String(raw).trim()
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

// The stable identity URL for a product BEFORE scraping it — lets the API
// look up an existing row (to preserve its currency + alert price) without
// paying for a scrape first. Returns null for inputs that will fail later.
export function canonicalIdentityUrl(rawInput: string): string | null {
  const input = String(rawInput ?? '').trim()
  if (!input) return null

  if (isGoogleShoppingUrl(input)) {
    const query = queryFromGoogleUrl(input)
    return query ? buildSearchUrl(query) : null
  }

  if (looksLikeUrl(input)) {
    let parsed: URL
    try {
      parsed = new URL(normalizeUrl(input))
    } catch {
      return null
    }
    const host = parsed.hostname.replace(/^www\./, '')
    if (host.startsWith('google.') && parsed.pathname === '/search') {
      const query = parsed.searchParams.get('q')
      return query ? buildSearchUrl(query) : null
    }
    const bingQuery = bingShopQuery(parsed)
    if (bingQuery) return buildSearchUrl(bingQuery)
    return isAllowedListingHost(parsed.hostname) ? parsed.href : null
  }

  return buildSearchUrl(input)
}

export async function scrapeProduct(rawInput: string, options: ScrapeOptions = {}): Promise<ScrapedProduct> {
  const input = String(rawInput ?? '').trim()
  if (!input)
    throw new ApiError('Please provide a product URL or a product name to search.', 400, 'empty_input')
  if (input.length > 2048)
    throw new ApiError('That link is too long. Please paste a product page URL.', 400, 'input_too_long')
  if (/[\u0000-\u001f]/.test(input))
    throw new ApiError('That input contains invalid characters.', 400, 'invalid_input')

  // ---- Path 1: Google Shopping URL already pasted -------------------------
  if (isGoogleShoppingUrl(input)) {
    const query = queryFromGoogleUrl(input)
    if (!query)
      throw new ApiError('That Google Shopping link is missing a search query.', 400, 'bad_google_url')
    return fromSearch(query, options)
  }

  // ---- Path 2: looks like a URL -> validate host, scrape the listing ------
  if (looksLikeUrl(input)) {
    const url = normalizeUrl(input)

    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new ApiError('That does not look like a valid URL.', 400, 'bad_url')
    }
    if (!/^https?:$/.test(parsed.protocol)) {
      throw new ApiError('Only http(s) links are supported.', 400, 'bad_protocol')
    }

    // A plain (non-shopping) Google search link is treated as a search.
    if (/^google\./.test(parsed.hostname.replace(/^www\./, '')) && parsed.pathname === '/search') {
      const query = parsed.searchParams.get('q')
      if (query) return fromSearch(query, options)
    }

    // Bing Shopping links (searches and offer pages) are search identities.
    const bingQuery = bingShopQuery(parsed)
    if (bingQuery) return fromSearch(bingQuery, options)

    if (!isAllowedListingHost(parsed.hostname)) {
      throw new ApiError(
        'That store is not supported for direct links yet. Paste an Amazon/Flipkart/Walmart/eBay product URL, or just type the product name to search.',
        400,
        'host_not_supported',
      )
    }

    return fromListing(parsed.href, options)
  }

  // ---- Path 3: free-text product name -> Google Shopping ------------------
  return fromSearch(input, options)
}

async function fromSearch(query: string, options: ScrapeOptions): Promise<ScrapedProduct> {
  const { best } = await searchShopping(query, {
    batch: options.batch,
    preferredCurrency: options.preferredCurrency,
  })
  return toScrapedProduct({
    identityUrl: buildSearchUrl(query),
    offer: best,
    options,
    source: 'search',
  })
}

async function fromListing(url: string, options: ScrapeOptions): Promise<ScrapedProduct> {
  const failures: string[] = []

  for (const candidate of getCandidates(url)) {
    try {
      const html = await candidate.run()
      const { title, priceValue, currency, image } = extractProduct(url, html)

      console.log(`[scraper] OK via ${candidate.label}: "${title}" ${formatPrice(priceValue, currency)}`)

      const targetValue =
        options.existingTargetValue && options.existingTargetValue > 0
          ? options.existingTargetValue
          : defaultTargetPrice(priceValue, currency)

      return {
        url,
        offerUrl: url,
        title,
        store: storeLabel(url),
        storeLabel: storeLabel(url),
        image,
        price: formatPrice(priceValue, currency),
        target: formatPrice(targetValue, currency),
        priceValue,
        targetValue,
        currency,
        scannedAt: new Date().toISOString(),
        source: 'listing',
      }
    } catch (error) {
      const err = error as Error & { fatal?: boolean }
      if (err.fatal) throw err // dead link: stop the whole chain
      failures.push(`${candidate.label}=${err.message}`)
      console.warn(`[scraper] ${candidate.label} failed: ${err.message}`)
    }
  }

  console.error(`[scraper] all routes failed for ${url} -> ${failures.join(' | ')}`)
  throw blockError()
}

function toScrapedProduct(args: {
  identityUrl: string
  offer: ShoppingOffer
  options: ScrapeOptions
  source: 'search' | 'listing'
}): ScrapedProduct {
  const { identityUrl, offer, options, source } = args
  const targetValue =
    options.existingTargetValue && options.existingTargetValue > 0
      ? options.existingTargetValue
      : defaultTargetPrice(offer.price, offer.currency)

  return {
    url: identityUrl,
    offerUrl: offer.link,
    title: offer.title,
    store: offer.merchant,
    storeLabel: offer.merchantLabel,
    image: offer.image,
    price: formatPrice(offer.price, offer.currency),
    target: formatPrice(targetValue, offer.currency),
    priceValue: offer.price,
    targetValue,
    currency: offer.currency,
    scannedAt: new Date().toISOString(),
    source,
  }
}

export { errorStatus }
