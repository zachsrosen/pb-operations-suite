# Product Catalog Hardening Plan (Deep Review + Regression Gates)

Date: 2026-02-27  
Owner: Catalog/BOM platform  
Status: Proposed

## 1) What this plan is for

Deliver a safe, auditable, production-ready catalog submission and approval flow that:

1. Captures full product data at submission time (no field loss).
2. Approves atomically for internal writes.
3. Pushes externally with explicit success/failure semantics (no fake "pushed" states).
4. Prevents regressions in BOM workflows and existing inventory APIs.

This document includes:
- Deep code review findings from current branch state.
- Unwanted features to explicitly prevent.
- Phased implementation tasks with prompts for execution.
- Regression checklist and release gates.

## 2) Deep code review findings (current workspace)

### [P0] Approval reports success even when external pushes are not implemented

- Evidence:
  - `src/app/api/catalog/push-requests/[id]/approve/route.ts` has TODO stubs for ZOHO/HUBSPOT/ZUPER and still marks request `APPROVED`.
  - `src/app/dashboards/catalog/page.tsx` shows success toast: "Approved and pushed to selected systems".
- Risk:
  - Operationally misleading. Users believe records exist in external systems when they do not.
- Required fix:
  - Change approval response/UI to report per-system status (`success`, `failed`, `skipped`, `not_implemented`) and block "pushed" wording unless actually pushed.

### [P1] Approval path is non-atomic for internal write + status update

- Evidence:
  - Internal `equipmentSku.upsert` and `pendingCatalogPush.update` are separate operations.
- Risk:
  - Partial state if one operation succeeds and the other fails.
- Required fix:
  - Use `prisma.$transaction` for internal upsert + request status/result updates.
  - Keep external network calls outside DB transaction.

### [P1] Field loss between submit and approve

- Evidence:
  - `PendingCatalogPush` only stores `brand/model/description/category/unitSpec/unitLabel/systems`.
  - Approval only persists a subset to `EquipmentSku`.
- Risk:
  - SKU, pricing, vendor data, dimensions, and category metadata can be dropped.
- Required fix:
  - Extend `PendingCatalogPush` and `EquipmentSku` schema and API contracts to include full common fields + metadata JSON.

### [P1] Category model drift between docs and code

- Evidence:
  - `prisma/schema.prisma` `EquipmentCategory` has 8 values.
  - `docs/product-property-mapping-simple.csv` models a 15-category taxonomy and still contains unresolved `?` push decisions.
  - POST `/api/catalog/push-requests` accepts any category string.
- Risk:
  - Invalid category requests can enter queue and silently skip internal persistence.
- Required fix:
  - Freeze canonical taxonomy and add an explicit mapping layer (internal enum value <-> display label <-> external value).
  - Validate categories at submission and approval time.

### [P1] Coverage gaps on critical approval behavior

- Evidence:
  - Existing tests primarily cover push-request create/list route.
  - No deep tests for approval atomicity, status transitions, metadata parsing, or external failures.
- Risk:
  - High chance of regression in core approval path.
- Required fix:
  - Add dedicated approve/reject route tests + integration tests.

### [P2] UI still centered on modal-based push from BOM

- Evidence:
  - `src/components/PushToSystemsModal.tsx` still used by BOM and catalog pages.
  - No `/dashboards/catalog/new` route in current branch.
- Risk:
  - Limited UX for category-specific fields, increased invalid submissions.
- Required fix:
  - Move creation flow to full page and keep BOM as redirect/prefill only.

### [P2] Permission intent is unclear for catalog routes

- Evidence:
  - `role-permissions.ts` does not explicitly include `/dashboards/catalog` or `/api/catalog` in non-admin route lists.
- Risk:
  - Accidental access restrictions or inconsistent behavior between middleware and route-level checks.
- Required fix:
  - Define explicit role policy for catalog read/create/approve operations and test middleware + API together.

## 3) Unwanted features to explicitly prevent

1. No "Approved and pushed" language unless each selected external system actually succeeded.
2. No auto-approval to `APPROVED` if required internal write fails.
3. No silent category coercion or acceptance of unknown categories.
4. No implicit defaults that push to all external systems without explicit user choice.
5. No external API write without idempotency guard (duplicate product creation).
6. No external API call inside DB transaction.
7. No schema rollout that breaks old environments without clear migration path.

