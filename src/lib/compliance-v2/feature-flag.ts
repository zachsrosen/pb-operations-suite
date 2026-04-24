/**
 * Single source of truth for the COMPLIANCE_V2_ENABLED feature flag.
 * Used both for the scoring-path delegation and for cache key construction,
 * so stale v1 results are never served after the flag flips.
 */
export function isComplianceV2Enabled(): boolean {
  return (process.env.COMPLIANCE_V2_ENABLED ?? "").toLowerCase() === "true";
}

/** Short string form for cache keys. Changes when flag changes. */
export function complianceVersionTag(): "v1" | "v2" {
  return isComplianceV2Enabled() ? "v2" : "v1";
}
