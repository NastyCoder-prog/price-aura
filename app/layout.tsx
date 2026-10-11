import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import './globals.css'

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '')

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'PriceAura — Never overpay again',
  description:
    'Search any product and compare live offers across Amazon, Flipkart, Walmart, eBay and more. Get email alerts when the price drops.',
  openGraph: {
    title: 'PriceAura — Never overpay again',
    description:
      'Live price tracking across major stores. Search by name, watch the price, buy at the right moment.',
    url: siteUrl,
    siteName: 'PriceAura',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'PriceAura — Never overpay again',
    description: 'Live price tracking across major stores with email alerts on drops.',
  },
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#080b0d',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
