/**
 * Check Engine Runner
 *
 * Executes all checks for a given skill against deal data.
 * Returns structured ReviewResult. Pure function — no side effects.
 */

import { getChecks } from "./index";
import type { ReviewContext, ReviewResult, Finding, SkillName } from "./types";

export async function runChecks(
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
