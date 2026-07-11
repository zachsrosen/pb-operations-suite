# PE HubSpot Task Auto-Completion Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-complete stale PE HubSpot tasks - the `Submit M{n} To Participate Energy` task once a milestone's submission date is stamped (Goal 1), and per-team rejection + resubmit tasks once the rejected docs are actually resubmitted (Goal 2) - from our own code, folded into the hourly `pe-rejection-advance` cron.

**Architecture:** A convergent, task-first reconciler (`src/lib/pe-task-autocomplete.ts`). It searches open PE tasks by subject token, classifies each with a loose signal-word matcher, and completes only those whose state condition strictly holds. Pure decision functions (classifier, maps, `decideCompletion`, ledger merge) carry the correctness load and are unit-tested; a thin orchestrator does the HubSpot/DB I/O and is validated by a dry-run. Complete-only (never reopen), idempotent, `SystemConfig`-ledgered, feature-flagged.

**Tech Stack:** TypeScript, Next.js API route (cron), Prisma (Neon Postgres), `@hubspot/api-client`, Jest.

**Spec:** `docs/superpowers/specs/2026-07-06-pe-task-autocompletion-design.md`

---

## File Structure

- **Create** `src/lib/pe-task-autocomplete.ts` - all logic: pure classifier + maps + `decideCompletion` + ledger merge (top of file, no I/O), then the `autocompletePeTasks` orchestrator + `recordAutocompleteLedger` (I/O, bottom of file).
- **Create** `src/__tests__/pe-task-autocomplete.test.ts` - unit tests for the pure functions.
- **Modify** `src/app/api/cron/pe-rejection-advance/route.ts` - call `autocompletePeTasks()` before `advancePeRejections()`, flag-gated, and add its summary to the response.
- **Modify** `.env.example` - document `PE_TASK_AUTOCOMPLETE_ENABLED`.
- **Create** `scripts/pe-task-autocomplete-dryrun.ts` - standalone dry-run for the go-live backlog review.

### Reused primitives (all verified on `origin/main`)

- `classifyRejectionTask(subject)` from `@/lib/pe-rejection-advance` - returns `{ milestone, flavor }` for rejection tasks.
- `markTaskComplete(taskId)` from `@/lib/hubspot-tasks` - sets `hs_task_status = COMPLETED` (idempotent).
- `PE_DOC_TO_TEAM_FIELD` from `@/lib/pe-rejection-notes` - canonical doc name -> `pe_rejection_notes_for_*` team field (PE typo `intercocnnection`).
- `PE_M1_DOC_NAMES` from `@/lib/pe-analytics` - the 13 canonical M1 doc names (incl. Bill of Materials).
- `PE_DOC_HUBSPOT_MAP`, `normalizeActionItemDocName` from `@/lib/pe-hubspot-sync`.
- `hubspotClient` from `@/lib/hubspot`; `prisma` from `@/lib/db`.
- Ledger pattern mirrors `mergeAdvanceLedger` / `recordAdvanceLedger` in `pe-rejection-advance.ts`.

### Data model (read-only)

- `PeActionItem`: `{ id, dealId: string|null, docLabel, actionDate: Date, resolvedAt: Date|null }`.
- `PeDocVersion`: `{ dealId: string|null, docName, uploadedAt: Date }`.

---

## Chunk 1: Reconciler

### Task 1: Task classifier + team/milestone maps (pure)

