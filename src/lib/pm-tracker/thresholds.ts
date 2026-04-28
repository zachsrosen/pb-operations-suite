/**
 * PM tracker policy thresholds. All values are first-pass guesses and meant
 * to be tuned during the Zach-only Phase 1 rollout.
 *
 * Banding semantics:
 *   - For metrics where higher is better (readinessScore, fieldPopulationScore,
 *     recoveryRate90d, reviewRate): green if >= green threshold, yellow if >=
 *     yellow threshold, else red.
 *   - For metrics where lower is better (ghostRate): green if <= green
 *     threshold, yellow if <= yellow threshold, else red.
 */

export const THRESHOLDS = {
  ghostDays: 14,
  stuckDays: 14,
  dayOfFailureHours: 48,
  permitSlaDays: 30, // default; per-AHJ overrides live in a future Phase 3 follow-up
  saveDebounceDays: 30,
  customerConfirmationLookbackDays: 7,

  // Color bands keyed by metric name
  bands: {
    ghostRate: { green: 0.05, yellow: 0.15 },
    readinessScore: { green: 0.95, yellow: 0.85 },
    fieldPopulationScore: { green: 0.95, yellow: 0.85 },
    recoveryRate90d: { green: 0.8, yellow: 0.6 },
    reviewRate: { green: 0.4, yellow: 0.25 },
  },
} as const;

export type ThresholdBand = keyof typeof THRESHOLDS.bands;
export type Tier = "green" | "yellow" | "red";

const LOWER_IS_BETTER: ReadonlySet<ThresholdBand> = new Set(["ghostRate"]);

/**
 * Return the green/yellow/red tier for a given metric value.
 * Handles "lower is better" metrics correctly.
 */
export function bandFor(metric: ThresholdBand, value: number): Tier {
  const cfg = THRESHOLDS.bands[metric];
  if (LOWER_IS_BETTER.has(metric)) {
    if (value <= cfg.green) return "green";
    if (value <= cfg.yellow) return "yellow";
    return "red";
  }
  if (value >= cfg.green) return "green";
  if (value >= cfg.yellow) return "yellow";
  return "red";
}
