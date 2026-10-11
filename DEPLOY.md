# PriceAura — Launch Runbook (Vercel)

This repo is **one Next.js app**: the dashboard (frontend) and the REST API +
price-check cron (backend) deploy together as a single Vercel project.

---

## 0. Prerequisites

| Account                    | Why                                  | Free tier?                       |
| -------------------------- | ------------------------------------ | -------------------------------- |
| GitHub                     | source control                       | ✅                               |
| Vercel                     | hosting, cron, previews              | ✅ (Hobby) / Pro for hourly cron |
| Neon **or** Supabase       | PostgreSQL database                  | ✅                               |
| Resend                     | price-drop emails                    | ✅ (3,000/mo)                    |
| Upstash Redis _(optional)_ | real distributed rate limiting       | ✅                               |
| A domain _(recommended)_   | OG images, unsubscribe links, emails | —                                |

Local machine: Node 20+, `pnpm` (`corepack enable`).

---

## 1. Run it locally

```bash
pnpm install
cp .env.example .env.local        # then fill in DATABASE_URL at minimum
```

Create the database tables (paste `schema.sql` into the Supabase/Neon SQL
editor, or `psql "$DATABASE_URL" -f schema.sql`). The file is **idempotent** —
safe to re-run on an existing database.

```bash
pnpm dev                          # http://localhost:3000
```

Quality gates (run before every push — CI runs the same ones):

```bash
pnpm check        # lint + typecheck + unit tests + production build
```

Without `DATABASE_URL`, the site still renders (empty watchlist) and shows a
friendly error notice — good for pure UI work.

---

## 2. Create the Vercel project

