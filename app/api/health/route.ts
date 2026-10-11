// app/api/health/route.ts
// GET /api/health -> deep health check (database + required env)

import { NextResponse } from 'next/server'
import { pingDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const missing: string[] = []
  if (!process.env.DATABASE_URL) missing.push('DATABASE_URL')
  if (process.env.NODE_ENV === 'production' && !process.env.CRON_SECRET) missing.push('CRON_SECRET')

  if (missing.length > 0) {
    return NextResponse.json({ ok: false, missing }, { status: 503 })
  }

  try {
    await pingDb()
    return NextResponse.json({ ok: true, time: new Date().toISOString() })
  } catch {
    return NextResponse.json({ ok: false, error: 'database_unreachable' }, { status: 503 })
  }
}
