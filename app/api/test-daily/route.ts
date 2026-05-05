export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'

// Manual test endpoint — simulates the daily routine
// Call it anytime to test with the proper 48-hour window
export async function POST(request: Request) {
  try {
    // Determine base URL from environment or request headers
    let baseUrl = process.env.NEXT_PUBLIC_APP_URL

    if (!baseUrl) {
      const host = request.headers.get('host')
      const proto = request.headers.get('x-forwarded-proto') || 'https'
      baseUrl = `${proto}://${host}`
    }

    // Call the actual cron handler with proper auth
    const response = await fetch(`${baseUrl}/api/cron/daily`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.CRON_SECRET}`,
      },
    })

    const data = await response.json()
    return NextResponse.json(data)
  } catch (err) {
    console.error('Test daily error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
