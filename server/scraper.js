// server/scraper.js
// The one function the rest of the app calls: scrapeProduct(url).
// It only orchestrates: validate -> download (fetcher) -> parse (parsers).
const { fetchHtml } = require('./fetcher')
const { extractProduct, storeLabel } = require('./parsers')
const { formatPrice } = require('./price')

function normalizeUrl(raw) {
  const trimmed = String(raw).trim()
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

async function scrapeProduct(rawUrl) {
  const url = normalizeUrl(rawUrl)

  let parsed
  try {
    parsed = new URL(url)
  } catch {
    const error = new Error('That does not look like a valid URL.')
    error.status = 400
    throw error
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    const error = new Error('Only http(s) links are supported.')
    error.status = 400
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

module.exports = { scrapeProduct, normalizeUrl }
