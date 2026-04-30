import { NextResponse } from 'next/server'
import { fetchMatchesInWindow, fetchMatchResults } from '@/lib/odds-api'
import { analyzeMatchesWithClaude } from '@/lib/claude'
import { supabaseAdmin } from '@/lib/supabase'

// Vercel Cron handler — called daily at 6:00 AM UTC
// This is the main routine: settle yesterday's bets + analyze for today/tomorrow
export async function GET(request: Request) {
  // Verify this is a Cron call (optional but recommended)
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Step 1: Auto-settle bets from yesterday
    await autoSettleBets()

    // Step 2: Get current bankroll
    const { data: bankrollData } = await supabaseAdmin
      .from('bankroll_history')
      .select('amount')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    const currentBankroll = bankrollData?.amount ?? 100

    // Step 3: Define analysis window: 6 AM today → 6 AM tomorrow (48 hours)
    const now = new Date()
    // Round down to 6 AM today (UTC)
    const windowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 6, 0, 0, 0)
    // If it's already past 6 AM, use tomorrow's 6 AM as start
    if (now > windowStart) {
      windowStart.setDate(windowStart.getDate() + 1)
    }
    const windowEnd = new Date(windowStart.getTime() + 48 * 60 * 60 * 1000)

    console.log(`Analysis window: ${windowStart.toISOString()} → ${windowEnd.toISOString()}`)

    // Step 4: Fetch matches in window
    const matches = await fetchMatchesInWindow(windowStart, windowEnd)
    if (matches.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'Pas de matchs dans la fenêtre',
        settled: 0,
        betsPlaced: 0,
      })
    }

    // Step 5: Filter out already-bet matches
    const { data: existingBets } = await supabaseAdmin
      .from('bets')
      .select('match_id')
      .eq('status', 'pending')

    const betMatchIds = new Set((existingBets || []).map(b => b.match_id))
    const newMatches = matches.filter(m => !betMatchIds.has(m.matchId))

    // Step 6: Analyze and place bets
    const { count: activeBetsCount } = await supabaseAdmin
      .from('bets')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending')

    const decisions = await analyzeMatchesWithClaude(newMatches, currentBankroll, activeBetsCount ?? 0)

    if (decisions.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'Pas de value bets trouvés',
        matchesFound: matches.length,
        settled: 0,
        betsPlaced: 0,
      })
    }

    // Step 7: Apply safety cap (max 30% of bankroll per session)
    const rawTotalStake = decisions.reduce((sum, d) => sum + d.stake, 0)
    if (rawTotalStake > currentBankroll * 0.3) {
      const scaleFactor = (currentBankroll * 0.3) / rawTotalStake
      decisions.forEach(d => { d.stake = Math.round(d.stake * scaleFactor * 100) / 100 })
    }

    // Step 8: Insert bets
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
    })
  } catch (err) {
    console.error('Daily routine error:', err)
    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 }
    )
  }
}

async function autoSettleBets() {
  try {
    const { data: pendingBets } = await supabaseAdmin
      .from('bets')
      .select('id, match_id, sport, home_team, away_team, bet_type, bet_label, stake, potential_win, sport_key')
      .eq('status', 'pending')

    if (!pendingBets || pendingBets.length === 0) return

    // Group by sport and fetch results
    const bySport: Record<string, any[]> = {}
    for (const bet of pendingBets) {
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

        const betResult = determineBetResult(bet, result.winner)
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

    // Update bankroll
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
  } catch (err) {
    console.error('Auto-settle error:', err)
  }
}

function deriveSportKey(sport: string): string {
  const map: Record<string, string> = {
    'Football': 'soccer_france_ligue_one',
    'Tennis': 'tennis_atp',
    'Basketball': 'basketball_nba',
    'Hockey sur glace': 'icehockey_nhl',
    'Rugby': 'rugby_union_super_rugby',
    'Baseball': 'baseball_mlb',
    'MMA': 'mma_mixed_martial_arts',
  }
  return map[sport] || 'soccer_france_ligue_one'
}

function determineBetResult(
  bet: any,
  winner: 'home' | 'away' | 'draw' | null
): 'won' | 'lost' | null {
  if (!winner) return null
  if (bet.bet_type === '1' || bet.bet_label.toLowerCase().includes(bet.home_team.toLowerCase())) {
    return winner === 'home' ? 'won' : 'lost'
  }
  if (bet.bet_type === '2' || bet.bet_label.toLowerCase().includes(bet.away_team.toLowerCase())) {
    return winner === 'away' ? 'won' : 'lost'
  }
  if (bet.bet_type === 'X' || bet.bet_label.toLowerCase().includes('nul')) {
    return winner === 'draw' ? 'won' : 'lost'
  }
  return null
}
