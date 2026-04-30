import { NextResponse } from 'next/server'

// Manual test endpoint — simulates the daily routine
// Call it anytime to test with the proper 48-hour window
export async function POST(request: Request) {
  try {
    // Call the actual cron handler with proper auth
    const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/cron/daily`, {
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
