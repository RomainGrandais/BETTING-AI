import { NextResponse } from 'next/server'
import { fetchMatchResults } from '@/lib/odds-api'
import { supabaseAdmin } from '@/lib/supabase'

interface PendingBet {
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

export async function POST() {
  try {
    // 1. Get all pending bets
    const { data: pendingBets, error } = await supabaseAdmin
      .from('bets')
      .select('id, match_id, sport, home_team, away_team, bet_type, bet_label, stake, potential_win, sport_key')
      .eq('status', 'pending')

    if (error) throw new Error(error.message)
    if (!pendingBets || pendingBets.length === 0) {
      return NextResponse.json({ success: true, settled: 0, message: 'Aucun pari en attente' })
    }

    // 2. Group by sport_key to minimize API calls
    const bySport: Record<string, PendingBet[]> = {}
    for (const bet of pendingBets as PendingBet[]) {
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

        // Determine if bet won or lost based on bet_type and result
        const betResult = determineBetResult(bet, result.winner)
        if (!betResult) continue // Can't determine — skip

        // Update bet status
        await supabaseAdmin
          .from('bets')
          .update({ status: betResult, settled_at: new Date().toISOString() })
          .eq('id', bet.id)

        // Bankroll: won = +profit only, lost = -stake
        if (betResult === 'won') {
          bankrollDelta += bet.potential_win - bet.stake // net profit
          totalWon++
        } else if (betResult === 'lost') {
          bankrollDelta -= bet.stake // deduct stake on loss
          totalLost++
        }
        totalSettled++
      }
    }

    // 4. Update bankroll for all settled bets in one entry
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
        event: `Auto-règlement: ${totalWon} gagné(s) (+€${(bankrollDelta > 0 ? bankrollDelta : 0).toFixed(2)}), ${totalLost} perdu(s)`,
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
  bet: PendingBet,
  winner: 'home' | 'away' | 'draw' | null
): 'won' | 'lost' | null {
  if (!winner) return null

  const betType = bet.bet_type
  if (betType === '1' || bet.bet_label.toLowerCase().includes(bet.home_team.toLowerCase())) {
    return winner === 'home' ? 'won' : 'lost'
  }
  if (betType === '2' || bet.bet_label.toLowerCase().includes(bet.away_team.toLowerCase())) {
    return winner === 'away' ? 'won' : 'lost'
  }
  if (betType === 'X' || bet.bet_label.toLowerCase().includes('nul')) {
    return winner === 'draw' ? 'won' : 'lost'
  }
  return null
}
