export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { fetchMatchResults } from '@/lib/odds-api'
import { supabaseAdmin } from '@/lib/supabase'
import { determineBetResult, deriveSportKey, BetForSettlement } from '@/lib/settle'

export async function POST() {
  try {
    // 1. Get all pending bets (skip combos — manual settle only)
    const { data: pendingBets, error } = await supabaseAdmin
      .from('bets')
      .select('id, match_id, sport, home_team, away_team, bet_type, bet_label, stake, potential_win, sport_key')
      .eq('status', 'pending')

    if (error) throw new Error(error.message)
    if (!pendingBets || pendingBets.length === 0) {
      return NextResponse.json({ success: true, settled: 0, message: 'Aucun pari en attente' })
    }

    // Filter out combo bets (match_id starts with "COMBO_")
    const settleable = (pendingBets as BetForSettlement[]).filter(b => !b.match_id.startsWith('COMBO_'))

    // 2. Group by sport_key to minimize API calls
    const bySport: Record<string, BetForSettlement[]> = {}
    for (const bet of settleable) {
      const sportKey = bet.sport_key || deriveSportKey(bet.sport)
      if (!bySport[sportKey]) bySport[sportKey] = []
      bySport[sportKey].push(bet)
    }

    let totalSettled = 0
    let totalWon = 0
    let totalLost = 0
    let bankrollDelta = 0

    // 3. For each sport, fetch results and try to settle
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
        totalSettled++
      }
    }

    // 4. Update bankroll in one entry
    if (totalSettled > 0) {
      const { data: lastBankroll } = await supabaseAdmin
        .from('bankroll_history')
        .select('amount')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      const currentBankroll = lastBankroll?.amount ?? 100
      const newBankroll = Math.round((currentBankroll + bankrollDelta) * 100) / 100
      await supabaseAdmin.from('bankroll_history').insert({
        amount: newBankroll,
        event: `Auto-règlement: ${totalWon} gagné(s) (+€${Math.max(0, bankrollDelta).toFixed(2)}), ${totalLost} perdu(s)`,
      })
    }

    return NextResponse.json({
      success: true,
      settled: totalSettled,
      won: totalWon,
      lost: totalLost,
      bankrollDelta,
      message: totalSettled === 0
        ? 'Aucun résultat disponible pour le moment'
        : `${totalSettled} paris réglés (${totalWon} gagnés, ${totalLost} perdus)`,
    })
  } catch (err) {
    console.error('Auto-settle error:', err)
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}
