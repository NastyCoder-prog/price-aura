import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Privacy Policy — PriceAura',
  description: 'How PriceAura collects, uses and protects your data.',
}

export default function PrivacyPage() {
  return (
    <main className="legal-page">
      <header className="legal-header">
        <Link href="/" className="brand">
          Price<span>Aura</span>
        </Link>
      </header>
      <article className="legal-prose">
        <h1>Privacy Policy</h1>
        <p className="legal-updated">Last updated: October 2026</p>

        <h2>What we collect</h2>
        <p>
          PriceAura stores the product links you ask us to watch, the alert prices you set, and — only if you
          choose to provide it — the email address used for price-drop alerts. We also record scan timestamps
          and price history for the products you track.
        </p>

        <h2>How we use it</h2>
        <p>
          Your data is used solely to run the service: scanning prices, detecting drops, and sending the email
          alerts you requested. We do not sell your data and we do not share it with advertisers.
        </p>

        <h2>Third parties</h2>
        <p>
          We store data in a managed PostgreSQL database and send alert emails through Resend. Product pages
          are read publicly through Google Shopping and, where available, directly from storefront pages.
          Anonymous usage analytics are provided by Vercel Analytics.
        </p>

        <h2>Emails &amp; unsubscribe</h2>
        <p>
          Every alert email contains a one-click unsubscribe link. Using it removes your address from that
          product immediately. Alert emails are transactional (they contain the price update you asked for)
          and are never used for marketing.
        </p>

        <h2>Your rights</h2>
        <p>
          You can delete a tracked product at any time from the dashboard, which also removes its alert emails
          and price history. For any other data requests, contact us below.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about this policy: <a href="mailto:privacy@priceaura.app">privacy@priceaura.app</a>
        </p>
      </article>
    </main>
  )
}
