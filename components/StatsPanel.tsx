'use client'

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { Bet } from './BetCard'

interface Props {
  bets: Bet[]
  initialBankroll: number
  currentBankroll: number
}

export default function StatsPanel({ bets, initialBankroll, currentBankroll }: Props) {
  const settled = bets.filter(b => b.status === 'won' || b.status === 'lost')
  const won = bets.filter(b => b.status === 'won')
  const lost = bets.filter(b => b.status === 'lost')
  const pending = bets.filter(b => b.status === 'pending')

  const winRate = settled.length > 0 ? (won.length / settled.length * 100) : 0
  const totalStaked = settled.reduce((s, b) => s + b.stake, 0)
  const totalReturned = won.reduce((s, b) => s + b.potential_win, 0)
  const roi = totalStaked > 0 ? ((totalReturned - totalStaked) / totalStaked * 100) : 0
  const profitLoss = currentBankroll - initialBankroll

  // Stats by sport
  const sportStats: Record<string, { won: number; lost: number; profit: number }> = {}
  for (const bet of settled) {
    if (!sportStats[bet.sport]) sportStats[bet.sport] = { won: 0, lost: 0, profit: 0 }
    if (bet.status === 'won') {
      sportStats[bet.sport].won++
      sportStats[bet.sport].profit += bet.potential_win - bet.stake
    } else {
      sportStats[bet.sport].lost++
      sportStats[bet.sport].profit -= bet.stake
    }
  }

  const sportChartData = Object.entries(sportStats)
    .map(([sport, s]) => ({
      sport: sport.length > 10 ? sport.slice(0, 10) + '…' : sport,
      profit: Math.round(s.profit * 100) / 100,
      winRate: Math.round((s.won / (s.won + s.lost)) * 100),
    }))
    .sort((a, b) => b.profit - a.profit)

  const statCards = [
    {
      label: 'Paris joués',
      value: settled.length.toString(),
      sub: `${pending.length} en attente`,
      color: 'text-white',
    },
    {
      label: 'Taux de victoire',
      value: `${winRate.toFixed(1)}%`,
      sub: `${won.length}W / ${lost.length}L`,
      color: winRate >= 50 ? 'text-green-400' : 'text-red-400',
    },
    {
      label: 'ROI',
      value: `${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%`,
      sub: `Sur €${totalStaked.toFixed(0)} misés`,
      color: roi >= 0 ? 'text-green-400' : 'text-red-400',
    },
    {
      label: 'Profit / Perte',
      value: `${profitLoss >= 0 ? '+' : ''}€${profitLoss.toFixed(2)}`,
      sub: `Bankroll: €${currentBankroll.toFixed(2)}`,
      color: profitLoss >= 0 ? 'text-green-400' : 'text-red-400',
    },
  ]

  return (
    <div className="space-y-4">
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3">
        {statCards.map(card => (
          <div key={card.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-gray-400 text-xs mb-1">{card.label}</p>
            <p className={`text-xl font-bold ${card.color}`}>{card.value}</p>
            <p className="text-gray-500 text-xs mt-0.5">{card.sub}</p>
          </div>
        ))}
      </div>

      {/* Sport breakdown */}
      {sportChartData.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <h3 className="text-white font-medium text-sm mb-4">Profit par Sport</h3>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={sportChartData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" horizontal={false} />
              <XAxis type="number" stroke="#6b7280" tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="sport" stroke="#6b7280" tick={{ fontSize: 10 }} width={70} />
              <Tooltip
                formatter={(v) => [`€${Number(v).toFixed(2)}`, 'Profit']}
                contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }}
                labelStyle={{ color: '#fff' }}
              />
              <Bar dataKey="profit" radius={[0, 4, 4, 0]}>
                {sportChartData.map((entry, i) => (
                  <Cell key={i} fill={entry.profit >= 0 ? '#10b981' : '#ef4444'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
