export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// Remets un pari settled (won/lost) en pending et annule l'impact sur la bankroll
export async function POST(request: NextRequest) {
  const { betId } = await request.json()

  if (!betId) {
    return NextResponse.json({ error: 'betId required' }, { status: 400 })
  }

  const { data: bet, error: fetchError } = await supabaseAdmin
    .from('bets')
    .select('*')
    .eq('id', betId)
    .single()

  if (fetchError || !bet) {
    return NextResponse.json({ error: 'Pari introuvable' }, { status: 404 })
  }

  if (bet.status === 'pending') {
    return NextResponse.json({ error: 'Ce pari est déjà en cours' }, { status: 400 })
  }

  // Annuler l'impact sur la bankroll
  const { data: lastBankroll } = await supabaseAdmin
    .from('bankroll_history')
    .select('amount')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  const currentBankroll = lastBankroll?.amount ?? 100
  let newBankroll = currentBankroll
  let eventLabel = ''

  if (bet.status === 'won') {
    // Annuler le gain: soustraire le profit qui avait été ajouté
    const profit = Math.round((bet.potential_win - bet.stake) * 100) / 100
    newBankroll = Math.round((currentBankroll - profit) * 100) / 100
    eventLabel = `Correction: ${bet.bet_label} remis en cours (-€${profit} annulé)`
  } else if (bet.status === 'lost') {
    // Annuler la perte: rendre la mise qui avait été déduite
    newBankroll = Math.round((currentBankroll + bet.stake) * 100) / 100
    eventLabel = `Correction: ${bet.bet_label} remis en cours (+€${bet.stake} récupéré)`
  }

  // Remettre le pari en pending
  await supabaseAdmin
    .from('bets')
    .update({ status: 'pending', settled_at: null })
    .eq('id', betId)

  // Enregistrer la correction dans l'historique bankroll (sauf void qui ne l'avait pas changé)
  if (bet.status !== 'void') {
    await supabaseAdmin.from('bankroll_history').insert({
      amount: newBankroll,
      event: eventLabel,
    })
  }

  return NextResponse.json({ success: true, newBankroll })
}
