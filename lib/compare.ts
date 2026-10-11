// lib/compare.ts
// The card shape the comparison dashboard renders: one entry per store offer
// with the thumbnail, the live price string, and the merchant identity.

import type { ShoppingOffer } from '@/lib/scraper/google'
import { formatPrice } from '@/lib/scraper/price'

export type StoreType = 'flipkart' | 'amazon' | 'other'

// The merchant slug decides how the product layout card is dressed: Flipkart
// and Amazon get their brand treatment, everything else is a generic store.
export function storeTypeFor(merchant: string): StoreType {
  if (merchant === 'flipkart') return 'flipkart'
  if (merchant === 'amazon') return 'amazon'
  return 'other'
}

export interface CompareOffer {
  title: string
  image: string | null
  price: string // live price string, e.g. "₹59,900"
  priceValue: number
  currency: string
  merchant: string
  merchantLabel: string
  storeType: StoreType
  isFlipkart: boolean
  link: string
  isBest: boolean
}

// Maps one scraped offer onto the shape the frontend renders.
export function toCompareOffer(offer: ShoppingOffer, best: ShoppingOffer | null): CompareOffer {
  return {
    title: offer.title,
    image: offer.image,
    price: formatPrice(offer.price, offer.currency),
    priceValue: offer.price,
    currency: offer.currency,
    merchant: offer.merchant,
    merchantLabel: offer.merchantLabel,
    storeType: storeTypeFor(offer.merchant),
    isFlipkart: offer.merchant === 'flipkart',
    link: offer.link,
    isBest: best ? offer.link === best.link && offer.price === best.price : false,
  }
}
