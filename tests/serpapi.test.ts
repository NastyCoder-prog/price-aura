import { describe, expect, it } from 'vitest'
import { parseSerpApiResults } from '@/lib/scraper/serpapi'

describe('parseSerpApiResults', () => {
  it('maps shopping_results rows into shared offers', () => {
    const offers = parseSerpApiResults({
      shopping_results: [
        {
          title: 'Apple iPhone 15 (128 GB) - Green',
          price: '₹59,900',
          extracted_price: 59900,
          product_link: 'https://www.amazon.in/Apple-iPhone-15-128-Green/dp/B0CHX1W5XY',
          source: 'Amazon',
          thumbnail: 'https://m.media-amazon.com/images/I/xx.jpg',
        },
        {
          title: 'Samsung Galaxy S24 5G',
          price: '₹64,999',
          extracted_price: 64999,
          link: 'https://www.flipkart.com/samsung-galaxy-s24/p/itm123',
          source: 'Flipkart',
          thumbnail: 'https://rukminim1.example/img.jpg',
        },
      ],
    })

    expect(offers).toHaveLength(2)
    expect(offers[0]).toMatchObject({
      title: 'Apple iPhone 15 (128 GB) - Green',
      price: 59900,
      currency: 'INR',
      merchant: 'amazon',
      merchantLabel: 'Amazon',
      link: 'https://www.amazon.in/Apple-iPhone-15-128-Green/dp/B0CHX1W5XY',
    })
    expect(offers[1]).toMatchObject({ merchant: 'flipkart', price: 64999, currency: 'INR' })
  })

  it('skips rows without a usable price or link', () => {
    const offers = parseSerpApiResults({
      shopping_results: [
        { title: 'No price item', link: 'https://example.com/x' },
        { title: 'No link item', price: '₹1,000' },
        { title: 'X', price: '₹1,000', link: 'not-a-url' },
      ],
    })
    expect(offers).toEqual([])
  })

  it('returns an empty list for error payloads', () => {
    expect(parseSerpApiResults({ error: 'Your account ran out of searches.' })).toEqual([])
  })
})
