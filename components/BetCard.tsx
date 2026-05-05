'use client'

import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { Clock, Trophy, X, RotateCcw, ChevronDown, ChevronUp, Trash2, Link } from 'lucide-react'
import { useState } from 'react'

export interface ComboLeg {
  matchId: string
  betLabel: string
  betType: string
}

export interface Bet {
  id: string
  match_id: string
  sport: string
  sport_key?: string
  home_team: string
  away_team: string
  competition: string
  start_time: string
  bet_label: string
  bet_type: string
  odds: number
  estimated_probability: number
  expected_value: number
  stake: number
  potential_win: number
  ai_reasoning: string
  combo_legs?: ComboLeg[] | null
  status: 'pending' | 'won' | 'lost' | 'void'
  created_at: string
  settled_at?: string
}

interface Props {
  bet: Bet
  onSettle?: (betId: string, result: 'won' | 'lost' | 'void') => void
  onUnsettle?: (betId: string) => void
  onDelete?: (betId: string) => void
  showActions?: boolean
}

const sportEmoji: Record<string, string> = {
  Football: '⚽',
  Tennis: '🎾',
  Basketball: '🏀',
  'Tennis de table': '🏓',
  Badminton: '🏸',
  Volleyball: '🏐',
  Rugby: '🏉',
  'Rugby à XIII': '🏉',
  Baseball: '⚾',
  'Hockey sur glace': '🏒',
  Handball: '🤾',
  MMA: '🥊',
  Boxe: '🥊',
  eSport: '🎮',
}

export default function BetCard({ bet, onSettle, onUnsettle, onDelete, showActions = false }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const profit = bet.potential_win - bet.stake
  const evPercent = (bet.expected_value * 100).toFixed(1)
  const isCombo = bet.bet_type === 'COMBO'

  const statusConfig = {
    pending: { label: 'En cours', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
    won: { label: 'Gagné', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
    lost: { label: 'Perdu', color: 'bg-red-500/20 text-red-400 border-red-500/30' },
    void: { label: 'Annulé', color: 'bg-gray-500/20 text-gray-400 border-gray-500/30' },
  }

  const sc = statusConfig[bet.status]

  function handleDeleteClick() {
    if (confirmDelete) {
      onDelete?.(bet.id)
      setConfirmDelete(false)
    } else {
      setConfirmDelete(true)
    }
  }

  return (
    <div className={`bg-gray-900 border rounded-xl p-4 transition-all ${
      bet.status === 'won' ? 'border-green-800/50' :
      bet.status === 'lost' ? 'border-red-800/50' :
      isCombo ? 'border-purple-800/50' :
      'border-gray-800'
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-base">{sportEmoji[bet.sport] || '🎯'}</span>
            {isCombo && (
              <span className="text-xs px-2 py-0.5 rounded-full border bg-purple-500/20 text-purple-400 border-purple-500/30 flex items-center gap-1">
                <Link size={10} /> Combiné
              </span>
            )}
            <span className="text-xs text-gray-500 truncate">{bet.competition}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full border ${sc.color}`}>{sc.label}</span>
          </div>
          {isCombo ? (
            <p className="text-white font-medium text-sm">{bet.bet_label}</p>
          ) : (
            <>
              <p className="text-white font-medium text-sm">
                {bet.home_team} <span className="text-gray-500">vs</span> {bet.away_team}
              </p>
              <p className="text-blue-400 text-sm font-medium mt-0.5">{bet.bet_label}</p>
            </>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="text-white font-bold text-lg">@{bet.odds}</p>
          <p className="text-gray-400 text-xs">Mise: €{bet.stake}</p>
        </div>
      </div>

      {/* Combo legs */}
      {isCombo && bet.combo_legs && bet.combo_legs.length > 0 && (
        <div className="mt-2 space-y-1">
          {bet.combo_legs.map((leg, i) => (
            <p key={i} className="text-xs text-purple-300 bg-purple-900/20 rounded px-2 py-1">
              {leg.betLabel}
            </p>
          ))}
        </div>
      )}

      {/* Stats row */}
      <div className="flex items-center gap-4 mt-3 pt-3 border-t border-gray-800 text-xs">
        <div>
          <span className="text-gray-500">Gain potentiel</span>
          <p className="text-white font-medium">€{bet.potential_win.toFixed(2)}</p>
        </div>
        <div>
          <span className="text-gray-500">Profit</span>
          <p className={`font-medium ${bet.status === 'won' ? 'text-green-400' : bet.status === 'lost' ? 'text-red-400' : 'text-green-400'}`}>
            {bet.status === 'lost' ? `-€${bet.stake.toFixed(2)}` : `+€${profit.toFixed(2)}`}
          </p>
        </div>
        <div>
          <span className="text-gray-500">EV</span>
          <p className={`font-medium ${Number(evPercent) > 0 ? 'text-green-400' : 'text-red-400'}`}>
            {Number(evPercent) > 0 ? '+' : ''}{evPercent}%
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1 text-gray-500">
          <Clock size={11} />
          <span>{format(new Date(bet.start_time), 'dd/MM HH:mm', { locale: fr })}</span>
        </div>
      </div>

      {/* AI Reasoning toggle */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 mt-2 text-xs text-gray-500 hover:text-gray-300 transition-colors"
      >
        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        Raisonnement de l'IA
      </button>
      {expanded && (
        <p className="mt-2 text-xs text-gray-400 bg-gray-800/50 rounded-lg p-3 leading-relaxed">
          {bet.ai_reasoning}
        </p>
      )}

      {/* Settlement actions (pending bets) */}
      {showActions && bet.status === 'pending' && onSettle && (
        <div className="flex gap-2 mt-3 pt-3 border-t border-gray-800">
          <button
            onClick={() => onSettle(bet.id, 'won')}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-green-600/20 hover:bg-green-600/30 text-green-400 text-xs font-medium transition-colors border border-green-600/30"
          >
            <Trophy size={12} /> Gagné
          </button>
          <button
            onClick={() => onSettle(bet.id, 'lost')}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-red-600/20 hover:bg-red-600/30 text-red-400 text-xs font-medium transition-colors border border-red-600/30"
          >
            <X size={12} /> Perdu
          </button>
          <button
            onClick={() => onSettle(bet.id, 'void')}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-gray-700/50 hover:bg-gray-700 text-gray-400 text-xs font-medium transition-colors border border-gray-700"
            title="Annuler le pari"
          >
            <RotateCcw size={12} />
          </button>
          {onDelete && (
            <button
              onClick={handleDeleteClick}
              onBlur={() => setConfirmDelete(false)}
              className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors border ${
                confirmDelete
                  ? 'bg-red-600/30 hover:bg-red-600/50 text-red-400 border-red-600/50'
                  : 'bg-gray-700/50 hover:bg-gray-700 text-gray-500 hover:text-red-400 border-gray-700'
              }`}
              title={confirmDelete ? 'Cliquer pour confirmer la suppression' : 'Supprimer ce pari'}
            >
              <Trash2 size={12} />
              {confirmDelete && <span>Confirmer</span>}
            </button>
          )}
        </div>
      )}

      {/* Unsettle action (settled bets in history) */}
      {showActions && bet.status !== 'pending' && onUnsettle && (
        <div className="mt-3 pt-3 border-t border-gray-800">
          <button
            onClick={() => onUnsettle(bet.id)}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-yellow-400 transition-colors"
          >
            <RotateCcw size={12} /> Remettre en cours
          </button>
        </div>
      )}
    </div>
  )
}
