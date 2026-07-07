/**
 * PE HubSpot task auto-completion.
 *
 * A convergent, task-first reconciler that closes stale PE tasks once the work
 * they track is done: the `Submit M{n} To Participate Energy` task when the
 * milestone's submission date is stamped, and per-team rejection / resubmit
 * tasks when the rejected docs are resubmitted. Complete-only (never reopens),
 * idempotent, and ledgered. Folded into the hourly `pe-rejection-advance` cron.
 *
 * Spec: docs/superpowers/specs/2026-07-06-pe-task-autocompletion-design.md
 *
 * The top of this file is pure (no I/O) so the decision logic unit-tests without
 * a live HubSpot/Prisma client. The orchestrator + ledger persistence live below
 * the divider and lazy-import their I/O dependencies.
 */

import { classifyRejectionTask } from "@/lib/pe-rejection-advance";
import { PE_DOC_TO_TEAM_FIELD } from "@/lib/pe-rejection-notes";
import { PE_M1_DOC_NAMES } from "@/lib/pe-analytics";
import { PE_DOC_HUBSPOT_MAP } from "@/lib/pe-hubspot-sync";

// ---------------------------------------------------------------------------
// Task classification (pure)
// ---------------------------------------------------------------------------

export type Team =
  | "design" | "sales" | "ops" | "permitting" | "compliance" | "accounting" | "interconnection";

export type ClassifiedTask =
  | { kind: "submit"; milestone: "m1" | "m2" }
  | { kind: "rejection"; milestone: "m1" | "m2"; flavor: "pe" | "onboarding" | "internal"; team?: Team }
  | { kind: "resubmit"; milestone: "m1" | "m2"; flavor: "pe" | "onboarding" };

const TEAM_WORDS: Record<string, Team> = {
  design: "design", sales: "sales", ops: "ops", operations: "ops",
  permitting: "permitting", compliance: "compliance", accounting: "accounting",
  interconnection: "interconnection",
};

/** Extract a canonical team from a subject like "M1 Sales Rejection" / "M1 Ops Internal Rejection". */
export function subjectTeam(subject: string): Team | undefined {
  const m = subject.match(/\bM[12]\s+([A-Za-z]+)(?:\s+Internal)?\s+Rejection\b/i);
  const w = m?.[1]?.toLowerCase();
  return w ? TEAM_WORDS[w] : undefined;
}

const milestoneToken = (s: string): "m1" | "m2" | null =>
  /\bM1\b/i.test(s) ? "m1" : /\bM2\b/i.test(s) ? "m2" : null;

/**
 * Classify an open task subject into a PE lifecycle task, or null. Loose
 * signal-word matching so subjects stay freely renameable; a milestone (or
 * onboarding) token is always required, which excludes the utility/misc
 * near-misses ("Onboard Project...", "PTO Ready to Resubmit", etc.).
 */
export function classifyPeTask(subject: string): ClassifiedTask | null {
  const s = subject.trim();

  // submit: "submit" + "participate" + milestone, and not a reject/resubmit task
  if (/\bsubmit\b/i.test(s) && /participate/i.test(s) && !/reject/i.test(s) && !/resubmit/i.test(s)) {
    const m = milestoneToken(s);
    if (m) return { kind: "submit", milestone: m };
  }

  // resubmit: "resubmit" + (milestone or onboarding), not a reject task
  if (/resubmit/i.test(s) && !/reject/i.test(s)) {
    if (/onboarding/i.test(s)) return { kind: "resubmit", milestone: "m1", flavor: "onboarding" };
    const m = milestoneToken(s);
    if (m) return { kind: "resubmit", milestone: m, flavor: "pe" };
  }

  // rejection: delegate to the shared classifier, then extract team
  const rej = classifyRejectionTask(s);
  if (rej) return { kind: "rejection", milestone: rej.milestone, flavor: rej.flavor, team: subjectTeam(s) };

  return null;
}

// ---------------------------------------------------------------------------
// Doc -> team / milestone (pure)
// ---------------------------------------------------------------------------

// Bill of Materials has no owning team in PE_DOC_TO_TEAM_FIELD; Zach routed it
// to Ops. This is the one override on top of the canonical PE team map.
const DOC_TEAM_OVERRIDES: Record<string, Team> = { "Bill of Materials": "ops" };

export function docToTeam(docName: string): Team | undefined {
  if (DOC_TEAM_OVERRIDES[docName]) return DOC_TEAM_OVERRIDES[docName];
  const field = PE_DOC_TO_TEAM_FIELD[docName]; // e.g. "pe_rejection_notes_for_intercocnnection"
  if (!field) return undefined;
  const raw = field.replace(/^pe_rejection_notes_for_/, "");
  // PE misspells the interconnection field; normalize to the canonical team name.
  return (raw === "intercocnnection" ? "interconnection" : raw) as Team;
}

const M1_DOCS = new Set<string>(PE_M1_DOC_NAMES as readonly string[]);

/** Doc -> milestone, derived from PE_M1_DOC_NAMES (single source of truth). */
export function docToMilestone(docName: string): "m1" | "m2" {
  return M1_DOCS.has(docName) ? "m1" : "m2";
}

/** All canonical PE doc names, from the single source of truth. */
export const ALL_DOC_NAMES: string[] = PE_DOC_HUBSPOT_MAP.map((d) => d.docName);
