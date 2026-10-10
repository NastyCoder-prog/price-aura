// lib/scraper/price.ts
// Shared price helpers: "₹1,49,999.00" <-> 149999

export function parsePrice(text: string | null | undefined): number | null {
  if (text === null || text === undefined) return null
  const cleaned = String(text).replace(/[\s,]/g, '')
  const match = cleaned.match(/(\d+(?:\.\d+)?)/)
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) ? Math.round(value) : null
}

export function formatPrice(amount: number): string {
  return `₹${Math.round(amount).toLocaleString('en-IN')}`
}

// "−8.4%" label for a drop from `previous` to `next`, else null.
export function priceChangeLabel(previous: number, next: number): string | null {
  if (!previous || next >= previous) return null
  const percent = ((previous - next) / previous) * 100
  return `−${percent.toFixed(1)}%`
}
