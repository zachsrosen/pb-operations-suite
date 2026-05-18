# PE Document Status HubSpot Properties

**Date**: 2026-05-18
**Status**: Draft
**Author**: Claude (Opus 4.6)

## Problem

Participate Energy document statuses are tracked in our `PeDocumentReview` DB table (synced from the PE portal scraper), but they are not visible on HubSpot deals. Users have no way to see document progress without opening the PB Ops Suite PE dashboard. Manual status changes in HubSpot are also not possible.

## Solution

Create 30 HubSpot deal properties (15 status enums + 15 notes text fields) in a "Participate Energy Documents" property group. Two-way sync keeps HubSpot and the DB in lockstep: the PE scraper pushes statuses to HubSpot after each run, and manual HubSpot edits flow back to the DB via webhook.

## HubSpot Property Schema

### Property Group

- **Name**: `pe_documents`
- **Label**: "Participate Energy Documents"
- **Object**: `deals`

### 15 Status Properties (type: `enumeration`, fieldType: `select`)

Each has 6 enum options matching the Prisma `PeDocStatus` enum:

| Value | Label | Display Order |
|---|---|---|
| `not_uploaded` | Not Uploaded | 0 |
| `uploaded` | Uploaded | 1 |
| `under_review` | Under Review | 2 |
| `action_required` | Action Required | 3 |
| `rejected` | Rejected | 4 |
| `approved` | Approved | 5 |

Property list:

| Internal Name | Label | Canonical Doc Name |
|---|---|---|
| `pe_doc_customer_agreement` | PE: Customer Agreement (PPA/ESA) | Customer Agreement (PPA/ESA) |
| `pe_doc_installation_order` | PE: Installation Order | Installation Order |
| `pe_doc_state_disclosures` | PE: State Disclosures | State Disclosures |
| `pe_doc_utility_bill` | PE: Utility Bill | Utility Bill |
| `pe_doc_signed_proposal` | PE: Signed Proposal | Signed Proposal |
| `pe_doc_design_plan` | PE: Design Plan | Design Plan |
| `pe_doc_photos_per_policy` | PE: Photos per Policy | Photos per Policy |
| `pe_doc_signed_final_permit` | PE: Signed Final Permit | Signed Final Permit |
| `pe_doc_access_to_monitoring` | PE: Access to Monitoring | Access to Monitoring |
| `pe_doc_certificate_of_acceptance` | PE: Certificate of Acceptance | Certificate of Acceptance |
| `pe_doc_attestation_customer_payment` | PE: Attestation of Customer Payment | Attestation of Customer Payment |
| `pe_doc_conditional_lien_waiver` | PE: Conditional Progress Lien Waiver | Conditional Progress Lien Waiver |
| `pe_doc_signed_interconnection` | PE: Signed Interconnection Agreement | Signed Interconnection Agreement |
| `pe_doc_conditional_waiver_final` | PE: Conditional Waiver — Final Payment | Conditional Waiver — Final Payment |
| `pe_doc_permission_to_operate` | PE: Permission to Operate (PTO) | Permission to Operate (PTO) |

### 15 Notes Properties (type: `string`, fieldType: `textarea`)

Same naming pattern with `_notes` suffix:

| Internal Name | Label |
|---|---|
| `pe_doc_customer_agreement_notes` | PE: Customer Agreement Notes |
| `pe_doc_installation_order_notes` | PE: Installation Order Notes |
| `pe_doc_state_disclosures_notes` | PE: State Disclosures Notes |
| `pe_doc_utility_bill_notes` | PE: Utility Bill Notes |
| `pe_doc_signed_proposal_notes` | PE: Signed Proposal Notes |
| `pe_doc_design_plan_notes` | PE: Design Plan Notes |
| `pe_doc_photos_per_policy_notes` | PE: Photos per Policy Notes |
| `pe_doc_signed_final_permit_notes` | PE: Signed Final Permit Notes |
| `pe_doc_access_to_monitoring_notes` | PE: Access to Monitoring Notes |
| `pe_doc_certificate_of_acceptance_notes` | PE: Certificate of Acceptance Notes |
| `pe_doc_attestation_customer_payment_notes` | PE: Attestation of Customer Payment Notes |
| `pe_doc_conditional_lien_waiver_notes` | PE: Conditional Progress Lien Waiver Notes |
| `pe_doc_signed_interconnection_notes` | PE: Signed Interconnection Agreement Notes |
| `pe_doc_conditional_waiver_final_notes` | PE: Conditional Waiver — Final Payment Notes |
| `pe_doc_permission_to_operate_notes` | PE: Permission to Operate Notes |

