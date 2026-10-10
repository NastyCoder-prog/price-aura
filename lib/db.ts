// lib/db.ts
// PostgreSQL data layer (Supabase, Neon, Vercel Postgres, ...).
// Works on Vercel because it is a pooled network connection — no local files.

import postgres from 'postgres'
import type { ScrapedProduct } from './scraper'
import { formatPrice, priceChangeLabel } from './scraper/price'

// One pooled client, reused across warm serverless invocations.
let client: postgres.Sql | null = null

export function db(): postgres.Sql {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Add it in Vercel → Settings → Environment Variables.')
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
  title: string
  store: string
  image?: string
  price: string
  target: string
  priceValue: number
  targetValue: number
  status: 'Monitoring' | 'Price Dropped!'
  change?: string
  scannedAt?: string
  emails: string[]
}

interface ProductRow {
  id: number
  url: string
  title: string
  store: string
  image: string | null
  price_value: number
  target_value: number
  status: string
  last_change: string | null
  scanned_at: Date | string | null
  emails: string[] | null
}

// Database row -> the JSON shape the frontend already understands.
function toApiProduct(row: ProductRow): ApiProduct {
  return {
    id: Number(row.id),
    url: row.url,
    title: row.title,
    store: row.store,
    image: row.image || undefined,
    price: formatPrice(row.price_value),
    target: formatPrice(row.target_value),
    priceValue: row.price_value,
    targetValue: row.target_value,
    status: row.status === 'Price Dropped!' ? 'Price Dropped!' : 'Monitoring',
    change: row.last_change || undefined,
    scannedAt: row.scanned_at ? new Date(row.scanned_at).toISOString() : undefined,
    emails: row.emails ?? [],
  }
}

export async function listProducts(): Promise<ApiProduct[]> {
  const rows = await db()<ProductRow[]>`
    select p.*, coalesce(array_agg(e.email) filter (where e.id is not null), '{}') as emails
    from products p
    left join product_emails e on e.product_id = p.id
    group by p.id
    order by p.id desc
  `
  return rows.map(toApiProduct)
}

export async function getProduct(id: number): Promise<ApiProduct | null> {
  const rows = await db()<ProductRow[]>`
    select p.*, coalesce(array_agg(e.email) filter (where e.id is not null), '{}') as emails
    from products p
    left join product_emails e on e.product_id = p.id
    where p.id = ${id}
    group by p.id
  `
  return rows[0] ? toApiProduct(rows[0]) : null
}

// Insert or update a freshly scraped product, record the price in history,
// and flag a "Price Dropped!" status when the new price is lower.
export async function saveProduct(scraped: ScrapedProduct): Promise<ApiProduct> {
  const sql = db()

  const id = await sql.begin(async (tx) => {
    const existing = await tx<{ id: number; price_value: number; target_value: number }[]>`
      select id, price_value, target_value from products where url = ${scraped.url}
    `

    let status = 'Monitoring'
    let lastChange: string | null = null
    let targetValue = scraped.targetValue // first scan: default 10% under

    if (existing[0]) {
      const latest = await tx<{ price_value: number }[]>`
        select price_value from price_history where product_id = ${existing[0].id} order by id desc limit 1
      `
      const previous = latest[0]?.price_value ?? existing[0].price_value
      targetValue = existing[0].target_value // keep the alert price we already had
      if (scraped.priceValue < previous) {
        status = 'Price Dropped!'
        lastChange = priceChangeLabel(previous, scraped.priceValue)
      }
    }

    let productId: number
    if (existing[0]) {
      await tx`
        update products
        set title = ${scraped.title}, store = ${scraped.store}, image = ${scraped.image},
            price_value = ${scraped.priceValue}, target_value = ${targetValue},
            status = ${status}, last_change = ${lastChange}, scanned_at = ${scraped.scannedAt}
        where id = ${existing[0].id}
      `
      productId = existing[0].id
    } else {
      const inserted = await tx<{ id: number }[]>`
        insert into products (url, title, store, image, price_value, target_value, status, last_change, scanned_at)
        values (${scraped.url}, ${scraped.title}, ${scraped.store}, ${scraped.image},
                ${scraped.priceValue}, ${targetValue}, ${status}, ${lastChange}, ${scraped.scannedAt})
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
  if (!saved) throw new Error('Failed to read back the saved product.')
  return saved
}

export async function addEmail(productId: number, email: string): Promise<ApiProduct | null> {
  await db()`
    insert into product_emails (product_id, email) values (${productId}, ${email})
    on conflict (product_id, email) do nothing
  `
  return getProduct(productId)
}

export async function priceHistory(
  productId: number,
  limit = 50
): Promise<{ priceValue: number; price: string; checkedAt: string }[]> {
  const rows = await db()<{ price_value: number; checked_at: Date | string }[]>`
    select price_value, checked_at from price_history
    where product_id = ${productId} order by id desc limit ${limit}
  `
  return rows.map((row) => ({
    priceValue: row.price_value,
    price: formatPrice(row.price_value),
    checkedAt: new Date(row.checked_at).toISOString(),
  }))
}
