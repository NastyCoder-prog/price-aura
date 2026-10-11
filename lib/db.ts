// lib/db.ts
// PostgreSQL data layer (Supabase, Neon, Vercel Postgres, ...).
// Works on Vercel because it is a pooled network connection — no local files.

import { ApiError } from './api-error'
import postgres from 'postgres'
import type { ScrapedProduct } from './scraper'
import { formatPrice, priceChangeLabel, type Currency } from './scraper/price'

// One pooled client, reused across warm serverless invocations.
let client: postgres.Sql | null = null

export function db(): postgres.Sql {
  if (!process.env.DATABASE_URL) {
    throw new ApiError('Database is not configured.', 503, 'database_unavailable')
  }
  if (!client) {
    // max: 1 + prepare: false keeps us friendly with serverless pooling
    // (use Supabase's *pooled* connection string, port 6543).
    client = postgres(process.env.DATABASE_URL, { max: 1, prepare: false })
  }
  return client
}

export interface ApiProduct {
  id: number
  url: string
  offerUrl: string
  title: string
  store: string
  image?: string
  price: string
  target: string
  priceValue: number
  targetValue: number
  currency: Currency | string
  status: 'Monitoring' | 'Price Dropped!'
  change?: string
  scannedAt?: string
  checkIntervalHours: number
  emails: string[]
}

interface ProductRow {
  id: number
  url: string
  offer_url: string | null
  title: string
  store: string
  image: string | null
  price_value: string | number
  target_value: string | number
  currency: string | null
  status: string
  last_change: string | null
  scanned_at: Date | string | null
  check_interval_hours: number | null
  emails: string[] | null
}

// A price move larger than this is treated as a bad scrape, not a real drop.
// (Guards against picking an EMI instalment or a foreign-currency number.)
const PLAUSIBLE_DROP_RATIO = 0.2

// Database row -> the JSON shape the frontend understands.
function toApiProduct(row: ProductRow): ApiProduct {
  const currency = row.currency || 'INR'
  const priceValue = Number(row.price_value)
  const targetValue = Number(row.target_value)
  return {
    id: Number(row.id),
    url: row.url,
    offerUrl: row.offer_url || row.url,
    title: row.title,
    store: row.store,
    image: row.image || undefined,
    price: formatPrice(priceValue, currency),
    target: formatPrice(targetValue, currency),
    priceValue,
    targetValue,
    currency,
    status: row.status === 'Price Dropped!' ? 'Price Dropped!' : 'Monitoring',
    change: row.last_change || undefined,
    scannedAt: row.scanned_at ? new Date(row.scanned_at).toISOString() : undefined,
    checkIntervalHours: Number(row.check_interval_hours ?? 6),
    emails: row.emails ?? [],
  }
}

export async function listProducts(
  options: { withEmails?: boolean; userId?: number } = {},
): Promise<ApiProduct[]> {
  // Fail closed: without an owner id nothing is returned.
  const owner = options.userId ?? null
  const rows = options.withEmails
    ? await db()<ProductRow[]>`
        select p.*, coalesce(array_agg(e.email) filter (where e.id is not null), '{}') as emails
        from products p
        left join product_emails e on e.product_id = p.id
        where p.user_id = ${owner}
        group by p.id
        order by p.id desc
      `
    : await db()<ProductRow[]>`
        select p.*, '{}'::text[] as emails from products p
        where p.user_id = ${owner}
        order by p.id desc
      `
  return rows.map(toApiProduct)
}

// Products whose last scan is older than their check interval. Oldest first
// so every product gets a turn when the cron hits its time budget.
export async function listDueProducts(batchSize = 25): Promise<ApiProduct[]> {
  const rows = await db()<ProductRow[]>`
    select p.*, coalesce(array_agg(e.email) filter (where e.id is not null), '{}') as emails
    from products p
    left join product_emails e on e.product_id = p.id
    where p.scanned_at is null
       or p.scanned_at <= now() - make_interval(hours => greatest(coalesce(p.check_interval_hours, 6), 1))
    group by p.id
    order by p.scanned_at asc nulls first, p.id asc
    limit ${batchSize}
  `
  return rows.map(toApiProduct)
}

export async function getProduct(
  id: number,
  options: { withEmails?: boolean } = {},
): Promise<ApiProduct | null> {
  const rows = options.withEmails
    ? await db()<ProductRow[]>`
        select p.*, coalesce(array_agg(e.email) filter (where e.id is not null), '{}') as emails
        from products p
        left join product_emails e on e.product_id = p.id
        where p.id = ${id}
        group by p.id
      `
    : await db()<ProductRow[]>`select p.*, '{}'::text[] as emails from products p where p.id = ${id}`
  return rows[0] ? toApiProduct(rows[0]) : null
}

// The caller's own copy of a product — every management route loads through
// this so nobody can touch another account's watchlist.
export async function getOwnedProduct(id: number, userId: number): Promise<ApiProduct | null> {
  const rows = await db()<ProductRow[]>`
    select p.*, '{}'::text[] as emails from products p
    where p.id = ${id} and p.user_id = ${userId}
  `
  return rows[0] ? toApiProduct(rows[0]) : null
}

