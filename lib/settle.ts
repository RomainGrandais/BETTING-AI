// Shared bet settlement logic — used by settle-auto and cron/daily

interface BetForSettlement {
  id: string
  match_id: string
  sport: string
  home_team: string
  away_team: string
  bet_type: string
  bet_label: string
  stake: number
  potential_win: number
  sport_key?: string
}

export type { BetForSettlement }

export function determineBetResult(
  bet: BetForSettlement,
  winner: 'home' | 'away' | 'draw' | null,
  homeScore: number | null,
  awayScore: number | null
): 'won' | 'lost' | null {
  const betType = bet.bet_type

  // Over/Under totals: e.g. "over_2.5", "under_1.5"
  if (betType.startsWith('over_') || betType.startsWith('under_')) {
    if (homeScore === null || awayScore === null) return null
    const line = parseFloat(betType.split('_')[1])
    if (isNaN(line)) return null
    const totalGoals = homeScore + awayScore
    if (betType.startsWith('over_')) return totalGoals > line ? 'won' : 'lost'
    return totalGoals < line ? 'won' : 'lost'
  }

  // BTTS (Both Teams To Score)
  if (betType === 'btts_yes') {
    if (homeScore === null || awayScore === null) return null
    return homeScore > 0 && awayScore > 0 ? 'won' : 'lost'
  }
  if (betType === 'btts_no') {
    if (homeScore === null || awayScore === null) return null
    return homeScore === 0 || awayScore === 0 ? 'won' : 'lost'
  }

  // H2H / 1X2 — strict bet_type matching only
  if (!winner) return null
  if (betType === '1') return winner === 'home' ? 'won' : 'lost'
  if (betType === '2') return winner === 'away' ? 'won' : 'lost'
  if (betType === 'X') return winner === 'draw' ? 'won' : 'lost'

  // Combo and unknown types: manual settle only
  return null
}

export function deriveSportKey(sport: string): string {
  const map: Record<string, string> = {
    'Football': 'soccer_epl',
    'Tennis': 'tennis_atp_french_open',
    'Basketball': 'basketball_nba',
    'Hockey sur glace': 'icehockey_nhl',
    'Rugby': 'rugby_union_super_rugby',
    'Baseball': 'baseball_mlb',
    'MMA': 'mma_mixed_martial_arts',
  }
  return map[sport] || 'soccer_epl'
}