**Files:**
- Create: `src/lib/pe-task-autocomplete.ts`
- Test: `src/__tests__/pe-task-autocomplete.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/pe-task-autocomplete.test.ts
// Pure functions only; mock the DB so importing the module never needs a live client.
jest.mock("@/lib/db", () => ({ prisma: null }));

import {
  classifyPeTask,
  docToTeam,
  docToMilestone,
  subjectTeam,
} from "@/lib/pe-task-autocomplete";

describe("classifyPeTask", () => {
  it("classifies submit tasks", () => {
    expect(classifyPeTask("Submit M1 To Participate Energy - ZRS")).toEqual({ kind: "submit", milestone: "m1" });
    expect(classifyPeTask("Submit M2 To Participate Energy - ZRS")).toEqual({ kind: "submit", milestone: "m2" });
  });

  it("classifies per-team and generic PE rejection tasks", () => {
    expect(classifyPeTask("M1 Sales Rejection - ZRS")).toEqual({ kind: "rejection", milestone: "m1", flavor: "pe", team: "sales" });
    expect(classifyPeTask("M1 Operations Rejection - ZRS")).toEqual({ kind: "rejection", milestone: "m1", flavor: "pe", team: "ops" });
    expect(classifyPeTask("M1 Design Rejection - ZRS")).toEqual({ kind: "rejection", milestone: "m1", flavor: "pe", team: "design" });
    expect(classifyPeTask("M1 Rejected by Participate Energy #3 - ZRS")).toEqual({ kind: "rejection", milestone: "m1", flavor: "pe", team: undefined });
  });

  it("classifies resubmit and onboarding tasks", () => {
    expect(classifyPeTask("M1 Ready to Resubmit #2 - ZRS")).toEqual({ kind: "resubmit", milestone: "m1", flavor: "pe" });
    expect(classifyPeTask("Onboarding Ready to Resubmit - ZRS")).toEqual({ kind: "resubmit", milestone: "m1", flavor: "onboarding" });
    expect(classifyPeTask("Onboarding Rejected by Participate Energy - ZRS")).toEqual({ kind: "rejection", milestone: "m1", flavor: "onboarding", team: undefined });
  });

  it("classifies internal-QC tasks (recognized, completed=false handled later)", () => {
    expect(classifyPeTask("M1 Ops Internal Rejection - ZRS")).toEqual({ kind: "rejection", milestone: "m1", flavor: "internal", team: "ops" });
  });

  it("returns null for non-PE and ambiguous subjects", () => {
    for (const s of [
      "Onboard Project To Participate Energy - ZRS",
      "Send Notice of Cancellation for Participate - ZRS",
      "Share Monitoring with Participate - ZRS",
      "Submit As-Built Revision #2 to AHJ - ZRS",
      "Xcel PTO Photos Ready to Resubmit #1 - ZRS",
      "PTO Ready to Resubmit - ZRS",
      "Jeff Hirsch - Resubmit IA removing grid charging",
      "Participate Energy Rejected - ZRS",
      "Provide Itemized Receipt - ZRS",
      "Close Out Project - WMS",
    ]) {
      expect(classifyPeTask(s)).toBeNull();
    }
  });
});

describe("doc -> team / milestone", () => {
  it("maps docs to canonical teams incl. the BOM->ops override and PE typo fix", () => {
    expect(docToTeam("Design Plan")).toBe("design");
    expect(docToTeam("Signed Proposal")).toBe("sales");
    expect(docToTeam("Signed Interconnection Agreement")).toBe("interconnection"); // PE typo normalized
    expect(docToTeam("Bill of Materials")).toBe("ops"); // override (absent from PE_DOC_TO_TEAM_FIELD)
    expect(docToTeam("Conditional Progress Lien Waiver")).toBe("accounting");
    expect(docToTeam("Conditional Waiver — Final Payment")).toBe("accounting");
  });

  it("maps docs to milestones (accounting spans M1 and M2)", () => {
    expect(docToMilestone("Conditional Progress Lien Waiver")).toBe("m1");
    expect(docToMilestone("Conditional Waiver — Final Payment")).toBe("m2");
    expect(docToMilestone("Permission to Operate (PTO)")).toBe("m2");
    expect(docToMilestone("Bill of Materials")).toBe("m1");
  });

  it("maps subject team words", () => {
    expect(subjectTeam("M1 Operations Rejection")).toBe("ops");
    expect(subjectTeam("M2 Interconnection Rejection")).toBe("interconnection");
    expect(subjectTeam("M1 Rejected by Participate Energy #1")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- pe-task-autocomplete`
Expected: FAIL - `classifyPeTask` (and the maps) are not exported.

- [ ] **Step 3: Write minimal implementation (top of the new module)**

