import { NextResponse } from 'next/server'

// Called every 8h by Vercel Cron — chains auto-settle then analyze
// Vercel cron calls with the header: authorization: Bearer CRON_SECRET
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const results: Record<string, unknown> = {}

  // Step 1: Settle completed bets
  try {
    const settleRes = await fetch(`${base}/api/settle-auto`, { method: 'POST' })
    results.settle = await settleRes.json()
  } catch (e) {
    results.settle = { error: String(e) }
  }

  // Step 2: Analyze and place new bets
  try {
    const analyzeRes = await fetch(`${base}/api/analyze`, { method: 'POST' })
    results.analyze = await analyzeRes.json()
  } catch (e) {
    results.analyze = { error: String(e) }
  }

  console.log('[TICK]', new Date().toISOString(), results)
  return NextResponse.json({ success: true, timestamp: new Date().toISOString(), results })
}
