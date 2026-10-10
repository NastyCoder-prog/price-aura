// server/parsers.js
// Universal product parser.
//
// Almost every shop publishes the same standard metadata, so one generic
// pass works almost everywhere:
//   - JSON-LD   <script type="application/ld+json">  (Schema.org Product)
//   - OpenGraph <meta property="og:title">, "product:price:amount", ...
//   - Microdata <span itemprop="price">1,499</span>
//
// Known marketplaces (Amazon, Flipkart, Myntra, Ajio, Nykaa) get a precise
// selector shortcut first, then fall back to the generic pass. New shops
// need no configuration at all.

const cheerio = require('cheerio')
const { parsePrice } = require('./price')
const { blockError } = require('./errors')

// "amazon.in" -> "amazon", "www.croma.com" -> "croma"
function storeLabel(url) {
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  return host.split('.')[0]
}

const SITE_SELECTORS = {
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
// Shopify stores (D2C brands), and basically anything Schema.org-compatible.
const GENERIC_TITLE_META = ['meta[property="og:title"]', 'meta[name="twitter:title"]', 'meta[itemprop="name"]', 'title']
const GENERIC_PRICE_META = [
  'meta[property="product:price:amount"]',
  'meta[property="og:price:amount"]',
  'meta[property="price"]',
  'meta[itemprop="price"]',
  '[itemprop="price"]',
]
const GENERIC_IMAGE_META = ['meta[property="og:image"]', 'meta[name="twitter:image"]']

// Returns the first selector that has text, e.g. firstText($, ['#productTitle', '#title'])
function firstText($, selectors) {
  for (const selector of selectors) {
    const text = $(selector).first().text().replace(/\s+/g, ' ').trim()
    if (text) return text
  }
  return ''
}

// Meta tags store text in `content`; regular elements store it as text.
function firstContent($, selectors) {
  for (const selector of selectors) {
    const element = $(selector).first()
    if (!element.length) continue
    const value = (element.attr('content') || element.text() || '').replace(/\s+/g, ' ').trim()
    if (value) return value
  }
  return ''
}

// og:title often looks like "Buy Nike Shoes -  - Footwear for Men" or
// "AirPods Pro : Flipkart". Keep the longest piece, then strip the
// marketing words shops like to glue onto their titles.
function cleanTitle(raw) {
  const pieces = raw
    .split(/\s*(?:\s[|:]\s|\s[–—]\s|\s-\s)\s*/)
    .map((piece) => piece.trim())
    .filter(Boolean)
  const best = pieces.length === 1 ? pieces[0] : pieces.reduce((longest, piece) => (piece.length > longest.length ? piece : longest), '')
  return best
    .replace(/^buy\s+/i, '')
    .replace(/\s+(price in india|buy online|online at best price|best price( in india)?|buy now)$/i, '')
    .trim()
}

function pickImage(image) {
  if (!image) return null
  if (typeof image === 'string') return image
  if (Array.isArray(image)) return typeof image[0] === 'string' ? image[0] : image[0]?.url ?? null
  if (typeof image === 'object') return image.url ?? null
  return null
}

// Schema.org structured data — survives class-name redesigns, so it is the
// most reliable generic source.
function fromJsonLd($) {
  let title = ''
  let price = null
  let image = null

  $('script[type="application/ld+json"]').each((_, element) => {
    let data
    try {
      // Some shops (Myntra, for one) put raw line breaks inside JSON
      // strings, which is invalid. Control characters are legal JSON
      // whitespace outside strings and harmless spaces inside them,
      // so replacing them repairs the block.
      data = JSON.parse($(element).text().replace(/[\u0000-\u001F]/g, ' '))
    } catch {
      return true // this block is not valid JSON even after repair, skip it
    }

    const nodes = Array.isArray(data)
      ? data
      : data && Array.isArray(data['@graph'])
        ? data['@graph']
        : [data]

    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue

      // Only trust Product nodes — pages often include Organization or
      // WebSite blocks whose "name" is just the shop's brand.
      const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']]
      if (!types.includes('Product')) continue

      if (!title && typeof node.name === 'string') title = node.name.trim()
      if (!image) image = pickImage(node.image)

      const offer = Array.isArray(node.offers) ? node.offers[0] : node.offers
      if (price === null && offer && offer.price !== undefined) price = parsePrice(offer.price)
      if (price === null && node.lowPrice !== undefined) price = parsePrice(node.lowPrice)
    }
    return true
  })

  return { title, price, image }
}

function extractProduct(url, html) {
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

  return { title: cleanTitle(title), priceValue, image, label }
}

module.exports = { extractProduct, storeLabel }
