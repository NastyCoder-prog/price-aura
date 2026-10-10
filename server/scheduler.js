// server/scheduler.js
// Background job: re-scans every stored product URL on a schedule.
// Default: every 12 hours (see RESCAN_CRON in config.js).
// Each scan updates the database and flags price drops automatically.

const cron = require('node-cron')
const config = require('./config')
const store = require('./store')
const { scrapeProduct } = require('./scraper')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function rescanAll() {
  const rows = store.allRows()
  if (rows.length === 0) {
    console.log('[rescan] nothing to scan yet')
    return { ok: 0, failed: 0 }
  }

  console.log(`[rescan] scanning ${rows.length} product(s)...`)
  let ok = 0
  let failed = 0

  for (const row of rows) {
    try {
      const scraped = await scrapeProduct(row.url)
      const saved = store.saveProduct(scraped)
      ok += 1
      console.log(`[rescan] ${saved.price}${saved.change ? ` (${saved.change})` : ''} · ${saved.title}`)
    } catch (error) {
      failed += 1
      console.warn(`[rescan] could not scan ${row.url}: ${error.message}`)
    }
    await sleep(3000) // polite pause so we never look like a bot flood
  }

  console.log(`[rescan] finished: ${ok} updated, ${failed} failed`)
  return { ok, failed }
}

function startScheduler() {
  cron.schedule(config.RESCAN_CRON, () => {
    rescanAll().catch((error) => console.error('[rescan] crashed:', error.message))
  })
  console.log(`[rescan] background job scheduled: "${config.RESCAN_CRON}"`)

  if (config.RESCAN_ON_BOOT) {
    setTimeout(() => {
      rescanAll().catch((error) => console.error('[rescan] crashed:', error.message))
    }, 5000)
  }
}

module.exports = { startScheduler, rescanAll }