export async function getProductByUrl(url: string, userId?: number): Promise<ApiProduct | null> {
  const rows =
    userId === undefined
      ? await db()<ProductRow[]>`select p.*, '{}'::text[] as emails from products p where p.url = ${url}`
      : await db()<ProductRow[]>`
          select p.*, '{}'::text[] as emails from products p
          where p.url = ${url} and p.user_id = ${userId}
        `
  return rows[0] ? toApiProduct(rows[0]) : null
}

export interface SaveProductOptions {
  checkIntervalHours?: number
  // Owner of the tracked product. Set when a signed-in user starts tracking.
  userId?: number | null
  // Re-scrape of an existing row (cron): resolve it by primary key instead
  // of by URL so every owner's copy updates independently.
  matchId?: number | null
}

// Insert or update a freshly scraped product, record the price in history,
// and flag a "Price Dropped!" status when the new price is lower.
export async function saveProduct(
  scraped: ScrapedProduct,
  options: SaveProductOptions = {},
): Promise<ApiProduct> {
  const sql = db()

  const id = await sql.begin(async (tx) => {
    // Row lookup: re-scrapes (cron) match by primary key; interactive saves
    // match the same URL within the same owner's watchlist.
    const existing = options.matchId
      ? await tx<{ id: number; price_value: number; target_value: number; currency: string }[]>`
          select id, price_value, target_value, currency from products where id = ${options.matchId}
        `
      : options.userId
        ? await tx<{ id: number; price_value: number; target_value: number; currency: string }[]>`
            select id, price_value, target_value, currency from products
            where url = ${scraped.url} and user_id = ${options.userId}
          `
        : await tx<{ id: number; price_value: number; target_value: number; currency: string }[]>`
            select id, price_value, target_value, currency from products
            where url = ${scraped.url} and user_id is null
          `

    let status = 'Monitoring'
    let lastChange: string | null = null
    let targetValue = scraped.targetValue // first scan: default ~10% under

    if (existing[0]) {
      // Never compare across currencies — a ₹/$ mix would fake a huge drop.
      const existingCurrency = existing[0].currency || 'INR'
      if (scraped.currency !== existingCurrency) {
        throw new ApiError(
          'The live offers for this product switched currency, so the scan was skipped to avoid a bad comparison. Try again later.',
          409,
          'currency_mismatch',
        )
      }

      const latest = await tx<{ price_value: number }[]>`
        select price_value from price_history where product_id = ${existing[0].id} order by id desc limit 1
      `
      const previous = Number(latest[0]?.price_value ?? existing[0].price_value)
      targetValue = existing[0].target_value // keep the alert price we already had

      if (scraped.priceValue < previous) {
        if (scraped.priceValue < previous * PLAUSIBLE_DROP_RATIO) {
          throw new ApiError(
            'The scraped price looked implausible compared to the last scan, so it was not saved.',
            422,
            'implausible_price',
          )
        }
        status = 'Price Dropped!'
        lastChange = priceChangeLabel(previous, scraped.priceValue)
      }
    }

    const interval = normalizeInterval(options.checkIntervalHours)

    let productId: number
    if (existing[0]) {
      await tx`
        update products
        set title = ${scraped.title}, store = ${scraped.store}, image = ${scraped.image},
            price_value = ${scraped.priceValue}, target_value = ${targetValue},
            currency = ${scraped.currency}, offer_url = ${scraped.offerUrl},
            status = ${status}, last_change = ${lastChange}, scanned_at = ${scraped.scannedAt},
            check_interval_hours = ${interval}
        where id = ${existing[0].id}
      `
      productId = existing[0].id
    } else {
      const inserted = await tx<{ id: number }[]>`
        insert into products (url, title, store, image, price_value, target_value, currency, offer_url,
                              status, last_change, scanned_at, check_interval_hours, user_id)
        values (${scraped.url}, ${scraped.title}, ${scraped.store}, ${scraped.image},
                ${scraped.priceValue}, ${targetValue}, ${scraped.currency}, ${scraped.offerUrl},
                ${status}, ${lastChange}, ${scraped.scannedAt}, ${interval}, ${options.userId ?? null})
        returning id
      `
      productId = inserted[0].id
    }

    await tx`
      insert into price_history (product_id, price_value, checked_at)
      values (${productId}, ${scraped.priceValue}, ${scraped.scannedAt})
    `

    return productId
  })

  const saved = await getProduct(id)
  if (!saved) throw new ApiError('Failed to read back the saved product.', 500, 'internal_error')
  return saved
}

export const ALLOWED_INTERVALS = [1, 6, 12, 24] as const

export function normalizeInterval(value: unknown): number {
  const numeric = Number(value)
  return (ALLOWED_INTERVALS as readonly number[]).includes(numeric) ? numeric : 6
}

