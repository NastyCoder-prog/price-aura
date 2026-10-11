import { describe, expect, it } from 'vitest'
import {
  buildBrightDataSearchUrl,
  isFlipkartMerchant,
  merchantSlug,
  parseBrightDataShopping,
} from '@/lib/scraper/brightdata'

describe('buildBrightDataSearchUrl', () => {
  it('geo-tags the search to India and asks for parsed JSON', () => {
    const url = new URL(buildBrightDataSearchUrl('sony wh-1000xm5'))
    expect(url.hostname).toBe('www.google.com')
    expect(url.searchParams.get('q')).toBe('sony wh-1000xm5')
    expect(url.searchParams.get('tbm')).toBe('shop')
    expect(url.searchParams.get('gl')).toBe('in')
    expect(url.searchParams.get('hl')).toBe('en')
    expect(url.searchParams.get('brd_json')).toBe('1')
  })
})

describe('merchantSlug / isFlipkartMerchant', () => {
  it("recognises Flipkart from label or domain forms", () => {
    expect(merchantSlug('Flipkart')).toBe('flipkart')
    expect(merchantSlug('flipkart.com')).toBe('flipkart')
    expect(merchantSlug('www.flipkart.com')).toBe('flipkart')
    expect(isFlipkartMerchant('Flipkart')).toBe(true)
    expect(isFlipkartMerchant('Amazon')).toBe(false)
  })

  it('normalises known stores and keeps a readable slug for the rest', () => {
    expect(merchantSlug('amazon.in')).toBe('amazon')
    expect(merchantSlug('Walmart - Giordanos')).toBe('walmart')
    expect(merchantSlug('Reliance Digital')).toBe('reliancedigital')
    expect(merchantSlug('Some D2C Shop')).toBe('somed2cshop')
  })
})

describe('parseBrightDataShopping', () => {
  it('maps the SERP shopping array onto shared offers', () => {
    const offers = parseBrightDataShopping({
      general: { query: 'iphone 15', location: 'India', search_type: 'shopping' },
      shopping: [
        {
          title: 'Apple iPhone 15 (128 GB) - Green',
          price: '₹59,900',
          image: 'https://m.media-amazon.com/images/I/xx.jpg',
          shop: 'Amazon',
          link: 'https://www.amazon.in/Apple-iPhone-15-128-Green/dp/B0CHX1W5XY',
          rating: 4.5,
          rank: 1,
        },
        {
          title: 'Samsung Galaxy S24 5G',
          price: '₹64,999',
          image: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2w...',
          shop: 'Flipkart',
          link: 'https://www.flipkart.com/samsung-galaxy-s24/p/itm123',
        },
        {
          title: 'Sony WH-1000XM5 Wireless Headphones',
          price: '₹26,990',
          shop: 'flipkart.com',
          // no link -> falls back to a geo-tagged shopping search identity
        },
      ],
    })

    expect(offers).toHaveLength(3)

    expect(offers[0]).toMatchObject({
      title: 'Apple iPhone 15 (128 GB) - Green',
      price: 59900,
      currency: 'INR',
      merchant: 'amazon',
      merchantLabel: 'Amazon',
      image: 'https://m.media-amazon.com/images/I/xx.jpg',
      link: 'https://www.amazon.in/Apple-iPhone-15-128-Green/dp/B0CHX1W5XY',
    })

    // Merchant identity drives the card badge: Flipkart vs other stores.
    expect(offers[1]).toMatchObject({
      merchant: 'flipkart',
      merchantLabel: 'Flipkart',
      price: 64999,
      currency: 'INR',
    })
    // Inline base64 thumbnails are never persisted or shipped to the client.
    expect(offers[1].image).toBeNull()

    expect(offers[2]).toMatchObject({ merchant: 'flipkart', merchantLabel: 'flipkart.com' })
    expect(offers[2].link).toContain('tbm=shop')
    expect(offers[2].link).toContain('gl=in')
  })

  it('accepts a bare response array', () => {
    const offers = parseBrightDataShopping([
      { title: 'Boat Rockerz 450 Headphone', price: '₹1,499', shop: 'Amazon' },
    ])
    expect(offers).toHaveLength(1)
    expect(offers[0]).toMatchObject({ merchant: 'amazon', price: 1499, currency: 'INR' })
  })

  it('skips rows without a usable title or price', () => {
    const offers = parseBrightDataShopping({
      shopping: [
        { title: 'No price item', shop: 'Amazon' },
        { price: '₹1,000', shop: 'Flipkart' },
        { title: 'Ok item', price: 'Free', shop: 'Flipkart' },
        { title: 'Ok item 2', price: '₹1,000', shop: 'Flipkart' },
      ],
    })
    expect(offers).toHaveLength(1)
    expect(offers[0]?.title).toBe('Ok item 2')
  })

  it('keeps only http(s) links and rejects junk', () => {
    const offers = parseBrightDataShopping([
      { title: 'Valid product name', price: '₹999', shop: 'Croma', link: 'not-a-url' },
    ])
    expect(offers).toHaveLength(1)
    expect(offers[0]?.link).toContain('google.com/search')
  })

  it('returns an empty list for empty or invalid payloads', () => {
    expect(parseBrightDataShopping(null)).toEqual([])
    expect(parseBrightDataShopping({})).toEqual([])
    expect(parseBrightDataShopping({ shopping: [] })).toEqual([])
    expect(parseBrightDataShopping({ error: 'Your zone ran out of credits.' })).toEqual([])
  })
})