## 4) Inferred product intent (what you likely want)

1. One submission should preserve all product data and become the source of truth for approval.
2. Approval should be operationally trustworthy: atomic internal write, auditable external outcomes.
3. Users should see exactly what happened per system, not a generic success message.
4. Category-specific data should be structured enough for future automation and reporting.
5. BOM users should get a fast path into catalog creation, but catalog creation should not live in a cramped modal.

## 5) Execution phases and prompts

## Phase 0 - Safety baseline

### Task 0.1: Baseline and guardrails

- Deliverables:
  - Branch created from latest `main`.
  - Snapshot of current behavior (tests + API responses + screenshots).
  - Explicit list of failing tests that are pre-existing and unrelated.
- Checks:
  - `npm run lint`
  - `npm run test -- catalog`
  - `npm run build`

Prompt:

```text
Create a baseline report for catalog functionality before any changes.
1) Run lint, build, and catalog-related tests.
2) Capture current API behavior for:
   - POST /api/catalog/push-requests
   - GET /api/catalog/push-requests?status=PENDING
   - POST /api/catalog/push-requests/:id/approve
3) Document known failures and mark which are unrelated.
Do not change code in this task.
```

## Phase 1 - Canonical taxonomy and mapping decisions

### Task 1.1: Freeze category taxonomy and push matrix

- Deliverables:
  - Final category list (internal enum values + display names + external mappings).
  - Completed `docs/product-property-mapping-simple.csv` fields with no unresolved `?`.
  - Decision record for ambiguous fields (e.g., hardToProcure, dimensions).
- Checks:
  - No unresolved `?` in required push columns for MVP fields.

Prompt:

```text
Finalize the catalog category and field mapping contract.
1) Produce canonical mappings for Internal/HubSpot/Zuper/Zoho category names.
2) Resolve all required Push-to-system '?' decisions for MVP fields.
3) Add a short ADR section to the plan describing assumptions and deferred fields.
No code changes yet; this is a contract freeze task.
```

## Phase 2 - Schema and migrations

### Task 2.1: Expand schema for full field persistence

- Target files:
  - `prisma/schema.prisma`
  - `prisma/migrations/*`
- Deliverables:
  - Add new enum values additively (no destructive renames).
  - Add full common fields to `EquipmentSku` and `PendingCatalogPush`.
  - Add `metadata Json?` for category-specific fields on pending requests.
- Checks:
  - `npx prisma format`
  - `npx prisma generate`
  - `npx prisma migrate dev --name ...`

Prompt:

```text
Implement additive schema changes for catalog submission hardening.
Requirements:
- Keep existing enum values intact; add new values only.
- Add missing common fields to EquipmentSku and PendingCatalogPush.
- Ensure sku exists consistently on both models.
- Keep migration backward-safe (no destructive rename/drop).
Return migration summary and generated SQL review notes.
```

### Task 2.2: Add per-category spec tables

- Deliverables:
  - Category-specific spec tables with 1:1 relation to `EquipmentSku`.
  - Relation fields on `EquipmentSku`.
- Checks:
  - Generate and apply migration locally.
  - Confirm relational integrity with create/update/delete tests.

Prompt:

```text
Add per-category spec models and relations in Prisma.
Requirements:
- 1:1 relation from each spec model to EquipmentSku with onDelete cascade.
- No polymorphic ambiguity in relation names.
- Include only MVP category tables; defer optional categories with explicit TODO markers.
Run prisma generate and verify schema compiles.
```

## Phase 3 - Mapping layer and validation

### Task 3.1: Introduce `catalog-fields` config as single source of truth

- Target files:
  - `src/lib/catalog-fields.ts` (new)
- Deliverables:
  - Category configs with:
    - internal enum
    - display label
    - hubspot/zoho/zuper category values
    - category-specific field definitions
    - push-property mapping metadata
- Checks:
  - Unit tests for mapping conversions and validation.

Prompt:

```text
Create src/lib/catalog-fields.ts as the canonical category/field mapping layer.
Include:
- enum/display/system mapping utilities
- validators for required fields and allowed categories
- exhaustive tests ensuring every category has deterministic mapping
Avoid hardcoding category strings in UI/routes after this is introduced.
```

