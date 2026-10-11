import { describe, expect, it } from 'vitest'
import {
  buildSearchUrl,
  isGoogleShoppingUrl,
  parseShoppingResults,
  resolveGoogleHref,
  selectOffer,
  type ShoppingOffer,
} from '@/lib/scraper/google'

const offer = (overrides: Partial<ShoppingOffer> = {}): ShoppingOffer => ({
  title: 'Test Product',
  price: 100,
  currency: 'INR',
  merchant: 'flipkart',
  merchantLabel: 'flipkart.com',
  link: 'https://www.flipkart.com/item/1',
  image: null,
  ...overrides,
})

describe('buildSearchUrl / isGoogleShoppingUrl', () => {
  it('builds a canonical shopping URL', () => {
    expect(buildSearchUrl('Sony WH-1000XM5')).toBe(
      'https://www.google.com/search?tbm=shop&q=Sony%20WH-1000XM5&hl=en&gl=in',
    )
  })

  it('recognises only tbm=shop links', () => {
    expect(isGoogleShoppingUrl('https://www.google.com/search?tbm=shop&q=x')).toBe(true)
    expect(isGoogleShoppingUrl('https://www.google.com/search?q=x')).toBe(false)
    expect(isGoogleShoppingUrl('https://example.com/search?tbm=shop&q=x')).toBe(false)
    expect(isGoogleShoppingUrl('not a url')).toBe(false)
  })
})

describe('resolveGoogleHref', () => {
  it('decodes /aclk adurl redirects to the merchant', () => {
    const resolved = resolveGoogleHref(
      '/aclk?sa=L&ai=abc&adurl=https%3A%2F%2Fwww.amazon.in%2Fdp%2FB09XS7JWHH',
    )
    expect(resolved).toBe('https://www.amazon.in/dp/B09XS7JWHH')
  })

  it('decodes /url?q= redirects', () => {
    expect(resolveGoogleHref('/url?q=https://www.ebay.com/itm/123')).toBe('https://www.ebay.com/itm/123')
  })

  it('passes absolute http(s) links through', () => {
    expect(resolveGoogleHref('https://www.walmart.com/ip/42')).toBe('https://www.walmart.com/ip/42')
  })

  it('keeps google shopping comparison pages absolute', () => {
    expect(resolveGoogleHref('/shopping/product/123')).toBe('https://www.google.com/shopping/product/123')
  })

  it('rejects javascript: and empty hrefs', () => {
    expect(resolveGoogleHref('javascript:alert(1)')).toBeNull()
    expect(resolveGoogleHref(undefined)).toBeNull()
    expect(resolveGoogleHref('')).toBeNull()
  })
})

function card({
  title,
  price,
  merchant,
  href,
  extra = '',
}: {
  title: string
  price: string
  merchant: string
  href: string
  extra?: string
}) {
  return `
    <div class="sh-dgr__content">
      <h3>${title}</h3>
      <span class="a8335b">${price}</span>
      <span class="aULbyc">${merchant}</span>
      ${extra}
      <a href="${href}"><img src="https://cdn.example.com/img.jpg" /></a>
    </div>`
}

describe('parseShoppingResults', () => {
  it('extracts title, price, merchant, link and image', () => {
    const html = `<html><body>${card({
      title: 'Sony WH-1000XM5 Wireless Headphones',
      price: '₹24,990',
      merchant: 'Amazon',
      href: '/aclk?adurl=https%3A%2F%2Fwww.amazon.in%2FSony%2Fdp%2FB09XS7JWHH',
    })}</body></html>`

    const offers = parseShoppingResults(html)
    expect(offers).toHaveLength(1)
    expect(offers[0]).toMatchObject({
      title: 'Sony WH-1000XM5 Wireless Headphones',
      price: 24990,
      currency: 'INR',
      link: 'https://www.amazon.in/Sony/dp/B09XS7JWHH',
      image: 'https://cdn.example.com/img.jpg',
    })
    expect(offers[0]!.merchant).toBe('amazon')
  })

  it('ignores cards without a price', () => {
    const html = `<div class="sh-dgr__content"><h3>No price product here</h3></div>`
    expect(parseShoppingResults(html)).toHaveLength(0)
  })

  it('picks the selling price over the struck-through MRP and skips EMI rows', () => {
    const html = card({
      title: 'Samsung Galaxy S24 Ultra 5G',
      price: '',
      merchant: 'Flipkart',
      href: 'https://www.flipkart.com/samsung-galaxy-s24/p/itm1',
      extra: '<section>₹1,09,999 ₹1,04,999 EMI from ₹4,375/month</section>',
    })
    // Remove the direct price span so the generic scan is exercised.
    const scanned = html.replace('<span class="a8335b"></span>', '')

    const offers = parseShoppingResults(scanned)
    expect(offers).toHaveLength(1)
    expect(offers[0]!.price).toBe(104999)
  })

  it('returns an empty list for pages with no cards', () => {
    expect(parseShoppingResults('<html><body>captcha wall</body></html>')).toEqual([])
  })
})

describe('selectOffer', () => {
  it('prefers the lowest price among preferred merchants', () => {
    const offers = [
      offer({ merchant: 'randomshop', price: 50, link: 'https://randomshop.com/a' }),
      offer({ merchant: 'amazon', price: 90, link: 'https://www.amazon.in/a' }),
      offer({ merchant: 'flipkart', price: 80, link: 'https://www.flipkart.com/b' }),
    ]
    expect(selectOffer(offers)?.merchant).toBe('flipkart')
  })

  it('falls back to non-preferred merchants when none are present', () => {
    const offers = [offer({ merchant: 'randomshop', price: 90, link: 'https://randomshop.com/a' })]
    expect(selectOffer(offers)?.merchant).toBe('randomshop')
  })

  it('never mixes currencies', () => {
    const offers = [
      offer({ currency: 'INR', price: 24990, link: 'https://www.amazon.in/a' }),
      offer({ currency: 'USD', price: 259, merchant: 'walmart', link: 'https://www.walmart.com/b' }),
    ]
    // INR is the majority here, so the $259 offer must not win (fake drop).
    expect(selectOffer(offers)?.currency).toBe('INR')
  })

  it('returns null when the product currency has no live offers', () => {
    const offers = [offer({ currency: 'USD', price: 259, link: 'https://www.walmart.com/b' })]
    expect(selectOffer(offers, 'INR')).toBeNull()
  })

  it('drops offers without a usable link or price', () => {
    expect(selectOffer([offer({ price: 0 })])).toBeNull()
    expect(selectOffer([offer({ link: '' })])).toBeNull()
  })
})
