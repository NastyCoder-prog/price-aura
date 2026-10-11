// lib/scraper/brightdata.ts
// Bright Data SERP API — Google Shopping (tbm=shop) as structured JSON.
//
// This is the primary aggregation source: one request through our SERP zone
// returns live listings from Amazon, Flipkart, Myntra, Croma, Walmart and
// every other store Google Shopping indexes, so the whole price-comparison
// dashboard is powered by a single unified search call.
//
// The request is geo-tagged with `gl` (country of the search) — India by
// default — so prices, sellers and currency match what an Indian shopper
// actually sees on google.co.in results.
//
// Env-gated: skipped entirely when BRIGHTDATA_API_KEY is unset, so every
// other source (Bing, SerpAPI, direct Google) still works keyless.

import { paceAggregator } from './pace'
import { blockError } from './fetcher'
import { detectCurrency, parsePrice, type Currency } from './price'
import type { ShoppingOffer } from './google'

// Country geotag sent with every search. Overridable per deployment, but the
// product is India-first so 'in' is the default.
export const DEFAULT_GEOTAG = 'in'

const BRIGHTDATA_ENDPOINT = 'https://api.brightdata.com/request'
const REQUEST_TIMEOUT_MS = 25_000

// One row of the `shopping` array Bright Data returns for a tbm=shop search.
// Field names drift between SERP revisions, so the parser reads each concept
// from several aliases rather than assuming a fixed schema.
export interface BrightDataShoppingRow {
  title?: string
  price?: string
  extracted_price?: number
  image?: string
  image_url?: string
  thumbnail?: string
  shop?: string
  seller?: string
  store?: string
  merchant?: string
  source?: string
  link?: string
  url?: string
  product_link?: string
  shipping?: string
  rating?: number
  reviews_cnt?: number
  rank?: number
}

// The parsed body Bright Data hands back for a Google Shopping SERP request.
export interface BrightDataSerpPayload {
  shopping?: BrightDataShoppingRow[]
  organic?: unknown[]
  general?: { query?: string; location?: string; search_type?: string }
  error?: string
  message?: string
}

export function brightDataAvailable(): boolean {
  return Boolean(process.env.BRIGHTDATA_API_KEY)
}

function serpZone(): string {
  return process.env.BRIGHTDATA_SERP_ZONE || 'serp_api1'
}

// The Google Shopping URL we ask Bright Data to fetch: the query, `tbm=shop`
// (Shopping search), `gl` (country geotag), `hl` (language) and `brd_json=1`
// (Bright Data's own flag that asks for parsed JSON instead of raw HTML).
export function buildBrightDataSearchUrl(query: string, geotag: string = DEFAULT_GEOTAG): string {
  const params = new URLSearchParams({
    q: query.trim(),
    tbm: 'shop',
    gl: (geotag || DEFAULT_GEOTAG).toLowerCase(),
    hl: 'en',
    brd_json: '1',
  })
  return `https://www.google.com/search?${params}`
}

// Canonical identity URL for a query (no brd_json) — used as the tracked
// product's stable key so the same search always maps to the same row.
export function buildBrightDataIdentityUrl(query: string, geotag: string = DEFAULT_GEOTAG): string {
  const params = new URLSearchParams({
    q: query.trim(),
    tbm: 'shop',
    gl: (geotag || DEFAULT_GEOTAG).toLowerCase(),
    hl: 'en',
  })
  return `https://www.google.com/search?${params}`
}

// Store label -> stable merchant slug the UI can badge ("Flipkart" -> "flipkart").
const MERCHANT_ALIASES: [RegExp, string][] = [
  [/^flipkart/, 'flipkart'],
  [/^amazon/, 'amazon'],
  [/^myntra/, 'myntra'],
  [/^ajio/, 'ajio'],
  [/^nykaa/, 'nykaa'],
  [/^reliance/, 'reliancedigital'],
  [/^croma/, 'croma'],
  [/^vijaysales|^vijay/, 'vijay'],
  [/^snapdeal/, 'snapdeal'],
  [/^meesho/, 'meesho'],
  [/^shopclues/, 'shopclues'],
  [/^poorvika/, 'poorvika'],
  [/^sangeetha/, 'sangeetha'],
  [/^walmart/, 'walmart'],
  [/^ebay/, 'ebay'],
  [/^bestbuy/, 'bestbuy'],
  [/^target/, 'target'],
  [/^costco/, 'costco'],
  [/^homedepot/, 'homedepot'],
  [/^aliexpress/, 'aliexpress'],
  [/^alibaba/, 'alibaba'],
  [/^etsy/, 'etsy'],
  [/^rakuten/, 'rakuten'],
  [/^ikea/, 'ikea'],
  [/^zara/, 'zara'],
  [/^apple/, 'apple'],
  [/^samsung/, 'samsung'],
  [/^oneplus/, 'oneplus'],
  [/^boat|^boAt/, 'boat'],
]

// "Flipkart", "flipkart.com", "Walmart - Giordanos" -> merchant slug.
export function merchantSlug(label: string): string {
  const cleaned = String(label ?? '')
    .trim()
    .toLowerCase()
    .replace(/^www\./, '')
    .split(/\s+[-–—|]\s+|,\s*/)[0] // drop trailing branch names ("Walmart - Giordanos")
    .replace(/\.(com|in|co|net|org)(\.[a-z]{2})?$/, '') // drop TLDs
    .replace(/[^a-z0-9]+/g, '')
  if (!cleaned) return 'unknown'
  for (const [pattern, slug] of MERCHANT_ALIASES) {
    if (pattern.test(cleaned) || pattern.test(label)) return slug
  }
  return cleaned.slice(0, 24)
}

