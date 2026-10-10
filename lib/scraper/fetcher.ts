// lib/scraper/fetcher.ts
// Downloads a product page, with an anti-bot failover chain (same as before,
// now running inside a Vercel serverless function):
//
//   1. DIRECT       plain fetch with browser headers (free, instant)
//   2. PAID APIs    ScraperAPI / ScrapingBee — only if a free API key is set
//   3. FREE PROXIES allorigins / codetabs (no key, slower, best-effort)
//
// We drop down the chain whenever a response looks like a bot block:
// HTTP 403 / 429 / 503, a captcha page, or an "access denied" page.

const SCRAPERAPI_API_KEY = process.env.SCRAPERAPI_API_KEY || ''
const SCRAPINGBEE_API_KEY = process.env.SCRAPINGBEE_API_KEY || ''

// Shown when a site blocks us or we cannot find a price.
export const BLOCK_MESSAGE = 'Unable to scan product. Please check the URL or try again.'

export function blockError(): Error {
  const error = new Error(BLOCK_MESSAGE)
  ;(error as Error & { status: number }).status = 502
  return error
}

// Shown when the link itself is dead. `fatal` stops the failover chain early.
export function notFoundError(): Error {
  const error = new Error('We could not find a product on that link. Please check the URL.')
  ;(error as Error & { status: number; fatal: boolean }).status = 404
  ;(error as Error & { status: number; fatal: boolean }).fatal = true
  return error
}

export function errorStatus(error: Error): number {
  return (error as Error & { status?: number }).status || 500
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
]

function browserHeaders(): Record<string, string> {
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

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<{ status: number; body: string }> {
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

function looksBlocked(status: number, body: string): boolean {
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

function scraperApiTarget(url: string): string {
  const query = new URLSearchParams({
    api_key: SCRAPERAPI_API_KEY,
    url,
    country_code: 'in',
    premium: 'true',
  })
  return `https://api.scraperapi.com/?${query}`
}

function scrapingBeeTarget(url: string): string {
  const query = new URLSearchParams({
    api_key: SCRAPINGBEE_API_KEY,
    url,
    country_code: 'in',
    render_js: 'false',
  })
  return `https://app.scrapingbee.com/api/v1/?${query}`
}

export async function fetchHtml(url: string): Promise<string> {
  const attempts: { label: string; target: string; timeout: number }[] = [
    { label: 'direct', target: url, timeout: 10000 },
  ]

  if (SCRAPERAPI_API_KEY) {
    attempts.push({ label: 'ScraperAPI', target: scraperApiTarget(url), timeout: 30000 })
  }
  if (SCRAPINGBEE_API_KEY) {
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
      const err = error as Error & { fatal?: boolean }
      if (err.fatal) throw err
      console.warn(`[fetcher] ${attempt.label} failed: ${err.message}`)
    }
  }

  throw blockError()
}
