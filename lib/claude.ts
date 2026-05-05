import Anthropic from '@anthropic-ai/sdk'
import { Match as OddsMatch } from './odds-api'
import { calculateStake, expectedValue } from './bankroll'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export interface ComboLeg {
  matchId: string
  betLabel: string
  betType: string
}

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
  comboLegs?: ComboLeg[]
}

export interface SportStat {
  sport: string
  bets: number
  winRate: number  // 0–1
  roi: number      // decimal, e.g. 0.12 = +12%
}

const SYSTEM_PROMPT = `Tu es un analyste expert en paris sportifs avec 25 ans d'expérience en gestion de portefeuille.
Ton objectif : croissance EXPONENTIELLE de la bankroll sur le long terme, basée sur des données réelles.

TYPES DE PARIS DISPONIBLES :
1. Résultat match (H2H/1X2) : Victoire domicile (type "1"), Match nul (type "X"), Victoire extérieur (type "2")
2. Total buts Over/Under : "Plus de X buts" (type "over_X"), "Moins de X buts" (type "under_X")
   → Utilise uniquement si les cotes correspondantes sont fournies dans les données du match
3. Combiné (type "COMBO") : combine 2-3 paris distincts pour maximiser les cotes quand l'edge est évident sur plusieurs matchs
   → Cotes combinées max : 6.0 | EV estimé minimum combiné : +20%
   → Fournis le champ "comboLegs" avec les sélections individuelles

EXIGENCES STRICTES :
- AUCUN pari sans evidence statistique ou tendance TRÈS claire
- EV positif minimal : +12% pour les simples, +20% pour les combinés
- Rejeter les inefficacités de marché "douteuses" — il faut une raison SOLIDE que le marché se trompe
- Cotes entre 1.50 et 4.50 (simples) | entre 2.50 et 6.00 (combinés)
- MAXIMUM 3 simples + 1 combiné par session — qualité sur quantité
- Chaque pari doit citer 2-3 facteurs spécifiques qui justifient l'edge

ANALYSE REQUISE POUR CHAQUE PARI :
1. Écarts de cotes : si les cotes diffèrent du marché moyen, pourquoi? Surréaction?
2. Forme et tendances : stats récentes, momentum, blessures connues
3. Facteurs contextuels : domicile/extérieur, fatigue, enjeux du match
4. Pour Over/Under : historique buts des deux équipes, solidité défensive, style de jeu
5. Comparaison cote-probabilité : l'écart exact en % et pourquoi il est justifié

ADAPTATION À L'HISTORIQUE :
Si les stats de performance par sport te sont fournies :
- Concentre-toi sur les sports/marchés avec ROI positif confirmé (>10 paris)
- Sois plus sélectif (EV minimum +15%) sur les sports avec ROI négatif
- Ne réduis pas la sélection uniquement pour variance court terme (<10 paris)
- Mets en avant les Over/Under pour le football si ce marché a un bon historique

REJETS AUTOMATIQUES :
- Équipes/joueurs inconnus ou données insuffisantes
- Cotes trop proches de la probabilité implicite du marché (<+8% EV réel)
- Matchs amicaux, tests, pré-saison sans enjeu clair
- Combinés avec des matchs déjà sélectionnés en simples dans la même session

Réponds UNIQUEMENT en JSON valide, sans markdown, sans commentaires.`

export async function analyzeMatchesWithClaude(
  matches: OddsMatch[],
  currentBankroll: number,
  activeBetsCount: number,
  sportStats?: SportStat[],
  recentROI = 0
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
    odds: m.odds.map(o => ({
      label: o.label,
      value: o.value,
      type: o.betType,
      ...(o.point !== undefined ? { point: o.point } : {}),
    })),
  }))

  const performanceSection = sportStats && sportStats.length > 0
    ? `\nPERFORMANCE HISTORIQUE PAR SPORT :\n${sportStats.map(s =>
        `- ${s.sport}: ${s.bets} paris, ${(s.winRate * 100).toFixed(0)}% victoires, ROI ${s.roi >= 0 ? '+' : ''}${(s.roi * 100).toFixed(1)}%`
      ).join('\n')}\nROI récent global: ${recentROI >= 0 ? '+' : ''}${(recentROI * 100).toFixed(1)}%\n`
    : ''

  const userMessage = `PARAMÈTRES :
Bankroll: €${currentBankroll.toFixed(2)} | Paris actifs: ${activeBetsCount} | Matchs disponibles: ${selectedMatches.length}
${performanceSection}
INSTRUCTIONS :
1. Analyse profondément — pas de guesses, uniquement des edges clairement identifiés
2. Maximum 3 paris simples + 1 combiné SEULEMENT si l'edge est TRÈS clair (+12% EV minimum simples, +20% combiné)
3. Pour chaque paris, détaille POURQUOI le marché se trompe (facteurs spécifiques)
4. Exploite les cotes Over/Under (totaux buts) si elles sont fournies et l'edge est présent
5. Si 0 bets avec +12% EV : retourne liste vide — mieux que forcer

Format JSON de réponse :
{
  "bets": [
    {
      "matchId": "...",
      "betLabel": "...",
      "betType": "1|2|X|over_2.5|under_2.5|COMBO",
      "odds": 0.0,
      "estimatedProbability": 0.0,
      "reasoning": "Facteur 1: [spécifique]. Facteur 2: [spécifique]. EV estimé: +X%",
      "comboLegs": [
        { "matchId": "...", "betLabel": "...", "betType": "1|2|X|over_2.5" }
      ]
    }
  ],
  "sessionSummary": "Résumé: X paris trouvés, critères appliqués"
}
Note: comboLegs est requis uniquement pour les bets de type COMBO.

Matchs à analyser :
${JSON.stringify(matchesJson, null, 2)}`

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2500,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  })

  const textContent = response.content.find(c => c.type === 'text')
  if (!textContent || textContent.type !== 'text') return []

  let parsed: {
    bets: Array<{
      matchId: string
      betLabel: string
      betType: string
      odds: number
      estimatedProbability: number
      reasoning: string
      comboLegs?: ComboLeg[]
    }>
  }

  try {
    const cleaned = textContent.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    parsed = JSON.parse(cleaned)
  } catch {
    console.error('Failed to parse Claude response:', textContent.text)
    return []
  }

  const decisions: BetDecision[] = []

  for (const bet of parsed.bets || []) {
    const isCombo = bet.betType === 'COMBO'

    // For combo bets, find any one of the legs' matches for metadata
    const match = isCombo
      ? matches.find(m => bet.comboLegs?.some(l => l.matchId === m.matchId))
      : matches.find(m => m.matchId === bet.matchId)

    if (!match) continue

    const ev = expectedValue(bet.odds, bet.estimatedProbability)
    const minEV = isCombo ? 0.20 : 0.10

    if (ev < minEV) {
      console.log(`Rejecting ${bet.matchId}: EV ${(ev * 100).toFixed(1)}% < ${minEV * 100}% minimum`)
      continue
    }

    // Combos: halve the stake vs a regular bet
    const stake = calculateStake(currentBankroll, bet.odds, bet.estimatedProbability, isCombo ? 0.025 : 0.05, recentROI)
    if (stake < 0.5) continue

    const matchId = isCombo
      ? `COMBO_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
      : bet.matchId

    decisions.push({
      matchId,
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
      comboLegs: isCombo ? bet.comboLegs : undefined,
    })
  }

  return decisions
}
