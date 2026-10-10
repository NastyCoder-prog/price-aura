// server/config.js
// Every setting in one place.
// The scraping-API keys are OPTIONAL. Leave them empty and the fetcher
// uses direct requests + free public proxies instead.
const path = require('path')

module.exports = {
  PORT: process.env.PORT || 4000,

  // OPTIONAL anti-bot APIs (both have free trial credits).
  // Paste your key between the quotes, or run:
  //   SCRAPERAPI_API_KEY=xxxx npm run server
  SCRAPERAPI_API_KEY: process.env.SCRAPERAPI_API_KEY || '',
  SCRAPINGBEE_API_KEY: process.env.SCRAPINGBEE_API_KEY || '',

  // Background re-scan schedule (cron syntax). Default: every 12 hours.
  RESCAN_CRON: process.env.RESCAN_CRON || '0 */12 * * *',

  // true = run one full re-scan 5 seconds after boot (handy for testing).
  RESCAN_ON_BOOT: process.env.RESCAN_ON_BOOT === 'true',

  // The SQLite database file lives here.
  DB_PATH: process.env.DB_PATH || path.join(__dirname, 'data', 'priceaura.db'),
}
