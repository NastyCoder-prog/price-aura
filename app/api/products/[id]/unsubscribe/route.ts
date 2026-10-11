// app/api/products/[id]/unsubscribe/route.ts
// GET /api/products/:id/unsubscribe?email=…&token=… -> remove an alert email

import { NextRequest, NextResponse } from 'next/server'
import { classifyError } from '@/lib/api-error'
import { getProduct, removeEmail } from '@/lib/db'
import { escapeHtml, verifyUnsubscribeToken } from '@/lib/mailer'

export const dynamic = 'force-dynamic'

function page(title: string, body: string, status = 200) {
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
     <body style="font-family:system-ui,sans-serif;background:#080b0d;color:#f1f5f3;display:grid;place-items:center;min-height:100vh;margin:0">
       <main style="max-width:420px;padding:32px;text-align:center">
         <h1 style="font-size:20px;letter-spacing:-.03em">${escapeHtml(title)}</h1>
         <p style="color:#8d9a9e;font-size:14px;line-height:1.6">${body}</p>
         <p style="margin-top:28px;font-size:12px"><a style="color:#c5f36b" href="/">Back to PriceAura</a></p>
       </main>
     </body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const productId = Number(id)
    const email = (request.nextUrl.searchParams.get('email') || '').trim().toLowerCase()
    const token = request.nextUrl.searchParams.get('token') || ''

    if (!Number.isInteger(productId) || !email || !verifyUnsubscribeToken(productId, email, token)) {
      return page('Invalid link', 'This unsubscribe link is invalid or has expired.', 400)
    }

    const product = await getProduct(productId)
    if (!product)
      return page('Done', 'This product is no longer being tracked, so no more alerts will be sent.')

    await removeEmail(productId, email)
    return page(
      'Unsubscribed',
      `You will no longer receive price alerts for <strong>${escapeHtml(product.title)}</strong>.`,
    )
  } catch (error) {
    classifyError('api/products/unsubscribe', error)
    return page('Something went wrong', 'Please try again in a moment.', 500)
  }
}
