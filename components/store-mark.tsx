// components/store-mark.tsx
// Store badge shared by the tracked-product cards and the comparison cards.
// Flipkart (and Amazon, Walmart…) render in their brand colour; every other
// store falls back to a neutral mark.

export const STORE_LABELS: Record<string, string> = {
  amazon: 'Amazon',
  flipkart: 'Flipkart',
  myntra: 'Myntra',
  ajio: 'Ajio',
  nykaa: 'Nykaa',
  croma: 'Croma',
  meesho: 'Meesho',
  snapdeal: 'Snapdeal',
  shopclues: 'ShopClues',
  reliancedigital: 'Reliance Digital',
  vijay: 'Vijay Sales',
  poorvika: 'Poorvika',
  sangeetha: 'Sangeetha',
  walmart: 'Walmart',
  ebay: 'eBay',
  bestbuy: 'Best Buy',
  target: 'Target',
  costco: 'Costco',
  homedepot: 'Home Depot',
  aliexpress: 'AliExpress',
  alibaba: 'Alibaba',
  etsy: 'Etsy',
  rakuten: 'Rakuten',
  ikea: 'IKEA',
  zara: 'Zara',
}

export function storeLabel(store: string) {
  const key = String(store ?? '').toLowerCase()
  return STORE_LABELS[key] ?? store.charAt(0).toUpperCase() + store.slice(1)
}

export function StoreMark({ store }: { store: string }) {
  const key = String(store ?? '').toLowerCase()
  return (
    <span className={`store-mark ${key}`} aria-label={storeLabel(store)}>
      {store.charAt(0).toUpperCase()}
    </span>
  )
}
