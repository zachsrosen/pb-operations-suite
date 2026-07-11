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

import { classifyRejectionTask, READY, ONBOARDING_READY } from "@/lib/pe-rejection-advance";
import { PE_DOC_TO_TEAM_FIELD } from "@/lib/pe-rejection-notes";
import { PE_M1_DOC_NAMES } from "@/lib/pe-analytics";
import { PE_DOC_HUBSPOT_MAP, normalizeActionItemDocName } from "@/lib/pe-hubspot-sync";
import { hubspotClient } from "@/lib/hubspot";
import { markTaskComplete } from "@/lib/hubspot-tasks";
// Note: `prisma` is lazy-imported inside the orchestrator/ledger functions so the
// pure logic above stays importable by unit tests without a live client.

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

/**
 * Extract a canonical team from a task BODY. The per-team rejection tasks often
 * carry the generic title "M1 Rejected by Participate Energy" while the owning
 * team is named only in the body ("...rejected the <team> documents..."). A
 * milestone-level phrasing ("rejected the M1 documents") is truly generic, so
 * TEAM_WORDS returns undefined for "m1"/"m2"/"onboarding".
 */
export function bodyTeam(body: string): Team | undefined {
  const text = (body || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  const m = text.match(/rejected the (\w+) documents/i);
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
export function classifyPeTask(subject: string, body = ""): ClassifiedTask | null {
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

  // rejection: delegate to the shared classifier, then resolve the team. For PE
  // rejections the team is in the subject ("M1 Sales Rejection") or, when the
  // title is generic ("M1 Rejected by Participate Energy"), in the body. A body
  // that names the milestone ("rejected the M1 documents") stays generic.
  const rej = classifyRejectionTask(s);
  if (rej) {
    const team = rej.flavor === "pe" ? (subjectTeam(s) ?? bodyTeam(body)) : subjectTeam(s);
    return { kind: "rejection", milestone: rej.milestone, flavor: rej.flavor, team };
  }

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
    const gate = task.flavor === "onboarding" ? ONBOARDING_READY : READY;
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

// ---------------------------------------------------------------------------
// I/O: orchestrator (searches tasks, reads deal + DB state, completes tasks)
//
// Everything below does HubSpot/Prisma I/O. The pure logic above is what the
// unit tests import.
// ---------------------------------------------------------------------------

const SEARCH_TOKENS = ["Participate", "Resubmit", "Rejection"];
const OPEN_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "WAITING"];

interface OpenTask { id: string; subject: string; body: string; createdAt: number }

/** Search open tasks whose subject contains any PE signal token; dedupe by id. */
async function searchOpenPeTasks(): Promise<OpenTask[]> {
  const byId = new Map<string, OpenTask>();
  for (const token of SEARCH_TOKENS) {
    let after: string | undefined;
    do {
      const res = await hubspotClient.crm.objects.tasks.searchApi.doSearch({
        filterGroups: [{ filters: [
          { propertyName: "hs_task_status", operator: "IN" as const, values: OPEN_STATUSES },
          { propertyName: "hs_task_subject", operator: "CONTAINS_TOKEN" as const, value: token },
        ] }],
        // hs_task_body carries the owning team for generic-titled rejection tasks.
        properties: ["hs_task_subject", "hs_task_body", "hs_task_status", "hs_createdate"],
        limit: 100, after,
      } as Parameters<typeof hubspotClient.crm.objects.tasks.searchApi.doSearch>[0]);
      for (const t of res.results) {
        if (byId.has(t.id)) continue;
        byId.set(t.id, {
          id: t.id,
          subject: t.properties.hs_task_subject || "",
          body: t.properties.hs_task_body || "",
          createdAt: new Date(t.properties.hs_createdate || 0).getTime(),
        });
      }
      after = res.paging?.next?.after;
    } while (after);
  }
  return [...byId.values()];
}

export interface AutocompleteResult {
  scannedTasks: number;
  candidates: number;
  completed: CompletionEntry[];
}

/**
 * Reconcile open PE tasks: find candidates, read the deal + DB state each needs,
 * and complete the ones whose condition holds. `dryRun` computes without writing.
 */
export async function autocompletePeTasks(opts: { dryRun?: boolean } = {}): Promise<AutocompleteResult> {
  const { prisma } = await import("@/lib/db");

  const open = await searchOpenPeTasks();
  const candidates = open
    .map((t) => ({ task: t, cls: classifyPeTask(t.subject, t.body) }))
    .filter((c): c is { task: OpenTask; cls: ClassifiedTask } => c.cls !== null);

  // task -> deal (PE tasks are single-deal; take the first association if several)
  const taskDeal = new Map<string, string>();
  for (const { task } of candidates) {
    const a = await hubspotClient.crm.associations.v4.basicApi.getPage("tasks", task.id, "deals", undefined, 1);
    if (a.results.length) taskDeal.set(task.id, String(a.results[0].toObjectId));
  }
  const dealIds = [...new Set(taskDeal.values())];
  if (dealIds.length === 0) return { scannedTasks: open.length, candidates: candidates.length, completed: [] };

  // deal properties
  const dealProps = new Map<string, Record<string, string>>();
  for (let i = 0; i < dealIds.length; i += 100) {
    const res = await hubspotClient.crm.deals.batchApi.read({
      inputs: dealIds.slice(i, i + 100).map((id) => ({ id })),
      properties: ["dealname", "pe_m1_status", "pe_m2_status", "pe_m1_submission_date", "pe_m2_submission_date"],
    } as Parameters<typeof hubspotClient.crm.deals.batchApi.read>[0]);
    for (const d of res.results) dealProps.set(d.id, d.properties as Record<string, string>);
  }

  // DB state: unresolved action items + latest version upload per (deal, canonical doc)
  const openItems = await prisma.peActionItem.findMany({
    where: { dealId: { in: dealIds }, resolvedAt: null },
    select: { dealId: true, docLabel: true },
  });
  const versions = await prisma.peDocVersion.findMany({
    where: { dealId: { in: dealIds } },
    select: { dealId: true, docName: true, uploadedAt: true },
  });

  const state = new Map<string, DealPeState>();
  for (const id of dealIds) {
    const p = dealProps.get(id) ?? {};
    state.set(id, {
      m1Status: p.pe_m1_status || "", m2Status: p.pe_m2_status || "",
      m1SubmissionDate: p.pe_m1_submission_date || null, m2SubmissionDate: p.pe_m2_submission_date || null,
      unresolvedDocsByMilestone: { m1: new Set(), m2: new Set() },
      latestUploadByDoc: new Map(),
    });
  }
  for (const it of openItems) {
    if (!it.dealId) continue;
    const s = state.get(it.dealId); if (!s) continue;
    const doc = normalizeActionItemDocName(it.docLabel);
    s.unresolvedDocsByMilestone[docToMilestone(doc)].add(doc);
  }
  for (const v of versions) {
    if (!v.dealId) continue;
    const s = state.get(v.dealId); if (!s) continue;
    const ms = v.uploadedAt.getTime();
    if (ms > (s.latestUploadByDoc.get(v.docName) ?? 0)) s.latestUploadByDoc.set(v.docName, ms);
  }

  const completed: CompletionEntry[] = [];
  for (const { task, cls } of candidates) {
    const dealId = taskDeal.get(task.id); if (!dealId) continue;
    const s = state.get(dealId); if (!s) continue;
    const { complete, reason } = decideCompletion(cls, task.createdAt, s);
    if (!complete) continue;
    if (!opts.dryRun) await markTaskComplete(task.id);
    completed.push({
      taskId: task.id, dealId, dealName: dealProps.get(dealId)?.dealname || dealId,
      kind: cls.kind, milestone: cls.milestone,
      team: cls.kind === "rejection" ? cls.team : undefined, reason,
    });
  }
  return { scannedTasks: open.length, candidates: candidates.length, completed };
}

/** Read + append + persist the ledger to its SystemConfig row. */
export async function recordAutocompleteLedger(
  completed: CompletionEntry[],
  atIso: string,
): Promise<AutocompleteLedger> {
  const { prisma } = await import("@/lib/db");
  const row = await prisma.systemConfig.findUnique({ where: { key: AUTOCOMPLETE_LEDGER_KEY } });
  let prev: AutocompleteLedger | null = null;
  if (row) { try { prev = JSON.parse(row.value) as AutocompleteLedger; } catch { prev = null; } }
  const next = mergeAutocompleteLedger(prev, completed, atIso);
  await prisma.systemConfig.upsert({
    where: { key: AUTOCOMPLETE_LEDGER_KEY },
    create: { key: AUTOCOMPLETE_LEDGER_KEY, value: JSON.stringify(next) },
    update: { value: JSON.stringify(next) },
  });
  return next;
}
