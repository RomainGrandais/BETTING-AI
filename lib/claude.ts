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

const SYSTEM_PROMPT = `Tu es un analyste expert en paris sportifs avec 25 ans d'expérience en gestion de portefeuille.
Ton objectif : croissance EXPONENTIELLE de la bankroll. Pas de bets "bateau" - chaque décision doit être justifiée solidement.

EXIGENCES STRICTES :
- AUCUN pari sans evidence statistique ou tendance TRÈS claire
- EV positif minimal : +12% (pas +5% - cela c'est du bruit)
- Rejeter les inefficacités de marché "douteuses" - il faut une raison SOLIDE que le marché se trompe
- Cotes entre 1.60 et 3.50 (risque/rendement optimal, pas les outsiders)
- MAXIMUM 2-3 bets par session - qualité sur quantité
- Chaque pari doit citer 2-3 facteurs spécifiques qui justifient l'edge

ANALYSE REQUISE POUR CHAQUE MATCH :
1. Écarts de cotes suspects : si les cotes diffèrent, pourquoi? Surréaction du marché?
2. Forme et tendances : stats récentes, dynamique momentum, blessures
3. Facteurs contextuels : domicile/extérieur, fatigue, enjeux du match
4. Confiance dans ta probabilité : modérée/haute/très haute (ne pas surpasser le marché sans raison)
5. Comparaison cote-probabilité : qu'elle est l'écart exact en % et est-ce justifié?

REJETS AUTOMATIQUES :
- Équipes/joueurs inconnus ou données insuffisantes
- Cotes inefficaces où tu "penses juste" sans facteur spécifique
- Matchs sans contexte clair (amical, test, etc)
- Probabilités estimées trop proches de celle du marché (<+8% EV réel)

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

  const userMessage = `PARAMÈTRES CRITIQUE :
Bankroll: €${currentBankroll.toFixed(2)} | Paris actifs: ${activeBetsCount} | Matchs: ${selectedMatches.length}

INSTRUCTIONS STRICTES :
1. Analyse profondément - ne pas faire de guesses
2. Maximum 2-3 bets SEULEMENT si l'edge est TRÈS clair (+12% EV minimum)
3. Pour chaque bet, détaille POURQUOI le marché se trompe (pas juste "je pense que...")
4. Si tu trouves 0 bet avec +12% EV, retourne une liste vide - mieux que de forcer
5. Cite les facteurs spécifiques : stats, tendances, contexte, écarts de cotes

Format de réponse JSON:
{
  "bets": [
    {
      "matchId": "...",
      "betLabel": "...",
      "betType": "...",
      "odds": 0.0,
      "estimatedProbability": 0.0,
      "reasoning": "Facteur 1: [spécifique]. Facteur 2: [spécifique]. Facteur 3: [spécifique]. EV estimé: +X%"
    }
  ],
  "sessionSummary": "Nombre de bets trouvés, critères appliqués"
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

    // STRICT: Minimum +10% EV for exponential growth (not +5%)
    if (ev < 0.10) {
      console.log(`Rejecting ${bet.matchId}: EV ${(ev * 100).toFixed(1)}% < 10% minimum`)
      continue
    }

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
