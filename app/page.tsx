'use client'

import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Zap, TrendingUp, Clock, CheckCircle, X } from 'lucide-react'
import BankrollChart from '@/components/BankrollChart'
import BetCard, { Bet } from '@/components/BetCard'
import StatsPanel from '@/components/StatsPanel'

interface BankrollEntry {
  id: string
  amount: number
  event: string
  created_at: string
}

type Tab = 'live' | 'history' | 'stats'

export default function Dashboard() {
  const [bets, setBets] = useState<Bet[]>([])
  const [bankrollHistory, setBankrollHistory] = useState<BankrollEntry[]>([])
  const [activeTab, setActiveTab] = useState<Tab>('live')
  const [loading, setLoading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [lastAnalysis, setLastAnalysis] = useState<string | null>(null)
  const [analysisResult, setAnalysisResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const initialBankroll = 100

  // True bankroll = last settled value (stakes don't move it, only win/loss does)
  const currentBankroll = bankrollHistory.length > 0
    ? bankrollHistory[bankrollHistory.length - 1].amount
    : initialBankroll

  // Stakes currently in play (reserved but not yet won/lost)
  const pendingStakes = bets
    .filter(b => b.status === 'pending')
    .reduce((sum, b) => sum + b.stake, 0)

  // What's available to bet right now
  const availableBankroll = Math.max(0, currentBankroll - pendingStakes)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [betsRes, bankrollRes] = await Promise.all([
        fetch('/api/bets'),
        fetch('/api/bankroll'),
      ])
      const betsData = await betsRes.json()
      const bankrollData = await bankrollRes.json()
      if (Array.isArray(betsData)) setBets(betsData)
      if (Array.isArray(bankrollData)) setBankrollHistory(bankrollData)
    } catch {
      setError('Erreur de chargement des données')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const runAutoSettle = async () => {
    setError(null)
    try {
      const res = await fetch('/api/settle-auto', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        setAnalysisResult(data.message)
        await fetchData()
      } else {
        setError(data.error || 'Erreur lors du règlement automatique')
      }
    } catch {
      setError('Erreur de connexion')
    }
  }

  const runAnalysis = async () => {
    setAnalyzing(true)
    setAnalysisResult(null)
    setError(null)
    try {
      const res = await fetch('/api/analyze', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        setAnalysisResult(data.message)
        setLastAnalysis(new Date().toLocaleTimeString('fr-FR'))
        await fetchData()
      } else {
        setError(data.error || "Erreur lors de l'analyse")
      }
    } catch {
      setError('Erreur de connexion')
    } finally {
      setAnalyzing(false)
    }
  }

  const handleSettle = async (betId: string, result: 'won' | 'lost' | 'void') => {
    try {
      const res = await fetch('/api/settle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ betId, result }),
      })
      const data = await res.json()
      if (data.success) await fetchData()
      else setError(data.error)
    } catch {
      setError('Erreur lors de la validation')
    }
  }

  // Sort by match start time ascending (soonest first)
  const sortedBets = [...bets].sort((a, b) =>
    new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
  )
  const pendingBets = sortedBets.filter(b => b.status === 'pending')
  const settledBets = sortedBets.filter(b => b.status !== 'pending')
  const wonBets = bets.filter(b => b.status === 'won')
  const profitLoss = currentBankroll - initialBankroll

  const tabs = [
    { id: 'live' as Tab, label: 'Paris actifs', count: pendingBets.length },
    { id: 'history' as Tab, label: 'Historique', count: settledBets.length },
    { id: 'stats' as Tab, label: 'Statistiques', count: null },
  ]

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <TrendingUp size={16} />
            </div>
            <div>
              <h1 className="text-white font-bold text-base">BettingAI</h1>
              <p className="text-gray-500 text-xs">Portefeuille géré par IA</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-white font-bold">€{currentBankroll.toFixed(2)}</p>
              <div className="flex items-center gap-1.5 justify-end">
                <p className={`text-xs ${profitLoss >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {profitLoss >= 0 ? '+' : ''}€{profitLoss.toFixed(2)}
                </p>
                {pendingStakes > 0 && (
                  <p className="text-xs text-yellow-500">· €{pendingStakes.toFixed(2)} en jeu</p>
                )}
              </div>
            </div>
            {pendingBets.length > 0 && (
              <button
                onClick={runAutoSettle}
                className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm font-medium text-gray-300 transition-colors border border-gray-700"
                title="Vérifier les résultats et régler les paris automatiquement"
              >
                <CheckCircle size={14} />
                Régler
              </button>
            )}
            <button
              onClick={runAnalysis}
              disabled={analyzing}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
            >
              {analyzing ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <Zap size={14} />
              )}
              {analyzing ? 'Analyse...' : 'Analyser'}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Status messages */}
        {error && (
          <div className="bg-red-900/20 border border-red-800/50 rounded-xl px-4 py-3 text-red-400 text-sm flex items-center gap-2">
            <X size={14} />
            {error}
          </div>
        )}
        {analysisResult && (
          <div className="bg-green-900/20 border border-green-800/50 rounded-xl px-4 py-3 text-green-400 text-sm flex items-center gap-2">
            <CheckCircle size={14} />
            {analysisResult}
            {lastAnalysis && (
              <span className="ml-auto text-gray-500 flex items-center gap-1">
                <Clock size={11} />{lastAnalysis}
              </span>
            )}
          </div>
        )}

        {/* Bankroll chart */}
        <BankrollChart data={bankrollHistory} initialBankroll={initialBankroll} />

        {/* Quick stats bar */}
        <div className="grid grid-cols-4 gap-3">
          {[
            {
              label: 'Portefeuille',
              value: `€${currentBankroll.toFixed(0)}`,
              sub: pendingStakes > 0 ? `€${availableBankroll.toFixed(0)} dispo · €${pendingStakes.toFixed(0)} en jeu` : 'disponible',
              highlight: false,
            },
            {
              label: 'En cours',
              value: String(pendingBets.length),
              sub: pendingStakes > 0 ? `€${pendingStakes.toFixed(2)} misés` : 'paris actifs',
              highlight: false,
            },
            {
              label: 'Gagnés',
              value: String(wonBets.length),
              sub: `sur ${settledBets.length} joués`,
              highlight: false,
            },
            {
              label: 'ROI réel',
              value: `${profitLoss >= 0 ? '+' : ''}${((profitLoss / initialBankroll) * 100).toFixed(1)}%`,
              sub: pendingStakes > 0 ? 'hors paris en cours' : 'depuis le début',
              highlight: profitLoss !== 0,
            },
          ].map(s => (
            <div key={s.label} className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
              <p className="text-gray-500 text-xs mb-1">{s.label}</p>
              <p className={`font-bold text-lg ${s.highlight ? (profitLoss >= 0 ? 'text-green-400' : 'text-red-400') : 'text-white'}`}>{s.value}</p>
              <p className="text-gray-600 text-xs">{s.sub}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div>
          <div className="flex border-b border-gray-800 mb-4">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-400'
                    : 'border-transparent text-gray-500 hover:text-gray-300'
                }`}
              >
                {tab.label}
                {tab.count !== null && (
                  <span className={`px-1.5 py-0.5 rounded text-xs ${
                    activeTab === tab.id ? 'bg-blue-500/20 text-blue-400' : 'bg-gray-800 text-gray-500'
                  }`}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
            <button
              onClick={fetchData}
              disabled={loading}
              className="ml-auto px-3 py-2 text-gray-500 hover:text-gray-300 transition-colors"
              title="Rafraîchir"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>

          {activeTab === 'live' && (
            <div className="space-y-3">
              {pendingBets.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <TrendingUp size={32} className="mx-auto mb-3 opacity-30" />
                  <p>Aucun pari actif</p>
                  <p className="text-sm mt-1">Lance une analyse pour que l&apos;IA place des paris</p>
                </div>
              ) : (
                pendingBets.map(bet => (
                  <BetCard
                    key={bet.id}
                    bet={bet}
                    onSettle={handleSettle}
                    showActions={true}
                  />
                ))
              )}
            </div>
          )}

          {activeTab === 'history' && (
            <div className="space-y-3">
              {settledBets.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <Clock size={32} className="mx-auto mb-3 opacity-30" />
                  <p>Aucun pari terminé pour l&apos;instant</p>
                </div>
              ) : (
                settledBets.map(bet => (
                  <BetCard key={bet.id} bet={bet} />
                ))
              )}
            </div>
          )}

          {activeTab === 'stats' && (
            <StatsPanel
              bets={bets}
              initialBankroll={initialBankroll}
              currentBankroll={currentBankroll}
            />
          )}
        </div>
      </div>
    </div>
  )
}
