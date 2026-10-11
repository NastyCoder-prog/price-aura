import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Terms of Service — PriceAura',
  description: 'Terms of use for the PriceAura price-tracking service.',
}

export default function TermsPage() {
  return (
    <main className="legal-page">
      <header className="legal-header">
        <Link href="/" className="brand">
          Price<span>Aura</span>
        </Link>
      </header>
      <article className="legal-prose">
        <h1>Terms of Service</h1>
        <p className="legal-updated">Last updated: October 2026</p>

        <h2>The service</h2>
        <p>
          PriceAura watches public product listings and notifies you when a tracked price drops. The service
          is provided &quot;as is&quot;; prices shown are scraped snapshots and may lag behind the storefront
          by minutes or hours.
        </p>

        <h2>Accuracy disclaimer</h2>
        <p>
          Always confirm the final price on the retailer&rsquo;s page before purchasing. PriceAura is not
          affiliated with Amazon, Flipkart, Walmart, eBay or any other retailer, and product names, images and
          trademarks belong to their respective owners.
        </p>

        <h2>Acceptable use</h2>
        <p>
          Do not use the service to overload our systems, scrape our site, or add email addresses of people
          who have not asked for alerts. We may suspend access that harms the service or other users.
        </p>

        <h2>Liability</h2>
        <p>
          To the maximum extent permitted by law, PriceAura is not liable for purchase decisions, missed
          alerts, or any indirect damages arising from use of the service.
        </p>

        <h2>Changes</h2>
        <p>
          We may update these terms; the &quot;last updated&quot; date above reflects the current version.
          Continued use after changes means you accept the updated terms.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about these terms: <a href="mailto:legal@priceaura.app">legal@priceaura.app</a>
        </p>
      </article>
    </main>
  )
}
