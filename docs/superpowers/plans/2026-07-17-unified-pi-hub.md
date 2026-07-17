# Unified P&I Hub Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One hub at `/dashboards/pi-hub` — Permit / Interconnection / PTO team switcher above the action tabs, one queue+detail engine parameterized by three team configs, and a status dropdown as the write path.

**Architecture:** Consolidates `src/lib/permit-hub.ts` + `src/lib/ic-hub.ts` (structurally identical) into `src/lib/pi-hub/` engine modules driven by `TEAM_CONFIGS`. The old hubs are untouched until the final rollout task; the new hub ships dark behind `PI_HUB_ENABLED` / `NEXT_PUBLIC_PI_HUB_ENABLED`. Spec: `docs/superpowers/specs/2026-07-17-unified-pi-hub-design.md` — read it first; every design decision below is justified there.

**Tech Stack:** Next.js 16 App Router, React Query v5, Prisma (ActivityLog only), HubSpot CRM API via `hubspotClient`/`searchWithRetry`, Jest + React Testing Library.

**House rules that will bite you if skipped:**
- HubSpot enum properties: **write VALUES, display LABELS.** Several differ (`"Complete"` is labelled "Permit Issued"; `"Rejected (New)"` is labelled "Rejected" while `"Rejected"` is labelled "Rejected - Revisions Needed"). Two production bugs (#1469, #1481) came from confusing them.
- New API routes must be added to the relevant roles' `allowedRoutes` in `src/lib/roles.ts` or they **403 silently**.
- Typecheck via a worktree needs `node_modules` + `src/generated` symlinked from the main repo; run `./node_modules/.bin/tsc --noEmit -p tsconfig.json`. Baseline is ~90 pre-existing errors in unrelated files — your files must add **zero**.
- Never run `prisma migrate`. (This plan needs no migration — `ActivityLog` already exists.)
- Verify against live data before claiming anything works; queue sizes in this plan were measured 2026-07-17 (permit 79 / ic 163 / pto ~133) and will drift.

---

## File structure

```
Create:
  src/lib/pi-hub/types.ts            Team, QueueItem, ProjectDetail, SetStatusResult
  src/lib/pi-hub/config.ts           TEAM_CONFIGS (pure data + groupForStatus)
  src/lib/pi-hub/tasks.ts            completeMatchingTask (extracted from completePermitTask)
  src/lib/pi-hub/status.ts           setStatus — the only write path
  src/lib/pi-hub/queue.ts            fetchQueue(team)
  src/lib/pi-hub/detail.ts           fetchDetail(team, dealId)
  src/lib/pi-hub/access.ts           PI_HUB_ROLES + isPiHubEnabled (created in Task 7)
  src/app/api/pi-hub/queue/route.ts
  src/app/api/pi-hub/today-count/route.ts
  src/app/api/pi-hub/project/[dealId]/route.ts
  src/app/api/pi-hub/options/route.ts
  src/app/api/pi-hub/status/route.ts
  src/app/dashboards/pi-hub/page.tsx
  src/app/dashboards/pi-hub/PiHubClient.tsx
  src/app/dashboards/pi-hub/Queue.tsx
  src/app/dashboards/pi-hub/ProjectDetail.tsx
  src/app/dashboards/pi-hub/StatusDropdown.tsx
  src/app/dashboards/pi-hub/panels/   (OverviewPanel, AhjPanel, UtilityPanel, PlansetPanel,
                                       CorrespondencePanel, StatusHistoryPanel, ActivityPanel)
  src/__tests__/pi-hub-config.test.ts
  src/__tests__/pi-hub-status.test.ts
  src/__tests__/pi-hub-queue-ui.test.tsx
  src/__tests__/pi-hub-dropdown.test.tsx
  src/__tests__/fixtures/pi-status-options.ts

Modify:
  src/lib/hubspot-enum-labels.ts     add getActiveEnumOptions
  src/lib/roles.ts                   allowedRoutes for 5 roles
  src/lib/query-keys.ts              piHub key factory
  .env.example                       PI_HUB_ENABLED, NEXT_PUBLIC_PI_HUB_ENABLED
  src/lib/suite-nav.ts + suites page (rollout task only)
  src/app/dashboards/permit-hub/page.tsx, ic-hub/page.tsx  (rollout task only: redirect)
```

`permit-hub.ts` / `ic-hub.ts` and their action routes are **not modified** by this plan (deletion happens post-bake, per spec §9).

---

## Chunk 1: Verifications + engine

### Task 0: Build-start verifications (gating — do these before any code)

**Files:** none (scratch scripts in the worktree root, deleted after)

- [ ] **Step 0.1: Verify `pto_status` retains property history.** Run against live HubSpot (env from main repo's `.env`):

```ts
// _tmp_history.ts — node --env-file=../PB-Operations-Suite/.env ./node_modules/.bin/tsx _tmp_history.ts
async function main() {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  // any deal with a pto_status; find one:
  const s = await fetch("https://api.hubapi.com/crm/v3/objects/deals/search", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: "pto_status", operator: "HAS_PROPERTY" }] }], properties: ["pto_status"], limit: 1 }),
  }).then(r => r.json());
  const id = s.results?.[0]?.id;
  const d = await fetch(`https://api.hubapi.com/crm/v3/objects/deals/${id}?propertiesWithHistory=pto_status`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
  const versions = d.propertiesWithHistory?.pto_status ?? [];
  console.log(`versions: ${versions.length}`, versions.slice(0, 2));
}
main();
```

Expected: `versions.length >= 1` with timestamps. If 0, days-in-status will honestly show "—" for PTO (engine already handles it) — note it in the PR, don't block.

- [ ] **Step 0.2: Verify no HubSpot workflow writes a status on task completion.** The repo carries a workflow dump: search it.

Run: `grep -ril "task" data/hubspot-flows/ | head` then inspect any flow whose trigger is task-completion for actions setting `permitting_status` / `interconnection_status` / `pto_status`. Also check `docs/hubspot-workflow-progression-map.md` if present.
Expected: none found. **If found: STOP and surface to Zach** — the `setStatus` task-completion step (Task 4) could let a workflow stomp the user's chosen value, and the ordering needs his call.

- [ ] **Step 0.3: Capture the live option fixture.** Fetch value+label+archived for `permitting_status`, `interconnection_status`, `pto_status` from `https://api.hubapi.com/crm/v3/properties/deals/<prop>` and write `src/__tests__/fixtures/pi-status-options.ts`:

```ts
/** Snapshot of live HubSpot enum options, captured <date> by plan Task 0.
 *  Used by pi-hub-config.test.ts to pin config statuses to real values. */
export const LIVE_STATUS_OPTIONS: Record<string, { value: string; label: string; archived: boolean; hidden: boolean }[]> = {
  // capture BOTH archived and hidden (default false when absent) — they are
  // the exact fields getActiveEnumOptions filters on
  permitting_status: [/* ... paste ... */],
  interconnection_status: [/* ... */],
  pto_status: [/* ... */],
};
```

- [ ] **Step 0.4: Commit** — `git commit -m "test(pi-hub): live status-option fixture"`

### Task 1: Types + team configs

**Files:** Create `src/lib/pi-hub/types.ts`, `src/lib/pi-hub/config.ts`, `src/__tests__/pi-hub-config.test.ts`

- [ ] **Step 1.1: Write `types.ts`:**

```ts
export type Team = "permit" | "ic" | "pto";
export type GroupKey = "ready" | "rejections" | "resubmit" | "waiting" | "other";
export const GROUP_ORDER: readonly GroupKey[] = ["ready", "rejections", "resubmit", "waiting", "other"];

export interface QueueItem {
  dealId: string;
  name: string;
  address: string | null;
  pbLocation: string | null;
  /** HubSpot internal VALUE — routing/filtering only. */
  status: string;
  /** Human label — display this. */
  statusLabel: string;
  dealStage: string | null;
  group: GroupKey;             // computed server-side from config
  daysInStatus: number | null;
  isStale: boolean;
  lead: string | null;
  leadOwnerId: string | null;
  pm: string | null;
  amount: number | null;
}

export interface SetStatusResult {
  ok: boolean;
  /** Non-fatal post-write failures ("task cleanup failed" etc.). */
  warnings: string[];
}
```

(`ProjectDetail` type is defined in Task 6 alongside its fetch — keep types near their single producer when only one module fills them.)

- [ ] **Step 1.2: Write `config.ts`.** Complete content — groups are explicit lists; anything non-terminal and unlisted falls to `"other"` so a newly added HubSpot status surfaces instead of vanishing (spec §4):

```ts
import type { GroupKey, Team } from "./types";

export interface TeamConfig {
  key: Team;
  label: string;
  accent: "blue" | "green" | "yellow";
  statusProperty: string;
  roleProperty: string;
  leadLabel: string;
  terminalStatuses: readonly string[];
  groups: Partial<Record<GroupKey, readonly string[]>>;
  inboxTeam: "permit" | "ic";
  folderProperty: string;
  folderLabel: string;
  /** Also selects the portal/application link source — the spec's separate
   *  portalLinkSource was identical to this across all three teams, so it
   *  was folded in. Don't re-add it without a team that differs. */
  domainPanel: "ahj" | "utility";
  /** NEW status value → open-task subject substrings to complete on arrival.
   *  Re-keyed from *_ACTION_TASK_SUBJECTS by landing status; collisions merge
   *  (e.g. both submit actions land on "Submitted to AHJ"); FOLLOW_UP writes
   *  no status so its subjects drop. PTO has no task conventions — omitted. */
  taskSubjectsForStatus?: Record<string, readonly string[]>;
}

export const TEAM_CONFIGS: Record<Team, TeamConfig> = {
  permit: {
    key: "permit", label: "Permit", accent: "blue",
    statusProperty: "permitting_status", roleProperty: "permit_tech", leadLabel: "Permit Lead",
    terminalStatuses: ["Complete", "Not Needed"], // "Complete" is labelled "Permit Issued"
    groups: {
      ready: ["Ready For Permitting", "Customer Signature Acquired", "Pending SolarApp", "Submit SolarApp to AHJ"],
      rejections: ["Non-Design Related Rejection"],
      resubmit: ["Returned from Design", "As-Built Ready To Resubmit"],
      waiting: ["Submitted to AHJ", "Resubmitted to AHJ", "Awaiting Utility Approval"],
      // other (catch-all): design-owned Rejected / In Design For Revision /
      // As-Built Revision Needed / In Progress, As-Built Revision Resubmitted,
      // Waiting On Information, Permit Issued Pending Payment, Submitted To Customer
    },
    inboxTeam: "permit",
    folderProperty: "permit_documents", folderLabel: "Permit Folder",
    domainPanel: "ahj",
    taskSubjectsForStatus: {
      "Submitted to AHJ": ["submit to ahj", "submit permit", "submit solarapp", "solarapp submission"],
      "Resubmitted to AHJ": ["resubmit to ahj", "resubmit permit"],
      // resubmit-to-ahj's asBuilt branch lands here (resubmit-to-ahj/route.ts:56-58)
      "As-Built Revision Resubmitted": ["resubmit to ahj", "resubmit permit"],
      "Returned from Design": ["complete revision", "revision complete"],
      "As-Built Revision In Progress": ["start as-built", "as-built revision"],
      "As-Built Ready To Resubmit": ["complete as-built"],
      "In Design For Revision": ["review rejection", "permit rejected"],
      "Non-Design Related Rejection": ["review rejection", "permit rejected"],
      "Rejected": ["review rejection", "permit rejected"],
      "Complete": ["permit issued", "permit approved"],
    },
  },
  ic: {
    key: "ic", label: "Interconnection", accent: "green",
    statusProperty: "interconnection_status", roleProperty: "interconnections_tech", leadLabel: "IC Lead",
    terminalStatuses: [
      "Application Approved", "Application Approved - Pending Signatures",
      "Conditional Application Approval", "Conditional Application Approval - Pending Signatures",
      "Not Needed",
    ],
    groups: {
      ready: ["Ready for Interconnection", "Signature Acquired By Customer"],
      rejections: ["Rejected (New)", "Non-Design Related Rejection"], // "Rejected (New)" is labelled "Rejected"
      resubmit: ["Revision Returned From Design", "As-Built Ready to Resubmit", "Waiting On Information"],
      waiting: ["Submitted To Utility", "Resubmitted To Utility", "As-Built Resubmitted"],
      // other: design-owned Rejected ("Rejected - Revisions Needed") / In Design For
      // Revisions, Transformer Upgrade, Waiting on New Construction, Waiting on
      // Utility Bill, Supplemental Review, RBC On Hold, In Review, Submitted To
      // Customer, Ready To Submit - Pending Design, Xcel Site Plan & SLD Needed,
      // Pending Rebate Approval, Waiting on Participate Energy
    },
    inboxTeam: "ic",
    folderProperty: "interconnection_documents", folderLabel: "Interconnection Folder",
    domainPanel: "utility",
    taskSubjectsForStatus: {
      "Submitted To Utility": ["submit to utility", "submit ic", "submit interconnection"],
      "Resubmitted To Utility": [
        "resubmit to utility", "resubmit ic", "resubmit interconnection",
        "provide information", "send information", "respond to utility", // PROVIDE_INFORMATION also lands here
      ],
      "Revision Returned From Design": ["complete revision", "ic revision complete"],
      "In Design For Revisions": ["review rejection", "ic rejected", "interconnection rejected"],
      "Non-Design Related Rejection": ["review rejection", "ic rejected", "interconnection rejected"],
      "Rejected": ["review rejection", "ic rejected", "interconnection rejected"],
      "Application Approved": ["ic approved", "interconnection approved"],
    },
  },
  pto: {
    key: "pto", label: "PTO", accent: "yellow",
    statusProperty: "pto_status", roleProperty: "interconnections_tech", leadLabel: "IC Lead",
    terminalStatuses: ["PTO", "Not Needed"], // "PTO" is labelled "PTO Granted"
    groups: {
      ready: ["Inspection Passed - Ready for Utility", "Xcel Photos Ready to Submit"],
      rejections: ["Inspection Rejected By Utility", "Ops Related PTO Rejection", "XCEL Photos Rejected"],
      resubmit: ["Ready to Resubmit", "Xcel Photos Ready to Resubmit"],
      waiting: ["Inspection Submitted to Utility", "Resubmitted to Utility", "Xcel Photos Submitted", "Xcel Photos Resubmitted"],
      // other BY DECISION (Zach 2026-07-17): Xcel Photos Approved, Conditional PTO -
      // Pending Transformer Upgrade; plus PTO Waiting on Interconnection Approval,
      // Pending Truck Roll, Waiting on New Construction, Waiting On Information
    },
    inboxTeam: "ic",
    folderProperty: "pto___closeout_documents", folderLabel: "PTO Folder",
    domainPanel: "utility",
    // no taskSubjectsForStatus: PTO skips task completion in v1 (spec §5)
  },
};

export function groupForStatus(config: TeamConfig, status: string): GroupKey {
  for (const [group, statuses] of Object.entries(config.groups)) {
    if (statuses?.includes(status)) return group as GroupKey;
  }
  return "other";
}
```

- [ ] **Step 1.3: Write the config validation test** (`src/__tests__/pi-hub-config.test.ts`) — pins every configured status to the live fixture (the #1481 bug-class guard):

```ts
import { TEAM_CONFIGS, groupForStatus } from "@/lib/pi-hub/config";
import { LIVE_STATUS_OPTIONS } from "./fixtures/pi-status-options";

describe("TEAM_CONFIGS validity", () => {
  for (const config of Object.values(TEAM_CONFIGS)) {
    const live = LIVE_STATUS_OPTIONS[config.statusProperty].map((o) => o.value);
    it(`${config.key}: every configured status exists in HubSpot`, () => {
      const configured = [
        ...config.terminalStatuses,
        ...Object.values(config.groups).flat(),
        ...Object.keys(config.taskSubjectsForStatus ?? {}),
      ];
      for (const s of configured) expect(live).toContain(s);
    });
    it(`${config.key}: task-subject keys are dropdown-reachable (active, not hidden)`, () => {
      // Group lists may pin retired values (deals can be STUCK on them — read
      // path), but taskSubjectsForStatus keys are dropdown LANDING statuses:
      // an archived/hidden one could never be selected, making its entry dead.
      const active = LIVE_STATUS_OPTIONS[config.statusProperty]
        .filter((o) => !o.archived && !o.hidden)
        .map((o) => o.value);
      for (const s of Object.keys(config.taskSubjectsForStatus ?? {})) {
        expect(active).toContain(s);
      }
    });
    it(`${config.key}: no status is in two groups`, () => {
      const all = Object.values(config.groups).flat();
      expect(new Set(all).size).toBe(all.length);
    });
    it(`${config.key}: terminal statuses are not grouped`, () => {
      for (const t of config.terminalStatuses) expect(groupForStatus(config, t)).toBe("other");
    });
  }
  it("unknown statuses fall to 'other'", () => {
    expect(groupForStatus(TEAM_CONFIGS.permit, "Some Future Status")).toBe("other");
  });
});
```

- [ ] **Step 1.4: Run** `./node_modules/.bin/jest src/__tests__/pi-hub-config.test.ts` — expect PASS. If a status fails `toContain`, the fixture or the config is wrong — resolve against live HubSpot, never by loosening the test.
- [ ] **Step 1.5: Commit** — `feat(pi-hub): team configs + validation against live options`

### Task 2: `getActiveEnumOptions`

**Files:** Modify `src/lib/hubspot-enum-labels.ts`; test in `src/__tests__/pi-hub-status.test.ts` (start the file)

- [ ] **Step 2.1: Add to `hubspot-enum-labels.ts`** (below `getEnumLabelMap`; reuse `appCache` + `getDealPropertyDefinition` already imported there):

```ts
export interface EnumOption { value: string; label: string }

/**
 * ACTIVE options only, in HubSpot display order — the dropdown's option
 * source. Do NOT use getEnumLabelMap for a write path: it deliberately
 * merges ARCHIVED options (for labeling deals stuck on retired values),
 * and offering those for writing reintroduces the #1481 bug class.
 */
export async function getActiveEnumOptions(propertyName: string): Promise<EnumOption[]> {
  const key = `enum-active:${propertyName}`;
  const cached = appCache.get<EnumOption[]>(key);
  if (cached.hit && cached.data) return cached.data;
  const def = await getDealPropertyDefinition(propertyName);
  const options = (def?.options ?? [])
    .filter((o) => !(o as { archived?: boolean; hidden?: boolean }).archived && !(o as { hidden?: boolean }).hidden)
    .map((o) => ({ value: String(o.value ?? ""), label: String(o.label ?? o.value ?? "") }))
    .filter((o) => o.value);
  if (options.length) appCache.set(key, options, { ttl: 60 * 60 * 1000, staleTtl: 60 * 60 * 1000 });
  return options;
}
```

- [ ] **Step 2.2:** Check `HubSpotPropertyOption` in `src/lib/hubspot.ts` — if it already declares `archived`/`hidden`, drop the inline casts.
- [ ] **Step 2.3:** Typecheck; commit — `feat(pi-hub): active-only enum options for the write path`

### Task 3: `tasks.ts` — extract the task search

**Files:** Create `src/lib/pi-hub/tasks.ts`

`completePermitTask` (`src/lib/permit-hub.ts:641-727`) cannot be reused whole: it **throws** on search failure and **createDealNote's internally** (verified; see spec §5). Extract only the search/complete step, with soft-fail semantics:

- [ ] **Step 3.1: Write `tasks.ts`:**

```ts
import { FilterOperatorEnum } from "@/generated-or-sdk-path"; // copy the exact import used at permit-hub.ts top
import { hubspotClient } from "@/lib/hubspot";
import { updateTask } from "@/lib/hubspot-tasks";
import { withHubSpotRetry } from "@/lib/bulk-sync-confirmation";

/**
 * Best-effort: complete ONE open HubSpot task on the deal whose subject
 * matches any pattern. Unlike completePermitTask this NEVER throws — the
 * status PATCH is the source of truth (spec §5) and task hygiene is a
 * post-write courtesy. Returns a warning string on failure, null on
 * success-or-nothing-to-do.
 */
export async function completeMatchingTask(opts: {
  dealId: string;
  subjectPatterns: readonly string[];
  noteBody: string;
}): Promise<string | null> {
  try {
    const searchResult = await withHubSpotRetry(
      () =>
        hubspotClient.crm.objects.tasks.searchApi.doSearch({
          filterGroups: [{ filters: [
            { propertyName: "associations.deal", operator: FilterOperatorEnum.Eq, value: opts.dealId },
            { propertyName: "hs_task_status", operator: FilterOperatorEnum.Neq, value: "COMPLETED" },
          ] }],
          properties: ["hs_task_subject", "hs_task_status"],
          limit: 100,
        }),
      "pi-hub.completeMatchingTask.search",
    );
    if (!searchResult.ok) return `task search failed: ${searchResult.error}`;
    const match = (searchResult.data.results ?? []).find((t) => {
      const subject = String((t.properties as Record<string, string | null>)?.hs_task_subject ?? "").toLowerCase();
      return opts.subjectPatterns.some((p) => subject.includes(p.toLowerCase()));
    });
    if (!match) return null; // nothing open to complete — not a warning
    await updateTask(match.id, { status: "COMPLETED", body: opts.noteBody });
    return null;
  } catch (err) {
    return `task completion failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}
```

(Copy the `FilterOperatorEnum` import line verbatim from `permit-hub.ts:22` — it imports from `@hubspot/api-client/lib/codegen/crm/deals`, and permit-hub uses that same enum for its tasks search.)

- [ ] **Step 3.2: Unit-test the never-throws contract** (append to `src/__tests__/pi-hub-status.test.ts`, mocking hubspot/tasks modules): (a) search returns `ok:false` → returns a warning string, no throw; (b) no subject match → returns `null`, `updateTask` not called; (c) match → `updateTask` called with `COMPLETED`, returns `null`; bonus (d) `updateTask` throws → returns warning string.
- [ ] **Step 3.3:** Run tests; typecheck; commit — `feat(pi-hub): soft-fail task completion helper`

### Task 4: `status.ts` — setStatus

**Files:** Create `src/lib/pi-hub/status.ts`; tests in `src/__tests__/pi-hub-status.test.ts`

- [ ] **Step 4.1: Write the failing tests first.** Mock `@/lib/hubspot` (deal update), `./tasks`, `@/lib/hubspot-engagements` (`createDealNote`), `@/lib/db` (prisma.activityLog.create), `@/lib/hubspot-enum-labels` (`getActiveEnumOptions`). Cases:

```ts
// 1. rejects a value not in active options — no PATCH attempted
// 2. PATCH succeeds, no taskSubjectsForStatus entry (pto) → ok:true, warnings:[]  — task helper NOT called
// 3. PATCH succeeds, task helper returns warning → ok:true, warnings:["task completion failed…"]
// 4. PATCH succeeds, createDealNote throws → ok:true, warning; activityLog still attempted
// 5. PATCH itself rejects → throws (caller/route turns it into a 502); no note, no task call
```

- [ ] **Step 4.2: Run** — expect FAIL (module missing).
- [ ] **Step 4.3: Implement:**

```ts
import { hubspotClient } from "@/lib/hubspot";
import { getActiveEnumOptions } from "@/lib/hubspot-enum-labels";
import { createDealNote } from "@/lib/hubspot-engagements";
import { prisma } from "@/lib/db";
import { TEAM_CONFIGS } from "./config";
import { completeMatchingTask } from "./tasks";
import type { SetStatusResult, Team } from "./types";

export async function setStatus(opts: {
  team: Team;
  dealId: string;
  newValue: string;
  userEmail: string;
  userName?: string;
  userId: string | null;
}): Promise<SetStatusResult> {
  const config = TEAM_CONFIGS[opts.team];
  const options = await getActiveEnumOptions(config.statusProperty);
  const option = options.find((o) => o.value === opts.newValue);
  if (!option) throw new Error(`"${opts.newValue}" is not an active ${config.statusProperty} option`);

  // THE write. Everything after is courtesy and may only warn.
  await hubspotClient.crm.deals.basicApi.update(opts.dealId, {
    properties: { [config.statusProperty]: opts.newValue },
  });

  const warnings: string[] = [];
  // Deliberate deviation from spec §5's "X → Y" note: the old value isn't
  // fetched (saves a read; HubSpot property history already records it).
  const noteBody = `<b>Status set via P&I Hub</b><br>${config.label}: ${option.label}<br>By: ${opts.userEmail}`;

  const subjects = config.taskSubjectsForStatus?.[opts.newValue];
  if (subjects?.length) {
    const warn = await completeMatchingTask({ dealId: opts.dealId, subjectPatterns: subjects, noteBody });
    if (warn) warnings.push(warn);
  }
  try { await createDealNote(opts.dealId, noteBody); }
  catch (err) { warnings.push(`note failed: ${err instanceof Error ? err.message : String(err)}`); }
  try {
    await prisma?.activityLog.create({ data: {
      type: "HUBSPOT_DEAL_UPDATED", // the one generic existing ActivityType that fits — there is NO STATUS_CHANGED value; do NOT add enum values (that's a migration)
      description: `${config.label} status → ${option.label}`,
      userEmail: opts.userEmail, userName: opts.userName, userId: opts.userId ?? undefined,
      entityType: "deal", entityId: opts.dealId, metadata: { team: opts.team, value: opts.newValue } as never,
    } });
  } catch (err) { warnings.push(`activity log failed: ${err instanceof Error ? err.message : String(err)}`); }

  return { ok: true, warnings };
}
```

**Verified for you:** the enum (prisma/schema.prisma ~130-321) has only hub-action-specific values (`PERMIT_SUBMITTED`…`IC_APPROVED`) and the generic `HUBSPOT_DEAL_UPDATED` — use the latter. A wrong value here fails Prisma on every write and gets silently downgraded to a warning by the try/catch, so get it right, and make test case 4 assert the exact `type` sent.

- [ ] **Step 4.4: Run tests** — expect PASS.
- [ ] **Step 4.5: Commit** — `feat(pi-hub): setStatus write path — PATCH first, warnings after`

### Task 5: `queue.ts`

**Files:** Create `src/lib/pi-hub/queue.ts`

This is a **port** of `fetchPermitQueue` (`src/lib/permit-hub.ts` — the whole function, incl. cursor pagination and `MAX_QUEUE_PAGES`) with these parameter substitutions; diff your port against the original before committing:

- [ ] **Step 5.1: Port.** Signature `fetchQueue(team: Team): Promise<QueueItem[]>`. Substitutions:
  - `permitting_status` filters → `config.statusProperty` (`HasProperty` + `NotIn config.terminalStatuses`) — same 4-filter shape (pipeline IN `INCLUDED_PIPELINES`, dealstage NOT_IN `EXCLUDED_STAGES`).
  - properties array: shared list + `config.statusProperty` + `config.roleProperty` + the lead-name property (`permit_lead_name` / `interconnection_lead_name` — check what each existing queue fetches; PTO uses IC's).
  - `fetchStatusEnteredAt(deals, config.statusProperty)`; `getEnumLabelMap(config.statusProperty)`; `buildStageDisplayMap()` — all identical.
  - Set `group: groupForStatus(config, status)` on each item (grouping moves server-side; the UI stops re-deriving it).
  - Lead resolution: port `resolvePermitLeadName`/owner-map usage as-is, keyed on `config.roleProperty`.
- [ ] **Step 5.2:** Typecheck. Then **live-verify** with a scratch script: `fetchQueue("permit")` ≈ 79 items / groups ≈ {ready 4-ish, waiting 42-ish}; `fetchQueue("ic")` ≈ 163; `fetchQueue("pto")` ≈ 133 with `PTO Waiting on Interconnection Approval` (~44) in `other`. Print counts per group per team. Numbers drift daily — sanity-check shape, not exact values.
- [ ] **Step 5.3: Commit** — `feat(pi-hub): parameterized queue fetch`

### Task 6: `detail.ts`

**Files:** Create `src/lib/pi-hub/detail.ts` (defines and exports `ProjectDetail`)

Port of `fetchPermitProjectDetail` / `fetchIcProjectDetail` (they differ only in domain object + property names):

- [ ] **Step 6.1: Port**, `fetchDetail(team: Team, dealId: string)`. Per-team pieces:
  - Deal properties: shared set + `config.statusProperty` + `config.roleProperty` + `config.folderProperty` + correspondence identifiers (permit: `permit_number___pv|ess|elec|fire_protection|zoning___land_use` + AHJ props; ic/pto: `utility_application__`).
  - Domain records: `domainPanel === "ahj"` → `fetchAHJsForDeal` + the name/city fallback chain (port from permit-hub verbatim); else `fetchUtilitiesForDeal`.
  - Correspondence: `getSharedInboxAddress(config.inboxTeam, region)` + `buildGmailThreadQuery({ address, projectNumber, identifiers })` — port from the current implementations (post-#1466: **no ahjEmail in the query**).
  - `folderUrl: props[config.folderProperty] ?? null` + `folderLabel: config.folderLabel` on the result.
  - Status history: port `fetchPermitStatusHistory` with `config.statusProperty`.
  - Status label: `labelFor(await getEnumLabelMap(config.statusProperty), status)`.
- [ ] **Step 6.2:** Typecheck; live-verify one deal per team prints a coherent detail (pick dealIds from Step 5.2 output). Commit — `feat(pi-hub): parameterized detail fetch`

## Chunk 2: API routes + access

### Task 7: Routes

**Files:** Create the four route files. Model auth/flag shape on `src/app/api/permit-hub/queue/route.ts` and `.../actions/mark-permit-issued/route.ts` (requireApiAuth → role check → flag check → work). Shared bits:

```ts
const PI_HUB_ROLES = ["ADMIN", "EXECUTIVE", "PERMIT", "INTERCONNECT", "TECH_OPS"]; // spec §8 — union of PERMIT_HUB_ROLES/IC_HUB_ROLES; put in src/lib/pi-hub/access.ts with isPiHubEnabled() reading PI_HUB_ENABLED
function parseTeam(v: string | null): Team | null { return v === "permit" || v === "ic" || v === "pto" ? v : null; }
```

- [ ] **Step 7.1:** `queue/route.ts` — GET `?team=`; 400 on bad team; returns `{ queue, lastUpdated }`.
- [ ] **Step 7.2:** `project/[dealId]/route.ts` — GET `?team=`; 404 when `fetchDetail` returns null.
- [ ] **Step 7.3:** `options/route.ts` — GET `?team=` → `{ options: await getActiveEnumOptions(config.statusProperty) }`.
- [ ] **Step 7.4:** `status/route.ts` — POST zod `{ team, dealId, status }`; `resolveUserIdByEmail` (import from permit-hub — it's exported) for the userId; on `setStatus` throw → 502 with message; else `{ ok, warnings }`.
- [ ] **Step 7.4b:** `today-count/route.ts` — model on `/api/permit-hub/today-count` but count today's `ActivityLog` rows where `type = HUBSPOT_DEAL_UPDATED` and `metadata.team` is set (i.e. pi-hub setStatus writes) for the current user. Feeds SessionHeader's "Touched today" across all three teams.
- [ ] **Step 7.5:** Add `piHub` keys to `src/lib/query-keys.ts` (mirror `permitHub`'s factory: `queue(team)`, `project(team, dealId)`, `options(team)`, `todayCount()` — the dropdown mutation must invalidate `todayCount()` too or "Touched today" never increments after a status set).
- [ ] **Step 7.6:** Typecheck; commit — `feat(pi-hub): api routes`

### Task 8: Access + flags

**Files:** Modify `src/lib/roles.ts`, `.env.example`

- [ ] **Step 8.1:** In `roles.ts`, add `"/dashboards/pi-hub"` + `"/api/pi-hub"` to the roles with explicit hub entries: **TECH_OPS** (has both hubs, ~822-825), **PERMIT** (permit-hub only, ~1034), **INTERCONNECT** (ic-hub only, ~1111) — for PERMIT/INTERCONNECT this also grants the unified page (their switcher hides teams they can't use). **ADMIN and EXECUTIVE need nothing** — they have `allowedRoutes: ["*"]`. **Do not remove any old entries** (spec §9 — redirects still pass middleware).
- [ ] **Step 8.2:** `.env.example`: `PI_HUB_ENABLED=false`, `NEXT_PUBLIC_PI_HUB_ENABLED=false` with a comment noting NEXT_PUBLIC_* is build-time inlined (set in Vercel before the enabling deploy).
- [ ] **Step 8.3:** Typecheck; commit — `feat(pi-hub): route allowlist + flags`

## Chunk 3: UI

### Task 9: Panels

**Files:** Create `src/app/dashboards/pi-hub/panels/*` — ports of `src/app/dashboards/permit-hub/tabs/*` + `ic-hub/tabs/UtilityTab.tsx`

- [ ] **Step 9.1:** Copy each tab component to `panels/` (rename Tab→Panel). `OverviewPanel` takes the unified `ProjectDetail`. Keep `CollapsibleSection` composition OUT of panels — `ProjectDetail.tsx` owns layout (as today post-#1482).
- [ ] **Step 9.2:** **UtilityPanel cleanup** (spec §6): delete the `interconnection_turnaround_time`, `pto_turnaround_time`, and `interconnection_issues` renders (never populate — not on the object / not fetched); change `submission_method` → `submission_type` (the fetch list has `submission_type`; the render was a typo).
- [ ] **Step 9.3:** `AhjPanel` keeps `formatMsAsDays`/`formatAverage` from #1483 — port them along.
- [ ] **Step 9.4:** Typecheck; commit — `feat(pi-hub): detail panels (utility dead-field cleanup)`

### Task 10: StatusDropdown

**Files:** Create `src/app/dashboards/pi-hub/StatusDropdown.tsx`; test `src/__tests__/pi-hub-dropdown.test.tsx`

- [ ] **Step 10.1: Failing tests:** renders current status **label**; options come from `/api/pi-hub/options` (mock fetch); selecting a non-terminal option POSTs `{team, dealId, status: VALUE}` (assert the VALUE, not the label, is sent); selecting a **terminal** option shows a confirm step first (use `ConfirmDialog` from `src/components/ui/ConfirmDialog.tsx`); a warnings response surfaces a toast/inline warning but not an error.
- [ ] **Step 10.2:** Implement — a `<select>`-styled listbox (follow `MultiSelectFilter`'s visual idiom, single-select) + React Query `useMutation` with optimistic update of the detail cache and invalidation of `queryKeys.piHub.queue(team)` on success. Terminal detection via a `terminalStatuses` prop passed from config through the detail/queue responses. Two render modes: default (detail header) and **`compact`** (queue row: small "Set status ▾" trigger, dropdown `align="right"`-style anchored so it cannot overflow the 420px queue column — the exact failure mode fixed in #1479). Same options fetch (`queryKeys.piHub.options(team)`, shared cache) and same mutation for both; the mutation invalidates `queue(team)`, the detail key, **and `todayCount()`**.
- [ ] **Step 10.3:** Run tests — PASS; commit — `feat(pi-hub): status dropdown`

### Task 11: Queue + ProjectDetail

**Files:** Create `Queue.tsx`, `ProjectDetail.tsx`; test `src/__tests__/pi-hub-queue-ui.test.tsx`

- [ ] **Step 11.1:** `Queue.tsx` — port `PermitQueue.tsx` (post-#1478: `flex-wrap` tab strip, tight paddings, `min-w-0`); delete the local `groupForActionKind` — rows carry `group` from the server. Accent classes come from `config.accent` via a small map (blue/green/yellow variants for active tab, selected row). Tabs = `GROUP_ORDER` with count badges; search matches name/address/lead/status **label**/value/dealStage (as today). **The old `actionLabel` slot in the row becomes the compact `StatusDropdown`** (spec §5: the row's primary affordance) — `QueueItem` has no `actionLabel`; the dropdown is the action.
- [ ] **Step 11.2:** `ProjectDetail.tsx` — port the #1482 two-column `CollapsibleSection` layout; header gets `StatusDropdown` (replacing the status pill), links: HubSpot, portal (AHJ portal / Utility portal per `domainPanel`), application, **`detail.folderUrl` with `detail.folderLabel`**, design folder, project drive. Folder links are full Drive URLs rendered as plain `href`s — same as today's `ExternalLinkButton`s; `extractFolderId` is only for Drive-API use, not links. Domain section renders `AhjPanel` or `UtilityPanel` per `config.domainPanel`. **No ActionPanel, no forms** (spec §3).
- [ ] **Step 11.3:** Port the queue component tests (`permit-queue-tabs.test.tsx` is the template — tab counts, switching, empty state, label display, stage display) against `Queue.tsx` with fixture `QueueItem`s (groups precomputed). Add: the row renders the compact dropdown; and a small detail-header test asserting `folderLabel`/`folderUrl` render per team (spec §10's "folder link selection").
- [ ] **Step 11.4:** Run; typecheck; commit — `feat(pi-hub): queue + detail components`

### Task 12: Page + switcher

**Files:** Create `page.tsx`, `PiHubClient.tsx`

- [ ] **Step 12.1:** `page.tsx` — model on `src/app/dashboards/permit-hub/page.tsx` (auth, role gate vs PI_HUB_ROLES, `isPiHubEnabled()` → `notFound()`, `export const dynamic = "force-dynamic"` — flag-read pages must be dynamic or they prerender 404).
- [ ] **Step 12.2:** `PiHubClient.tsx` — port `PermitHubClient.tsx` shell, including `SessionHeader` **rewired to `/api/pi-hub/today-count`** (Step 7.4b) — do not leave it pointed at the permit-only `/api/permit-hub/today-count`, which is flag/role-gated to the old hub and counts only permit actions. Team state: `useSearchParams()` `?team=` (default `permit`, validated), switcher writes it via `router.replace` so it's linkable. Switcher = three buttons **above** the queue's group tabs, accented per team, hiding teams the user's roles can't access (pass allowed teams from the server page: PERMIT-only → permit; INTERCONNECT → ic+pto; ADMIN/EXECUTIVE/TECH_OPS → all).
  Data: `useQuery(queryKeys.piHub.queue(team))` + `useSSE` cache invalidation (port the pattern; keep `keepPreviousData` semantics so switching teams doesn't flash empty — house UI standard).
- [ ] **Step 12.3:** Typecheck; run full hub test suite (`jest src/__tests__/pi-hub-*`); commit — `feat(pi-hub): page, client shell, team switcher`

## Chunk 4: Verification + rollout

### Task 13: Live verification (flags still off in prod; run locally)

- [ ] **Step 13.1:** Scratch-script `fetchQueue` × 3 teams + `fetchDetail` on one deal per team: group counts sane, statusLabels resolve (0 raw values), folder URL present where the property is set, correspondence threads project-scoped.
- [ ] **Step 13.2:** `setStatus` **live dry-run on ONE test deal chosen by Zach** — ask him for a safe dealId; set a non-terminal status one step (e.g. re-set its current value is NOT a valid test — pick an adjacent real transition he approves), verify in HubSpot UI: property changed, note created, no task falsely completed. **Do not test terminal statuses live.**
- [ ] **Step 13.3:** `npm run build` (or `preflight`) passes.
- [ ] **Step 13.4:** Commit any fixes; push branch; open PR titled `feat(pi-hub): unified P&I hub behind flags`.

### Task 14: Enable + redirects (separate PR, after Zach eyeballs the dark launch)

- [ ] **Step 14.1:** Set `PI_HUB_ENABLED` + `NEXT_PUBLIC_PI_HUB_ENABLED` in Vercel prod (printf, not echo), **then** deploy.
- [ ] **Step 14.2:** Verify all three teams render in prod (screenshot each; check queue counts vs live script).
- [ ] **Step 14.3:** Redirect PR: `permit-hub/page.tsx` / `ic-hub/page.tsx` → `redirect("/dashboards/pi-hub?team=permit"|"?team=ic")` when `isPiHubEnabled()`, else render as today. Update `suite-nav.ts` / suites page cards to point at `/dashboards/pi-hub` (keep old `allowedRoutes`).
- [ ] **Step 14.4:** Post-bake cleanup (NOT this plan): delete old pages/libs/action routes.

---

**Out of scope for this plan** (tracked in spec): approval-signal detection; per-status stale thresholds; deleting `permit-hub.ts`/`ic-hub.ts`/action routes/`PermitHubDraft`.
