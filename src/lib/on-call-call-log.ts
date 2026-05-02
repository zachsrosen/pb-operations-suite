/**
 * Shared constants and types for the on-call emergency call log.
 * Used by the API route AND the form/list UI components so the dropdown
 * options stay in sync with what the server accepts.
 */

export const ISSUE_TYPES = [
  { value: "inverter", label: "Inverter" },
  { value: "no-production", label: "No production" },
  { value: "battery", label: "Battery" },
  { value: "monitoring", label: "Monitoring offline" },
  { value: "roofing", label: "Roofing" },
  { value: "safety", label: "Safety / urgent" },
  { value: "other", label: "Other" },
] as const;

export type IssueTypeValue = (typeof ISSUE_TYPES)[number]["value"];

export const ISSUE_TYPE_VALUES: ReadonlySet<string> = new Set(
  ISSUE_TYPES.map((t) => t.value),
);

/**
 * Escalation targets shown in the dropdown. "Other" lets the electrician
 * type a custom name. Keep this list short — these are the people who
 * actually pick up off-hours escalations.
 */
export const ESCALATION_TARGETS = [
  "Tracey Mallory",
  "Operations Manager",
  "Service Lead",
  "Other",
] as const;

export type CallLogPayload = {
  poolId: string;
  reporterCrewMemberId: string;
  callReceivedAt: string; // ISO
  customerName: string;
  customerPhone?: string | null;
  customerAddress?: string | null;
  issueType: string;
  issueTypeOther?: string | null;
  safetyRisk?: boolean;
  homeHasPower?: boolean | null;
  troubleshootingAttempted?: string | null;
  resolvedRemotely?: boolean;
  dispatched?: boolean;
  arrivalAt?: string | null;
  completedAt?: string | null;
  hoursWorked?: number | null;
  escalatedTo?: string | null;
  notes?: string | null;
};

/**
 * Compute hours from arrival → completion, rounded to two decimals.
 * Returns null if either timestamp is missing or the range is non-positive.
 */
export function computeHoursWorked(
  arrivalAt: string | Date | null | undefined,
  completedAt: string | Date | null | undefined,
): number | null {
  if (!arrivalAt || !completedAt) return null;
  const a = new Date(arrivalAt).getTime();
  const c = new Date(completedAt).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(c) || c <= a) return null;
  return Math.round(((c - a) / 3_600_000) * 100) / 100;
}
