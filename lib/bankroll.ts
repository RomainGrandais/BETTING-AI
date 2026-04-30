// Kelly Criterion for optimal bet sizing
// f* = (bp - q) / b  where b = net odds, p = estimated win prob, q = 1-p
export function kellyCriterion(odds: number, estimatedProbability: number): number {
  const b = odds - 1  // net odds
  const p = estimatedProbability
  const q = 1 - p
  const kelly = (b * p - q) / b
  // Use fractional Kelly (25%) to reduce variance
  return Math.max(0, kelly * 0.25)
}

export function calculateStake(
  bankroll: number,
  odds: number,
  estimatedProbability: number,
  maxStakePercent = 0.05  // max 5% of bankroll per bet
): number {
  const kellyFraction = kellyCriterion(odds, estimatedProbability)
  const rawStake = bankroll * kellyFraction
  const maxStake = bankroll * maxStakePercent
  const stake = Math.min(rawStake, maxStake)
  // Round to 2 decimals, minimum €0.50
  return Math.max(0.5, Math.round(stake * 100) / 100)
}

export function impliedProbability(odds: number): number {
  return 1 / odds
}

export function expectedValue(odds: number, estimatedProbability: number): number {
  return estimatedProbability * (odds - 1) - (1 - estimatedProbability)
}

export function isValueBet(odds: number, estimatedProbability: number): boolean {
  return expectedValue(odds, estimatedProbability) > 0
}