1. Push the repo to GitHub.
2. [vercel.com/new](https://vercel.com/new) → **Import** the repo.
3. Framework preset: **Next.js** (auto-detected). Package manager: **pnpm**.
   Do **not** change the build command.
4. Leave the project unconfigured for now — env vars come next.
5. (Recommended) attach your domain under _Settings → Domains_.

---

## 3. Environment variables

Set these under _Settings → Environment Variables_ for **Production** and
**Preview** (names must match `.env.example` exactly):

| Name                                                  | Required    | Value                                                                                                                  |
| ----------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                        | ✅          | **Pooled** connection string (port **6543** on Supabase, the "pooled" URL on Neon). Never use the direct/unpooled URL. |
| `CRON_SECRET`                                         | ✅          | A long random string: `openssl rand -hex 32`                                                                           |
| `NEXT_PUBLIC_SITE_URL`                                | ✅          | Your canonical URL, e.g. `https://priceaura.app` (used by OG tags, sitemap, and unsubscribe links in emails)           |
| `RESEND_API_KEY`                                      | recommended | Resend API key. If unset, emails are **logged instead of sent** (safe no-op).                                          |
| `EMAIL_FROM`                                          | recommended | Verified sender: `PriceAura <alerts@yourdomain.com>`                                                                   |
| `EMAIL_SIGNING_SECRET`                                | optional    | Another random string for unsubscribe tokens (falls back to `CRON_SECRET`)                                             |
| `SCRAPERAPI_API_KEY` / `SCRAPINGBEE_API_KEY`          | optional    | Paid anti-bot APIs — used automatically when present                                                                   |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | optional    | Upstash REST credentials → real distributed rate limiting                                                              |

Then **Redeploy → Redeploy with empty cache** so the build sees the new vars.

---

## 4. Database

1. Create a Postgres database (Neon or Supabase).
2. Run `schema.sql` once (SQL editor or `psql`).
3. Paste the **pooled** URL into `DATABASE_URL`.
4. Verify: `curl https://your-domain/api/health` → `{"ok":true}`.

---

## 5. Email (Resend)

1. Add your domain in Resend → _Domains_ → verify SPF/DKIM.
2. Set `EMAIL_FROM` to e.g. `PriceAura <alerts@yourdomain.com>`.
3. Set `RESEND_API_KEY`.
4. Test: track a product, add an alert email via **Manage → email field**, then
   check the function logs for `[email] sent …`. With no API key the same line
   appears as `(no RESEND_API_KEY) would send …`.

Every alert email carries a one-click **unsubscribe** link (signed with
`EMAIL_SIGNING_SECRET`/`CRON_SECRET`) — that is why `NEXT_PUBLIC_SITE_URL`
must be correct in production.

---

## 6. The cron (backend price checks)

`vercel.json` schedules:

```json
{ "path": "/api/cron/check-prices", "schedule": "0 4 * * *" } // daily 04:00 UTC
```

- The endpoint **fails closed** in production if `CRON_SECRET` is missing, and
  rejects any request without `Authorization: Bearer $CRON_SECRET`.
- It only scans **due** products (older than their per-product check interval),
  oldest first, with bounded concurrency and a 50s budget. Unfinished products
  simply stay due for the next run.
- Aggregator requests (Bing Shopping / Google Shopping) are spaced 3–7 s apart
  in cron (batch mode) so we never hammer a source in a loop.

### Where the prices come from (free-first)

Every "search by name" (and every re-track of a Bing/Google Shopping link)
runs one aggregate multi-store comparison through this chain:

1. **Bing Shopping** — free & unlimited; plain server HTML from
   `bing.com/shop`, aggregated offers from Myntra, Ajio, Vijay Sales,
   Reliance Digital, Nykaa, eBay, Walmart and more. This is the default
   path and needs **zero API keys**.
2. **SerpAPI `google_shopping`** (optional `SERPAPI_API_KEY`, ~100 free
   searches/month) — real Google Shopping data as JSON, which additionally
   carries Amazon/Flipkart listings for many queries.
3. **Google Shopping direct/proxies** (free) and **ScraperAPI /
   ScrapingBee render APIs** (optional keys) — last-resort JS rendering
   for Google's results page.

All three feed one `selectOffer()` ranking: same currency as the tracked
product, preferred merchants (Amazon, Flipkart, Walmart, …) win ties,
lowest price wins. The cron's due-check re-runs the same chain, so prices
keep moving with the market.

**Manual trigger (after every deploy):**

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://your-domain/api/cron/check-prices
```

Expected: `{"scanned":…,"updated":…,"failed":…}`. Watch
_Vercel → Functions → check-prices_ for per-product logs.

### More frequent checks (optional, requires Vercel Pro)

Hobby allows **daily** crons only. On Pro, change the schedule to hourly:

```json
{ "path": "/api/cron/check-prices", "schedule": "0 * * * *" }
```

Per-product intervals ("Every hour / 6h / 12h / 24h" in the UI) are honoured by
the due-query either way — hourly cron just lets the "Every hour" option actually
fire hourly.

---

## 7. Verify the whole stack (post-deploy checklist)

```bash
BASE=https://your-domain

curl -s $BASE/api/health                      # {"ok":true}
curl -s $BASE/api/products                    # {"products":[]}
# add a product (search mode = multi-store Shopping aggregator):
curl -s -X POST $BASE/api/products \
  -H 'Content-Type: application/json' \
  -d '{"query":"Sony WH-1000XM5","frequency":6,"email":"you@example.com"}'
curl -s -H "Authorization: Bearer $CRON_SECRET" $BASE/api/cron/check-prices
```

Manual UI pass:

- [ ] Search by name returns a real product with a real price
- [ ] Paste-a-link mode works with an Amazon/Flipkart URL
- [ ] Unsupported host shows the friendly "not supported" message (no stack traces)
- [ ] Manage → Edit alert price saves and updates the card
- [ ] Manage → Price history draws the chart
- [ ] Manage → delete removes the product (after confirm)
- [ ] Adding an email shows the confirmation; the unsubscribe link in a real
      email removes it
- [ ] `/privacy` and `/terms` render; footer links work
- [ ] Homepage shows no fake stats (counts derive from real data)
- [ ] Lighthouse: Performance / Accessibility / SEO ≥ 90
- [ ] Rate limit: 31 rapid POSTs → HTTP 429 (best-effort without Upstash)

---

## 8. Security notes (already built in — verify, don't re-add)

- No internal error messages reach clients (`lib/api-error.ts`); full errors
  are only in Vercel logs.
- API responses never expose subscriber emails (PII) — they are used only for
  sending alerts and are stripped from GET responses.
- Direct scraping is restricted to an **allowlist of storefront hosts**
  (SSRF guard); everything else goes through the Shopping search chain
  (Bing → SerpAPI → Google).
- Emails HTML-escape scraped titles; unsubscribe links are HMAC-signed.
- Security headers (CSP, HSTS, X-Frame-Options, …) ship via `next.config.mjs`.
- Cron requires `CRON_SECRET` in production.

---

## 9. Rollback & monitoring

- **Rollback:** Vercel → project → _Deployments_ → previous good deployment →
  _Promote to Production_ (takes seconds; DB migrations are backward
  compatible by design).
- **Alerts:** point an uptime monitor (BetterStack/UptimeRobot) at
  `/api/health` and at `/` (every 5 min).
- **Cron watchdog:** alert if the last scheduled run failed — check
  _Vercel → Cron_ history daily during the first week.
- **Logs:** Vercel → Functions → filter `[scraper]`, `[cron]`, `[email]`.

---

## 10. Optional next steps (not required to launch)

- Sentry for error tracking (`@sentry/nextjs`)
- Playwright E2E against the preview deployment
- Move `generator`-era placeholder assets (`public/placeholder*`) to real
  product imagery if desired
- Account/auth layer if the dashboard ever becomes private per-user