// Whether a merchant label names Flipkart (the store the cards badge
// specially) — the comparison UI renders Flipkart differently from others.
export function isFlipkartMerchant(label: string): boolean {
  return merchantSlug(label) === 'flipkart'
}

// Thumbnails arrive either as an http(s) URL or as an inline base64 data
// URI. Data URIs can be megabytes per row, so they are never persisted or
// shipped to the client — the card falls back to its placeholder art instead.
function thumbnailFrom(row: BrightDataShoppingRow): string | null {
  for (const candidate of [row.image, row.image_url, row.thumbnail]) {
    const value = typeof candidate === 'string' ? candidate.trim() : ''
    if (/^https?:\/\//i.test(value)) return value
  }
  return null
}

function merchantLabelFrom(row: BrightDataShoppingRow): string {
  const raw = row.shop ?? row.merchant ?? row.seller ?? row.store ?? row.source ?? ''
  const label = String(raw).replace(/\s+/g, ' ').trim()
  return label || 'Unknown retailer'
}

// Bright Data's shopping rows usually carry no product link; fall back to a
// geo-tagged Google Shopping search for that exact item, which our scraper
// understands as a stable search identity.
function offerLinkFrom(row: BrightDataShoppingRow, title: string, merchantLabel: string): string {
  for (const candidate of [row.link, row.product_link, row.url]) {
    const value = typeof candidate === 'string' ? candidate.trim() : ''
    if (/^https?:\/\//i.test(value) && !/^https?:\/\/(www\.)?google\./i.test(value)) return value
    if (/^https?:\/\/(www\.)?google\./i.test(value) && /\/aclk\?|\/url\?/.test(value)) return value
  }
  const shop = merchantLabel !== 'Unknown retailer' ? ` ${merchantLabel}` : ''
  return buildBrightDataIdentityUrl(`${title}${shop}`.trim())
}

function cleanTitle(raw: unknown): string {
  return String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Accepts the full SERP body, a bare `shopping` array, or a wrapped dataset
// envelope — so the same map function works across Bright Data responses.
function shoppingRows(payload: unknown): BrightDataShoppingRow[] {
  if (Array.isArray(payload)) return payload as BrightDataShoppingRow[]
  if (!payload || typeof payload !== 'object') return []
  const body = payload as BrightDataSerpPayload & { data?: unknown }
  if (Array.isArray(body.shopping)) return body.shopping
  if (Array.isArray(body.data)) return body.data as BrightDataShoppingRow[]
  return []
}

// ---------------------------------------------------------------------------
// The map function: Bright Data's incoming JSON response array -> the shared
// ShoppingOffer shape the whole app renders from. For every item it pulls the
// thumbnail image, the live price string, and the merchant — deciding whether
// the merchant is 'Flipkart' or another store so the product layout cards can
// be rendered dynamically (Flipkart gets its brand mark, others get a generic
// store badge).
// ---------------------------------------------------------------------------
export function parseBrightDataShopping(payload: unknown): ShoppingOffer[] {
  const offers: ShoppingOffer[] = []
  const seen = new Set<string>()

  for (const row of shoppingRows(payload)) {
    const title = cleanTitle(row.title)
    if (title.length < 4) continue

    // Live price string exactly as Google rendered it ("₹59,900", "$349.00").
    const priceText = cleanTitle(row.price)
    const price =
      parsePrice(priceText) ??
      (typeof row.extracted_price === 'number' && row.extracted_price > 0 ? row.extracted_price : null)
    if (!price || price <= 0) continue
    const currency: Currency = detectCurrency(priceText)

    // Merchant: "Flipkart" stays Flipkart, "amazon.in" becomes "amazon", and
    // anything unrecognised keeps a readable label for the generic badge.
    const merchantLabel = merchantLabelFrom(row)
    const merchant = merchantSlug(merchantLabel)

    const link = offerLinkFrom(row, title, merchantLabel)
    const image = thumbnailFrom(row)

    const key = `${title.toLowerCase()}|${price}|${merchant}`
    if (seen.has(key)) continue
    seen.add(key)

    offers.push({
      title,
      price,
      currency,
      merchant, // 'flipkart' | 'amazon' | … — drives the card's store badge
      merchantLabel, // "Flipkart" / "Croma" / "Unknown retailer"
      link,
      image,
    })
  }

  return offers
}

// Fetches Google Shopping results through the Bright Data SERP zone.
export async function searchBrightData(
  query: string,
  options: { batch?: boolean } = {},
): Promise<{ searchUrl: string; offers: ShoppingOffer[] }> {
  if (!brightDataAvailable()) throw blockError()

  const searchUrl = buildBrightDataSearchUrl(query)
  await paceAggregator(Boolean(options.batch))

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(BRIGHTDATA_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.BRIGHTDATA_API_KEY}`,
        Accept: 'application/json',
      },
      body: JSON.stringify({ zone: serpZone(), url: searchUrl, format: 'raw' }),
      signal: controller.signal,
    })

    if (!response.ok) throw new Error(`brightdata HTTP ${response.status}`)

    const payload: unknown = await response.json().catch(() => null)
    if (!payload) throw new Error('brightdata returned a non-JSON body (HTML interstitial?)')

    const body = payload as { error?: string; message?: string }
    if (body?.error || body?.message) {
      throw new Error(String(body.error || body.message))
    }

    const offers = parseBrightDataShopping(payload)
    if (offers.length === 0) throw new Error('no parseable shopping offers in the SERP response')

    console.log(`[scraper] brightdata OK: ${offers.length} offers`)
    return { searchUrl, offers }
  } catch (error) {
    console.warn(`[scraper] brightdata failed: ${(error as Error).message}`)
    throw blockError()
  } finally {
    clearTimeout(timer)
  }
}
