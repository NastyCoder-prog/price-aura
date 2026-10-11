import { describe, expect, it } from 'vitest'
import { extractProduct, storeLabel } from '@/lib/scraper/parsers'

describe('storeLabel', () => {
  it('reduces storefront hosts to short keys', () => {
    expect(storeLabel('https://www.amazon.in/dp/B09XS7JWHH')).toBe('amazon')
    expect(storeLabel('https://www.flipkart.com/item/p/itm')).toBe('flipkart')
    expect(storeLabel('https://ebay.co.uk/itm/123')).toBe('ebay')
  })
})

describe('extractProduct', () => {
  it('reads structured JSON-LD + product meta on generic stores', () => {
    const html = `<!doctype html><html><head>
      <title>Buy Sony WH-1000XM5 Headphones Online at Best Price</title>
      <meta property="og:title" content="Sony WH-1000XM5 Wireless Noise Cancelling Headphones" />
      <meta property="product:price:amount" content="24990" />
      <meta property="product:price:currency" content="INR" />
      <meta property="og:image" content="https://cdn.example.com/sony.jpg" />
      <script type="application/ld+json">
        {"@type":"Product","name":"Sony WH-1000XM5","offers":{"@type":"Offer","price":"24990","priceCurrency":"INR"}}
      </script>
    </head><body></body></html>`

    const result = extractProduct('https://www.amazon.in/sony-wh-1000xm5/dp/B09XS7JWHH', html)
    expect(result.title).toBe('Sony WH-1000XM5')
    expect(result.priceValue).toBe(24990)
    expect(result.currency).toBe('INR')
    expect(result.image).toBe('https://cdn.example.com/sony.jpg')
    expect(result.label).toBe('amazon')
  })

  it('uses the precise Amazon selector when present', () => {
    const html = `<!doctype html><html><head><title>Amazon</title></head><body>
      <span id="productTitle">  Sony WH-1000XM5 Wireless Headphones  </span>
      <span class="a-price"><span class="a-offscreen">₹24,990</span></span>
    </body></html>`

    const result = extractProduct('https://www.amazon.in/dp/B09XS7JWHH', html)
    expect(result.title).toBe('Sony WH-1000XM5 Wireless Headphones')
    expect(result.priceValue).toBe(24990)
  })

  it('throws a safe blocked error when no price can be found', () => {
    const html = '<html><head><title>Access Denied</title></head><body>captcha</body></html>'
    expect(() => extractProduct('https://www.amazon.in/dp/B09XS7JWHH', html)).toThrowError(
      /Unable to scan that page/,
    )
  })
})
