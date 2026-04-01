# Ready-To-Build Auto PO Creation — Design Spec

**Date:** 2026-03-19
**Status:** Draft
**Goal:** When the BOM pipeline runs from the HubSpot `ready_to_build` stage, automatically create missing Zoho Purchase Orders in the same pipeline run that creates the Sales Order.

---

## Context

The current BOM automation already has the right primitives:

- The HubSpot webhook route supports a `ready_to_build` trigger via `WEBHOOK_READY_TO_BUILD`
- The BOM pipeline already creates the Sales Order
- Preferred-vendor PO splitting now lives in shared code (`resolvePoVendorGroups()` + `createPurchaseOrders()`)
- PO creation is idempotent and supports partial retry via `zohoPurchaseOrders` + frozen grouping

That means we do **not** need a second automation path. The correct architecture is to extend the existing RTB pipeline run so PO creation happens immediately after SO creation.

**Key principle:** automatic PO creation is only for the `ready_to_build` automation path. It should not run automatically on `design_complete`.

---

## 1. Scope

### In Scope

- Auto-create missing vendor POs during the BOM pipeline when trigger = `WEBHOOK_READY_TO_BUILD`
- Reuse the existing shared PO creation library
- Include PO results in pipeline metadata and notifications
- Skip unassigned items automatically and surface them to ops

### Out of Scope

- Changing the manual BOM page PO preview flow
- Changing the `design_complete` automation to auto-create POs
- Auto-assigning vendors for unassigned items during automation
- Replacing or cancelling existing POs automatically

---

## 2. Triggering Rules

### 2a. Trigger Gate

Automatic PO creation should run only when all of the following are true:

1. The pipeline trigger is `WEBHOOK_READY_TO_BUILD`
2. `PIPELINE_AUTO_CREATE_PO_ON_RTB=true`
3. Zoho Inventory is configured
4. A BOM snapshot exists for the run

If any of those are false, the pipeline skips `CREATE_PO` and proceeds normally.

### 2b. Explicit Non-Goal

`WEBHOOK_DESIGN_COMPLETE` continues to stop after SO creation. That stage is too early to commit procurement automatically.

---

## 3. Pipeline Flow

**Primary file:** `src/lib/bom-pipeline.ts`

The existing pipeline remains the single orchestrator. The flow becomes:

1. Fetch deal
2. List plansets
3. Extract BOM
4. Save snapshot
5. Resolve Zoho customer
6. Create or reuse SO
7. If trigger is `WEBHOOK_READY_TO_BUILD` and auto-PO flag is enabled:
   - resolve vendor groups from the snapshot
   - create or reuse missing POs
8. Send notification with SO + PO result summary

**Implementation note:** the pipeline already contains a `CREATE_PO` block from the preferred-vendor PO splitting work. This feature does **not** add a second PO creation path. Instead, it changes the behavior of the existing `CREATE_PO` step so that it only executes when:

- `trigger === "WEBHOOK_READY_TO_BUILD"`
- `PIPELINE_AUTO_CREATE_PO_ON_RTB === "true"`

When those conditions are not met, the existing `CREATE_PO` step should be skipped and the pipeline should proceed directly to `NOTIFY`.

### 3a. Ordering Rule

SO creation stays first. PO creation depends on a successful SO result, but PO failures do not roll back the SO.

### 3b. Failure Policy

- SO failure: pipeline fails or becomes partial, same as today
- PO failure: pipeline becomes `PARTIAL`, but `NOTIFY` still runs
- Unassigned items: pipeline becomes `PARTIAL`, but `NOTIFY` still runs

This keeps the operational contract simple: customer-facing order creation is blocking, procurement creation is best-effort.

---

## 4. PO Creation Rules

### 4a. Shared Library Reuse

Reuse the existing shared functions:

- `resolvePoVendorGroups()`
- `createPurchaseOrders()`

No new PO creation logic should live in the webhook or pipeline route layer.

### 4b. Idempotency

The pipeline must preserve the same PO idempotency rules as the manual flow:

- If a vendor PO already exists in `zohoPurchaseOrders`, skip it
- If some vendor POs exist and others do not, create only the missing ones
- Once the first PO exists, use frozen `bomData.poVendorGroups` rather than recomputing fresh vendor buckets

### 4c. Retry Behavior

`createPurchaseOrders()` already implements persist-as-you-go recovery and partial-failure idempotency. Because of that, the pipeline should **not** wrap `createPurchaseOrders()` in `withRetry("CREATE_PO", ...)`.

Rules:

- keep the `CREATE_PO` pipeline step for observability and failure classification
- remove the `withRetry` wrapper around `createPurchaseOrders()`
- if the existing codebase still has a `STEP_RETRY_POLICIES.CREATE_PO` entry after this change, remove it as dead config

This avoids double-running the same PO creation loop inside a retry wrapper when the shared library already knows how to resume safely from partial progress.

