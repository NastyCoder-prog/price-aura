// server/fetcher.js
// Downloads a product page, with an anti-bot failover chain:
//
//   1. DIRECT      plain fetch with browser headers (free, instant)
//   2. PAID APIs   ScraperAPI / ScrapingBee — only if you add a free API key
//                  in config.js. These route the request through their own
//                  residential IPs, which is what beats most bot walls.
//   3. FREE PROXIES allorigins / codetabs (no key, slower, best-effort)
//
// We move down the chain automatically whenever a response looks like a block:
// HTTP 403 / 429 / 503, a captcha page, or an "access denied" page.

const config = require('./config')
const { blockError, notFoundError } = require('./errors')

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
]

// Browser-like headers. Without these, most shops say no.
function browserHeaders() {
  return {
    'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate',
    'Cache-Control': 'no-cache',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
  }
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      headers: browserHeaders(),
      redirect: 'follow',
      signal: controller.signal,
    })
    const body = await response.text()
    return { status: response.status, body }
  } finally {
    clearTimeout(timer)
  }
}

// Spots bot walls: bad status codes, captcha pages, "access denied" pages.
function looksBlocked(status, body) {
  if (status === 403 || status === 429 || status === 503 || status >= 500) return true
  const start = body.slice(0, 8000).toLowerCase()
  const markers = [
    'captcha',
    'validatecaptcha',
    'robot check',
    'automated access to amazon',
    'are you a robot',
    'access denied',
    'too many requests',
    'sorry, we could not find the page you are looking for',
  ]
  return markers.some((marker) => start.includes(marker))
}

// Step 2 targets — only used when an API key exists in config.js.
function scraperApiTarget(url) {
  const query = new URLSearchParams({
    api_key: config.SCRAPERAPI_API_KEY,
    url,
    country_code: 'in',
    premium: 'true',
  })
  return `https://api.scraperapi.com/?${query}`
}

function scrapingBeeTarget(url) {
  const query = new URLSearchParams({
    api_key: config.SCRAPINGBEE_API_KEY,
    url,
    country_code: 'in',
    render_js: 'false',
  })
  return `https://app.scrapingbee.com/api/v1/?${query}`
}

async function fetchHtml(url) {
  const attempts = [{ label: 'direct', target: url, timeout: 10000 }]

  if (config.SCRAPERAPI_API_KEY) {
    attempts.push({ label: 'ScraperAPI', target: scraperApiTarget(url), timeout: 30000 })
  }
  if (config.SCRAPINGBEE_API_KEY) {
    attempts.push({ label: 'ScrapingBee', target: scrapingBeeTarget(url), timeout: 30000 })
  }

  attempts.push(
    { label: 'allorigins proxy', target: `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, timeout: 12000 },
    { label: 'codetabs proxy', target: `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`, timeout: 12000 }
  )

  for (const attempt of attempts) {
    try {
      const { status, body } = await fetchWithTimeout(attempt.target, attempt.timeout)

      // A dead product link should fail instantly, not after every proxy.
      if (status === 404 || status === 410 || /<title>[^<]*page not found/i.test(body.slice(0, 3000))) {
        throw notFoundError()
      }

      if (status === 200 && body && body.length > 500 && !looksBlocked(status, body)) {
        console.log(`[fetcher] page fetched via ${attempt.label}`)
        return body
      }

      console.warn(`[fetcher] ${attempt.label} looks blocked (HTTP ${status})`)
    } catch (error) {
      if (error.fatal) throw error
      console.warn(`[fetcher] ${attempt.label} failed: ${error.message}`)
    }
  }

  throw blockError()
}

module.exports = { fetchHtml }
