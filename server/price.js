// server/price.js
// Shared price helpers: "₹1,49,999.00" <-> 149999

// Handles: "₹1,499"  "Rs. 499"  "Rs 1,49,999.00"  "INR 24990"  "MRP: ₹1,499.50"
function parsePrice(text) {
  if (text === null || text === undefined) return null
  const cleaned = String(text).replace(/[\s,]/g, '')
  const match = cleaned.match(/(\d+(?:\.\d+)?)/)
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) ? Math.round(value) : null
}

function formatPrice(amount) {
  return `₹${Math.round(amount).toLocaleString('en-IN')}`
}

// "−8.4%" label for a drop from `previous` to `next`, else null.
function priceChangeLabel(previous, next) {
  if (!previous || next >= previous) return null
  const percent = ((previous - next) / previous) * 100
  return `−${percent.toFixed(1)}%`
}

module.exports = { parsePrice, formatPrice, priceChangeLabel }
