// lib/scraper/parsers.ts
// Universal product parser — works on any shop that publishes standard
// metadata (JSON-LD, OpenGraph, microdata). Known marketplaces get a
// precise selector shortcut first, then fall back to the generic pass.

import * as cheerio from 'cheerio'
import type { CheerioAPI } from 'cheerio'
import { detectCurrency, parsePrice, type Currency } from './price'
import { blockError } from './fetcher'

// "amazon.in" -> "amazon", "www.croma.com" -> "croma"
export function storeLabel(url: string): string {
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  return host.split('.')[0]
}

const SITE_SELECTORS: Record<string, { title: string[]; price: string[] }> = {
  amazon: {
    title: ['#productTitle', '#title span', '#title'],
    price: [
      '#corePriceDisplay_desktop_feature_div .a-price .a-offscreen',
      '#corePrice_desktop .a-price .a-offscreen',
      '.apexPriceToPay .a-offscreen',
      '#priceblock_ourprice',
      '#priceblock_dealprice',
      '#price_inside_buybox',
      'span.a-price span.a-offscreen',
    ],
  },
  flipkart: {
    title: ['h1 span.VU-ZEz', 'span.B_NuCI', 'h1.x391fo', 'h1 span'],
    price: ['div._30jeq3._16Jk6d', 'div._30jeq3.Nx9bqj', 'div.Nx9bqj._4b5DiR', 'div._30jeq3', 'div._16Jk6d'],
  },
  myntra: {
    title: ['h1.pdp-name', 'h1'],
    price: ['span.pdp-price', 'span.pdp-mrp', 'span.pdp-discount-container'],
  },
  ajio: {
    title: ['h1.prod-name', 'h1'],
    price: ['div.price-wrapper .prod-sp', 'span.prod-sp'],
  },
  nykaa: {
    title: ['h1', 'h1.css-111c0e9'],
    price: ['span.css-111c0e9', 'span.price', 'span.css-1jhyetp'],
  },
}

// The generic metadata that works on Myntra, Ajio, Nykaa, Croma, Meesho,
// Shopify stores (D2C brands), and anything Schema.org-compatible.
const GENERIC_TITLE_META = [
  'meta[property="og:title"]',
  'meta[name="twitter:title"]',
  'meta[itemprop="name"]',
  'title',
]
const GENERIC_PRICE_META = [
  'meta[property="product:price:amount"]',
  'meta[property="og:price:amount"]',
  'meta[property="price"]',
  'meta[itemprop="price"]',
  '[itemprop="price"]',
]
const GENERIC_IMAGE_META = ['meta[property="og:image"]', 'meta[name="twitter:image"]']

function firstText($: CheerioAPI, selectors: string[]): string {
  for (const selector of selectors) {
    const text = $(selector).first().text().replace(/\s+/g, ' ').trim()
    if (text) return text
  }
  return ''
}

// Meta tags store text in `content`; regular elements store it as text.
function firstContent($: CheerioAPI, selectors: string[]): string {
  for (const selector of selectors) {
    const element = $(selector).first()
    if (!element.length) continue
    const value = (element.attr('content') || element.text() || '').replace(/\s+/g, ' ').trim()
    if (value) return value
  }
  return ''
}

// Titles often arrive as "Buy Nike Shoes -  - Footwear for Men" or
// "AirPods Pro : Flipkart". Keep the longest piece, strip marketing words.
function cleanTitle(raw: string): string {
  const pieces = raw
    .split(/\s*(?:\s[|:]\s|\s[–—]\s|\s-\s)\s*/)
    .map((piece) => piece.trim())
    .filter(Boolean)
  const best =
    pieces.length === 1
      ? pieces[0]
      : pieces.reduce((longest, piece) => (piece.length > longest.length ? piece : longest), '')
  return best
    .replace(/^buy\s+/i, '')
    .replace(/\s+(price in india|buy online|online at best price|best price( in india)?|buy now)$/i, '')
    .trim()
}

function pickImage(image: unknown): string | null {
  if (!image) return null
  if (typeof image === 'string') return image
  if (Array.isArray(image)) {
    const first: unknown = image[0]
    return typeof first === 'string' ? first : ((first as { url?: string } | null)?.url ?? null)
  }
  if (typeof image === 'object') return (image as { url?: string }).url ?? null
  return null
}

interface LdResult {
  title: string
  price: number | null
  image: string | null
}

// Schema.org structured data — survives class-name redesigns, so it is the
// most reliable generic source.
function fromJsonLd($: CheerioAPI): LdResult {
  let title = ''
  let price: number | null = null
  let image: string | null = null

  $('script[type="application/ld+json"]').each((_, element) => {
    let data: unknown
    try {
      // Some shops (Myntra, for one) put raw line breaks inside JSON
      // strings, which is invalid. Control characters are legal JSON
      // whitespace outside strings and harmless spaces inside them.
      data = JSON.parse(
        $(element)
          .text()
          .replace(/[\u0000-\u001F]/g, ' '),
      )
    } catch {
      return true // not valid JSON even after repair, skip it
    }

    const record = data as Record<string, unknown>
    const nodes: unknown[] = Array.isArray(data)
      ? data
      : record && Array.isArray(record['@graph'])
        ? (record['@graph'] as unknown[])
        : [data]

    for (const raw of nodes) {
      if (!raw || typeof raw !== 'object') continue
      const node = raw as Record<string, unknown>

      // Only trust Product nodes — pages often include Organization or
      // WebSite blocks whose "name" is just the shop's brand.
      const type = node['@type']
      const types = Array.isArray(type) ? type.map(String) : [String(type)]
      if (!types.includes('Product')) continue

      if (!title && typeof node.name === 'string') title = node.name.trim()
      if (!image) image = pickImage(node.image)

      const offers = node.offers
      const offer = Array.isArray(offers)
        ? (offers[0] as Record<string, unknown>)
        : (offers as Record<string, unknown> | undefined)
      if (price === null && offer && offer.price !== undefined) price = parsePrice(String(offer.price))
      if (price === null && node.lowPrice !== undefined) price = parsePrice(String(node.lowPrice))
    }
    return true
  })

  return { title, price, image }
}

export interface ExtractedProduct {
  title: string
  priceValue: number
  currency: Currency
  image: string | null
  label: string
}

export function extractProduct(url: string, html: string): ExtractedProduct {
  const $ = cheerio.load(html)
  const label = storeLabel(url)
  const site = SITE_SELECTORS[label]

  // 1. Precise selectors for known marketplaces.
  let title = site ? firstText($, site.title) : ''
  let priceText = site ? firstText($, site.price) : ''

  // 2. Universal metadata — this is what makes unknown shops work for free.
  // JSON-LD names are the cleanest, so they win over og:title.
  const ld = fromJsonLd($)
  if (!title) title = ld.title || firstContent($, GENERIC_TITLE_META)
  if (!priceText) priceText = firstContent($, GENERIC_PRICE_META)

  const priceValue = parsePrice(priceText) ?? ld.price ?? null
  const image = ld.image || firstContent($, GENERIC_IMAGE_META) || null

  if (!title || !priceValue) throw blockError()

  return { title: cleanTitle(title), priceValue, currency: detectCurrency(priceText), image, label }
}
