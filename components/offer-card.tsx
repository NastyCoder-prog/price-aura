// components/offer-card.tsx
// One store's live offer in the price-comparison grid: thumbnail, merchant
// badge (Flipkart/Amazon in brand colour, others generic), the live price
// string, and the "Track this product" button.

'use client'

import { ExternalLink, Loader2, Package } from 'lucide-react'
import type { CompareOffer } from '@/lib/compare'
import { StoreMark, storeLabel } from '@/components/store-mark'

export function OfferCard({
  offer,
  tracking,
  onTrack,
}: {
  offer: CompareOffer
  tracking: string | null
  onTrack: (offer: CompareOffer) => void
}) {
  const busy = tracking === offer.link
  return (
    <article className={`offer-card${offer.isBest ? ' best' : ''}`}>
      <div className="offer-art">
        {offer.image ? (
          <img src={offer.image} alt="" loading="lazy" width={200} height={140} />
        ) : (
          <span className="offer-thumb-fallback">
            <Package aria-hidden="true" />
          </span>
        )}
        <div className="product-glow" />
      </div>
      <div className="offer-body">
        <div className="offer-store">
          <div className="offer-store-name">
            <StoreMark store={offer.merchant} />
            <span>{offer.merchantLabel || storeLabel(offer.merchant)}</span>
          </div>
          {offer.isBest && <span className="best-badge">Lowest</span>}
        </div>
        <h3>{offer.title}</h3>
        <span className="offer-price">{offer.price}</span>
        <div className="offer-actions">
          <button type="button" className="track-offer" disabled={busy} onClick={() => onTrack(offer)}>
            {busy && <Loader2 className="spin" data-icon="inline-start" aria-hidden="true" />}
            {busy ? 'Tracking…' : 'Track this product'}
          </button>
          <a
            className="open-offer"
            href={offer.link}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open this offer on ${offer.merchantLabel}`}
          >
            <ExternalLink aria-hidden="true" />
          </a>
        </div>
      </div>
    </article>
  )
}
