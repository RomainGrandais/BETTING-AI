import { NextResponse } from 'next/server'
import { fetchMatchesInWindow } from '@/lib/odds-api'
import { analyzeMatchesWithClaude } from '@/lib/claude'
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

    // 3. Fetch matches in fixed daily window: 6 AM UTC today → 6 AM UTC tomorrow
    // (same window as the cron, so manual analysis always covers the full day)
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

    // 4. Filter out matches already bet on
    const { data: existingBets } = await supabaseAdmin
      .from('bets')
      .select('match_id')
      .eq('status', 'pending')

    const betMatchIds = new Set((existingBets || []).map(b => b.match_id))
    const newMatches = matches.filter(m => !betMatchIds.has(m.matchId))

    // 5. Ask Claude to analyze and pick bets
    const decisions = await analyzeMatchesWithClaude(
      newMatches,
      currentBankroll,
      activeBetsCount ?? 0
    )

    if (decisions.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'Claude n\'a pas trouvé de value bets intéressants cette session',
        matchesFound: matches.length,
        betsPlaced: 0,
      })
    }

    // 6. Safety cap: never put more than 30% of bankroll at risk in one session
    const rawTotalStake = decisions.reduce((sum, d) => sum + d.stake, 0)
    if (rawTotalStake > currentBankroll * 0.3) {
      const scaleFactor = (currentBankroll * 0.3) / rawTotalStake
      decisions.forEach(d => { d.stake = Math.round(d.stake * scaleFactor * 100) / 100 })
    }

    // 7. Insert bets into DB
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
    if (insertError) throw new Error(`Insert bets error: ${insertError.message}`)

    // Bankroll is NOT updated here — it moves only when bets are settled
    // (win = +profit, loss = -stake). Stakes in play are tracked via pending bets.
    const totalStake = decisions.reduce((sum, d) => sum + d.stake, 0)

    return NextResponse.json({
      success: true,
      message: `${decisions.length} paris placés avec succès`,
      matchesFound: matches.length,
      betsPlaced: decisions.length,
      totalStake,
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
