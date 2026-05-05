import { NextResponse } from 'next/server'
import { fetchMatchesInWindow } from '@/lib/odds-api'
import { analyzeMatchesWithClaude, SportStat } from '@/lib/claude'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST() {
  try {
    // 1. Get current bankroll
    const { data: bankrollData, error: bankrollError } = await supabaseAdmin
      .from('bankroll_history')
      .select('amount')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (bankrollError && bankrollError.code !== 'PGRST116') {
      throw new Error(`Bankroll fetch error: ${bankrollError.message}`)
    }

    const currentBankroll = bankrollData?.amount ?? 100

    // 2. Count active bets
    const { count: activeBetsCount } = await supabaseAdmin
      .from('bets')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending')

    // 3. Fetch performance stats to guide Claude's selection
    const { sportStats, recentROI } = await fetchPerformanceStats()

    // 4. Fetch matches in fixed daily window: 6 AM UTC today → 6 AM UTC tomorrow
    const now = new Date()
    const windowStart = new Date(now)
    windowStart.setUTCHours(6, 0, 0, 0)
    if (now.getUTCHours() < 6) windowStart.setUTCDate(windowStart.getUTCDate() - 1)
    const windowEnd = new Date(windowStart.getTime() + 24 * 60 * 60 * 1000)

    const matches = await fetchMatchesInWindow(windowStart, windowEnd)

    if (matches.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'Aucun match disponible pour le moment',
        matchesFound: 0,
        betsPlaced: 0,
      })
    }

    // 5. Filter out matches already bet on
    const { data: existingBets } = await supabaseAdmin
      .from('bets')
      .select('match_id')
      .eq('status', 'pending')

    const betMatchIds = new Set((existingBets || []).map(b => b.match_id))
    const newMatches = matches.filter(m => !betMatchIds.has(m.matchId))

    // 6. Ask Claude to analyze and pick bets (with performance context)
    const decisions = await analyzeMatchesWithClaude(
      newMatches,
      currentBankroll,
      activeBetsCount ?? 0,
      sportStats,
      recentROI
    )

    if (decisions.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'Claude n\'a pas trouvé de value bets intéressants cette session',
        matchesFound: matches.length,
        betsPlaced: 0,
      })
    }

    // 7. Safety cap: never put more than 30% of bankroll at risk in one session
    const rawTotalStake = decisions.reduce((sum, d) => sum + d.stake, 0)
    if (rawTotalStake > currentBankroll * 0.3) {
      const scaleFactor = (currentBankroll * 0.3) / rawTotalStake
      decisions.forEach(d => { d.stake = Math.round(d.stake * scaleFactor * 100) / 100 })
    }

    // 8. Insert bets into DB
    const betsToInsert = decisions.map(d => ({
      match_id: d.matchId,
      sport: d.sport,
      sport_key: d.sportKey,
      home_team: d.homeTeam,
      away_team: d.awayTeam,
      competition: d.competition,
      start_time: d.startTime,
      bet_label: d.betLabel,
      bet_type: d.betType,
      odds: d.odds,
      estimated_probability: d.estimatedProbability,
      expected_value: d.expectedValue,
      stake: d.stake,
      potential_win: Math.round(d.stake * d.odds * 100) / 100,
      ai_reasoning: d.reasoning,
      combo_legs: d.comboLegs ?? null,
      status: 'pending',
    }))

    const { error: insertError } = await supabaseAdmin.from('bets').insert(betsToInsert)
    if (insertError) throw new Error(`Insert bets error: ${insertError.message}`)

    const totalStake = decisions.reduce((sum, d) => sum + d.stake, 0)

    return NextResponse.json({
      success: true,
      message: `${decisions.length} paris placés avec succès`,
      matchesFound: matches.length,
      betsPlaced: decisions.length,
      totalStake,
      recentROI,
      bets: decisions,
    })
  } catch (error) {
    console.error('Analyze error:', error)
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    )
  }
}

async function fetchPerformanceStats(): Promise<{ sportStats: SportStat[]; recentROI: number }> {
  try {
    const { data: settled } = await supabaseAdmin
      .from('bets')
      .select('sport, status, stake, potential_win')
      .in('status', ['won', 'lost'])
      .order('created_at', { ascending: false })
      .limit(100)

    if (!settled || settled.length === 0) return { sportStats: [], recentROI: 0 }

    // Per-sport stats
    const bySport: Record<string, { won: number; lost: number; staked: number; returned: number }> = {}
    for (const bet of settled) {
      if (!bySport[bet.sport]) bySport[bet.sport] = { won: 0, lost: 0, staked: 0, returned: 0 }
      const s = bySport[bet.sport]
      s.staked += bet.stake
      if (bet.status === 'won') { s.won++; s.returned += bet.potential_win }
      else s.lost++
    }

    const sportStats: SportStat[] = Object.entries(bySport).map(([sport, s]) => ({
      sport,
      bets: s.won + s.lost,
      winRate: s.won / (s.won + s.lost),
      roi: s.staked > 0 ? (s.returned - s.staked) / s.staked : 0,
    }))

    // Recent ROI: last 10 settled bets
    const recent = settled.slice(0, 10)
    const recentStaked = recent.reduce((sum, b) => sum + b.stake, 0)
    const recentReturned = recent.filter(b => b.status === 'won').reduce((sum, b) => sum + b.potential_win, 0)
    const recentROI = recentStaked > 0 ? (recentReturned - recentStaked) / recentStaked : 0

    return { sportStats, recentROI }
  } catch {
    return { sportStats: [], recentROI: 0 }
  }
}
