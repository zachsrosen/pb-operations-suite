# Unified P&I Hub (Permit · Interconnection · PTO) — Design Spec

**Date:** 2026-07-17
**Status:** Draft for review
**Author:** Zach Rosen (with Claude)

**Grounding (measured live this session):**
- Permit queue: **79 deals** (Ready 4 / Rejections 0 / Resubmit 1 / Waiting 42 / Other 32).
- IC queue: **163 deals** (Ready 27 / Resubmit 15 / Waiting 62 / Other 59).
- PTO (no hub exists): **19 `pto_status` options, 311 deals in scope, 133 non-terminal** — largest bucket is `PTO Waiting on Interconnection Approval` (**44 deals**), i.e. blocked on the IC step.
- IC and PTO share a role property: both use `interconnections_tech`. Permit uses `permit_tech`. Two of the three "teams" are the same person's job.
- `permit-hub.ts` (802 lines) and `ic-hub.ts` (725) are structurally identical, export-for-export (`resolveUserIdByEmail` is byte-identical). `permit-hub.ts:6-7` deferred "extraction to shared primitives … until IC Hub (second consumer)"; IC shipped as a copy instead. PTO must not be a third.
- Usage reality: **zero hub actions ever completed** (0 `PermitHubDraft` rows all-time); 204 of 209 page visits are Zach. The hubs are being handed to their first real user now — this redesign is the setup for that, not a migration of active users.

---

## 1. Problem

