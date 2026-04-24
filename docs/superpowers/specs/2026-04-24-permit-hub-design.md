# Permit Hub — Design

**Date:** 2026-04-24
**Status:** Draft
**Author:** Zach Rosen + Claude

## Problem

The permitting team (2 people — one in Colorado, one in California) works open permit action items out of `pi-permit-action-queue`, which is a sortable list. It tells them *what* to do ("Submit to AHJ", "Revise & resubmit", "Follow up with AHJ") but not *how* — the actual work is tab-switching across HubSpot, Gmail, Google Drive (stamped plansets), the AHJ's portal, SolarApp+, and the HubSpot AHJ custom object. There is no single place where a permit lead can see "here's this project, here's the AHJ, here's the planset, here's the correspondence, here's the action I should take" and take that action.

This project builds the **Permit Hub** — a two-pane workspace that aggregates all the context needed to work a permit action item on one screen, and whose actions slot into the existing HubSpot task-based automation instead of duplicating or bypassing it.

The hub is also the first concrete consumer of a reusable "workspace hub" pattern, following the IDR Meeting Hub's success. After Permit Hub ships and stabilizes, the same shape is extracted into shared primitives and cloned into an Interconnection Hub and a Design Hub.

## Goals

- One workspace page (`/dashboards/permit-hub`) with a persistent queue pane and a per-project detail pane.
- Permit lead can sit down, pick a project from the queue, see every piece of context they'd otherwise tab-switch to find, and complete the appropriate action in the same UI.
- Action writeback completes existing HubSpot tasks — preserving the workflow automation that currently drives permit status transitions.
- Solo-use only for v1 (no presence, no multi-user sessions). Pilot with Peter Zaun on the Colorado queue behind a feature flag.
- Structurally similar to IDR hub, so after this ships, the shared primitives can be extracted to support IC and Design hubs with minimal re-design.

## Non-goals (v1)