## Phase 4 - API contract hardening

### Task 4.1: Update push request create/edit routes

- Target files:
  - `src/app/api/catalog/push-requests/route.ts`
  - `src/app/api/catalog/push-requests/[id]/route.ts`
- Deliverables:
  - Accept and validate full common fields + metadata.
  - Enforce category validation using mapping layer.
  - Reject malformed numeric/boolean fields with clear messages.
- Checks:
  - Route tests for valid/invalid payloads and auth.

Prompt:

```text
Harden catalog push request APIs.
Requirements:
- Accept full payload (sku, vendor, pricing, dimensions, metadata).
- Validate against catalog-fields mapping.
- Return deterministic 4xx error payloads for invalid fields.
- Keep backward compatibility for older clients where feasible.
Add route tests for new validation cases.
```

### Task 4.2: Approval route atomicity and truthful status model

- Target files:
  - `src/app/api/catalog/push-requests/[id]/approve/route.ts`
- Deliverables:
  - Internal upsert + request status/result update in one transaction.
  - Per-system result object persisted on request (or status details JSON).
  - No misleading "pushed" semantics when external adapters are missing/failing.
- Checks:
  - Tests for transaction behavior and status transitions.

Prompt:

```text
Refactor approve route for atomic internal writes and truthful external outcomes.
Rules:
- INTERNAL write + request status update must be in one prisma transaction.
- External calls must run outside DB transaction.
- Persist per-system outcome with explicit states (success/failed/skipped/not_implemented).
- Do not mark request fully successful if selected systems failed.
Add tests for partial failure and retry-safe behavior.
```

## Phase 5 - External system adapters

### Task 5.1: HubSpot product create/upsert adapter

- Target files:
  - `src/lib/hubspot.ts`
  - approval route wiring
- Deliverables:
  - Create-or-find by stable key (prefer SKU, fallback category+brand+model).
  - Push mapped fields only.
  - Return product ID and payload echo for audit.

Prompt:

```text
Add a HubSpot product adapter for catalog approval.
Requirements:
- Idempotent create-or-get behavior.
- Uses mapping layer for property names/values.
- Strong error handling and actionable logs.
- Unit tests with mocked HubSpot responses (success, duplicate, validation error).
```

### Task 5.2: Zoho item create/upsert adapter

- Target files:
  - `src/lib/zoho-inventory.ts`
  - approval route wiring
- Deliverables:
  - Item create/upsert helper (separate from BOM matching logic).
  - Map rate/purchase_rate/vendor/part_number/unit and required category fields.
  - Return `item_id` and normalized result.

Prompt:

```text
Implement Zoho item create/upsert support for catalog approval.
Requirements:
- Keep separate from BOM fuzzy matching path.
- Idempotent lookup using SKU/model where possible.
- Validate required Zoho payload shape before request.
- Add tests for create success, duplicate detection, and API error handling.
```

### Task 5.3: Zuper part/item create adapter

- Target files:
  - `src/lib/zuper.ts`
  - approval route wiring
- Deliverables:
  - Part create helper with category and mapped custom fields.
  - Idempotent lookup strategy.
  - Clear error mapping from Zuper payload-level failures.

Prompt:

```text
Add Zuper catalog part creation support.
Requirements:
- Build a reusable create-or-find adapter.
- Handle HTTP and payload-level errors consistently.
- Map category and custom fields from catalog-fields config.
- Add tests for normal and failure responses.
```

## Phase 6 - UI/UX workflow migration

### Task 6.1: Build `/dashboards/catalog/new` full-page form

- Deliverables:
  - Common fields section + category-specific dynamic fields.
  - Form validation aligned with API requirements.
  - Structured submit payload including metadata.
- Checks:
  - Client-side required/format validation.
  - Accessibility basics (labels, error states, keyboard nav).

Prompt:

```text
Create /dashboards/catalog/new as the primary submission flow.
Requirements:
- Use catalog-fields mapping for dynamic sections.
- Required fields must match API requirements exactly.
- Keep UX fast and clear for BOM-origin submissions.
- Include URL prefill support for brand/model/category/dealId if present.
```

