# IDR Sync: Complete HubSpot Task Instead of Direct Property Update

**Status**: Planned (pending validation of current direct-update approach)
**Depends on**: PR #595 (IDR Design Revision workflow) — merged and live
**Date**: 2026-05-11

## Context

PR #595 shipped two behaviors on IDR meeting sync:
1. `designRevisionNeeded = true` → sets `design_status = "IDR Revision Needed"`
2. `reviewed = true` + no revision flag → sets `design_status = "Draft Complete - Waiting on Approvals"`

Behavior 2 bypasses the existing manual workflow where a design lead completes a HubSpot task ("Complete Initial Design Review"), which triggers a HubSpot workflow that sets the status and fires downstream effects (notifications, counters, etc.).

## Proposed Change

Replace the direct `design_status` property update (behavior 2) with completing the HubSpot task via API, letting HubSpot workflows handle the status change.

### Task Details

- **Subject pattern**: `Complete Initial Design Review - {suffix}` (suffix is ZRS/WMS/etc., always present)
- **Match strategy**: Search for open tasks on the deal where `hs_task_subject` contains `"Complete Initial Design Review"` and `hs_task_status = "NOT_STARTED"`
- **Action**: PATCH `hs_task_status` to `"COMPLETED"`

### Implementation

**Single file change**: `src/lib/idr-meeting.ts`

1. Add a `completeInitialDesignReviewTask(dealId: string)` function:
   - Search: `GET /crm/v3/objects/tasks` filtered by association to deal + subject contains "Complete Initial Design Review" + status NOT_STARTED
   - Complete: `PATCH /crm/v3/objects/tasks/{taskId}` with `{ properties: { hs_task_status: "COMPLETED" } }`
   - Return boolean (found and completed, or not found)

2. In `buildHubSpotPropertyUpdates()`, remove the `reviewed` auto-advance branch:
   ```diff
   - } else if (fields.reviewed) {
   -   updates.design_status = "Draft Complete - Waiting on Approvals";
   - }
   ```

3. In `syncItemToHubSpot()`, after property push, call `completeInitialDesignReviewTask(dealId)` when `reviewed && !designRevisionNeeded`.

### Edge Cases

- **Task not found**: Log a warning, don't fail the sync. The direct property update is the fallback (or the design lead completes it manually).
- **Multiple matching tasks**: Complete the first one. Shouldn't happen in practice.
- **Task already completed**: PATCH is idempotent — no harm done.

## Why Wait

Testing the current direct-update approach first to validate the overall workflow (toggle → sync → status change) before adding the task-search complexity. If the direct update works well and the HubSpot workflow isn't needed for side-effects, we may keep it as-is.
