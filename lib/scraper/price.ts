// lib/scraper/price.ts
// Shared price helpers: "₹1,49,999.00" <-> 149999, "$1,299.99" <-> 1299.99
// Amounts are stored as numeric(14,2) in Postgres (major units, 2 decimals).

export type Currency = 'INR' | 'USD' | 'EUR' | 'GBP' | 'JPY' | 'AUD' | 'CAD' | 'CNY' | 'AED' | 'SGD'

interface CurrencyInfo {
  symbol: string
  locale: string
  zeroDecimal: boolean
}

const CURRENCIES: Record<Currency, CurrencyInfo> = {
  INR: { symbol: '₹', locale: 'en-IN', zeroDecimal: true },
  USD: { symbol: '$', locale: 'en-US', zeroDecimal: false },
  EUR: { symbol: '€', locale: 'en-IE', zeroDecimal: false },
  GBP: { symbol: '£', locale: 'en-GB', zeroDecimal: false },
  JPY: { symbol: '¥', locale: 'ja-JP', zeroDecimal: true },
  AUD: { symbol: 'A$', locale: 'en-AU', zeroDecimal: false },
  CAD: { symbol: 'C$', locale: 'en-CA', zeroDecimal: false },
  CNY: { symbol: 'CN¥', locale: 'zh-CN', zeroDecimal: false },
  AED: { symbol: 'AED ', locale: 'en-AE', zeroDecimal: false },
  SGD: { symbol: 'S$', locale: 'en-SG', zeroDecimal: false },
}

// Order matters: unambiguous/prefixed symbols are checked before a bare "$".
const CURRENCY_PATTERNS: [RegExp, Currency][] = [
  [/₹|\bINR\b|\bRs\.?\b/i, 'INR'],
  [/€|\bEUR\b/, 'EUR'],
  [/£|\bGBP\b/, 'GBP'],
  [/A\$/, 'AUD'],
  [/C\$/, 'CAD'],
  [/US\s?\$|\bUSD\b/, 'USD'],
  [/S\$/, 'SGD'],
  [/CN¥|\bCNY\b/, 'CNY'],
  [/¥|\bJPY\b/, 'JPY'],
  [/\bAED\b|د\.إ/, 'AED'],
  [/\$/, 'USD'],
]

// Best-effort currency detection from a raw price string. Defaults to INR
// because the app is India-first; unknown symbols fall back to it.
export function detectCurrency(text: string | null | undefined): Currency {
  const value = String(text ?? '')
  for (const [pattern, currency] of CURRENCY_PATTERNS) {
    if (pattern.test(value)) return currency
  }
  return 'INR'
}

// Extracts a positive number from a raw price string ("₹1,49,999.00" ->
// 149999, "€49,99" -> 49.99). A number of the form "49,99" (one comma, two
// trailing digits, no dot) is a decimal comma (EU style); every other comma
// is a thousands separator (US "1,299" and Indian "1,04,999" both pass
// through untouched). Keeps 2-decimal precision so cent currencies stay exact.
export function parsePrice(text: string | null | undefined): number | null {
  if (text === null || text === undefined) return null
  let value = String(text).trim()
  if (!value.includes('.') && /^\D*\d{1,3},\d{2}\D*$/.test(value)) {
    value = value.replace(',', '.')
  }
  const cleaned = value.replace(/[\s,]/g, '')
  const match = cleaned.match(/(\d+(?:\.\d+)?)/)
  if (!match) return null
  const parsed = Number(match[1])
  if (!Number.isFinite(parsed)) return null
  return Math.round(parsed * 100) / 100
}

export function formatPrice(amount: number, currency: Currency | string = 'INR'): string {
  const info = CURRENCIES[currency as Currency] ?? CURRENCIES.INR
  const fractionDigits = info.zeroDecimal ? 0 : 2
  const body = Number(amount).toLocaleString(info.locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  })
  return `${info.symbol}${body}`
}

// "−8.4%" label for a drop from `previous` to `next`, else null.
export function priceChangeLabel(previous: number, next: number): string | null {
  if (!previous || next >= previous) return null
  const percent = ((previous - next) / previous) * 100
  return `−${percent.toFixed(1)}%`
}

// Default alert price: ~10% under the current price, rounded the way each
// currency is actually quoted (tens for INR, cents elsewhere).
export function defaultTargetPrice(price: number, currency: Currency | string = 'INR'): number {
  const raw = price * 0.9
  if (currency === 'INR' || currency === 'JPY') return Math.round(raw / 10) * 10
  return Math.round(raw * 100) / 100
}