### Task 6.2: Replace modal entry points with redirects/prefill

- Target files:
  - `src/app/dashboards/bom/page.tsx`
  - `src/app/dashboards/catalog/page.tsx`
  - `src/components/PushToSystemsModal.tsx` (deprecate/remove)
- Deliverables:
  - BOM "+" action routes to `/dashboards/catalog/new?...`.
  - Catalog page uses same route for new item creation.
  - Modal removed from active imports/usages.

Prompt:

```text
Migrate modal-driven catalog submission to route-driven flow.
Requirements:
- Replace PushToSystemsModal usage with router.push() to /dashboards/catalog/new.
- Preserve existing user context via query params.
- Remove dead modal code or mark for removal with no remaining imports.
```

## Phase 7 - Permissions, observability, and audits

### Task 7.1: Role policy and middleware/API parity

- Deliverables:
  - Explicit role access rules for:
    - view catalog
    - submit request
    - approve/reject request
  - Matching checks in middleware and route handlers.
- Checks:
  - Tests for ADMIN/OWNER/MANAGER/PROJECT_MANAGER/VIEWER access matrix.

Prompt:

```text
Define and enforce catalog route/API role policy.
Requirements:
- Align middleware route access with API-level authorization.
- Prevent accidental broadening or over-restriction.
- Add focused tests for role matrix and forbidden cases.
```

### Task 7.2: Structured audit trail

- Deliverables:
  - Approval logs include actor, selected systems, per-system outcomes, IDs returned.
  - Failure logs include request ID and external response context.

Prompt:

```text
Add structured audit logging for catalog approvals.
Requirements:
- One correlated record per approval attempt.
- Include request id, actor, selected systems, results, and external ids.
- Redact secrets; keep logs operationally useful.
```

## Phase 8 - Test matrix, regression gates, and rollout

### Task 8.1: Automated regression suite

- Minimum test additions:
  - `catalog-push-approve.test.ts`
  - mapping layer tests
  - external adapter unit tests
  - catalog/new form validation tests
- Required scenarios:
  - auth guards
  - invalid category/field rejection
  - internal transaction rollback safety
  - partial external failure semantics
  - retries do not duplicate external records

Prompt:

```text
Implement a regression-focused test suite for catalog submission/approval.
Cover:
- role/auth guards
- schema validation
- transaction atomicity
- per-system result handling and retries
- UI/API contract alignment
Target deterministic tests with isolated mocks.
```

### Task 8.2: Manual smoke and rollout checklist

- Smoke workflow:
  1. Submit from `/dashboards/catalog/new`.
  2. Approve as admin.
  3. Verify internal SKU + spec table row.
  4. Verify each selected external system result.
  5. Re-approve attempt blocked/idempotent.
- Rollout gates:
  - Build/lint pass.
  - New tests pass.
  - No increase in unrelated test failures.
  - Migration tested on non-prod DB first.

Prompt:

```text
Run post-implementation smoke and release gate checks.
Output:
- Step-by-step verification results with evidence.
- Any mismatch between expected and actual outcomes.
- Go/No-Go recommendation with explicit blockers.
```

## 6) Regression checklist (must pass before merge)

1. Existing BOM export/import and row editing behavior unchanged.
2. Existing inventory SKU list/edit endpoints still work with and without newest migration applied.
3. Approval route cannot produce partial internal state.
4. Unknown categories are rejected at API boundary.
5. UI never claims external push success unless confirmed.
6. Retrying a failed approval does not duplicate external products.
7. Role access matrix matches product decision (documented).
8. Pending/Approved/Rejected transitions are deterministic and tested.

## 7) Suggested delivery slicing

1. Slice A: Phase 1-4 (contract, schema, API hardening, no external push yet but truthful statuses).
2. Slice B: Phase 5 (external adapters) behind feature flags.
3. Slice C: Phase 6-8 (UI migration + regression completion + rollout).

## 8) Definition of done

The work is done when:

1. Submission captures full fields and persists without loss.
2. Approval is atomic for internal writes and explicit for external outcomes.
3. Category mappings are deterministic and centrally defined.
4. Modal path is retired in favor of route-driven flow.
5. Regression suite and smoke checks pass with no unresolved critical findings.

