// lib/scraper/fetcher.ts
// Downloads a product page through a chain of candidates, tried in order:
//
//   1. DIRECT        plain fetch, desktop browser headers (free, instant)
//   2. DIRECT MOBILE same URL with an iPhone user-agent (different fingerprint)
//   3. PAID APIs     ScraperAPI / ScrapingBee — only if a free API key is set
//   4. FREE PROXIES  allorigins / codetabs (no key, fetched from other IPs)
//   5. JINA READER   r.jina.ai (free, no key, returns the page as HTML)
//
// The scraper tries each candidate until one both downloads AND parses.
// Every failure is logged with its reason, so Vercel's function logs show
// exactly what each attempt returned.

// Shown when a site blocks us or we cannot find a price.
export const BLOCK_MESSAGE = 'Unable to scan product. Please check the URL or try again.'

export function blockError(): Error {
  const error = new Error(BLOCK_MESSAGE)
  ;(error as Error & { status: number }).status = 502
  return error
}

// Shown when the link itself is dead. `fatal` stops the whole chain early.
export function notFoundError(): Error {
  const error = new Error('We could not find a product on that link. Please check the URL.')
  ;(error as Error & { status?: number; fatal?: boolean }).status = 404
  ;(error as Error & { status?: number; fatal?: boolean }).fatal = true
  return error
}

export function errorStatus(error: Error): number {
  return (error as Error & { status?: number }).status || 500
}

const DESKTOP_USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
]

const MOBILE_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'

function browserHeaders(userAgent?: string): Record<string, string> {
  return {
    'User-Agent': userAgent || DESKTOP_USER_AGENTS[Math.floor(Math.random() * DESKTOP_USER_AGENTS.length)],
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

// Spots bot walls: bad status codes, captcha pages, "access denied" pages.
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
    'just a moment',
    'verify you are human',
    'security verification',
    'cf-chl-',
    'sorry, we could not find the page you are looking for',
  ]
  return markers.some((marker) => start.includes(marker))
}

export interface Candidate {
  label: string
  run: () => Promise<string>
}

// One download attempt with its own timeout. Returns HTML or throws with a
// human-readable reason (except a dead link, which throws a fatal error).
function attempt(label: string, target: string, timeoutMs: number, extraHeaders: Record<string, string> = {}): Candidate {
  return {
    label,
    run: async () => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const response = await fetch(target, {
          headers: { ...browserHeaders(extraHeaders['User-Agent']), ...extraHeaders },
          redirect: 'follow',
          signal: controller.signal,
        })
        const body = await response.text()

        // A dead product link fails instantly — no point trying other routes.
        if (response.status === 404 || response.status === 410 || /<title>[^<]*page not found/i.test(body.slice(0, 3000))) {
          throw notFoundError()
        }

        if (response.status === 200 && body && body.length > 500 && !looksBlocked(response.status, body)) {
          return body
        }

        if (response.status === 200 && looksBlocked(response.status, body)) {
          throw new Error('page is a captcha / bot wall')
        }
        if (body.length <= 500) throw new Error(`empty response (${body.length} bytes)`)
        throw new Error(`HTTP ${response.status}`)
      } catch (error) {
        const err = error as Error & { fatal?: boolean }
        if (err.fatal) throw err
        if (err.name === 'AbortError') throw new Error(`timed out after ${timeoutMs}ms`)
        if (err.message.startsWith('page is') || err.message.startsWith('empty') || err.message.startsWith('timed') || err.message.startsWith('HTTP')) {
          throw err
        }
        throw new Error(err.message || 'network error')
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

export function getCandidates(url: string): Candidate[] {
  const SCRAPERAPI_API_KEY = process.env.SCRAPERAPI_API_KEY || ''
  const SCRAPINGBEE_API_KEY = process.env.SCRAPINGBEE_API_KEY || ''
  const encoded = encodeURIComponent(url)

  const list: Candidate[] = [
    attempt('direct', url, 8000),
    attempt('direct (mobile UA)', url, 8000, { 'User-Agent': MOBILE_USER_AGENT }),
  ]

  // Optional paid anti-bot APIs — tried before the free proxies if configured.
  if (SCRAPERAPI_API_KEY) {
    const query = new URLSearchParams({ api_key: SCRAPERAPI_API_KEY, url, country_code: 'in', premium: 'true' })
    list.push(attempt('ScraperAPI', `https://api.scraperapi.com/?${query}`, 15000))
  }
  if (SCRAPINGBEE_API_KEY) {
    const query = new URLSearchParams({ api_key: SCRAPINGBEE_API_KEY, url, country_code: 'in', render_js: 'false' })
    list.push(attempt('ScrapingBee', `https://app.scrapingbee.com/api/v1/?${query}`, 15000))
  }

  // Free proxies: the page is fetched from a completely different IP.
  list.push(
    attempt('allorigins proxy', `https://api.allorigins.win/raw?url=${encoded}`, 8000),
    attempt('codetabs proxy', `https://api.codetabs.com/v1/proxy?quest=${encoded}`, 8000),
    // Last resort: Jina Reader renders the page on their servers and hands
    // us back clean HTML. Free, no API key.
    attempt('jina reader', `https://r.jina.ai/${url}`, 12000, { 'X-Respond-With': 'html', Accept: 'text/html' })
  )

  return list
}
