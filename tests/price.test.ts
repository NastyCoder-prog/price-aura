import { describe, expect, it } from 'vitest'
import {
  defaultTargetPrice,
  detectCurrency,
  formatPrice,
  parsePrice,
  priceChangeLabel,
} from '@/lib/scraper/price'

describe('parsePrice', () => {
  it('parses Indian grouped prices', () => {
    expect(parsePrice('₹1,49,999.00')).toBe(149999)
    expect(parsePrice('₹19,990')).toBe(19990)
  })

  it('parses western grouped prices with cents', () => {
    expect(parsePrice('$1,299.99')).toBe(1299.99)
    expect(parsePrice('€ 49,99')).toBe(49.99)
  })

  it('returns null for empty or non-numeric input', () => {
    expect(parsePrice('')).toBeNull()
    expect(parsePrice(null)).toBeNull()
    expect(parsePrice('free')).toBeNull()
  })
})

describe('detectCurrency', () => {
  it('detects the major symbols', () => {
    expect(detectCurrency('₹24,990')).toBe('INR')
    expect(detectCurrency('$349.99')).toBe('USD')
    expect(detectCurrency('€349')).toBe('EUR')
    expect(detectCurrency('£299')).toBe('GBP')
  })

  it('prefers prefixed dollar variants over plain $', () => {
    expect(detectCurrency('C$199')).toBe('CAD')
    expect(detectCurrency('A$299')).toBe('AUD')
    expect(detectCurrency('US $49')).toBe('USD')
  })

  it('defaults to INR for the India-first app', () => {
    expect(detectCurrency('24990')).toBe('INR')
    expect(detectCurrency('')).toBe('INR')
  })
})

describe('formatPrice', () => {
  it('formats INR without decimals', () => {
    expect(formatPrice(19990, 'INR')).toBe('₹19,990')
    expect(formatPrice(149999, 'INR')).toBe('₹1,49,999')
  })

  it('formats USD with two decimals', () => {
    expect(formatPrice(1299.99, 'USD')).toBe('$1,299.99')
  })

  it('falls back to INR for unknown currencies', () => {
    expect(formatPrice(100, 'XXX')).toBe('₹100')
  })
})

describe('priceChangeLabel', () => {
  it('labels a drop with one decimal', () => {
    expect(priceChangeLabel(1000, 916)).toBe('−8.4%')
  })

  it('returns null when there is no drop', () => {
    expect(priceChangeLabel(1000, 1000)).toBeNull()
    expect(priceChangeLabel(1000, 1100)).toBeNull()
    expect(priceChangeLabel(0, 10)).toBeNull()
  })
})

describe('defaultTargetPrice', () => {
  it('rounds INR alerts down to the nearest ten', () => {
    expect(defaultTargetPrice(19990, 'INR')).toBe(17990)
  })

  it('keeps cents for USD alerts', () => {
    expect(defaultTargetPrice(1299.99, 'USD')).toBe(1169.99)
  })
})
