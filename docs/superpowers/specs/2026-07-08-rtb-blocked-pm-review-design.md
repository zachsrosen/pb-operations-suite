# RTB-Blocked PM Review Gate — Design

**Date:** 2026-07-08
**Ticket:** Freshservice #919 — "Workflow: move permit-issued projects to Ready to Build - Blocked pending PM review"
**Origin:** CA Design/Ops meeting (7/7). Scope expanded to **company-wide** during brainstorming.

## Problem

When a project's permit is issued, an existing HubSpot deal workflow advances the deal
straight to **Ready to Build**. Entering that stage triggers customer-facing messaging
(Olivia, the PM bot, fires on the Ready-to-Build stage). The result is customers being
notified before a project manager has confirmed the project is actually ready to build —
"premature customer notifications."

## Goal

Insert a mandatory PM review gate between permit issuance and Ready to Build. Permit-issued
deals park in the existing **RTB - Blocked** stage. A PM reviews prefilled context and gives
a single explicit release approval, which advances the deal to Ready to Build and lets
Olivia message the customer at the right time.

Applies to **all locations** (not just California).

## Non-goals

- No new pipeline stage — **RTB - Blocked** already exists.
- No change to Olivia / customer-messaging triggers. She continues to fire on Ready to Build;
  the gate simply controls *when* deals reach that stage.
- No per-item checkboxes. The review is informational context + one release control.
- (Phase 1) No app UI. Phase 1 is pure HubSpot automation.

## Key facts (verified)

- **Project Pipeline** id `6900017`. Stage internal IDs:
  - Permitting & Interconnection — `20461938`
  - **RTB - Blocked** — `71052436`
  - **Ready To Build** — `22580871`
- Permit-issued signal on the deal: `permit_issued_` (boolean) and
  `permit_completion_date` (datetime → `permitIssueDate`).
- Customer notification fires on **deal stage = Ready to Build** (confirmed with Zach).
- `src/lib/constants.ts` (`STAGE_ORDER`, ordered furthest-along-first) lists both stages:
  `RTB - Blocked` is the less-advanced of the two, so in pipeline progression a deal reaches
  RTB - Blocked before Ready To Build.

## Design

### Mechanic

```
Permitting & Interconnection
        │  permit issued  (EXISTING workflow — retarget its stage move)
        ▼
   RTB - Blocked   ← deals park here; Olivia stays quiet
        │  PM reviews prefilled card, flips one release flag
        ▼
   Ready to Build  → Olivia notifies customer; scheduling proceeds
```

### HubSpot properties (new)

One writable gate plus audit fields on the **deal**:

| Property (internal name)   | Type      | Purpose                                            |
|----------------------------|-----------|----------------------------------------------------|
| `pm_rtb_approved`          | boolean   | The single release control. PM sets true to release. |
| `pm_rtb_approved_date`     | datetime  | Stamped when `pm_rtb_approved` flips true (audit).  |
| `pm_rtb_approved_by`       | string    | Who approved (audit). See attribution caveat below. |

**Attribution caveat:** in Phase 1 a HubSpot workflow generally cannot capture *who* flipped
`pm_rtb_approved`, so `pm_rtb_approved_by` can only reliably record the deal owner. In Phase 2
the app API route knows the acting user and populates it accurately. Don't oversell the Phase 1
value of this field.

No per-item checklist properties. The review "items" are read-only context surfaced from
existing properties (see Info card).

### HubSpot workflow changes

1. **Modify the existing permit-issued workflow.** Change its stage-move target from
   Ready to Build (`22580871`) to **RTB - Blocked** (`71052436`). Everything else about
   that workflow stays the same.
   - As part of entering RTB - Blocked, **reset** `pm_rtb_approved` to false (and clear the
     two audit fields) so a stale prior approval cannot instantly re-release a deal that
     re-enters the stage.

2. **New "release" workflow.** Enrollment trigger: `pm_rtb_approved` becomes `true`
   **AND** deal stage = RTB - Blocked (`71052436`) in pipeline `6900017`.
   Actions:
   - Set deal stage → Ready to Build (`22580871`).
   - Stamp `pm_rtb_approved_date` = now.
   - Set `pm_rtb_approved_by` = current owner (or the actor, if available).

   Guard: scoping the trigger to `stage = RTB - Blocked` ensures the flag only releases
   deals sitting in the gate — it cannot yank a later-stage deal backward or forward.

