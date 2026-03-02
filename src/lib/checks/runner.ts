/**
 * Check Engine Runner
 *
 * Executes all checks for a given skill against deal data.
 * Returns structured ReviewResult. Pure function — no side effects.
 *
 * Feature flag: AI_DESIGN_REVIEW_ENABLED
 *   "true" → Claude vision review (Phase 2, calls runDesignReview)
 *   anything else / unset → deterministic registered checks (fallback)
 */

import { getChecks } from "./index";
import type { ReviewContext, ReviewResult, Finding, SkillName } from "./types";

/** Check if AI design review is enabled via feature flag. */
export function isAIDesignReviewEnabled(): boolean {
  return process.env.AI_DESIGN_REVIEW_ENABLED === "true";
}

/**
 * Run all checks for a skill against deal data.
 *
 * For design-review with AI_DESIGN_REVIEW_ENABLED=true, dispatches to the
 * AI review path (Phase 2). Otherwise runs deterministic registered checks.
 */
export async function runChecks(
  skill: SkillName,
  context: ReviewContext
): Promise<ReviewResult> {
  // Phase 2: AI dispatch for design-review when flag is enabled
  if (skill === "design-review" && isAIDesignReviewEnabled()) {
    // Dynamically import to avoid loading AI module when flag is off
    const { runDesignReview } = await import("@/lib/checks/design-review-ai");
    return runDesignReview(context.dealId, context.properties);
  }

  // Deterministic fallback: run registered check functions
  return runDeterministicChecks(skill, context);
}

/** Run the deterministic registered check functions for a skill. */
export async function runDeterministicChecks(
  skill: SkillName,
  context: ReviewContext
): Promise<ReviewResult> {
  const start = Date.now();
  const checks = getChecks(skill);
  const findings: Finding[] = [];

  for (const check of checks) {
    try {
      const finding = await check(context);
      if (finding) findings.push(finding);
    } catch (err) {
      findings.push({
        check: "internal-error",
        severity: "warning",
        message: `Check failed internally: ${err instanceof Error ? err.message : "unknown error"}`,
      });
    }
  }

  const errorCount = findings.filter((f) => f.severity === "error").length;
  const warningCount = findings.filter((f) => f.severity === "warning").length;

  return {
    skill,
    dealId: context.dealId,
    findings,
    errorCount,
    warningCount,
    passed: errorCount === 0,
    durationMs: Date.now() - start,
  };
}
