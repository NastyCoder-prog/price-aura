/** @type {import('next').NextConfig} */
const nextConfig = {
  // Type errors fail the build on purpose — no room for shipping broken code.
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    // Product images come from third-party storefronts, so they are served
    // as-is without an image-optimization proxy.
    unoptimized: true,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          {
            key: 'Content-Security-Policy',
            // img-src includes http(s) because product images are scraped from
            // third-party storefronts; scripts are limited to Vercel Analytics.
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: http: https:",
              "font-src 'self' data:",
              "connect-src 'self' https://*.vercel-scripts.com https://vitals.vercel-insights.com",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
    ]
  },
}

export default nextConfig