Both workflow definitions are Zach's to apply (HubSpot workflows are owned by Zach). This
spec provides the exact stage IDs and property names; the workflows can be built in the
HubSpot UI or via the Automation v4 API.

### Info card (review context)

Rendered on the deal (visible on the HubSpot record via the new + existing properties, and
in the Phase 2 app queue). All rows are **read-only**, sourced from properties that already
exist — the PM reads them, then flips the single release flag.

| Row              | Source                                                                    |
|------------------|---------------------------------------------------------------------------|
| Permit issued    | `permit_completion_date` (permitIssueDate) + `permitting_status`          |
| Payment milestone| Computed via `payment-tracking.ts` `effectivePaidStatus()` for the build-gating milestone (deposit / DA). **Open item:** confirm exact milestone. |
| Final design     | `design_status` + `permit_revision_counter` / `total_revision_count`      |
| Materials / SO   | BOM push state (`BomHubSpotPushLog`) + Zoho Sales Order number/status. **Open item:** SO number is app-side (BOM pipeline), not a clean deal property — Phase 2 queue joins it; Phase 1 HubSpot card omits it or links out. |

### Phasing

- **Phase 1 (solves the ticket):** create the three properties; modify the existing
  permit-issued workflow to target RTB - Blocked + reset the flag; add the new release
  workflow. PMs work directly on the HubSpot deal record (existing properties give them
  context; they flip `pm_rtb_approved`). This alone stops premature notifications company-wide.
- **Phase 2 (PM UX):** an app **RTB Review Queue** dashboard listing deals in RTB - Blocked
  (pipeline `6900017`, stage `71052436`), grouped by location/PM, rendering the info card
  with joined app-side data (SO number, computed payment status) and an "Approved — Release
  to Build" button that writes `pm_rtb_approved` via a new API route. Mirrors the existing
  internal-rejection / PE-doc-tracker pattern (app writes HubSpot deal properties; HubSpot
  workflow does the stage move).

## App queue (Phase 2) specifics

- **Page:** new dashboard under the Operations / Project-Management suite, e.g.
  `src/app/dashboards/rtb-review/page.tsx`. Add its route to `allowedRoutes` for each role
  that should see it (PM, OPS_MGR, ADMIN, OWNER) — otherwise silent 403.
- **API:** `GET /api/deals/rtb-review` (list deals in stage 71052436 with joined context),
  `POST /api/deals/rtb-review/[dealId]/approve` (sets `pm_rtb_approved` = true via HubSpot).
  Both new routes must be added to the role allowlist.
- Writes go to HubSpot only; the HubSpot release workflow remains the single actor that
  moves the stage. The app never moves the stage itself (keeps one source of truth).
- If the page is gated behind a feature flag read at runtime, it needs `force-dynamic`.

## Error handling & edge cases

- **Re-entry:** resetting `pm_rtb_approved` on entry to RTB - Blocked prevents a stale
  approval from auto-releasing a re-blocked deal.
- **Bypass:** a PM manually dragging a deal straight to Ready to Build bypasses the gate.
  Acceptable for v1 (PM judgment); revisit with a guard workflow if bypass becomes a problem.
- **Deals already past RTB:** the release workflow is scoped to `stage = RTB - Blocked`, so
  it never affects downstream deals. No backfill pulls existing Construction/Inspection deals
  backward.
- **Rollout softening:** because this now gates *every* project, consider announcing to PMs
  and (Phase 2) surfacing computed status so approval is mostly confirmation, not hand-audit.

## Testing

- **Phase 1:** validate in HubSpot with a test deal — permit-issued enrollment lands it in
  RTB - Blocked with `pm_rtb_approved=false`; flipping `pm_rtb_approved=true` advances it to
  Ready to Build and stamps the audit fields; confirm Olivia does not message until the deal
  reaches Ready to Build.
- **Phase 2:** unit tests for the list/approve API (role gating, HubSpot write shape) and the
  queue aggregation, following existing dashboard/API test patterns.

## Open items to confirm before/with the plan

1. Which payment milestone gates build (deposit vs DA "Paid In Full") for the Payment row.
2. Whether the Phase 1 HubSpot card should link out to the app for SO/materials status, or
   omit that row until Phase 2.
3. Identify the exact existing permit-issued workflow to modify (locate via Automation v4 API
   / HubSpot UI) so the stage-target edit is applied to the right workflow.