export async function updateProductTarget(
  id: number,
  targetValue: number,
  userId?: number,
): Promise<ApiProduct | null> {
  if (userId === undefined) {
    await db()`
      update products set target_value = ${targetValue}, status = 'Monitoring', last_change = null
      where id = ${id}
    `
  } else {
    await db()`
      update products set target_value = ${targetValue}, status = 'Monitoring', last_change = null
      where id = ${id} and user_id = ${userId}
    `
  }
  return getProduct(id)
}

export async function deleteProduct(id: number, userId?: number): Promise<void> {
  if (userId === undefined) {
    await db()`delete from products where id = ${id}`
  } else {
    await db()`delete from products where id = ${id} and user_id = ${userId}`
  }
}

export async function addEmail(productId: number, email: string): Promise<void> {
  await db()`
    insert into product_emails (product_id, email) values (${productId}, ${email})
    on conflict (product_id, email) do nothing
  `
}

export async function removeEmail(productId: number, email: string): Promise<void> {
  await db()`delete from product_emails where product_id = ${productId} and email = ${email}`
}

export interface PriceHistoryPoint {
  priceValue: number
  price: string
  checkedAt: string
}

export async function priceHistory(productId: number, limit = 50): Promise<PriceHistoryPoint[]> {
  const rows = await db()<
    { price_value: string | number; checked_at: Date | string; currency: string | null }[]
  >`
    select h.price_value, h.checked_at, p.currency
    from price_history h
    join products p on p.id = h.product_id
    where h.product_id = ${productId}
    order by h.id desc
    limit ${limit}
  `
  return rows.map((row) => {
    const currency = row.currency || 'INR'
    const priceValue = Number(row.price_value)
    return {
      priceValue,
      price: formatPrice(priceValue, currency),
      checkedAt: new Date(row.checked_at).toISOString(),
    }
  })
}

export interface ApiUser {
  id: number
  email: string
  name: string | null
}

interface UserRow {
  id: number
  email: string
  name: string | null
  password_hash?: string
}

// ---- Accounts -------------------------------------------------------------

// Creates an account. Returns null when the email is already registered so
// the route can answer "email already in use" without leaking anything else.
export async function createUser(input: {
  email: string
  passwordHash: string
  name?: string | null
}): Promise<ApiUser | null> {
  const rows = await db()<
    UserRow[]
  >`insert into users (email, password_hash, name)
    values (${input.email}, ${input.passwordHash}, ${input.name ?? null})
    on conflict (email) do nothing
    returning id, email, name`
  return rows[0] ? { id: Number(rows[0].id), email: rows[0].email, name: rows[0].name } : null
}

export async function getUserAuth(email: string): Promise<(ApiUser & { passwordHash: string }) | null> {
  const rows = await db()<UserRow[]>`
    select id, email, name, password_hash from users where email = ${email}
  `
  const row = rows[0]
  if (!row) return null
  return {
    id: Number(row.id),
    email: row.email,
    name: row.name,
    passwordHash: row.password_hash ?? '',
  }
}

// Sessions store only a hash of the cookie token.
export async function createSession(tokenHash: string, userId: number, expiresAt: Date): Promise<void> {
  await db()`
    insert into sessions (token_hash, user_id, expires_at) values (${tokenHash}, ${userId}, ${expiresAt})
  `
}

export async function getSessionUser(tokenHash: string): Promise<ApiUser | null> {
  if (!tokenHash) return null
  const rows = await db()<UserRow[]>`
    select u.id, u.email, u.name
    from sessions s
    join users u on u.id = s.user_id
    where s.token_hash = ${tokenHash} and s.expires_at > now()
  `
  const row = rows[0]
  return row ? { id: Number(row.id), email: row.email, name: row.name } : null
}

export async function deleteSession(tokenHash: string): Promise<void> {
  if (!tokenHash) return
  await db()`delete from sessions where token_hash = ${tokenHash}`
}

// Alert helpers for the cron. `previousLow` is the cheapest price recorded
// BEFORE the scan that just landed, so "all-time low" means a genuinely new
// record — not "the price is unchanged since last time".
export interface PriceWatchStats {
  previousLow: number | null
  isAllTimeLow: boolean
  atOrBelowTarget: boolean
}

export async function priceWatchStats(
  productId: number,
  priceValue: number,
  targetValue: number,
): Promise<PriceWatchStats> {
  const rows = await db()<
    { previous_low: string | number | null }[]
  >`
    select min(h.price_value) as previous_low
    from price_history h
    where h.product_id = ${productId}
      and h.id < (select max(h2.id) from price_history h2 where h2.product_id = ${productId})
  `
  const raw = rows[0]?.previous_low
  const previousLow = raw === null || raw === undefined ? null : Number(raw)
  return {
    previousLow,
    isAllTimeLow: previousLow !== null && priceValue < previousLow,
    atOrBelowTarget: targetValue > 0 && priceValue <= targetValue,
  }
}

export async function pingDb(): Promise<void> {
  await db()`select 1`
}
