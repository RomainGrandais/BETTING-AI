import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  const { betId, result } = await request.json()

  if (!betId || !['won', 'lost', 'void'].includes(result)) {
    return NextResponse.json({ error: 'betId and result (won/lost/void) required' }, { status: 400 })
  }

  const { data: bet, error: fetchError } = await supabaseAdmin
    .from('bets')
    .select('*')
    .eq('id', betId)
    .single()

  if (fetchError || !bet) {
    return NextResponse.json({ error: 'Bet not found' }, { status: 404 })
  }

  if (bet.status !== 'pending') {
    return NextResponse.json({ error: 'Bet already settled' }, { status: 400 })
  }

  await supabaseAdmin
    .from('bets')
    .update({ status: result, settled_at: new Date().toISOString() })
    .eq('id', betId)

  // Bankroll logic:
  // - Won  → add net profit only (potential_win - stake)
  // - Lost → deduct stake
  // - Void → no change (stake never counted as lost or won)
  const { data: lastBankroll } = await supabaseAdmin
    .from('bankroll_history')
    .select('amount')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  const currentBankroll = lastBankroll?.amount ?? 100
  let newBankroll = currentBankroll
  let eventLabel = ''

  if (result === 'won') {
    const profit = Math.round((bet.potential_win - bet.stake) * 100) / 100
    newBankroll = Math.round((currentBankroll + profit) * 100) / 100
    eventLabel = `Gagné: ${bet.bet_label} @ ${bet.odds} (+€${profit})`
  } else if (result === 'lost') {
    newBankroll = Math.round((currentBankroll - bet.stake) * 100) / 100
    eventLabel = `Perdu: ${bet.bet_label} @ ${bet.odds} (-€${bet.stake})`
  }
  // void: bankroll unchanged, no entry needed

  if (result !== 'void') {
    await supabaseAdmin.from('bankroll_history').insert({
      amount: newBankroll,
      event: eventLabel,
    })
  }

  return NextResponse.json({ success: true, result, newBankroll })
}
