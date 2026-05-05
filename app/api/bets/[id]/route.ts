export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// DELETE /api/bets/[id] — removes a pending bet as if it never existed
// No bankroll impact: stakes are only deducted when a bet is settled as lost.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const { data: bet, error: fetchError } = await supabaseAdmin
    .from('bets')
    .select('id, status')
    .eq('id', id)
    .single()

  if (fetchError || !bet) {
    return NextResponse.json({ error: 'Pari introuvable' }, { status: 404 })
  }

  if (bet.status !== 'pending') {
    return NextResponse.json(
      { error: 'Seuls les paris en cours peuvent être supprimés' },
      { status: 400 }
    )
  }

  const { error: deleteError } = await supabaseAdmin
    .from('bets')
    .delete()
    .eq('id', id)

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
