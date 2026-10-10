// server/store.js
// Persistent storage using SQLite (a real database in one file:
// server/data/priceaura.db). Nothing is lost when the server restarts.
//
// Tables:
//   products       one row per tracked URL (title, price, alert price, status)
//   price_history  one row every time a product is scanned (the price chart)
//   product_emails email tags so we can notify users about drops later

const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')
const config = require('./config')
const { formatPrice, priceChangeLabel } = require('./price')

fs.mkdirSync(path.dirname(config.DB_PATH), { recursive: true })

const db = new Database(config.DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    store TEXT NOT NULL,
    image TEXT,
    price_value INTEGER NOT NULL,
    target_value INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'Monitoring',
    last_change TEXT,
    scanned_at TEXT
  );

  CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    price_value INTEGER NOT NULL,
    checked_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS product_emails (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    UNIQUE (product_id, email)
  );
`)

const stmt = {
  all: db.prepare('SELECT * FROM products ORDER BY id DESC'),
  byId: db.prepare('SELECT * FROM products WHERE id = ?'),
  byUrl: db.prepare('SELECT * FROM products WHERE url = ?'),
  insert: db.prepare(`
    INSERT INTO products (url, title, store, image, price_value, target_value, status, last_change, scanned_at)
    VALUES (@url, @title, @store, @image, @priceValue, @targetValue, @status, @lastChange, @scannedAt)
  `),
  update: db.prepare(`
    UPDATE products
    SET title = @title, store = @store, image = @image, price_value = @priceValue,
        target_value = @targetValue, status = @status, last_change = @lastChange, scanned_at = @scannedAt
    WHERE id = @id
  `),
  historyInsert: db.prepare('INSERT INTO price_history (product_id, price_value, checked_at) VALUES (?, ?, ?)'),
  historyFor: db.prepare('SELECT price_value, checked_at FROM price_history WHERE product_id = ? ORDER BY id DESC LIMIT ?'),
  latestHistoryPrice: db.prepare('SELECT price_value FROM price_history WHERE product_id = ? ORDER BY id DESC LIMIT 1'),
  emailsFor: db.prepare('SELECT email FROM product_emails WHERE product_id = ? ORDER BY id'),
  emailAdd: db.prepare('INSERT OR IGNORE INTO product_emails (product_id, email) VALUES (?, ?)'),
}

// Database row -> the JSON shape the frontend already understands.
function toApiProduct(row, emails = []) {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    store: row.store,
    image: row.image || undefined,
    price: formatPrice(row.price_value),
    target: formatPrice(row.target_value),
    priceValue: row.price_value,
    targetValue: row.target_value,
    status: row.status,
    change: row.last_change || undefined,
    scannedAt: row.scanned_at || undefined,
    emails,
  }
}

function emailsFor(productId) {
  return stmt.emailsFor.all(productId).map((row) => row.email)
}

function listProducts() {
  return stmt.all.all().map((row) => toApiProduct(row, emailsFor(row.id)))
}

function getProduct(id) {
  const row = stmt.byId.get(id)
  return row ? toApiProduct(row, emailsFor(id)) : null
}

// Insert or update a freshly scraped product, record the price in history,
// and flag a "Price Dropped!" status when the new price is lower.
const saveProduct = db.transaction((scraped) => {
  const existing = stmt.byUrl.get(scraped.url)

  let status = 'Monitoring'
  let lastChange = null
  let targetValue = scraped.targetValue // first scan: default 10% under

  if (existing) {
    const previous = stmt.latestHistoryPrice.get(existing.id)?.price_value ?? existing.price_value
    targetValue = existing.target_value // keep the alert price we already had
    if (scraped.priceValue < previous) {
      status = 'Price Dropped!'
      lastChange = priceChangeLabel(previous, scraped.priceValue)
    }
  }

  const values = {
    url: scraped.url,
    title: scraped.title,
    store: scraped.store,
    image: scraped.image ?? null,
    priceValue: scraped.priceValue,
    targetValue,
    status,
    lastChange,
    scannedAt: scraped.scannedAt ?? new Date().toISOString(),
  }

  let id
  if (existing) {
    stmt.update.run({ ...values, id: existing.id })
    id = existing.id
  } else {
    id = Number(stmt.insert.run(values).lastInsertRowid)
  }

  stmt.historyInsert.run(id, values.priceValue, values.scannedAt)
  return getProduct(id)
})

function addEmail(productId, email) {
  stmt.emailAdd.run(productId, email)
  return getProduct(productId)
}

function priceHistory(productId, limit = 50) {
  return stmt.historyFor.all(productId, limit).map((row) => ({
    priceValue: row.price_value,
    price: formatPrice(row.price_value),
    checkedAt: row.checked_at,
  }))
}

// Raw rows for the background rescan job.
function allRows() {
  return stmt.all.all()
}

module.exports = { listProducts, getProduct, saveProduct, addEmail, priceHistory, allRows }