- No multi-user sessions, presence, or live sync (solo only; IDR's presence model is intentionally deferred).
- No SolarApp+ integration — link-out only.
- No Gmail read integration or AI email summarization — Correspondence tab is a Gmail deep-link search (AI summary is a flagged v2 opportunity, not v1 scope).
- No Drive content reading — planset tab is a deep-link to the project's Drive folder, same pattern as the BOM flow.
- No absorption of `pi-permit-revisions` — that page stays separate; Hub handles "ball in our court" action items only.
- No mobile / tablet layout. Desktop only.
- No editing of the AHJ HubSpot custom object — read-only surface.
- No permit expiration tracking, no predicted review-time forecasting, no portal auto-submit.
- No extraction into `workspace-hub/` shared primitives until IC Hub begins — avoid premature abstraction.

## User decisions captured during brainstorming

| Question | Decision |
|----------|----------|
| Flexibility | **C** — Pattern supports both solo and meeting modes across the three future hubs |
| Desired outcome | **A+B+C** — Build framework via first consumer, score candidates, deep-design winner |
| What the team loves about IDR | **B + E** — aggregated-context-on-one-screen + clean writeback to systems of record |
| Team with most pain | Design, Permitting, Interconnection — all work the same deal at different stages |
| Framing for three hubs | **B** — Three separate hubs sharing a framework (extracted after v1) |
| First hub to build | **A** — Permit Hub (highest raw tab-switching pain, tractable writeback, template for IC) |
| v1 approach | **B** — Full two-pane hub (not thin side-panel, not single-item focus) |
| Extraction strategy | Build Permit Hub standalone; extract shared primitives when IC Hub begins |
| Revisions page | **Keep separate** — Hub is for action items, not revision tracking |
| Pilot user | Peter Zaun (Colorado permit lead) |
| Default queue view | All permits company-wide with filter chips (not "mine only") |
| Writeback pattern | Complete the HubSpot task that triggers the existing workflow; do not write status fields directly |
| Correspondence approach | Gmail deep-link search in v1; AI summarization is v2 |
| Mobile | Not supported — desktop only |

## Architecture

### Route & shell

```
/dashboards/permit-hub  →  src/app/dashboards/permit-hub/page.tsx
  └─ <DashboardShell title="Permit Hub" accentColor="blue" fullWidth>
      └─ <PermitHubClient>
          ├─ <SessionHeader>      (today counter + draft indicator + filters summary)
          ├─ <PermitQueue>        (left pane — filterable, sortable queue)
          └─ <ProjectDetail>      (right pane — tabbed context + action)
              ├─ <OverviewTab>
              ├─ <AhjTab>
              ├─ <PlansetTab>
              ├─ <CorrespondenceTab>
              ├─ <StatusHistoryTab>
              ├─ <ActivityTab>
              └─ <ActionPanel>    (status-aware action form, persistent at bottom)
```

Wrapped in the existing `DashboardShell`, full-bleed, accent blue (distinct from IDR's orange and BI's purple). Uses the same two-pane internal layout as IDR but with slimmer session chrome since there's no live meeting.

### Component file layout

```
src/app/dashboards/permit-hub/
  page.tsx
  PermitHubClient.tsx
  SessionHeader.tsx
  PermitQueue.tsx
  ProjectDetail.tsx
  tabs/
    OverviewTab.tsx
    AhjTab.tsx
    PlansetTab.tsx
    CorrespondenceTab.tsx
    StatusHistoryTab.tsx
    ActivityTab.tsx
  actions/
    ActionPanel.tsx               (router — selects form based on permitting_status)
    SubmitToAhjForm.tsx
    ResubmitToAhjForm.tsx
    ReviewRejectionForm.tsx
    FollowUpForm.tsx
    CompleteRevisionForm.tsx
    StartAsBuiltRevisionForm.tsx
    CompleteAsBuiltForm.tsx
    SubmitSolarAppForm.tsx
    MarkPermitIssuedForm.tsx
```

Naming/structure deliberately mirrors `src/app/dashboards/idr-meeting/` — when IC Hub begins, extraction into `src/components/workspace-hub/` + `src/lib/workspace-hub/` is a mechanical move.

### Data sources

| Tab / Action | Read from | Write to |
|---|---|---|
| Queue | HubSpot deal search filtered by `permitting_status IN PERMIT_ACTION_STATUSES` (existing `pi-permit-action-queue` data fetcher) | — |
| Overview tab | HubSpot deal properties, `HubSpotProjectCache` | — |
| AHJ tab | `fetchAHJsForDeal(dealId)` from `hubspot-custom-objects.ts` — portal_link, application_link, submission_method, permit_turnaround_time, stamping_requirements, permit_issues, primary_contact_name, email, phone_number, plus aggregate stats (permit_issued_count, permit_rejection_count, average_permit_revision_count) | — |
| Planset tab | Google Drive folder URL derived from deal properties (`find-design-plans` skill pattern) | — |
| Correspondence tab | Gmail deep-link URL: `https://mail.google.com/mail/u/0/#search/from:<ahj_email>+OR+to:<ahj_email>+<address>` | — |
| Status history tab | HubSpot deal property history API for `permitting_status`, `permit_submit`, `permit_issued` | — |
| Activity tab | HubSpot engagements (notes + tasks) on the deal, filtered to permit-related subject/body | — |
| Action forms | Form state saved to `PermitHubDraft` (crash recovery) | (1) HubSpot task completion via `/api/permit-hub/complete-task`, (2) new HubSpot note with captured context, (3) `ActivityLog` entry |

### Writeback model

Peter confirmed the existing permit workflow: submissions and revision routes are driven by **completing named HubSpot tasks**, which fire HubSpot Workflows that cascade the status changes. The Hub preserves this by:

1. For each action form, the Hub looks up the open task on the deal whose subject matches the action (e.g., "Submit to AHJ", "Resubmit to AHJ").
2. When Peter submits the form, the Hub calls HubSpot to (a) complete that task with a body note containing the captured details (submission date, method, reference #, free-text notes), (b) create a timeline note on the deal with the same content.
3. If no matching open task exists (edge case — deal state is inconsistent), the Hub surfaces a warning and offers a "write status field directly" escape hatch that requires explicit user confirmation. This is defensive — expected path is task completion.
4. Every action additionally writes an `ActivityLog` entry with the new permit activity types (see Data model below) for the "today touched" counter and audit trail.

This means the Hub does not duplicate the HubSpot Workflow — status transitions continue to happen server-side via the Workflow fired by task completion.

### Action form routing

The `ActionPanel` selects which form to render based on the deal's current `permitting_status`, using the existing `PERMIT_ACTION_STATUSES` map in `lib/pi-statuses.ts`. One form is shown at a time. The form captures structured data:

| Status → Form | Captures |
|---|---|
| Ready For Permitting / Customer Signature Acquired → **SubmitToAhjForm** | submission date, method (portal / paper / SolarApp+), reference #, permit fee paid?, notes |
| Rejected / Non-Design Related Rejection → **ReviewRejectionForm** | rejection date, category (design / non-design / paperwork), rejection reason (free-text), chosen next route (create design revision task / non-design fix task / paperwork fix task) |
| In Design For Revision → **CompleteRevisionForm** | revision complete checkbox, updated planset link (optional), notes |
| Returned from Design / Resubmitted to AHJ → **ResubmitToAhjForm** | resubmission date, reference #, what changed, notes |
| As-Built Revision Needed → **StartAsBuiltRevisionForm** | revision trigger (AHJ-requested / QC-caught), revision scope notes |
| As-Built Revision In Progress → **CompleteAsBuiltForm** | completion date, updated planset link, notes |
| As-Built Ready To Resubmit → **ResubmitToAhjForm** (reused) | as-built mode flag set |
| Pending SolarApp / Submit SolarApp to AHJ → **SubmitSolarAppForm** | SolarApp project #, submission date, notes |
| Resubmitted to AHJ / Submitted to AHJ → **FollowUpForm** | contact date, contact method (phone / email / portal), what was said, next follow-up date |
| (deal enters "Permit Issued" status) → **MarkPermitIssuedForm** | issue date, permit #, expiration date, issued permit PDF link (Drive) |

All forms share a `<FormShell>` wrapper that handles draft auto-save (debounced to `PermitHubDraft`), submit state, and error surfacing.

### Session model

- **No presence, no multi-user sync.** Solo-only workflow.
- **"Touched today" counter** in `SessionHeader` — queries `ActivityLog` for today's permit hub entries by the current user and shows a count with hover to expand.
- **Draft recovery** — when any action form is partially filled, its state is debounced-saved to `PermitHubDraft` (keyed by userId + dealId + actionKind). On page load, if a draft exists for a newly-selected deal, surface a toast: "You have an unsynced draft for this project — resume?"
- **No commit-at-end batching.** Each action submits immediately. This matches solo mode — no reason to batch.
- **No refresh-project button** — page uses the same SSE stream the other dashboards use, so status changes appear automatically when HubSpot Workflows fire.

## Data model

### New table

```prisma
model PermitHubDraft {
  id         String   @id @default(cuid())
  userId     String
  dealId     String
  actionKind String   // e.g. "SUBMIT_TO_AHJ", "REVIEW_REJECTION"
  payload    Json     // the partially-filled form state
  updatedAt  DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, dealId, actionKind])
  @@index([userId])
  @@index([updatedAt])  // for 7-day TTL cleanup cron
}
```

- Unique per (user, deal, action) — a user can't have two drafts for the same action on the same deal.
- Payload is a JSON blob; form-specific shape validated at the action route, not the DB.
- Cleanup: daily cron purges drafts older than 7 days. New cron route `/api/cron/permit-hub-drafts-cleanup`.

### New ActivityType enum values

Add to the existing `ActivityType` enum:

- `PERMIT_SUBMITTED`
- `PERMIT_RESUBMITTED`
- `PERMIT_REJECTION_LOGGED`
- `PERMIT_REVISION_ROUTED`    // when Peter routes a rejection to design or non-design
- `PERMIT_REVISION_COMPLETED`
- `PERMIT_FOLLOWUP`
- `PERMIT_AS_BUILT_STARTED`
- `PERMIT_AS_BUILT_COMPLETED`
- `PERMIT_ISSUED`
- `PERMIT_SOLARAPP_SUBMITTED`

Every action form writes one ActivityLog entry on successful submit. This powers the "touched today" counter and provides an audit trail without building a hub-specific session table.

### Reused models

- `HubSpotProjectCache` — project data cache, already kept fresh by the existing cache layer.
- `ActivityLog` — activity trail. New enums above.
- No IdrMeetingSession equivalent — solo mode does not need a session row.

## API surface

All routes at `/api/permit-hub/*`. Added to the role allowlist in `lib/roles.ts` for `PERMIT`, `TECH_OPS`, `ADMIN`, `OWNER`.

| Method | Path | Purpose |
|---|---|---|
| GET  | `/api/permit-hub/queue` | Returns the filtered permit action queue (wraps the existing data fetcher with hub-specific shape) |
| GET  | `/api/permit-hub/project/[dealId]` | Returns the full detail-pane bundle (deal + AHJ records + planset link + correspondence search URL + status history + activity) |
| POST | `/api/permit-hub/drafts` | Upsert draft form state |
| GET  | `/api/permit-hub/drafts/[dealId]/[actionKind]` | Fetch a specific draft |
| DELETE | `/api/permit-hub/drafts/[dealId]/[actionKind]` | Delete (on successful submit) |
| POST | `/api/permit-hub/actions/submit-to-ahj` | Submit-to-AHJ action |
| POST | `/api/permit-hub/actions/resubmit-to-ahj` | Resubmit action |
| POST | `/api/permit-hub/actions/review-rejection` | Rejection review + routing action |
| POST | `/api/permit-hub/actions/follow-up` | Follow-up action |
| POST | `/api/permit-hub/actions/complete-revision` | Complete-revision action |
| POST | `/api/permit-hub/actions/start-as-built-revision` | Start as-built revision |
| POST | `/api/permit-hub/actions/complete-as-built` | Complete as-built |
| POST | `/api/permit-hub/actions/submit-solarapp` | SolarApp submission |
| POST | `/api/permit-hub/actions/mark-permit-issued` | Record permit issuance |
| GET  | `/api/permit-hub/today-count` | Current-user count of activity-log entries today for the touched-today chip |
| GET  | `/api/cron/permit-hub-drafts-cleanup` | Daily cron — purge >7-day drafts |

Each action route:
1. Validates input with Zod
2. Looks up the matching open HubSpot task on the deal
3. Completes the task with captured notes (falls back to field write + warning if no task exists)
4. Creates a HubSpot note engagement summarizing the action
5. Writes `ActivityLog` entry
6. Deletes the `PermitHubDraft` row for this action
7. Returns success / error

## Rollout

### Feature flag

- `PERMIT_HUB_ENABLED` env var (server) — gates the dashboard route and all `/api/permit-hub/*` routes (middleware short-circuits to 404 when off).
- `NEXT_PUBLIC_PERMIT_HUB_ENABLED` — gates the suite card on `/suites/permitting-interconnection` and the nav entry.

### Role access

Added to `allowedRoutes` for: `PERMIT`, `TECH_OPS` (legacy), `ADMIN`, `OWNER`. The new `/api/permit-hub/*` prefix and `/dashboards/permit-hub` route must both be added to every role's allowlist — per the existing feedback: new API routes silently 403 otherwise.

### Pilot plan

1. Ship behind flag. Enable for Peter Zaun first (Colorado). Feedback loop for one week.
2. Iterate on action forms, queue filters, and any missing context that surfaces.
3. Enable for CA permit lead.
4. Let it run ~2 weeks with both users. Collect friction.
5. Start IC Hub — this is the trigger to extract shared primitives into `src/components/workspace-hub/` + `src/lib/workspace-hub/`. The three abstractions that will emerge (based on IDR + Permit Hub patterns):
   - `<WorkspaceHubShell>` — two-pane layout with header slot, queue slot, detail slot
   - `<ActionFormShell>` — draft auto-save + submit state + error surfacing
   - `queueFilterStore` — sortable/filterable persisted queue state helper

### Suite placement

Add a "Permit Hub" card to `/suites/permitting-interconnection` (blue accent, distinct from existing action-queue card). Keep `pi-permit-action-queue` in place — the two coexist during pilot, and only the Hub is promoted once Peter is fully on it. Per existing feedback: suite card implies route allowlist entries — both must land together.

## Risk register

| Risk | Mitigation |
|---|---|
| HubSpot task-subject matching is fragile (if task names drift, the Hub can't find the task to complete) | Action route logs when it can't find a matching task; falls back to the escape-hatch with a confirmation prompt. A follow-up improvement is a config map of action → task subject patterns, maintainable by admins. |
| Draft form state could contain stale deal context after a long pause | Drafts are keyed on actionKind, not deal snapshot — when resumed, current deal state is re-read. Drafts are form field data only. |
| Two people submit the same action simultaneously (unlikely — 2 people split by region) | The HubSpot task completion is idempotent — second call will find the task already closed and surface a "already done" message. No corruption. |
| Peter's pain is not what I've guessed (queue+context+action model doesn't hit "submitting for revisions" or "reading emails" pain) | Pilot week is the forcing function. If after a week Peter still burns time on those two, the follow-up is the Gmail read integration + structured rejection review (flagged below). |
| Premature abstraction — extracting shared primitives before IC Hub exists | Deliberately deferred. IDR + Permit Hub will look similar but stay independent until IC Hub begins. |

## Follow-up opportunities (post-v1)

Flagged during brainstorming, explicitly cut from v1 scope:

- **Gmail thread fetch + AI summary on Correspondence tab** — fetch last ~10 threads matching AHJ email + site address, display as mini-inbox with Haiku-generated one-line snippets. This is the potential hero feature for pain point #2 ("reading through emails") but is its own project, not a Permit Hub v1 stretch.
- **Structured rejection review** — AI-extract rejection category, specific comments, and suggested route from the AHJ email. Pre-fills `ReviewRejectionForm`. Depends on Gmail fetch above.
- **SolarApp+ integration** — if SolarApp+ offers an API, pull submission status / ID into the hub. Currently manual.
- **AHJ custom object editing** — quick-edit for notes/quirks straight from the AHJ tab (today requires jumping to HubSpot).
- **IC Hub + Design Hub** — template clones once the framework extraction happens. Tracked separately.
- **Mobile layout** — if field workers start needing hub access on tablets.
- **Permit expiration tracking** — proactive alerts before a permit expires.
