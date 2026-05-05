// The Odds API — https://the-odds-api.com
// Free tier: 500 requests/month
// Note: markets=h2h,totals costs 2 credits per sport fetch

export interface Match {
  matchId: string
  sportName: string
  sportKey: string
  competition: string
  homeTeam: string
  awayTeam: string
  startTime: string
  odds: Odd[]
  status: 'upcoming' | 'live' | 'finished'
}

export interface Odd {
  label: string
  value: number
  betType: string
  point?: number
}

export interface MatchResult {
  matchId: string
  completed: boolean
  homeScore: number | null
  awayScore: number | null
  winner: 'home' | 'away' | 'draw' | null
}

const API_KEY = process.env.ODDS_API_KEY!
const BASE = 'https://api.the-odds-api.com/v4'

const SPORT_NAME_MAP: Record<string, string> = {
  soccer: 'Football',
  tennis: 'Tennis',
  basketball: 'Basketball',
  icehockey: 'Hockey sur glace',
  rugby_union: 'Rugby',
  rugby_league: 'Rugby à XIII',
  baseball: 'Baseball',
  mma: 'MMA',
  volleyball: 'Volleyball',
  handball: 'Handball',
  cricket: 'Cricket',
  boxing: 'Boxe',
  aussierules: 'Football australien',
  americanfootball: 'Football américain',
}

function getSportName(sportKey: string): string {
  for (const [prefix, name] of Object.entries(SPORT_NAME_MAP)) {
    if (sportKey.startsWith(prefix)) return name
  }
  return 'Sport'
}

interface OddsApiSport {
  key: string
  active: boolean
  title: string
  has_outrights: boolean
}