## Sync Architecture

### Flow 1: DB to HubSpot (after scraper sync)

```
PE Scraper runs (POST /api/accounting/pe-docs/sync)
  -> syncPeDocStatuses() writes to PeDocumentReview (existing)
  -> syncPeDocStatusesToHubSpot(dealIds[])
       |-- Query PeDocumentReview for all docs on affected deals
       |-- Map docName -> pe_doc_* property name
       |-- Map PeDocStatus enum -> HubSpot enum value
       |-- Map notes -> pe_doc_*_notes property
       |-- HubSpot batch update API (POST /crm/v3/objects/deals/batch/update)
       |   Max 50 deals per batch call (conservative: 30 properties per deal)
       +-- Failures logged, do not fail overall sync (best-effort)
```

Called at the end of both `syncPeDocStatuses()` and `syncPeCsvStatuses()`. The deal IDs are collected internally from the `ops` array (the successful upsert operations already track `dealId`) — no changes to `SyncResult` or `CsvSyncResult` return types needed.

**Any code path that calls `syncPeDocStatuses()`** (including future webhook endpoints like `/api/webhooks/pe-scraper`) will automatically trigger the HubSpot push, since the push is wired into the function itself rather than the route handler.

### Flow 2: HubSpot to DB (webhook for manual changes)

```
User edits pe_doc_* property in HubSpot
  -> HubSpot deal.propertyChange webhook fires
  -> POST /api/webhooks/hubspot/pe-doc-status
       |-- Validate HubSpot webhook signature (X-HubSpot-Signature-v3)
       |-- Extract dealId, propertyName, newValue from payload
       |-- Filter: ignore properties not prefixed with pe_doc_
       |-- Map pe_doc_* -> canonical docName
       |-- Echo suppression: read existing PeDocumentReview row
       |   If status matches AND reviewedBy != "hubspot-manual" -> return 200 (no-op)
       |   (Prevents circular writes when scraper push triggers webhooks back)
       |-- For status properties: upsert PeDocumentReview
       |      reviewedBy: "hubspot-manual"
       |-- For _notes properties: update PeDocumentReview.notes
       +-- Return 200
```

HubSpot webhook subscription: `deal.propertyChange` events. The handler filters to `pe_doc_*` prefixed property names and ignores everything else.

**Echo suppression**: When `syncPeDocStatusesToHubSpot()` pushes statuses to HubSpot, HubSpot fires `deal.propertyChange` webhooks right back. Without suppression, every scraper sync would generate 15+ redundant webhook calls per deal. The webhook handler short-circuits when the incoming value already matches the DB row and the row was not manually set (`reviewedBy !== "hubspot-manual"`).

### Flow 3: Conflict Resolution

The PE portal scraper is authoritative. When `syncPeDocStatuses()` runs:

- DB row has `reviewedBy: "hubspot-manual"` but scraper brings a **different** status: scraper wins, overwrites with `reviewedBy: "pe-scraper-sync"`
- Scraper status **matches** DB: no-op, preserves existing attribution
- Manual HubSpot overrides survive until the PE portal itself reports a different status

No new DB columns needed. The existing `PeDocumentReview.reviewedBy` field distinguishes source.

## Mapping Constants

A single `PE_DOC_HUBSPOT_MAP` array in `lib/pe-hubspot-sync.ts` serves as the source of truth for all three name systems:

```typescript
interface PeDocPropertyMapping {
  docName: string;         // Canonical name in PeDocumentReview.docName
  statusProp: string;      // HubSpot status property internal name
  notesProp: string;       // HubSpot notes property internal name
  label: string;           // HubSpot property label
}

const PE_DOC_HUBSPOT_MAP: PeDocPropertyMapping[] = [
  {
    docName: "Customer Agreement (PPA/ESA)",
    statusProp: "pe_doc_customer_agreement",
    notesProp: "pe_doc_customer_agreement_notes",
    label: "PE: Customer Agreement (PPA/ESA)",
  },
  // ... 14 more entries
];
```

Status value mapping (PeDocStatus enum to HubSpot enum value):

