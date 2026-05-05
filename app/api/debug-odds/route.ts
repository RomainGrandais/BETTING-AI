export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'

const API_KEY = process.env.ODDS_API_KEY
const BASE = 'https://api.the-odds-api.com/v4'

export async function GET() {
  if (!API_KEY) {
    return NextResponse.json({ error: 'ODDS_API_KEY not set in environment' }, { status: 500 })
  }

  try {
    // 1. Check sports list + remaining credits
    const sportsRes = await fetch(`${BASE}/sports?apiKey=${API_KEY}`, {
      signal: AbortSignal.timeout(8000),
    })

    const remainingCredits = sportsRes.headers.get('x-requests-remaining')
    const usedCredits = sportsRes.headers.get('x-requests-used')

    if (!sportsRes.ok) {
      return NextResponse.json({
        error: `Sports API returned ${sportsRes.status}`,
        remainingCredits,
        usedCredits,
      }, { status: 500 })
    }

    const allSports = await sportsRes.json()
    const activeSports = allSports.filter((s: { active: boolean; has_outrights: boolean }) => s.active && !s.has_outrights)

    // 2. Test one soccer sport (h2h only) to check odds availability
    const soccerSport = activeSports.find((s: { key: string }) => s.key.startsWith('soccer'))
    let sampleOddsCount = 0
    let sampleSportKey = null
    let sampleError = null

    if (soccerSport) {
      sampleSportKey = soccerSport.key
      try {
        const oddsRes = await fetch(
          `${BASE}/sports/${soccerSport.key}/odds?apiKey=${API_KEY}&regions=eu&markets=h2h&oddsFormat=decimal&dateFormat=iso`,
          { signal: AbortSignal.timeout(8000) }
        )
        if (oddsRes.ok) {
          const odds = await oddsRes.json()
          sampleOddsCount = odds.length
        } else {
          sampleError = `${oddsRes.status} ${oddsRes.statusText}`
        }
      } catch (e) {
        sampleError = String(e)
      }
    }

    // 3. Current time window
    const now = new Date()
    const windowStart = new Date(now)
    windowStart.setUTCHours(6, 0, 0, 0)
    if (now.getUTCHours() < 6) windowStart.setUTCDate(windowStart.getUTCDate() - 1)
    const windowEnd = new Date(windowStart.getTime() + 24 * 60 * 60 * 1000)

    return NextResponse.json({
      apiKeySet: true,
      remainingCredits,
      usedCredits,
      activeSportsCount: activeSports.length,
      soccerSportsCount: activeSports.filter((s: { key: string }) => s.key.startsWith('soccer')).length,
      sampleSportKey,
      sampleOddsCount,
      sampleError,
      window: {
        start: windowStart.toISOString(),
        end: windowEnd.toISOString(),
        nowUTC: now.toISOString(),
      },
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