```ts
// src/lib/pe-task-autocomplete.ts
import { classifyRejectionTask } from "@/lib/pe-rejection-advance";
import { PE_DOC_TO_TEAM_FIELD } from "@/lib/pe-rejection-notes";
import { PE_M1_DOC_NAMES } from "@/lib/pe-analytics";
import { PE_DOC_HUBSPOT_MAP } from "@/lib/pe-hubspot-sync";

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

/** Extract a canonical team from a task subject like "M1 Sales Rejection". */
export function subjectTeam(subject: string): Team | undefined {
  const m = subject.match(/\bM[12]\s+([A-Za-z]+)(?:\s+Internal)?\s+Rejection\b/i);
  const w = m?.[1]?.toLowerCase();
  return w ? TEAM_WORDS[w] : undefined;
}

const milestoneToken = (s: string): "m1" | "m2" | null =>
  /\bM1\b/i.test(s) ? "m1" : /\bM2\b/i.test(s) ? "m2" : null;

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

// --- doc -> team / milestone -------------------------------------------------

const DOC_TEAM_OVERRIDES: Record<string, Team> = { "Bill of Materials": "ops" };

export function docToTeam(docName: string): Team | undefined {
  if (DOC_TEAM_OVERRIDES[docName]) return DOC_TEAM_OVERRIDES[docName];
  const field = PE_DOC_TO_TEAM_FIELD[docName]; // e.g. "pe_rejection_notes_for_intercocnnection"
  if (!field) return undefined;
  const raw = field.replace(/^pe_rejection_notes_for_/, "");
  return (raw === "intercocnnection" ? "interconnection" : raw) as Team;
}

const M1_DOCS = new Set<string>(PE_M1_DOC_NAMES as readonly string[]);

export function docToMilestone(docName: string): "m1" | "m2" {
  return M1_DOCS.has(docName) ? "m1" : "m2";
}

/** All canonical PE doc names, from the single source of truth. */
export const ALL_DOC_NAMES: string[] = PE_DOC_HUBSPOT_MAP.map((d) => d.docName);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- pe-task-autocomplete`
Expected: PASS. If import of `@/lib/pe-analytics` or `@/lib/pe-rejection-advance` pulls a runtime dep, add `jest.mock` for that module at the top of the test (mirror `src/__tests__/pe-resolve-superseded.test.ts`, which mocks `@/lib/db` and `@/lib/pe-scraper-sync`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/pe-task-autocomplete.ts src/__tests__/pe-task-autocomplete.test.ts
git commit -m "feat(pe): classify PE tasks + doc team/milestone maps for auto-completion"
```

---

### Task 2: `decideCompletion` (pure core rules)

**Files:**
- Modify: `src/lib/pe-task-autocomplete.ts`
- Test: `src/__tests__/pe-task-autocomplete.test.ts`

The pure decision takes a normalized per-deal state so it needs no I/O.

- [ ] **Step 1: Write the failing test**

```ts
import { decideCompletion, type DealPeState } from "@/lib/pe-task-autocomplete";

const C = 1_000_000; // task hs_createdate (ms)
const base = (over: Partial<DealPeState> = {}): DealPeState => ({
  m1Status: "Submitted", m2Status: "",
  m1SubmissionDate: "1699999999999", m2SubmissionDate: null,
  unresolvedDocsByMilestone: { m1: new Set(), m2: new Set() },
  latestUploadByDoc: new Map(),
  ...over,
});

describe("decideCompletion", () => {
  it("submit: closes when the milestone submission date is set, not before", () => {
    expect(decideCompletion({ kind: "submit", milestone: "m1" }, C, base({ m1SubmissionDate: "123" })).complete).toBe(true);
    expect(decideCompletion({ kind: "submit", milestone: "m1" }, C, base({ m1SubmissionDate: null })).complete).toBe(false);
    // per-milestone independence
    expect(decideCompletion({ kind: "submit", milestone: "m2" }, C, base({ m2SubmissionDate: null })).complete).toBe(false);
  });

  it("per-team rejection: closes only when team's docs are resolved AND a post-C resubmission exists", () => {
    const task = { kind: "rejection" as const, milestone: "m1" as const, flavor: "pe" as const, team: "sales" as const };
    // Sales owns "Signed Proposal" (m1). Unresolved -> stays open.
    expect(decideCompletion(task, C, base({ unresolvedDocsByMilestone: { m1: new Set(["Signed Proposal"]), m2: new Set() } })).complete).toBe(false);
    // Resolved but no post-C upload -> stays open.
    expect(decideCompletion(task, C, base({ latestUploadByDoc: new Map([["Signed Proposal", C - 1]]) })).complete).toBe(false);
    // Resolved + post-C upload -> closes.
    expect(decideCompletion(task, C, base({ latestUploadByDoc: new Map([["Signed Proposal", C + 1]]) })).complete).toBe(true);
  });

  it("per-team rejection: an M2 resubmission never closes an M1 accounting task", () => {
    const m1acct = { kind: "rejection" as const, milestone: "m1" as const, flavor: "pe" as const, team: "accounting" as const };
    // Only the M2 accounting doc was resubmitted; M1 accounting doc (Progress Lien) has no post-C upload.
    const state = base({ latestUploadByDoc: new Map([["Conditional Waiver — Final Payment", C + 1]]) });
    expect(decideCompletion(m1acct, C, state).complete).toBe(false);
  });

  it("generic rejection: waits until no unresolved docs remain on the milestone", () => {
    const task = { kind: "rejection" as const, milestone: "m1" as const, flavor: "pe" as const, team: undefined };
    expect(decideCompletion(task, C, base({ unresolvedDocsByMilestone: { m1: new Set(["Design Plan"]), m2: new Set() } })).complete).toBe(false);
    expect(decideCompletion(task, C, base({ latestUploadByDoc: new Map([["Design Plan", C + 1]]) })).complete).toBe(true);
  });

  it("resubmit: closes once the milestone left Ready to Resubmit", () => {
    const task = { kind: "resubmit" as const, milestone: "m1" as const, flavor: "pe" as const };
    expect(decideCompletion(task, C, base({ m1Status: "Ready to Resubmit" })).complete).toBe(false);
    expect(decideCompletion(task, C, base({ m1Status: "Submitted" })).complete).toBe(true);
  });

  it("onboarding resubmit: closes once m1 left Onboarding Ready to Resubmit", () => {
    const task = { kind: "resubmit" as const, milestone: "m1" as const, flavor: "onboarding" as const };
    expect(decideCompletion(task, C, base({ m1Status: "Onboarding Ready to Resubmit" })).complete).toBe(false);
    expect(decideCompletion(task, C, base({ m1Status: "Onboarding Resubmitted" })).complete).toBe(true);
  });

  it("BOM rejection counts toward the Ops team task", () => {
    const opsTask = { kind: "rejection" as const, milestone: "m1" as const, flavor: "pe" as const, team: "ops" as const };
    // BOM is the only Ops-relevant doc resubmitted post-C, and no Ops doc is unresolved.
    expect(decideCompletion(opsTask, C, base({ latestUploadByDoc: new Map([["Bill of Materials", C + 1]]) })).complete).toBe(true);
  });

  it("internal flavor is never completed in v1", () => {
    const task = { kind: "rejection" as const, milestone: "m1" as const, flavor: "internal" as const, team: "ops" as const };
    expect(decideCompletion(task, C, base()).complete).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- pe-task-autocomplete`
Expected: FAIL - `decideCompletion` / `DealPeState` not exported.

- [ ] **Step 3: Write minimal implementation (append to the module)**

```ts
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

/** Docs in a given milestone owned by a given team (undefined team = all docs in the milestone). */
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

  const onlyOnboarding = task.flavor === "onboarding";
  const docs = scopedDocs(task.milestone, task.team, onlyOnboarding);
  if (docs.length === 0) return { complete: false, reason: "no docs in scope" };

  if (!allResolved(state, task.milestone, docs)) return { complete: false, reason: "unresolved items remain" };
  if (!resubmittedAfter(state, docs, createdAt)) return { complete: false, reason: "no post-creation resubmission" };
  return { complete: true, reason: `${task.team ?? "milestone"} docs resubmitted` };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- pe-task-autocomplete`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pe-task-autocomplete.ts src/__tests__/pe-task-autocomplete.test.ts
git commit -m "feat(pe): decideCompletion rules for PE task auto-completion"
```

---

### Task 3: Ledger merge (pure)

**Files:**
- Modify: `src/lib/pe-task-autocomplete.ts`
- Test: `src/__tests__/pe-task-autocomplete.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { mergeAutocompleteLedger, type AutocompleteLedger, type CompletionEntry } from "@/lib/pe-task-autocomplete";

const entry = (taskId: string): CompletionEntry => ({
  taskId, dealId: "1", dealName: "D", kind: "submit", milestone: "m1", reason: "x",
});

describe("mergeAutocompleteLedger", () => {
  it("folds entries and keeps a lifetime total", () => {
    const l1 = mergeAutocompleteLedger(null, [entry("a"), entry("b")], "2026-07-07T00:00:00Z");
    expect(l1.totalCompleted).toBe(2);
    expect(l1.entries).toHaveLength(2);
    const l2 = mergeAutocompleteLedger(l1, [entry("c")], "2026-07-07T01:00:00Z");
    expect(l2.totalCompleted).toBe(3);
    expect(l2.lastRunAt).toBe("2026-07-07T01:00:00Z");
  });

  it("caps stored entries but not the lifetime total", () => {
    const many = Array.from({ length: 2100 }, (_, i) => entry(String(i)));
    const l = mergeAutocompleteLedger(null, many, "2026-07-07T00:00:00Z");
    expect(l.totalCompleted).toBe(2100);
    expect(l.entries.length).toBe(2000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- pe-task-autocomplete`
Expected: FAIL - `mergeAutocompleteLedger` not exported.

- [ ] **Step 3: Write minimal implementation (append to the module)**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- pe-task-autocomplete`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pe-task-autocomplete.ts src/__tests__/pe-task-autocomplete.test.ts
git commit -m "feat(pe): autocomplete ledger merge"
```

---

### Task 4: Orchestrator + ledger persistence (I/O)

**Files:**
- Modify: `src/lib/pe-task-autocomplete.ts` (append I/O section)

No unit test here (pure logic is covered); the dry-run (Task 6) is the acceptance gate. Keep this section below a clear divider so the pure top of the file stays import-light.

- [ ] **Step 1: Implement the orchestrator**

```ts
// ---------------------------------------------------------------------------
// I/O: orchestrator (searches tasks, reads deal + DB state, completes tasks)
// ---------------------------------------------------------------------------
import { hubspotClient } from "@/lib/hubspot";
import { markTaskComplete } from "@/lib/hubspot-tasks";
import { normalizeActionItemDocName } from "@/lib/pe-hubspot-sync";

const SEARCH_TOKENS = ["Participate", "Resubmit", "Rejection"];
const OPEN_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "WAITING"];

interface OpenTask { id: string; subject: string; createdAt: number }

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
        properties: ["hs_task_subject", "hs_task_status", "hs_createdate"],
        limit: 100, after,
      } as Parameters<typeof hubspotClient.crm.objects.tasks.searchApi.doSearch>[0]);
      for (const t of res.results) {
        if (byId.has(t.id)) continue;
        byId.set(t.id, {
          id: t.id,
          subject: t.properties.hs_task_subject || "",
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

export async function autocompletePeTasks(opts: { dryRun?: boolean } = {}): Promise<AutocompleteResult> {
  const { prisma } = await import("@/lib/db");

  const open = await searchOpenPeTasks();
  const candidates = open
    .map((t) => ({ task: t, cls: classifyPeTask(t.subject) }))
    .filter((c): c is { task: OpenTask; cls: ClassifiedTask } => c.cls !== null);

  // task -> deal
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
```

- [ ] **Step 2: Verify the project still type-checks and builds**

Run: `npm run lint && npx tsc --noEmit`
Expected: no errors in `pe-task-autocomplete.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/pe-task-autocomplete.ts
git commit -m "feat(pe): task-first autocomplete orchestrator + ledger persistence"
```

---

### Task 5: Wire into the `pe-rejection-advance` cron

**Files:**
- Modify: `src/app/api/cron/pe-rejection-advance/route.ts`

- [ ] **Step 1: Add the autocomplete pass before the advance step**

In the `GET` handler, after the auth check and before `const result = await advancePeRejections();`, insert:

```ts
    // Auto-complete stale PE tasks (submit / rejection / resubmit) BEFORE advancing,
    // so a resubmission closes the rejection task and the advance step can flip the
    // milestone status in the same run. Flag-gated; convergent so a skipped run heals.
    let autocomplete: { completed: number; ledgerTotal?: number } | undefined;
    if (process.env.PE_TASK_AUTOCOMPLETE_ENABLED === "true") {
      try {
        const { autocompletePeTasks, recordAutocompleteLedger } = await import("@/lib/pe-task-autocomplete");
        const ac = await autocompletePeTasks();
        let ledgerTotal: number | undefined;
        if (ac.completed.length > 0) {
          console.warn(
            "[pe-task-autocomplete] completed:",
            ac.completed.map((c) => `${c.dealName} ${c.kind}/${c.milestone}${c.team ? `/${c.team}` : ""}`).join(" | "),
          );
          const ledger = await recordAutocompleteLedger(ac.completed, new Date().toISOString());
          ledgerTotal = ledger.totalCompleted;
        }
        autocomplete = { completed: ac.completed.length, ledgerTotal };
      } catch (err) {
        console.error("[pe-task-autocomplete] failed (non-fatal):", err);
      }
    }
```

Then add `autocomplete` to the success `NextResponse.json({ ... })` payload.

- [ ] **Step 2: Verify build**

Run: `npm run lint && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cron/pe-rejection-advance/route.ts
git commit -m "feat(pe): run task auto-completion in the pe-rejection-advance cron (flag-gated)"
```

---

### Task 6: Dry-run script + feature-flag docs

**Files:**
- Create: `scripts/pe-task-autocomplete-dryrun.ts`
- Modify: `.env.example`

- [ ] **Step 1: Write the dry-run script**

```ts
// scripts/pe-task-autocomplete-dryrun.ts
// READ-ONLY preview of what task auto-completion WOULD close, grouped by kind.
//   tsx scripts/pe-task-autocomplete-dryrun.ts
import "dotenv/config";
import { autocompletePeTasks } from "../src/lib/pe-task-autocomplete";

async function main() {
  const res = await autocompletePeTasks({ dryRun: true });
  const byKind = new Map<string, number>();
  for (const c of res.completed) {
    const k = `${c.kind}${c.team ? `/${c.team}` : ""}/${c.milestone}`;
    byKind.set(k, (byKind.get(k) ?? 0) + 1);
  }
  console.log(`scanned open PE tasks: ${res.scannedTasks} | candidates: ${res.candidates} | WOULD complete: ${res.completed.length}`);
  console.log("\nby kind:");
  for (const [k, n] of [...byKind.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${k}`);
  console.log("\ndetail:");
  for (const c of res.completed) console.log(`  ${c.kind}/${c.milestone}${c.team ? `/${c.team}` : ""}  ${c.dealName}  (${c.reason})  [task ${c.taskId}]`);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Document the flag in `.env.example`**

Add near the other PE flags:

```
# When "true", the pe-rejection-advance cron also auto-completes stale PE tasks
# (Submit M1/M2, per-team rejection, resubmit). Off by default; run
# scripts/pe-task-autocomplete-dryrun.ts to preview before enabling.
PE_TASK_AUTOCOMPLETE_ENABLED=false
```

- [ ] **Step 3: Verify the dry-run runs read-only against prod data**

Run: `tsx scripts/pe-task-autocomplete-dryrun.ts`
Expected: prints scanned/candidate/would-complete counts and a by-kind breakdown; makes NO writes (no `markTaskComplete` calls because `dryRun: true`). Confirm a non-zero `submit/*` count appears (proves the submit path and scan coverage), and that no unrelated subjects show up.

- [ ] **Step 4: Commit**

```bash
git add scripts/pe-task-autocomplete-dryrun.ts .env.example
git commit -m "feat(pe): dry-run preview + PE_TASK_AUTOCOMPLETE_ENABLED flag"
```

---

## Rollout (post-merge, human-gated)

1. Merge with the flag OFF. Run `tsx scripts/pe-task-autocomplete-dryrun.ts`; review the full would-complete list with Zach (confirm the assumed M2 subject forms appear correctly and no unrelated task is listed).
2. Set `PE_TASK_AUTOCOMPLETE_ENABLED=true` in Vercel prod env (`vercel env add`, verify with `vercel env ls production`).
3. Watch the hourly cron response `autocomplete.completed` and the `SystemConfig` row `pe_task_autocomplete_ledger` for the first days; spot-check a few completed tasks against their deals.

## Notes for the implementer

- **Prisma is not run here.** No schema change; the only persisted state is the `SystemConfig` ledger row (same table `pe-rejection-advance` uses). Do NOT run `prisma migrate`.
- **Pure vs I/O split:** keep `classifyPeTask`, the maps, `decideCompletion`, and `mergeAutocompleteLedger` at the top of the module with no I/O imports so the unit tests import cleanly; the orchestrator's `hubspotClient` / `prisma` imports sit below the divider (and `prisma` is lazy-imported inside the functions, matching `pe-rejection-advance.ts`).
- **Test import hiccups:** if importing `@/lib/pe-analytics` or `@/lib/pe-rejection-advance` into the test pulls a runtime dependency, add a `jest.mock("@/lib/db", () => ({ prisma: null }))` (already in the Task 1 test) and mock any other offending module, mirroring `src/__tests__/pe-resolve-superseded.test.ts`.
- **Idempotency:** completing an already-completed task is a HubSpot no-op; the ledger dedupes nothing itself but the convergent design means re-listing a task is harmless (it was already COMPLETED, so the next run's `searchOpenPeTasks` won't return it).
