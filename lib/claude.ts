import Anthropic from '@anthropic-ai/sdk'
import { Match as WinamaxMatch } from './odds-api'
import { calculateStake, expectedValue } from './bankroll'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export interface BetDecision {
  matchId: string
  sport: string
  sportKey: string
  homeTeam: string
  awayTeam: string
  competition: string
  startTime: string
  betType: string
  betLabel: string
  odds: number
  estimatedProbability: number
  expectedValue: number
  stake: number
  reasoning: string
}

const SYSTEM_PROMPT = `Tu es un analyste expert en paris sportifs avec 20 ans d'expérience dans tous les sports.
Tu gères un portefeuille de paris sportifs avec pour objectif de maximiser le ROI à long terme.

Principes fondamentaux :
- Tu cherches uniquement des VALUE BETS : paris où la probabilité réelle dépasse la probabilité implicite des cotes
- Tu appliques une gestion stricte de la bankroll (Kelly Criterion fractionnel)
- Tu analyses les cotes pour détecter les inefficacités du marché
- Tu diversifies sur plusieurs sports pour réduire le risque
- Tu évites les matchs avec trop d'incertitude ou sans information suffisante

Critères de sélection :
- Valeur attendue (EV) positif minimal : +5%
- Cotes entre 1.50 et 4.00 (meilleur ratio risque/rendement)
- Maximum 3-5 paris par session d'analyse
- Priorité aux sports et compétitions que tu connais bien

Pour chaque match analysé, estime la probabilité réelle de chaque issue basée sur :
- La logique des cotes (marché efficient = tes ajustements doivent être justifiés)
- La réputation et le niveau des équipes/joueurs
- Le contexte de la compétition

Réponds UNIQUEMENT en JSON valide, sans markdown, sans commentaires.`

export async function analyzeMatchesWithClaude(
  matches: WinamaxMatch[],
  currentBankroll: number,
  activeBetsCount: number
): Promise<BetDecision[]> {
  if (matches.length === 0) return []

  // Limit to 80 most interesting matches to control token usage
  const selectedMatches = matches.slice(0, 80)

  const matchesJson = selectedMatches.map(m => ({
    id: m.matchId,
    sport: m.sportName,
    competition: m.competition,
    home: m.homeTeam,
    away: m.awayTeam,
    start: m.startTime,
    odds: m.odds.map(o => ({ label: o.label, value: o.value, type: o.betType })),
  }))

  const userMessage = `Bankroll actuelle: €${currentBankroll.toFixed(2)}
Paris actifs en cours: ${activeBetsCount}
Matchs disponibles dans les 48h: ${selectedMatches.length}

Analyse ces matchs et sélectionne les meilleurs value bets.
Pour chaque pari sélectionné, fournis:
- matchId
- betLabel (ex: "Victoire Real Madrid", "Plus de 2.5 buts")
- betType (1X2, OU, HC, etc.)
- odds (la cote choisie)
- estimatedProbability (ta probabilité estimée, entre 0 et 1)
- reasoning (raisonnement court en français, max 150 mots)

Réponds avec ce JSON exact:
{
  "bets": [
    {
      "matchId": "...",
      "betLabel": "...",
      "betType": "...",
      "odds": 0.0,
      "estimatedProbability": 0.0,
      "reasoning": "..."
    }
  ],
  "sessionSummary": "Résumé de la session en 50 mots"
}

Matchs à analyser:
${JSON.stringify(matchesJson, null, 2)}`

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  })

  const textContent = response.content.find(c => c.type === 'text')
  if (!textContent || textContent.type !== 'text') return []

  let parsed: { bets: Array<{
    matchId: string
    betLabel: string
    betType: string
    odds: number
    estimatedProbability: number
    reasoning: string
  }> }

  try {
    // Strip potential markdown code blocks
    const cleaned = textContent.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    parsed = JSON.parse(cleaned)
  } catch {
    console.error('Failed to parse Claude response:', textContent.text)
    return []
  }

  const decisions: BetDecision[] = []

  for (const bet of parsed.bets || []) {
    const match = matches.find(m => m.matchId === bet.matchId)
    if (!match) continue

    const ev = expectedValue(bet.odds, bet.estimatedProbability)
    if (ev <= 0) continue // Skip negative EV bets

    const stake = calculateStake(currentBankroll, bet.odds, bet.estimatedProbability)
    if (stake < 0.5) continue

    decisions.push({
      matchId: bet.matchId,
      sport: match.sportName,
      sportKey: match.sportKey,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      competition: match.competition,
      startTime: match.startTime,
      betType: bet.betType,
      betLabel: bet.betLabel,
      odds: bet.odds,
      estimatedProbability: bet.estimatedProbability,
      expectedValue: ev,
      stake,
      reasoning: bet.reasoning,
    })
  }

  return decisions
}