// Fetch matches within a time window
export async function fetchMatchesInWindow(windowStart: Date, windowEnd: Date): Promise<Match[]> {
  const res = await fetch(`${BASE}/sports?apiKey=${API_KEY}`, {
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`Sports list failed: ${res.status}`)

  const allSports = await res.json() as OddsApiSport[]
  const activeSports = allSports.filter(s => s.active && !s.has_outrights)

  const matches: Match[] = []

  for (const sport of activeSports) {
    try {
      const sportMatches = await fetchSportOdds(sport.key, getSportName(sport.key), sport.title, windowStart, windowEnd)
      matches.push(...sportMatches)
      await new Promise(r => setTimeout(r, 150))
    } catch (err) {
      console.error(`Error fetching ${sport.key}:`, err)
    }
  }

  return matches
}

// Soccer sports get totals (Over/Under goals) in addition to H2H
function getMarketsForSport(sportKey: string): string {
  if (sportKey.startsWith('soccer')) return 'h2h,totals'
  return 'h2h'
}

async function fetchSportOdds(sportKey: string, sportName: string, competition: string, windowStart: Date, windowEnd: Date): Promise<Match[]> {
  const markets = getMarketsForSport(sportKey)

  // Try with requested markets first; fall back to h2h-only if it fails
  const marketsToTry = markets === 'h2h' ? ['h2h'] : [markets, 'h2h']

  for (const m of marketsToTry) {
    const params = new URLSearchParams({
      apiKey: API_KEY,
      regions: 'eu',
      markets: m,
      oddsFormat: 'decimal',
      dateFormat: 'iso',
    })

    const res = await fetch(`${BASE}/sports/${sportKey}/odds?${params}`, {
      signal: AbortSignal.timeout(10000),
    })

    if (res.status === 422 || res.status === 404) {
      if (m !== 'h2h') continue  // retry with h2h only
      return []
    }
    if (!res.ok) throw new Error(`Odds fetch failed for ${sportKey}: ${res.status}`)

    const events = await res.json() as OddsApiEvent[]
    return events
      .filter(e => {
        const start = new Date(e.commence_time)
        return start >= windowStart && start <= windowEnd
      })
      .map(e => parseEvent(e, sportName, competition))
      .filter(m2 => m2.odds.length > 0)
  }

  return []
}

// Manual analyze endpoint — 24h from now
export async function fetchUpcomingMatches(): Promise<Match[]> {
  const now = new Date()
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  return fetchMatchesInWindow(now, in24h)
}

interface OddsApiEvent {
  id: string
  sport_key: string
  sport_title: string
  commence_time: string
  home_team: string
  away_team: string
  bookmakers: Array<{
    key: string
    title: string
    markets: Array<{
      key: string
      outcomes: Array<{ name: string; price: number; point?: number }>
    }>
  }>
}

interface OutcomeAccum {
  prices: number[]
  name: string
  market: 'h2h' | 'totals'
  point?: number
}

function parseEvent(event: OddsApiEvent, sportName: string, competition: string): Match {
  const outcomeMap: Record<string, OutcomeAccum> = {}

  for (const bookmaker of event.bookmakers) {
    for (const market of bookmaker.markets) {
      if (market.key === 'h2h') {
        for (const outcome of market.outcomes) {
          const key = `h2h_${outcome.name}`
          if (!outcomeMap[key]) outcomeMap[key] = { prices: [], name: outcome.name, market: 'h2h' }
          outcomeMap[key].prices.push(outcome.price)
        }
      } else if (market.key === 'totals') {
        for (const outcome of market.outcomes) {
          const key = `totals_${outcome.name}_${outcome.point}`
          if (!outcomeMap[key]) outcomeMap[key] = { prices: [], name: outcome.name, market: 'totals', point: outcome.point }
          outcomeMap[key].prices.push(outcome.price)
        }
      }
    }
  }

  const odds: Odd[] = []

  for (const acc of Object.values(outcomeMap)) {
    if (acc.prices.length === 0) continue
    const avgPrice = acc.prices.reduce((a, b) => a + b, 0) / acc.prices.length
    if (avgPrice <= 1.01) continue

    if (acc.market === 'h2h') {
      let betType = 'H2H'
      if (acc.name === event.home_team) betType = '1'
      else if (acc.name === event.away_team) betType = '2'
      else if (acc.name === 'Draw') betType = 'X'

      odds.push({
        label: acc.name === 'Draw' ? 'Match nul' : acc.name,
        value: Math.round(avgPrice * 100) / 100,
        betType,
      })
    } else if (acc.market === 'totals' && acc.point !== undefined) {
      // e.g. betType = "over_2.5" or "under_2.5"
      const direction = acc.name.toLowerCase() // "over" or "under"
      const betType = `${direction}_${acc.point}`
      const label = `${acc.name === 'Over' ? 'Plus de' : 'Moins de'} ${acc.point} buts`
      odds.push({
        label,
        value: Math.round(avgPrice * 100) / 100,
        betType,
        point: acc.point,
      })
    }
  }

  return {
    matchId: event.id,
    sportName,
    sportKey: event.sport_key,
    competition,
    homeTeam: event.home_team,
    awayTeam: event.away_team,
    startTime: event.commence_time,
    odds,
    status: 'upcoming',
  }
}

export async function fetchMatchResults(sportKey: string): Promise<MatchResult[]> {
  const params = new URLSearchParams({
    apiKey: API_KEY,
    daysFrom: '3',
    dateFormat: 'iso',
  })

  const res = await fetch(`${BASE}/sports/${sportKey}/scores?${params}`, {
    signal: AbortSignal.timeout(8000),
  })

  if (!res.ok) return []

  const events = await res.json() as Array<{
    id: string
    completed: boolean
    scores: Array<{ name: string; score: string }> | null
    home_team: string
    away_team: string
  }>

  return events
    .filter(e => e.completed && e.scores)
    .map(e => {
      const homeScore = Number(e.scores?.find(s => s.name === e.home_team)?.score ?? null)
      const awayScore = Number(e.scores?.find(s => s.name === e.away_team)?.score ?? null)

      let winner: MatchResult['winner'] = null
      if (!isNaN(homeScore) && !isNaN(awayScore)) {
        if (homeScore > awayScore) winner = 'home'
        else if (awayScore > homeScore) winner = 'away'
        else winner = 'draw'
      }

      return {
        matchId: e.id,
        completed: e.completed,
        homeScore: isNaN(homeScore) ? null : homeScore,
        awayScore: isNaN(awayScore) ? null : awayScore,
        winner,
      }
    })
}
