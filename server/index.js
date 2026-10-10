// server/index.js
// Entry point of the backend: `npm run server`
//
// Routes:
//   GET  /api/products             -> all tracked products
//   POST /api/products             -> scrape a URL now and start tracking it
//   POST /api/products/rescan      -> re-scan everything immediately
//   GET  /api/products/:id/history -> price history of one product
//   POST /api/products/:id/emails  -> tag an email onto a product

const express = require('express')
const cors = require('cors')
const config = require('./config')
const store = require('./store')
const { scrapeProduct } = require('./scraper')
const { startScheduler, rescanAll } = require('./scheduler')

const app = express()

app.use(cors())
app.use(express.json())

app.get('/api/products', (req, res) => {
  res.json({ products: store.listProducts() })
})

app.post('/api/products', async (req, res) => {
  try {
    const { url, email } = req.body || {}

    if (!url || typeof url !== 'string' || !url.trim()) {
      return res.status(400).json({ error: 'Please provide a product URL.' })
    }

    const scraped = await scrapeProduct(url)
    const saved = store.saveProduct(scraped)

    if (email && typeof email === 'string' && email.includes('@')) {
      store.addEmail(saved.id, email.trim())
    }

    res.status(201).json({ product: store.getProduct(saved.id) })
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Something went wrong.' })
  }
})

// Manual full re-scan (the cron job does this automatically every 12 hours).
app.post('/api/products/rescan', async (req, res) => {
  const result = await rescanAll().catch((error) => ({ error: error.message }))
  res.json(result)
})

app.get('/api/products/:id/history', (req, res) => {
  const product = store.getProduct(Number(req.params.id))
  if (!product) return res.status(404).json({ error: 'Product not found.' })
  res.json({ product, history: store.priceHistory(product.id) })
})

app.post('/api/products/:id/emails', (req, res) => {
  const product = store.getProduct(Number(req.params.id))
  if (!product) return res.status(404).json({ error: 'Product not found.' })

  const email = String((req.body || {}).email || '').trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Please provide a valid email address.' })
  }

  res.json({ product: store.addEmail(product.id, email) })
})

app.listen(config.PORT, () => {
  console.log(`PriceAura API running at http://localhost:${config.PORT}`)
  startScheduler()
})