### 4d. Unassigned Items

Automation never picks a vendor for unassigned items.

Rules:

- `no_zoho_match` items are skipped
- `no_vendor` items are skipped
- Both are recorded in `BomPipelineRun.metadata`
- Both are surfaced in the notification

This avoids silent procurement to the wrong vendor.

---

## 5. Notification Changes

**Primary file:** `src/lib/email.ts`

Pipeline notifications for RTB runs should include a PO summary alongside the existing SO summary.

### 5a. Payload Shape

Extend the pipeline notification payload to accept:

```ts
purchaseOrders?: Array<{
  vendorName: string;
  poNumber: string | null;
  itemCount: number;
}>;
poFailed?: Array<{
  vendorName: string;
  error: string;
}>;
poUnassignedCount?: number;
```

These fields are additive and optional so existing non-RTB notification callers continue to work unchanged.

### 5b. Success Notification

Include:

- SO number / link
- Number of created or reused POs
- Vendor names for created/reused POs
- Count of unassigned items, if any

### 5c. Partial Notification

Include:

- SO created successfully
- Which vendor POs failed
- Which items were unassigned
- Clear wording that procurement is incomplete and needs follow-up

### 5d. Notification Tone

RTB notifications should make the pipeline outcome easy to triage:

- `SO created, POs complete`
- `SO created, POs partial`
- `SO skipped/failed`

---

## 6. Configuration

### 6a. New Env Flag

Add:

```bash
PIPELINE_AUTO_CREATE_PO_ON_RTB=true
```

Default behavior if unset:

- treat as `false`
- RTB pipeline still runs, but skips automatic PO creation

This allows a safe staged rollout.

### 6b. Existing Stage Config

No new webhook route is needed. Continue using:

```bash
PIPELINE_STAGE_CONFIG="<design-stage-id>:design_complete,<rtb-stage-id>:ready_to_build"
```

The RTB stage is what activates the same pipeline under a different trigger.

---

## 7. Data Model Impact

No new schema changes are required for this feature, assuming preferred-vendor PO splitting has already shipped.

This RTB automation relies on the existing fields:

- `ProjectBomSnapshot.zohoPurchaseOrders`
- `ProjectBomSnapshot.bomData.poVendorGroups`
- `BomPipelineStep.CREATE_PO`

---

## 8. Backward Compatibility

- Manual BOM page PO preview and creation continue to work unchanged
- Existing RTB webhook behavior continues to run the pipeline even if auto-PO is disabled
- Old runs without PO metadata remain valid
- Enabling the new env flag only affects future RTB-triggered runs

---

## 9. Files Changed

| File | Change |
|------|--------|
| `src/lib/bom-pipeline.ts` | Gate the existing `CREATE_PO` step to `WEBHOOK_READY_TO_BUILD` + env flag, remove `withRetry` around `createPurchaseOrders()`, and include PO results in final pipeline status/metadata |
| `src/lib/email.ts` | Extend pipeline notification payload and rendered content to include PO summary / failures / unassigned items |
| `src/app/api/webhooks/hubspot/design-complete/route.ts` | Documentation/comment updates only if needed; no new route |
| `src/__tests__/lib/bom-pipeline*.test.ts` | Add RTB-specific coverage for SO+PO success, PO partial failure, and env-flag-off behavior |
| `src/__tests__/lib/bom-po-create.test.ts` | Reuse existing PO behavior coverage; expand only if RTB-specific edge cases need unit tests |

---

## 10. Acceptance Criteria

This feature is complete when:

1. A `ready_to_build` webhook triggers the existing BOM pipeline
2. The pipeline creates or reuses the SO
3. The same run creates or reuses missing vendor POs
4. Existing POs are not duplicated
5. Unassigned items are skipped and reported
6. PO failures do not block notification
7. The final notification clearly reports SO + PO outcome
8. `design_complete` runs do not auto-create POs

---

## 11. Recommended Rollout

1. Ship code behind `PIPELINE_AUTO_CREATE_PO_ON_RTB=false`
2. Enable the RTB stage in `PIPELINE_STAGE_CONFIG` if not already enabled
3. Turn on the flag in staging or a limited environment
4. Verify:
   - one RTB deal with fully assigned vendors
   - one RTB deal with unassigned items
   - one RTB retry after partial PO creation
5. Enable in production

---

## 12. Resolved Retry Rule

How should manual retry behave for a previously partial RTB run?

**Resolved:** `MANUAL` retries continue creating missing POs via the existing frozen-grouping rule. No additional code is needed beyond reusing `createPurchaseOrders()`:

- if `zohoPurchaseOrders` already contains some vendor POs, they are skipped
- frozen `bomData.poVendorGroups` is reused
- only the missing vendor buckets are created

This preserves operational recovery without requiring the deal to re-enter RTB.
