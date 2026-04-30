'use client'

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'

interface BankrollEntry {
  id: string
  amount: number
  event: string
  created_at: string
}

interface Props {
  data: BankrollEntry[]
  initialBankroll?: number
}

export default function BankrollChart({ data, initialBankroll = 100 }: Props) {
  const chartData = data.map(entry => ({
    date: format(new Date(entry.created_at), 'dd/MM HH:mm', { locale: fr }),
    amount: entry.amount,
    event: entry.event,
    pct: ((entry.amount - initialBankroll) / initialBankroll * 100).toFixed(1),
  }))

  const currentAmount = data[data.length - 1]?.amount ?? initialBankroll
  const totalReturn = ((currentAmount - initialBankroll) / initialBankroll * 100)
  const isPositive = totalReturn >= 0

  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ payload: { amount: number; pct: string; event: string } }> }) => {
    if (active && payload && payload.length) {
      const d = payload[0].payload
      return (
        <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 text-sm">
          <p className="text-white font-bold">€{d.amount.toFixed(2)}</p>
          <p className={d.pct >= '0' ? 'text-green-400' : 'text-red-400'}>
            {d.pct >= '0' ? '+' : ''}{d.pct}% vs départ
          </p>
          <p className="text-gray-400 text-xs mt-1 max-w-48 truncate">{d.event}</p>
        </div>
      )
    }
    return null
  }

  return (
    <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-white">Évolution de la Bankroll</h2>
          <p className="text-gray-400 text-sm">Départ: €{initialBankroll}</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-white">€{currentAmount.toFixed(2)}</p>
          <p className={`text-sm font-medium ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
            {isPositive ? '+' : ''}{totalReturn.toFixed(1)}% ROI
          </p>
        </div>
      </div>

      {chartData.length < 2 ? (
        <div className="flex items-center justify-center h-48 text-gray-500">
          Pas encore assez de données
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="date" stroke="#6b7280" tick={{ fontSize: 11 }} />
            <YAxis stroke="#6b7280" tick={{ fontSize: 11 }} domain={['auto', 'auto']} />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine y={initialBankroll} stroke="#4b5563" strokeDasharray="4 4" />
            <Line
              type="monotone"
              dataKey="amount"
              stroke={isPositive ? '#10b981' : '#ef4444'}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
