export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { fetchMatchesInWindow, fetchMatchResults } from '@/lib/odds-api'
import { analyzeMatchesWithClaude, SportStat } from '@/lib/claude'
import { supabaseAdmin } from '@/lib/supabase'
import { determineBetResult, deriveSportKey, BetForSettlement } from '@/lib/settle'

// Vercel Cron handler — called daily at 6:00 AM UTC
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Step 1: Auto-settle bets from yesterday
    const { won: settledWon, lost: settledLost } = await autoSettleBets()

    // Step 2: Get current bankroll
    const { data: bankrollData } = await supabaseAdmin
      .from('bankroll_history')
      .select('amount')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    const currentBankroll = bankrollData?.amount ?? 100

    // Step 3: Fetch performance stats for Claude
    const { sportStats, recentROI } = await fetchPerformanceStats()

    // Step 4: Analysis window — 6 AM UTC today → 6 AM UTC tomorrow (UTC-safe)
    const now = new Date()
    const windowStart = new Date(now)
    windowStart.setUTCHours(6, 0, 0, 0)
    if (now.getUTCHours() < 6) windowStart.setUTCDate(windowStart.getUTCDate() - 1)
    const windowEnd = new Date(windowStart.getTime() + 24 * 60 * 60 * 1000)

    console.log(`Analysis window: ${windowStart.toISOString()} → ${windowEnd.toISOString()}`)

    // Step 5: Fetch matches in window
    const matches = await fetchMatchesInWindow(windowStart, windowEnd)
    if (matches.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'Pas de matchs dans la fenêtre',
        settled: settledWon + settledLost,
        betsPlaced: 0,
      })
    }

    // Step 6: Filter out already-bet matches
    const { data: existingBets } = await supabaseAdmin
      .from('bets')
      .select('match_id')
      .eq('status', 'pending')

    const betMatchIds = new Set((existingBets || []).map(b => b.match_id))
    const newMatches = matches.filter(m => !betMatchIds.has(m.matchId))

    // Step 7: Analyze and place bets
    const { count: activeBetsCount } = await supabaseAdmin
      .from('bets')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending')

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
        message: 'Pas de value bets trouvés',
        matchesFound: matches.length,
        settled: settledWon + settledLost,
        betsPlaced: 0,
      })
    }

    // Step 8: Safety cap (max 30% of bankroll per session)
    const rawTotalStake = decisions.reduce((sum, d) => sum + d.stake, 0)
    if (rawTotalStake > currentBankroll * 0.3) {
      const scaleFactor = (currentBankroll * 0.3) / rawTotalStake
      decisions.forEach(d => { d.stake = Math.round(d.stake * scaleFactor * 100) / 100 })
    }

    // Step 9: Insert bets
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
    if (insertError) throw new Error(`Insert error: ${insertError.message}`)

    return NextResponse.json({
      success: true,
      matchesAnalyzed: matches.length,
      betsPlaced: decisions.length,
      totalStake: decisions.reduce((sum, d) => sum + d.stake, 0),
      bankroll: currentBankroll,
      settled: settledWon + settledLost,
    })
  } catch (err) {
    console.error('Daily routine error:', err)
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}

async function autoSettleBets(): Promise<{ won: number; lost: number }> {
  try {
    const { data: pendingBets } = await supabaseAdmin
      .from('bets')
      .select('id, match_id, sport, home_team, away_team, bet_type, bet_label, stake, potential_win, sport_key')
      .eq('status', 'pending')

    if (!pendingBets || pendingBets.length === 0) return { won: 0, lost: 0 }

    const settleable = (pendingBets as BetForSettlement[]).filter(b => !b.match_id.startsWith('COMBO_'))

    const bySport: Record<string, BetForSettlement[]> = {}
    for (const bet of settleable) {
      const sportKey = bet.sport_key || deriveSportKey(bet.sport)
      if (!bySport[sportKey]) bySport[sportKey] = []
      bySport[sportKey].push(bet)
    }

    let bankrollDelta = 0
    let totalWon = 0
    let totalLost = 0

    for (const [sportKey, bets] of Object.entries(bySport)) {
      const results = await fetchMatchResults(sportKey)
      const resultMap = new Map(results.map(r => [r.matchId, r]))

      for (const bet of bets) {
        const result = resultMap.get(bet.match_id)
        if (!result?.completed) continue

        const betResult = determineBetResult(bet, result.winner, result.homeScore, result.awayScore)
        if (!betResult) continue

        await supabaseAdmin
          .from('bets')
          .update({ status: betResult, settled_at: new Date().toISOString() })
          .eq('id', bet.id)

        if (betResult === 'won') {
          bankrollDelta += bet.potential_win - bet.stake
          totalWon++
        } else if (betResult === 'lost') {
          bankrollDelta -= bet.stake
          totalLost++
        }
      }
    }

    if (totalWon + totalLost > 0) {
      const { data: lastBankroll } = await supabaseAdmin
        .from('bankroll_history')
        .select('amount')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      const current = lastBankroll?.amount ?? 100
      const newBankroll = Math.round((current + bankrollDelta) * 100) / 100
      await supabaseAdmin.from('bankroll_history').insert({
        amount: newBankroll,
        event: `Daily settle: ${totalWon}W ${totalLost}L ${bankrollDelta >= 0 ? '+' : ''}${bankrollDelta.toFixed(2)}€`,
      })
    }

    return { won: totalWon, lost: totalLost }
  } catch (err) {
    console.error('Auto-settle error:', err)
    return { won: 0, lost: 0 }
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

    const recent = settled.slice(0, 10)
    const recentStaked = recent.reduce((sum: number, b: { stake: number }) => sum + b.stake, 0)
    const recentReturned = recent.filter((b: { status: string }) => b.status === 'won')
      .reduce((sum: number, b: { potential_win: number }) => sum + b.potential_win, 0)
    const recentROI = recentStaked > 0 ? (recentReturned - recentStaked) / recentStaked : 0

    return { sportStats, recentROI }
  } catch {
    return { sportStats: [], recentROI: 0 }
  }
}
