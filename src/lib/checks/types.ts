/**
 * Check Engine Types
 *
 * A check is a pure function: takes deal context in, returns a finding or null.
 * The registry maps skill names to arrays of check functions.
 */

export interface ReviewContext {
  dealId: string;
  properties: Record<string, string | null>;
  associations?: {
    contacts?: Array<{ email?: string; firstname?: string; lastname?: string }>;
    lineItems?: Array<{ name?: string; quantity?: number; price?: number; hs_sku?: string }>;
    files?: string[];
  };
}

export type Severity = "error" | "warning" | "info";

export interface Finding {
  check: string;
  severity: Severity;
  message: string;
  field?: string;
}

export type CheckFn = (context: ReviewContext) => Promise<Finding | null>;

export interface ReviewResult {
  skill: string;
  dealId: string;
  findings: Finding[];
  errorCount: number;
  warningCount: number;
  passed: boolean;
  durationMs: number;
}

export type SkillName = "design-review" | "install-review";

/** All valid skill names — used for DB queries (e.g. latest review per skill). */
export const VALID_SKILLS: SkillName[] = ["design-review", "install-review"];

/**
 * Skills the generic /api/reviews/run runner can execute.
 * install-review has its own endpoint (/api/install-review) with AI vision pipeline,
 * so it's excluded here to prevent false "passed" results from empty check lists.
 */
export const RUNNER_SKILLS: SkillName[] = ["design-review"];

export const SKILL_ALLOWED_ROLES: Record<SkillName, string[]> = {
  "design-review": ["ADMIN", "EXECUTIVE", "OWNER", "MANAGER", "DESIGNER", "OPERATIONS_MANAGER", "PROJECT_MANAGER", "TECH_OPS"],
  "install-review": ["ADMIN", "EXECUTIVE", "OWNER", "MANAGER", "OPERATIONS", "OPERATIONS_MANAGER", "PROJECT_MANAGER", "TECH_OPS"],
};
