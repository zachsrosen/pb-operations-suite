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

// ---------------------------------------------------------------------------
// Completion decision (pure)
// ---------------------------------------------------------------------------

export interface DealPeState {
  m1Status: string;
  m2Status: string;
  m1SubmissionDate: string | null;
  m2SubmissionDate: string | null;
  /** Canonical doc names with an unresolved PeActionItem, split by milestone. */
  unresolvedDocsByMilestone: { m1: Set<string>; m2: Set<string> };
  /** Canonical doc name -> latest PeDocVersion.uploadedAt (ms). */
  latestUploadByDoc: Map<string, number>;
}

const ONBOARDING_DOCS = [
  "Customer Agreement (PPA/ESA)", "Installation Order", "State Disclosures", "Utility Bill",
];

/** Docs in a milestone owned by a team (undefined team = all docs in the milestone). */
function scopedDocs(milestone: "m1" | "m2", team: Team | undefined, onlyOnboarding = false): string[] {
  const pool = onlyOnboarding ? ONBOARDING_DOCS : ALL_DOC_NAMES;
  return pool.filter(
    (d) => docToMilestone(d) === milestone && (team === undefined || docToTeam(d) === team),
  );
}

/** A doc is "resubmitted for this cycle" if its latest upload post-dates the task. */
function resubmittedAfter(state: DealPeState, docs: string[], createdAt: number): boolean {
  return docs.some((d) => (state.latestUploadByDoc.get(d) ?? 0) > createdAt);
}

/** No doc in the set still has an unresolved action item on the milestone. */
function allResolved(state: DealPeState, milestone: "m1" | "m2", docs: string[]): boolean {
  const unresolved = state.unresolvedDocsByMilestone[milestone];
  return docs.every((d) => !unresolved.has(d));
}

/**
 * Decide whether an open, classified task should be completed given the deal's
 * current state. Complete-only + strictly condition-gated; see spec Section 6.
 */
export function decideCompletion(
  task: ClassifiedTask,
  createdAt: number,
  state: DealPeState,
): { complete: boolean; reason: string } {
  if (task.kind === "submit") {
    const date = task.milestone === "m1" ? state.m1SubmissionDate : state.m2SubmissionDate;
    return date
      ? { complete: true, reason: `${task.milestone} submission date set` }
      : { complete: false, reason: "no submission date" };
  }

  if (task.kind === "resubmit") {
    const status = task.milestone === "m1" ? state.m1Status : state.m2Status;
    const gate = task.flavor === "onboarding" ? "Onboarding Ready to Resubmit" : "Ready to Resubmit";
    return status !== gate
      ? { complete: true, reason: `left ${gate}` }
      : { complete: false, reason: `still ${gate}` };
  }

  // rejection
  if (task.flavor === "internal") return { complete: false, reason: "internal deferred to phase 2" };

  const docs = scopedDocs(task.milestone, task.team, task.flavor === "onboarding");
  if (docs.length === 0) return { complete: false, reason: "no docs in scope" };

  if (!allResolved(state, task.milestone, docs)) return { complete: false, reason: "unresolved items remain" };
  if (!resubmittedAfter(state, docs, createdAt)) return { complete: false, reason: "no post-creation resubmission" };
  return { complete: true, reason: `${task.team ?? "milestone"} docs resubmitted` };
}

// ---------------------------------------------------------------------------
// Ledger (pure merge; persistence lives in the I/O section)
// ---------------------------------------------------------------------------

export const AUTOCOMPLETE_LEDGER_KEY = "pe_task_autocomplete_ledger";
const LEDGER_CAP = 2000;

export interface CompletionEntry {
  taskId: string;
  dealId: string;
  dealName: string;
  kind: ClassifiedTask["kind"];
  milestone: "m1" | "m2";
  team?: Team;
  reason: string;
  at?: string;
}
export interface AutocompleteLedger {
  totalCompleted: number;
  lastRunAt: string;
  entries: CompletionEntry[];
}

/**
 * Fold a run's completions into the prior ledger (pure). `totalCompleted` is the
 * lifetime count (never trimmed); `entries` keeps the most recent LEDGER_CAP.
 */
export function mergeAutocompleteLedger(
  prev: AutocompleteLedger | null,
  completed: CompletionEntry[],
  atIso: string,
): AutocompleteLedger {
  const base = prev ?? { totalCompleted: 0, lastRunAt: atIso, entries: [] };
  const fresh = completed.map((c) => ({ ...c, at: atIso }));
  return {
    totalCompleted: base.totalCompleted + completed.length,
    lastRunAt: atIso,
    entries: [...base.entries, ...fresh].slice(-LEDGER_CAP),
  };
}
