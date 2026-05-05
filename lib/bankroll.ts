// Kelly Criterion for optimal bet sizing
// f* = (bp - q) / b  where b = net odds, p = estimated win prob, q = 1-p
export function kellyCriterion(odds: number, estimatedProbability: number): number {
  const b = odds - 1  // net odds
  const p = estimatedProbability
  const q = 1 - p
  const kelly = (b * p - q) / b
  return Math.max(0, kelly)
}

// Adjust the fractional Kelly multiplier based on recent performance.
// Reduces exposure during bad streaks, increases slightly during good runs.
export function adaptiveKellyMultiplier(recentROI: number): number {
  if (recentROI < -0.20) return 0.10  // severe drawdown: very conservative
  if (recentROI < -0.10) return 0.15  // losing streak: defensive
  if (recentROI < 0)     return 0.20  // slight negative: cautious
  if (recentROI < 0.15)  return 0.25  // baseline (default)
  if (recentROI < 0.30)  return 0.30  // performing well: slightly more aggressive
  return 0.35                          // strong run: more aggressive, still capped
}

export function calculateStake(
  bankroll: number,
  odds: number,
  estimatedProbability: number,
  maxStakePercent = 0.05,
  recentROI = 0
): number {
  const multiplier = adaptiveKellyMultiplier(recentROI)
  const kellyFraction = kellyCriterion(odds, estimatedProbability) * multiplier
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
