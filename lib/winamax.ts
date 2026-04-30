export interface WinamaxMatch {
  matchId: string
  sportName: string
  competition: string
  homeTeam: string
  awayTeam: string
  startTime: string
  odds: WinamaxOdd[]
  status: 'upcoming' | 'live' | 'finished'
}

export interface WinamaxOdd {
  label: string
  value: number
  betType: string
}

const WINAMAX_API = 'https://www.winamax.fr/apif/sports'

const SPORT_IDS: Record<string, number> = {
  Football: 1,
  Tennis: 2,
  Basketball: 3,
  'Tennis de table': 31,
  Badminton: 32,
  Volleyball: 13,
  Baseball: 6,
  Hockey: 9,
  Rugby: 5,
  'Football américain': 7,
  Handball: 10,
  'Snooker/Billard': 19,
  'eSport': 99,
}

async function fetchWithTimeout(url: string, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    })
    clearTimeout(id)
    return res
  } catch (e) {
    clearTimeout(id)
    throw e
  }
}

export async function fetchWinamaxMatches(): Promise<WinamaxMatch[]> {
  const matches: WinamaxMatch[] = []

  try {
    const res = await fetchWithTimeout(`${WINAMAX_API}/`)
    if (!res.ok) throw new Error(`Winamax API error: ${res.status}`)
    const data = await res.json()

    // Winamax returns sport categories at root level
    const sports = data.sports || data || []

    for (const sport of Array.isArray(sports) ? sports : Object.values(sports)) {
      const sportName = sport.name || sport.sportName || 'Unknown'
      const sportMatches = await fetchSportMatches(sport, sportName)
      matches.push(...sportMatches)
    }
  } catch (err) {
    console.error('Error fetching Winamax sports list:', err)
    // Fallback: try known sport IDs
    const fallbackMatches = await fetchKnownSports()
    matches.push(...fallbackMatches)
  }

  return matches
}

async function fetchKnownSports(): Promise<WinamaxMatch[]> {
  const matches: WinamaxMatch[] = []
  const now = Date.now()
  const in48h = now + 48 * 60 * 60 * 1000

  for (const [sportName, sportId] of Object.entries(SPORT_IDS)) {
    try {
      const res = await fetchWithTimeout(`${WINAMAX_API}/sport-${sportId}`)
      if (!res.ok) continue
      const data = await res.json()
      const parsed = parseSportData(data, sportName, now, in48h)
      matches.push(...parsed)
      await new Promise(r => setTimeout(r, 200)) // rate limit
    } catch {
      // Sport not available, skip
    }
  }

  return matches
}

async function fetchSportMatches(sport: Record<string, unknown>, sportName: string): Promise<WinamaxMatch[]> {
  const now = Date.now()
  const in48h = now + 48 * 60 * 60 * 1000

  try {
    const url = (sport.url as string) || (sport.apiUrl as string)
    if (!url) return []
    const res = await fetchWithTimeout(url)
    if (!res.ok) return []
    const data = await res.json()
    return parseSportData(data, sportName, now, in48h)
  } catch {
    return []
  }
}

function parseSportData(
  data: Record<string, unknown>,
  sportName: string,
  now: number,
  in48h: number
): WinamaxMatch[] {
  const matches: WinamaxMatch[] = []

  // Winamax API structure varies — handle both array and object responses
  const events = (data.events as Record<string, unknown>[]) ||
    (data.matches as Record<string, unknown>[]) ||
    (Array.isArray(data) ? data as Record<string, unknown>[] : [])

  for (const event of events) {
    try {
      const startTs = Number(event.startTime || event.date || 0) * 1000
      if (startTs < now || startTs > in48h) continue

      const teams = (event.teams as Record<string, unknown>[]) || []
      const homeTeam = String(
        (teams[0] as Record<string, unknown>)?.name ||
        event.homeTeam ||
        event.team1 ||
        'Équipe A'
      )
      const awayTeam = String(
        (teams[1] as Record<string, unknown>)?.name ||
        event.awayTeam ||
        event.team2 ||
        'Équipe B'
      )

      const rawOdds = (event.odds as Record<string, unknown>[]) ||
        (event.bets as Record<string, unknown>[]) || []
      const odds: WinamaxOdd[] = rawOdds.map(o => ({
        label: String(o.label || o.name || o.outcome || ''),
        value: Number(o.odds || o.value || o.price || 0),
        betType: String(o.type || o.betType || '1X2'),
      })).filter(o => o.value > 1.01)

      if (odds.length === 0) continue

      matches.push({
        matchId: String(event.matchId || event.id || event.eventId || Math.random()),
        sportName,
        competition: String(
          event.competition ||
          (event.tournament as Record<string, unknown>)?.name ||
          event.league ||
          ''
        ),
        homeTeam,
        awayTeam,
        startTime: new Date(startTs).toISOString(),
        odds,
        status: 'upcoming',
      })
    } catch {
      // Skip malformed event
    }
  }

  return matches
}

export async function checkMatchResult(matchId: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(`${WINAMAX_API}/match-${matchId}/result`)
    if (!res.ok) return null
    const data = await res.json() as Record<string, unknown>
    const result = data.result as Record<string, unknown> | undefined
    if (result?.winner) return String(result.winner)
    if (result?.score) return String(result.score)
    return null
  } catch {
    return null
  }
}
