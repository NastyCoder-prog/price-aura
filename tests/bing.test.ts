import { describe, expect, it } from 'vitest'
import { buildBingShopUrl, parseBingResults } from '@/lib/scraper/bing'

function card({
  title,
  alt,
  price,
  seller,
  href,
}: {
  title: string
  alt: string
  price: string
  seller: string
  href: string
}) {
  return `
    <div class="br-item br-card">
      <a class="br-titlelink" href="${href}">${title}</a>
      <div class="br-price">${price}</div>
      <div class="br-sellerName">${seller}</div>
      <img src="https://th.bing.com/th/id/OPAC.abc?w=220" alt="${alt}" />
    </div>`
}

describe('buildBingShopUrl', () => {
  it('encodes the query and pins the India market', () => {
    expect(buildBingShopUrl('Sony WH-1000XM5')).toBe('https://www.bing.com/shop?q=Sony%20WH-1000XM5&mkt=en-IN')
  })
})

describe('parseBingResults', () => {
  it('extracts full titles (from image alt), prices, sellers and links', () => {
    const html = `<html><body>${card({
      title: 'Sony WH-1000XM5 Noise Cancelin…',
      alt: 'Sony WH-1000XM5 Noise Canceling Wireless Headphones - 30Hr Battery',
      price: '₹ 30,033.00',
      seller: 'UUbuy India',
      href: '/shop/productdetails?q=x&goid=123',
    })}</body></html>`

    const offers = parseBingResults(html, 'https://www.bing.com/shop?q=x')
    expect(offers).toHaveLength(1)
    expect(offers[0]).toMatchObject({
      title: 'Sony WH-1000XM5 Noise Canceling Wireless Headphones - 30Hr Battery',
      price: 30033,
      currency: 'INR',
      merchant: 'uubuy',
      merchantLabel: 'UUbuy India',
      link: 'https://www.bing.com/shop/productdetails?q=x&goid=123',
      image: 'https://th.bing.com/th/id/OPAC.abc?w=220',
    })
  })

  it('takes the sale price when the card shows MRP crossed with a deal price', () => {
    const html = card({
      title: 'Sony WH-1000XM5 Premium Nois…',
      alt: 'Sony WH-1000XM5 Premium Noise Cancelling Wireless Headphones, Silver',
      price: '₹ 19,990.00₹ 34,990.00',
      seller: 'Myntra',
      href: '/shop/productdetails?q=x&goid=456',
    })

    const offers = parseBingResults(html, 'https://www.bing.com/shop?q=x')
    expect(offers).toHaveLength(1)
    expect(offers[0]!.price).toBe(19990)
    expect(offers[0]!.merchant).toBe('myntra')
  })

  it('parses western currencies', () => {
    const html = card({
      title: 'Best Buy listing…',
      alt: 'Sony WH-1000XM5 Wireless Noise Cancelling Headphones',
      price: '$ 279.99',
      seller: 'Best Buy',
      href: 'https://www.bing.com/shop/productdetails?q=x',
    })
    const offers = parseBingResults(html, 'https://www.bing.com/shop?q=x')
    expect(offers[0]).toMatchObject({ price: 279.99, currency: 'USD', merchant: 'bestbuy' })
  })

  it('skips cards without a price', () => {
    const html = card({
      title: 'No price…',
      alt: 'No price product',
      price: '',
      seller: 'X',
      href: '/shop/p/1',
    })
    expect(parseBingResults(html, 'https://www.bing.com/shop?q=x')).toHaveLength(0)
  })

  it('returns an empty list when the page is not a results page', () => {
    expect(parseBingResults('<html><body>blocked</body></html>', 'https://www.bing.com/shop?q=x')).toEqual([])
  })

  it('parses the Singapore (Vercel sin1) variant and decodes /ck/a links', () => {
    // Builds a Bing /ck/a click-tracking redirect whose u=a1<base64url> holds
    // the real merchant URL — exactly how the sin1 layout ships its links.
    const merchantUrl = 'https://www.fruugo.sg/sony-wh-1000xm5/p/12345'
    const ckHref = `https://www.bing.com/ck/a?!&&p=abc123&u=a1${Buffer.from(merchantUrl, 'utf-8').toString('base64url')}`
    const fullTitle = 'Sony WH-1000XM5 Wireless Noise Cancelling Headphones Black'
    const html = `
      <div class="br-item br-card">
        <a class="br-voidlink br-titleClickWrap linkBtn" href="javascript:void(0)">
          <div class="br-pdItemName"><span title="${fullTitle}">${fullTitle.slice(0, 28)}…</span></div>
        </a>
        <div class="pd-price">$298.00</div>
        <div class="br-sellersCite">www.fruugo.sg</div>
        <a class="br-compareSellers" href="${ckHref}">Compare sellers</a>
        <img src="https://th.bing.com/th/id/OPAC.x?w=248" alt="${fullTitle}" />
      </div>`

    const offers = parseBingResults(html, 'https://www.bing.com/shop?q=x&cc=in')
    expect(offers).toHaveLength(1)
    expect(offers[0]).toMatchObject({
      title: fullTitle,
      price: 298,
      currency: 'USD',
      merchant: 'fruugo',
      merchantLabel: 'www.fruugo.sg',
      link: merchantUrl,
    })
  })
})