```typescript
const PE_STATUS_TO_HUBSPOT: Record<PeDocStatus, string> = {
  NOT_UPLOADED: "not_uploaded",
  UPLOADED: "uploaded",
  UNDER_REVIEW: "under_review",
  ACTION_REQUIRED: "action_required",
  REJECTED: "rejected",
  APPROVED: "approved",
};

const HUBSPOT_TO_PE_STATUS: Record<string, PeDocStatus> = {
  not_uploaded: PeDocStatus.NOT_UPLOADED,
  uploaded: PeDocStatus.UPLOADED,
  under_review: PeDocStatus.UNDER_REVIEW,
  action_required: PeDocStatus.ACTION_REQUIRED,
  rejected: PeDocStatus.REJECTED,
  approved: PeDocStatus.APPROVED,
};
```

## Files

### New Files

1. **`scripts/create-pe-doc-properties.ts`** — One-time idempotent script
   - Creates the `pe_documents` property group on deals (idempotent)
   - Creates 15 enum status properties (idempotent, 409 = skip)
   - Creates 15 textarea notes properties (idempotent, 409 = skip)
   - Pattern: follows `scripts/_create-shit-show-properties.ts`
   - Usage: `npx tsx scripts/create-pe-doc-properties.ts`

2. **`src/lib/pe-hubspot-sync.ts`** — Sync module
   - `PE_DOC_HUBSPOT_MAP` constant (canonical name <-> HubSpot property mapping)
   - `PE_STATUS_TO_HUBSPOT` / `HUBSPOT_TO_PE_STATUS` maps
   - `extractHubSpotNotes(rawNotes: string)` — extracts Approver/Partner segments from pipe-delimited notes blob
   - `syncPeDocStatusesToHubSpot(dealIds: string[])` — batch-pushes DB statuses to HubSpot
   - `upsertPeDocFromHubSpot(dealId, propertyName, value)` — webhook handler helper (with echo suppression)

3. **`src/app/api/webhooks/hubspot/pe-doc-status/route.ts`** — Webhook endpoint
   - POST handler: validates signature, filters to `pe_doc_*` properties, upserts DB
   - Follows existing webhook patterns (signature validation, idempotency)

### Modified Files

4. **`src/lib/pe-scraper-sync.ts`**
   - Import `syncPeDocStatusesToHubSpot` from `pe-hubspot-sync`
   - At end of `syncPeDocStatuses()`: collect unique deal IDs from successful upserts, call `syncPeDocStatusesToHubSpot(dealIds)`
   - Same change at end of `syncPeCsvStatuses()`

5. **`src/middleware.ts`**
   - Add `"/api/webhooks/hubspot/pe-doc-status"` to the `PUBLIC_API_ROUTES` array (each webhook route is listed individually — no wildcard prefix match)

### Not Changing

- **Prisma schema**: `PeDocumentReview` already has all needed columns (`dealId`, `docName`, `status`, `notes`, `reviewedBy`, `reviewedAt`)
- **Dashboard UI**: Properties appear natively in HubSpot deal record views, no PB Ops UI changes needed
- **`src/lib/roles.ts`**: Webhook routes bypass session auth via middleware public route check, no role additions needed

## Notes Population

The scraper captures two comment fields per document: `approverNotes` and `partnerComments`. The existing `buildNotesString()` function in `pe-scraper-sync.ts` combines these into a pipe-delimited blob in `PeDocumentReview.notes`:

```
Synced from PE portal scraper (PROJ-8708) | Submitted: 2026-04-16 | Approver: The design plan must be stamped... | Responded: 2026-05-15
```

**Do not push the full blob to HubSpot.** The `syncPeDocStatusesToHubSpot()` function must extract only the human-readable portions for the HubSpot notes property:

- `Approver:` content (PE reviewer feedback — most important)
- `Partner:` content (partner comments, if present)

Sync metadata (`Synced from PE portal scraper`, `Submitted:`, `Responded:` dates) is omitted. The extraction function `extractHubSpotNotes(rawNotes: string)` parses the pipe-delimited format and returns only the relevant segments joined with a newline.

For the webhook (HubSpot -> DB), manual notes edits write directly to `PeDocumentReview.notes` and are preserved until the scraper brings different notes content.

## Rollout

1. Run `scripts/create-pe-doc-properties.ts` to create properties in HubSpot
2. Deploy code changes (scraper sync + webhook handler)
3. Create HubSpot webhook subscription for `deal.propertyChange` (manual via HubSpot developer portal, or script)
4. Trigger a PE scraper sync to backfill all existing deals with current statuses
