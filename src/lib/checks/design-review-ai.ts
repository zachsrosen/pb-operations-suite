/**
 * AI-Powered Design Review (Phase 2)
 *
 * Claude vision review that reads planset PDFs and cross-references against
 * AHJ requirements, utility requirements, and deal properties.
 *
 * This module is only loaded when AI_DESIGN_REVIEW_ENABLED=true.
 * It is dynamically imported by runner.ts to avoid loading when flag is off.
 *
 * TODO (Phase 2): Implement full AI review with:
 *   - Planset PDF download from Drive
 *   - Anthropic Files API upload
 *   - Claude Sonnet structured output (submit_findings tool)
 *   - AHJ + utility requirement cross-referencing
 */

import type { ReviewResult } from "./types";

export async function runDesignReview(
  dealId: string,
  properties: Record<string, string | null>,
): Promise<ReviewResult> {
  // Phase 2 placeholder — this should never be called until Phase 2 is implemented.
  // If it IS called, return a clear error finding rather than silently passing.
  return {
    skill: "design-review",
    dealId,
    findings: [
      {
        check: "ai-review-not-implemented",
        severity: "error",
        message:
          "AI design review is enabled but not yet implemented. " +
          "Unset AI_DESIGN_REVIEW_ENABLED to use deterministic checks.",
      },
    ],
    errorCount: 1,
    warningCount: 0,
    passed: false,
    durationMs: 0,
  };
}