Three sequential stages of the same pipeline — permit → interconnection → PTO — live in two separate, near-duplicate hubs, and the third stage has no surface at all. The person who works IC also works PTO, and 44 PTO deals are blocked on an IC step they'd see in a different hub. Meanwhile the primary interaction the team actually needs — *set the status* — doesn't exist: the hubs expose 16 bespoke action routes (9 permit + 7 IC, never used, two of which wrote invalid values until #1481), while a plain status change requires leaving for HubSpot.

## 2. Goals

- **One page** at `/dashboards/pi-hub`: a **team switcher (Permit / Interconnection / PTO) above the action tabs**, one queue+detail layout, one codebase.
- **One engine, three configs.** A team is data — status property, role property, statuses→tab mapping, inbox routing, folder links, domain panel — not a copy of 600 lines.
- **Status dropdown as the primary interaction.** Editing `permitting_status` / `interconnection_status` / `pto_status` from the hub, from the option list with **labels** shown and **values** written.
- PTO exists for the first time, for free, as the third config.
- Per-team folder links: Permit → `permit_documents`, IC/PTO → `interconnection_documents`.

## 3. Non-goals (YAGNI)

- **No new action forms.** The dropdown replaces them. Permit number lives on the deal already (`permit_number___*`); issue/approval dates are stamped by HubSpot workflows on status change. The existing form routes stay in the repo but the unified hub does not render them (same treatment as the follow-up form in #1482).
- **No blended cross-team queue view.** Switcher shows one team at a time. (A "my work across teams" view is a later idea, not v1.)
- No changes to the Daily Focus email or its config lists.
- No approval-signal detection in v1 (separate spec, already drafted; it plugs into this surface later).
- No PTO-specific inbox scanning beyond reusing the IC inboxes (`interconnections@` / `interconnectca@`), which is where utility/PTO mail lands.
- Old routes are not deleted in v1 — they redirect (§9).

## 4. Architecture

```
src/lib/pi-hub/
  config.ts        TEAM_CONFIGS: Record<"permit"|"ic"|"pto", TeamConfig>  (pure data)
  queue.ts         fetchQueue(team)      — one implementation, parameterized
  detail.ts        fetchDetail(team, dealId)
  status.ts        setStatus(team, dealId, newValue)  — the dropdown's write path
  types.ts

src/app/dashboards/pi-hub/
  page.tsx         flag + role gate, ?team= param
  PiHubClient.tsx  team switcher ▸ SessionHeader ▸ Queue | Detail
  Queue.tsx        one queue component (today's PermitQueue, parameterized)
  ProjectDetail.tsx  one detail component (the #1482 unified layout, parameterized)

src/app/api/pi-hub/
  queue/route.ts       ?team=
  project/[dealId]/route.ts
  status/route.ts      POST { team, dealId, status } — the only write route
```

### TeamConfig (the whole point)

```ts
interface TeamConfig {
  key: "permit" | "ic" | "pto";
  label: string;                      // switcher label
  accent: "blue" | "green" | "yellow"; // yellow = PI_QUERY_DEFS pto headerColor
  statusProperty: string;             // permitting_status | interconnection_status | pto_status
  roleProperty: string;               // permit_tech | interconnections_tech | interconnections_tech
  leadLabel: string;                  // "Permit Lead" | "IC Lead" | "IC Lead"
  terminalStatuses: string[];         // excluded from the queue (values, not labels)
  groupForStatus: (status: string) => "ready" | "rejections" | "resubmit" | "waiting" | "other";
  inboxTeam: "permit" | "ic";         // getSharedInboxAddress routing; pto → "ic"
  folderProperty: string;             // permit_documents | interconnection_documents | interconnection_documents
  folderLabel: string;                // "Permit Folder" | "Interconnection Folder"
  domainPanel: "ahj" | "utility";     // which custom-object section the detail shows
  portalLinkSource: "ahj" | "utility";
  /** NEW status value → open-task subject substrings to complete on arrival.
   *  Derived from PERMIT_ACTION_TASK_SUBJECTS / IC_ACTION_TASK_SUBJECTS
   *  (re-keyed from action kind to the status the action lands on). The
   *  re-key is many-to-one, not 1:1: collisions merge subject lists (e.g.
   *  RESUBMIT_TO_UTILITY and PROVIDE_INFORMATION both land on "Resubmitted
   *  To Utility" — union both), and FOLLOW_UP writes no status, so its
   *  subjects drop out. Statuses with no entry — all of PTO in v1 — skip
   *  task completion. */
  taskSubjectsForStatus?: Record<string, readonly string[]>;
}
```

Note `interconnection_documents` is referenced nowhere in code today (verified live: it exists and holds Drive folder URLs on 2,139 IC-status deals) — today's IC hub links `permit_documents`, so the per-team folder is a new fetch, not a rewire.

Everything else — pagination, `statusEnteredAt`/stale, label resolution, correspondence matching (`buildGmailThreadQuery` with address + PROJ# + app#/permit#s), owner/stage resolution — is engine code written once. All of it already exists in the two hubs; this is consolidation, not invention. The `PermitHubDraft` table is **not** carried over: it stored action-form drafts, and with no forms rendered there is nothing to draft.

### Grouping moves from action-kinds to config

Today: status → action kind (`pi-statuses.ts`) → group (duplicated switch in each Queue component). The action-kind layer existed to route to action forms; with forms gone, its only remaining consumers are the task-subject maps (folded into `taskSubjectsForStatus` above) and the Daily Focus email / other dashboards, which keep reading `pi-statuses.ts` untouched. The hub itself maps status → group directly in config via `groupForStatus`.

**PTO grouping (v1):**
- **ready**: Inspection Passed - Ready for Utility, Xcel Photos Ready to Submit
- **rejections**: Inspection Rejected By Utility, Ops Related PTO Rejection, XCEL Photos Rejected
- **resubmit**: Ready to Resubmit, Xcel Photos Ready to Resubmit
- **waiting**: Inspection Submitted to Utility, Resubmitted to Utility, Xcel Photos Submitted, Xcel Photos Resubmitted
- **other**: everything else non-terminal (incl. PTO Waiting on Interconnection Approval — blocked upstream, not actionable)
- **terminal** (excluded): `PTO` (labelled "PTO Granted"), `Not Needed`

## 5. The status dropdown

Replaces the action-form system as the write path.

- **Options: active options only, in HubSpot display order.** A new `getActiveEnumOptions(property)` fetches the property definition and returns non-archived options as `{value, label}[]`. `getEnumLabelMap` (which deliberately merges **archived** options) is used only for *labeling* deals stuck on retired values — it must not feed the dropdown, or users could write retired statuses, reintroducing the #1481 bug class this design exists to kill. Labels render; values write; no hardcoded option lists anywhere.
- **The PATCH is the source of truth.** `setStatus(team, dealId, newValue)` PATCHes the deal property first. Everything after — task completion, note, activity log — is caught and surfaced as a non-blocking warning, never a failure: `completePermitTask` deliberately **throws** on task-search failure, so `setStatus` extracts only its task-search/complete step into a shared helper rather than calling the whole function (which would also double-write the note it creates internally). If a follow-up step fails after the PATCH succeeded, the UI reports "status changed; task cleanup failed" — it must never report failure for a write that landed, or roll back optimistic state to a lie.
- **Task completion is config-scoped**: after a successful PATCH, if `taskSubjectsForStatus[newValue]` exists, best-effort complete one matching open HubSpot task (keeps workflow task hygiene when a task exists; skips silently when none does). All PTO statuses skip in v1 — PTO has no task-subject conventions to match against.
- **Note + activity**: `createDealNote` ("Status: X → Y, by Zach via P&I Hub") and an `ActivityLog` row, both post-PATCH, both non-blocking.
- Dates (permit_issued, approval dates) are stamped by existing HubSpot workflows triggered by the status change — the hub does not write dates.
- **Optimistic UI** keyed off the PATCH only, rollback if the PATCH itself fails; queue refetch on success (the deal may leave the current tab or queue — correct and visible).
- **Confirm step only when the new status is terminal** for the team ("This marks the permit issued — the deal leaves this queue"), since those feed PE payments/close-out.
- Placement: in the detail header (replacing the status pill) and as the row's primary affordance in the queue's action column.

## 6. Detail view

The #1482 unified layout, parameterized:

- Left: Overview · **domain panel** (AHJ for permit; Utility for ic/pto) · Planset
- Right: Correspondence (badge, prime slot) · Status History · Activity (collapsed)
- Header links: HubSpot · portal · application · **`folderProperty` link** (Permit Folder / Interconnection Folder) · design folder · project drive. Folder fields are Drive URLs — run through `extractFolderId()` handling like existing folder links.
- PTO's domain panel is the Utility panel (same associated custom object). Known cleanup folded in: today's `UtilityTab` renders **four** fields that can never populate — `interconnection_turnaround_time` and `pto_turnaround_time` (don't exist on the Utility object), the `interconnection_issues` block (not in `UTILITY_PROPERTIES`), and `submission_method` (the fetch list has `submission_type`; a typo'd property name — fix the name, keep the field). Drop the three dead ones, repair the fourth.

## 7. Days-in-status & stale

Engine-level, already solved: `fetchStatusEnteredAt(deals, statusProperty)` works for any property with history — `pto_status` included (verify history is enabled on it during build; if HubSpot doesn't retain history for it, days show "—" honestly rather than a fake 0). Stale threshold stays global (14d) in v1; per-status thresholds remain a listed improvement, not scope.

## 8. Access & flags

- Roles: union of today's hub role lists — `ADMIN`, `EXECUTIVE`, `PERMIT`, `INTERCONNECT`, `TECH_OPS` (per `PERMIT_HUB_ROLES` / `IC_HUB_ROLES` in code; note neither includes PM). PTO uses IC's set. Route added to each of those roles' `allowedRoutes` (silent-403 trap) and gated by `PI_HUB_ENABLED` + `NEXT_PUBLIC_PI_HUB_ENABLED`.
- Switcher hides teams the user's role can't access (e.g. a `PERMIT`-only user sees only Permit).

## 9. Migration & rollout

1. Build `/dashboards/pi-hub` behind flags; old hubs untouched. Set `NEXT_PUBLIC_PI_HUB_ENABLED` in Vercel **before** the enabling deploy — `NEXT_PUBLIC_*` flags are build-time inlined (the suite page reads them as module-level consts), so flipping the var after deploy does nothing until the next build.
2. Verify live (all three teams' queues + dropdown writes against a test deal), then enable.
3. `/dashboards/permit-hub` → redirect `/dashboards/pi-hub?team=permit`; `/dashboards/ic-hub` → `?team=ic`. The old routes **stay in every role's `allowedRoutes` during the redirect period** — a redirect page still passes middleware first, and dropping them early is this repo's classic silent-403. Old page code and `permit-hub.ts`/`ic-hub.ts` libs are deleted only after the redirects have baked; the old API action routes stay until then.
4. Suite cards/nav updated to the single hub.

Timing note: there are no habituated users to migrate (see grounding) — this is the setup for first real use, which is why replacing rather than preserving the action-form system is low-risk *now* and would not be later.

## 10. Testing

- Engine unit tests parameterized across all three configs (queue grouping, terminal exclusion, label display, folder link selection) — the existing 30+ hub tests are the template and largely port over.
- `setStatus` tests: writes the **value**, completes a matching task when present, never throws when absent, note+activity recorded (mocked Prisma/HubSpot).
- Config validation test: every status in every `groupForStatus` map and `terminalStatuses` list must exist in the live-fetched option list fixture — pinning against the #1481 class.
- Live verification before enabling flags, per team, from real queue data (the house style all session). Two specific checks at build start: (a) `pto_status` has property history enabled (days-in-status depends on it); (b) **no HubSpot workflow writes a status on task completion** — today's flow completes the task and lets workflows move the status, so if any workflow still does that, the post-PATCH task-complete step could stomp the user's chosen value with the workflow's.

## 11. Open questions

- PTO stale thresholds — utility PTO waits are long; 14d may flag half the queue. Accept for v1?
- Should `Xcel Photos Approved` (8 deals) be "waiting" (it precedes PTO grant) instead of "other"?
- Is `Conditional PTO - Pending Transformer Upgrade` (3 deals) semi-terminal? It lands in "other" via the catch-all in v1.
- Does `pto_status` have property history enabled (needed for days-in-status)? Verify at build start.
