// app/api/search/route.ts
// POST /api/search { query }   (or GET /api/search?q=…)
//
// The single, unified price-comparison endpoint. One call searches Google
// Shopping through Bright Data's SERP format (geo-tagged gl=in) and returns
// every live offer so the dashboard can render a comparison card per store:
// thumbnail, live price string, and the merchant (Flipkart vs any other
// store). Tracking is a separate POST /api/products with the offer you pick.

import { NextRequest, NextResponse } from 'next/server'
import { classifyError } from '@/lib/api-error'
import { filterByRelevance, searchShopping, selectOffer } from '@/lib/scraper/google'
import { toCompareOffer } from '@/lib/compare'
import { clientIp, rateLimit } from '@/lib/ratelimit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MIN_QUERY_LENGTH = 2
const MAX_QUERY_LENGTH = 200

function errorResponse(scope: string, error: unknown) {
  const { message, status, code } = classifyError(scope, error)
  return NextResponse.json({ error: { code, message } }, { status })
}

async function runSearch(query: string) {
  const result = await searchShopping(query)
  const relevant = filterByRelevance(query, result.offers)
  const best = selectOffer(relevant, null, query) ?? result.best
  const offers = [...relevant].sort(
    (a, b) => a.price - b.price || a.merchantLabel.localeCompare(b.merchantLabel),
  )
  return {
    query,
    source: result.source,
    best: toCompareOffer(best, best),
    offers: offers.map((offer) => toCompareOffer(offer, best)),
  }
}

export async function GET(request: NextRequest) {
  return handle(request, request.nextUrl.searchParams.get('q') ?? '')
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { query?: unknown }
  return handle(request, typeof body.query === 'string' ? body.query : '')
}

async function handle(request: NextRequest, rawQuery: string) {
  const ip = clientIp(request.headers)
  const limit = await rateLimit(`search:${ip}`, 20, 60 * 1000)
  if (!limit.ok) {
    return NextResponse.json(
      {
        error: {
          code: 'rate_limited',
          message: `Too many searches from your network. Try again in ${limit.retryAfterSeconds} seconds.`,
        },
      },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    )
  }

  const query = String(rawQuery ?? '').replace(/\s+/g, ' ').trim()
  if (query.length < MIN_QUERY_LENGTH) {
    return NextResponse.json(
      { error: { code: 'missing_query', message: 'Type a product name to compare prices.' } },
      { status: 400 },
    )
  }
  if (query.length > MAX_QUERY_LENGTH) {
    return NextResponse.json(
      { error: { code: 'query_too_long', message: 'That search is too long. Try a shorter product name.' } },
      { status: 400 },
    )
  }

  try {
    return NextResponse.json(await runSearch(query))
  } catch (error) {
    return errorResponse('api/search', error)
  }
}
