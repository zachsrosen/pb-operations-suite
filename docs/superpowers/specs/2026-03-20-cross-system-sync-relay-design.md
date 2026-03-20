# Cross-System Sync Relay

**Date:** 2026-03-20
**Status:** Draft
**Scope:** SyncModal, catalog-sync, sync API routes, catalog-sync-confirmation

## Summary

Extend the product catalog sync modal to support relaying values between external systems (Zoho, HubSpot, Zuper) through a server-derived canonical sync plan. The modal captures user intent (push/pull/skip per field with auto-cascade); the server owns plan derivation, hashing, conflict detection, and ordered execution.

## Goals

- Support mixed pull/push/skip per field per system in a single sync operation.
- Auto-cascade downstream pushes from approved pulls, with explicit user override support.
- Approve and execute one canonical plan — not client-orchestrated multi-phase sync.
- Fail safely when external state changes between preview and execute, or when partial writes occur.
- Option to relay values directly between external systems without updating the internal product.

## Non-Goals

- Arbitrary system-to-system mapping outside the existing internal-field mapping model.
- Silent approval of derived writes — all operations are visible in the plan before confirm.
- Client-only orchestration of multi-phase sync (server owns execution order).
- Pull-to-pull cascading — pulling from System A never auto-sets another system to pull. Only push/skip can be auto-set by cascade.

---

## 1. State Model

### 1.1 Field Intent

Each field on each system carries a user intent:

```ts
type Direction = "push" | "pull" | "skip";
type SelectionMode = "manual" | "auto";

interface FieldIntent {
  direction: Direction;
  mode: SelectionMode;
  updateInternalOnPull: boolean; // only meaningful when direction === "pull"
}
```

- **manual**: user explicitly set this direction. Sticky — auto-cascade never overwrites it.
- **auto**: set by cascade logic. The system re-evaluates auto fields whenever a pull changes. Once the user touches an auto field, it flips to manual.
- **updateInternalOnPull**: per-field flag controlling whether a pull also writes to the internal product. Defaults to `true`. A global toggle in the UI seeds per-field defaults but is not the source of truth.

### 1.2 Field Value Snapshot

The server returns snapshots of every mapped field across all systems at preview time:

```ts
type ExternalSystem = "zoho" | "hubspot" | "zuper";

interface FieldValueSnapshot {
  system: ExternalSystem | "internal";
  field: string;
  rawValue: string | number | null;
  normalizedValue: string | number | null;
}
```

Normalization uses field-specific transforms (not plain string equality):

| Transform        | Fields                          | Rule                                     |
|------------------|---------------------------------|------------------------------------------|
| `number`         | rate, purchase_rate, price, hs_cost_of_goods_sold | Parse to float, compare numerically      |
| `trimmed-string` | name, sku, description, part_number, unit | Trim whitespace, compare case-sensitively |
| `enum-ci`        | manufacturer, category          | Trim, compare case-insensitively         |
| `trimmed-string` | vendor_name, vendor_id          | Companion pair — auto-paired via `companion` property (see §1.3) |

### 1.3 Field Mapping Edge

A single shared server-side mapping table replaces the current split between `PULL_FIELD_MAP` (client) and `buildXxxProposedFields`/`parseXxxCurrentFields` (server):

```ts
type NormalizeWith = "number" | "trimmed-string" | "enum-ci";

interface FieldMappingEdge {
  system: ExternalSystem;
  externalField: string;
  internalField: string;
  normalizeWith: NormalizeWith;
  direction?: "push-only" | "pull-only"; // default: bidirectional
  condition?: { category: string[] };    // only active for these product categories
  companion?: string;                    // auto-paired field (e.g., vendor_name → vendor_id)
  generator?: string;                    // composite field generator (e.g., "zuperSpecification")
  transform?: string;                   // pre-write transform (e.g., "zuperCategoryUid")
}
```

**Category-conditional mappings**: HubSpot spec properties vary by product category (e.g., `dc_size` only exists for MODULE, `ac_size` only for INVERTER). The `condition` field gates which mappings are active for a given product. When `condition` is omitted, the mapping applies to all categories.

**Push-only composite fields**: Zuper's `specification` field is a many-to-one composite generated from multiple internal spec fields (e.g., MODULE: `"410W Mono PERC"` from wattage + cellType). It cannot be decomposed back into individual fields on pull. Marked `direction: "push-only"` — the preview shows it as read-only with a tooltip explaining why. The `generateZuperSpecification()` function in `catalog-fields.ts` already handles the composition logic; the mapping table references it as a special-case generator rather than a simple field-to-field edge.

**Virtual internal fields**: Fields prefixed with `_` (e.g., `_specification`, `_name`) are virtual — never persisted to the database. They exist only in the mapping table to anchor push-only composite edges. During plan derivation, virtual fields are skipped in the internal patch (Step 1). During re-materialization (Step 2), edges with a `generator` property regenerate their value from the **post-patch** internal state. This means a pull of `wattage` from HubSpot correctly cascades into an updated Zuper `specification` push because the generator reads the now-updated wattage.

**Push-only `name` fields**: Across all three systems, the external `name` field is composed as `"${brand} ${model}"` via `buildSkuName()`. It cannot be decomposed back into separate brand and model fields on pull. All `name` edges are marked `direction: "push-only"` with `generator: "skuName"`.

**Companion fields**: Fields that must travel together (e.g., Zoho `vendor_name` + `vendor_id`). The `companion` property on one edge points to the other. When a pull or push includes one, the plan expander auto-includes its companion. Both fields map to separate `internalField` values (`vendorName` and `zohoVendorId`). When a companion is auto-expanded, it inherits the `updateInternalOnPull` setting from the field that triggered it.

**Pre-write transforms**: Some fields require a transform before writing to the external system. Zuper's `category` field needs UID resolution via `resolveZuperCategoryUid()`. The `transform` property names a registered transform function that runs at execution time (Step 3), after re-materialization but before the API call.

**Category-conditional collision handling**: Some HubSpot properties map to different internal fields depending on product category (e.g., `capacity__kw_` → `continuousPowerKw` for BATTERY, `powerKw` for EV_CHARGER). The `condition` field ensures only one edge is active per product. **Validation rule**: after filtering by the product's category, no two active mappings may share the same `system + externalField` pair.

Example mappings:

```ts
// Push-only composite: name (all systems)
{ system: "hubspot", externalField: "name", internalField: "_name",
  normalizeWith: "trimmed-string", direction: "push-only", generator: "skuName" },
{ system: "zoho", externalField: "name", internalField: "_name",
  normalizeWith: "trimmed-string", direction: "push-only", generator: "skuName" },
{ system: "zuper", externalField: "name", internalField: "_name",
  normalizeWith: "trimmed-string", direction: "push-only", generator: "skuName" },

// Bidirectional (all categories)
{ system: "hubspot", externalField: "price", internalField: "sellPrice", normalizeWith: "number" },
{ system: "hubspot", externalField: "manufacturer", internalField: "brand", normalizeWith: "enum-ci" },
{ system: "hubspot", externalField: "hs_sku", internalField: "sku", normalizeWith: "trimmed-string" },

// Category-conditional (MODULE only)
{ system: "hubspot", externalField: "dc_size", internalField: "wattage", normalizeWith: "number",
  condition: { category: ["MODULE"] } },

// Category-conditional (INVERTER only)
{ system: "hubspot", externalField: "ac_size", internalField: "acOutputKw", normalizeWith: "number",
  condition: { category: ["INVERTER"] } },

// Category-conditional collision: same HubSpot property, different internal fields
{ system: "hubspot", externalField: "capacity__kw_", internalField: "continuousPowerKw",
  normalizeWith: "number", condition: { category: ["BATTERY"] } },
{ system: "hubspot", externalField: "capacity__kw_", internalField: "powerKw",
  normalizeWith: "number", condition: { category: ["EV_CHARGER"] } },

// Push-only composite: Zuper specification
{ system: "zuper", externalField: "specification", internalField: "_specification",
  normalizeWith: "trimmed-string", direction: "push-only", generator: "zuperSpecification" },

// Pre-write transform: Zuper category (name → UID)
{ system: "zuper", externalField: "category", internalField: "category",
  normalizeWith: "enum-ci", transform: "zuperCategoryUid" },

// Companion pair
{ system: "zoho", externalField: "vendor_name", internalField: "vendorName",
  normalizeWith: "trimmed-string", companion: "vendor_id" },
{ system: "zoho", externalField: "vendor_id", internalField: "zohoVendorId",
  normalizeWith: "trimmed-string", companion: "vendor_name" },
```

### 1.4 Sync Plan

The server derives this from user intents + fresh snapshots:

```ts
interface SyncPlan {
  productId: string;
  basePreviewHash: string;   // hash of raw fetched external state
  planHash: string;           // hash of the fully derived canonical plan
  conflicts: PullConflict[];
  internalPatch: Record<string, string | number | null>;
  operations: SyncOperation[];
  summary: {
    pulls: number;
    internalWrites: number;
    pushes: number;
    creates: number;
  };
}

type SyncOperation =
  | {
      kind: "pull";
      system: ExternalSystem;
      externalField: string;
      internalField: string;
      value: string | number | null;
      updateInternal: boolean;
      noOp?: boolean;            // true when pull has no effect (see §2.4)
      source: "manual";
    }
  | {
      kind: "push";
      system: ExternalSystem;
      externalField: string;
      value: string | number | null;
      source: "manual" | "cascade"; // pulls are always "manual" (see Non-Goals: no pull-to-pull cascade)
    }
  | {
      kind: "create";
      system: ExternalSystem;
      fields: Record<string, string | number | null>;
      source: "manual" | "cascade";
    };
```

---

## 2. Client Behavior

### 2.1 Default Intents

On modal open, the server returns snapshots + mappings. The client initializes intents:

- Fields with a diff between internal proposed and external current: default to `push / manual`.
- Fields with no diff: default to `skip / auto`.
- Fields where the external system has no product (create action): default to `push / manual` for all mapped fields.

### 2.2 Auto-Cascade Logic

When a field becomes `pull / manual`:

1. Compute the **effective internal value** for the mapped `internalField` — the external system's current value for that field.
2. Find all **sibling mapped fields** on other systems that map to the same `internalField`.
3. For each sibling that is still in `auto` mode:
   - If the sibling system's current value differs from the effective internal value (after normalization): set to `push / auto`.
   - If equal: set to `skip / auto`.
4. Fields in `manual` mode are never touched by cascade.

When a pull is removed (changed to push or skip), re-evaluate all auto fields as if the pull never existed. The effective internal value reverts to the actual internal product value.

### 2.3 Manual Override

- Any user interaction with a field's direction arrows flips it to `manual` mode.
- A "Reset auto decisions" button restores all `auto` fields to their cascade-computed state, re-running the cascade from current pulls.
- The UI distinguishes auto vs manual fields visually (e.g., a small "cascaded" badge on auto-push arrows, or a subtle color difference).

### 2.4 Update-Internal Toggle

- Per-field toggle, visible when direction is `pull`.
- Defaults to `true`.
- When `false`: the pulled value is still used for cascade computation (so downstream systems get the value), but the internal product PATCH skips that field.
- **Edge case**: if `updateInternalOnPull = false` AND no downstream system benefits from the effective value (all siblings are `skip` or `manual` with a different direction), the pull resolves to a **no-op**. The server marks this in the plan response via a `noOp: true` flag on the pull operation. The UI grays out the field and shows a hint: "No effect — no downstream targets." No-op pulls are excluded from the plan hash so they don't trigger unnecessary stale detection.
- Optional global toggle at the top of the modal seeds the per-field default. Changing the global toggle updates all fields that haven't been manually set.

---

## 3. Conflict Detection

### 3.1 Rules

Conflicts are keyed by `internalField`, after normalization:

- Group all `pull` selections by their mapped `internalField`.
- If more than one pull targets the same `internalField` and the normalized values differ: create a `PullConflict`.
- Equal normalized values from different systems are **not** a conflict.
- Multi-way conflicts are supported (3 systems pulling to the same field with 3 different values).

```ts
interface PullConflict {
  internalField: string;
  contenders: Array<{
    system: ExternalSystem;
    externalField: string;
    normalizedValue: string | number | null;
  }>;
}
```

### 3.2 UI Behavior

- Conflicting fields are highlighted with a warning badge.
- A banner summarizes: "Conflict: Zoho rate (6600) and HubSpot price (305) both target sellPrice."
- The **Confirm** button stays disabled while any conflict exists.
- Resolution: user changes one of the conflicting pulls to `skip` or `push`.

---

## 4. API Shape

### 4.1 Preview (existing, extended)

```
GET /api/inventory/products/:id/sync
```

Response adds `snapshots`, `mappings`, and `defaultIntents`:

```ts
{
  productId: string;
  snapshots: FieldValueSnapshot[];
  mappings: FieldMappingEdge[];
  defaultIntents: Record<ExternalSystem, Record<string, FieldIntent>>;
  basePreviewHash: string;
}
```

`basePreviewHash` covers the raw fetched external state — used to detect if external state changed before the user even submits a plan.

### 4.2 Plan Derivation (new)

```
POST /api/inventory/products/:id/sync/plan
```

```ts
// Request
{
  intents: Record<ExternalSystem, Record<string, FieldIntent>>;
}

// Response
{
  plan: SyncPlan;
}
```

The server:
1. Re-fetches current external state (or uses cached snapshots if within TTL).
2. Filters mappings by product category (`condition` field) and direction constraints (`push-only` excluded from pull intents).
3. Applies intents to derive pull operations.
4. Computes effective internal state from pulls.
5. Derives downstream push/create operations from effective state. Generates composite fields (e.g., Zuper `specification` from spec data via `generateZuperSpecification()`).
6. Expands companion fields (vendor_name → vendor_name + vendor_id).
7. Detects conflicts (§3).
8. Marks no-op pulls (§2.4).
9. Computes `planHash` over the canonical plan (excluding no-op pulls).

The client uses this to show the user exactly what will happen before they confirm.

### 4.3 Confirm (existing, revised)

```
POST /api/inventory/products/:id/sync/confirm
```

```ts
// Request
{
  planHash: string;
}

// Response
{
  token: string;
  issuedAt: number;
  expiresAt: number;
}
```

The approval token signs `productId + planHash + issuedAt`. No longer signs individual systems or a filtered changes hash — the plan hash covers everything. Token TTL is 5 minutes (reuses the existing `CATALOG_SYNC_CONFIRM_TTL_MS` from `catalog-sync-confirmation.ts`). No separate plan TTL is needed — stale detection at execute time is the safety net if external state changes between plan derivation and confirm.

### 4.4 Execute (existing, revised)

```
POST /api/inventory/products/:id/sync/execute
```

```ts
// Request
{
  planHash: string;
  token: string;
  issuedAt: number;
  intents: Record<ExternalSystem, Record<string, FieldIntent>>;
}

// Response
{
  status: "success" | "partial" | "failed" | "stale" | "conflict";
  planHash: string;
  outcomes: SyncOperationOutcome[];
}
```

The server:
1. Re-derives the plan from fresh state + submitted intents.
2. Computes fresh `planHash`.
3. If fresh hash differs from submitted hash: return `409 stale`.
4. Validates HMAC token against submitted `planHash`.
5. Checks for unresolved conflicts: return `conflict` status if any.
6. Executes in order (see Section 5).

---

## 5. Execution Order

The server executes the plan in a fixed order:

### Step 1: Apply Internal Patch

Build the internal patch from all pull operations where `updateInternal = true`. Apply via Prisma update.

- **If the patch fails**: abort all downstream external writes. Return `failed` with the patch error.

### Step 2: Re-materialize Outbound Writes

Using the now-effective internal state (actual DB values after patch), compute the outbound field values for each push/create operation. This ensures pushes always reflect the committed internal state, not a transient computed value.

### Step 3: Execute External Writes

Execute push and create operations in parallel (one per system). Each system write aggregates its field-level results into one `SyncOperationOutcome`:

```ts
interface SyncOperationOutcome {
  kind: "pull" | "push" | "create" | "internal-patch";
  system: ExternalSystem | "internal";
  status: "success" | "skipped" | "failed";
  message: string;
  source: "manual" | "cascade";
  fields?: string[]; // which external fields were written (for push/create)
}
```

Outcomes are **per-system** (one push outcome per system, one create outcome per system, one internal-patch outcome) so the results UI can show a clean per-system status row. The `fields` array provides drill-down detail.

### Step 4: Link-Back After Create

When a create operation succeeds, the external system returns an ID (e.g., Zoho `item_id`, HubSpot `product_id`, Zuper `product_uid`). The server writes this back to the `InternalProduct` record (`zohoItemId`, `hubspotProductId`, `zuperItemId`) so future syncs can update rather than re-create. This is the same link-back the current create flow performs — no new behavior, just documenting the contract.

### Step 5: Return Results

- All succeed: `status: "success"`.
- Internal patch succeeded, some external writes failed: `status: "partial"`.
- Internal patch failed: `status: "failed"`, no external writes attempted.

---

## 6. Hash and Approval Model

### 6.1 Hash Composition

Two hashes, one approval:

| Hash | Covers | Purpose |
|------|--------|---------|
| `basePreviewHash` | Raw external snapshots at preview time | Detect external drift before user acts |
| `planHash` | Full canonical plan: pulls, internal patch, pushes, creates, user overrides, cascade sources | Approval token binds to the exact plan the user reviewed |

### 6.2 Plan Hash Computation

```ts
function opSortKey(op: SyncOperation): string {
  const field = op.kind === "create" ? "create" : op.externalField;
  return `${op.kind}:${op.system}:${field}`;
}

function canonicalizeOp(op: SyncOperation): Record<string, unknown> {
  // Strip noOp (excluded from hash), keep everything else that affects the plan
  if (op.kind === "pull") {
    return { kind: op.kind, system: op.system, externalField: op.externalField,
             internalField: op.internalField, value: op.value, updateInternal: op.updateInternal };
  }
  if (op.kind === "push") {
    return { kind: op.kind, system: op.system, externalField: op.externalField,
             value: op.value, source: op.source };
  }
  // create
  return { kind: op.kind, system: op.system, fields: sortKeys(op.fields), source: op.source };
}

function computePlanHash(plan: SyncPlan): string {
  const activeOps = plan.operations.filter(op => !(op.kind === "pull" && op.noOp));
  const canonical = {
    productId: plan.productId,
    internalPatch: sortKeys(plan.internalPatch),
    operations: activeOps
      .sort((a, b) => opSortKey(a).localeCompare(opSortKey(b)))
      .map(canonicalizeOp),
  };
  return sha256(JSON.stringify(canonical));
}
```

The plan hash is deterministic: same intents + same external state = same hash. No-op pulls are excluded so they don't trigger unnecessary stale detection. Any change in no-op status between plan derivation and execution will produce a different plan hash and trigger stale detection, which is intentional — the user should re-review when a formerly no-op pull becomes active (or vice versa).

### 6.3 Stale Detection

At execute time, the server re-derives the plan from fresh state + submitted intents. If `freshPlanHash !== submittedPlanHash`, return `409 stale`. The client must re-preview and re-approve.

### 6.4 Token Schema Change

Current token signs: `productId + systems + changesHash + issuedAt`.

New token signs: `productId + planHash + issuedAt`.

This is a breaking change to the confirm/execute contract. The migration path:
- Deploy new endpoints alongside old ones (or version the request body).
- The SyncModal switches to the new flow atomically in one PR.
- Old `changesHash`-based validation is removed.

---

## 7. Failure Semantics

| Scenario | Behavior |
|----------|----------|
| Internal patch fails | Abort all downstream writes. Return `failed`. |
| Internal patch succeeds, external write fails | Return `partial`. Internal is already changed. |
| All succeed | Return `success`. |
| Plan hash mismatch at execute | Return `stale` (409). No writes. |
| Unresolved conflicts at execute | Return `conflict`. No writes. |

After any `partial` result:
- User must re-preview before retrying.
- The re-preview will show the now-updated internal state and the remaining external diffs.
- Results UI shows which operations were `manual` vs `cascade` so the user understands what happened.

**No automatic rollback** of the internal patch on external failure. The internal product is the source of truth; external systems catch up on retry.

---

## 8. UI Changes Summary

### SyncModal Changes

1. **Direction arrows** remain but gain `auto`/`manual` mode tracking.
2. **Cascaded badge**: auto-set push fields show a small indicator (e.g., "cascaded" pill or chain-link icon).
3. **Update-internal toggle**: per-field checkbox on pull fields. Global toggle at modal top seeds defaults.
4. **Conflict banner**: appears when pull conflicts are detected. Lists conflicting fields with values. Confirm disabled.
5. **Reset auto button**: restores all auto fields to cascade-computed state.
6. **Results view**: shows `manual` vs `cascade` source per outcome row.
7. **Plan preview step**: after user sets intents and clicks "Preview Plan", the modal calls `POST /sync/plan` and shows the full canonical plan before confirm. This replaces the current direct-to-confirm flow.

### Removed from Client

- `PULL_FIELD_MAP` — replaced by server-returned `mappings`.
- `COMPANION_FIELDS` — replaced by server-side plan expansion.
- `computePreviewHashClient` — replaced by server-computed `planHash`.
- Client-side pull PATCH logic — server handles internal writes.
- Client-side push/pull phase orchestration — server executes the full plan.

---

## 9. Migration Notes

### Backward Compatibility

The new API endpoints (`/sync/plan`, revised `/sync/execute`) can coexist with the current endpoints during development. The SyncModal switches to the new flow in a single PR. No gradual migration needed — verified that `SyncModal.tsx` is the only consumer of the sync confirm/execute endpoints (grep for `/sync/confirm` and `/sync/execute` confirms no other callers).

### Mapping Table Location

The shared field mapping table (`FieldMappingEdge[]`) lives in `src/lib/catalog-sync-mappings.ts` (new file). It replaces:
- `buildZohoProposedFields` / `parseZohoCurrentFields` field lists
- `buildHubSpotProposedFields` / `parseHubSpotCurrentFields` field lists
- `buildZuperProposedFields` / `parseZuperCurrentFields` field lists
- `PULL_FIELD_MAP` in SyncModal
- `COMPANION_FIELDS` in SyncModal

The existing `buildXxxProposedFields` and `parseXxxCurrentFields` functions are refactored to read from the mapping table rather than hardcoded field lists. Category-conditional edges reference the same `hubspotProperty` values already defined in `catalog-fields.ts` field definitions, keeping a single source of truth for field-to-property mapping.

### Composite Field Generators

Push-only composite fields (Zuper `specification`) use dedicated generator functions rather than simple field-to-field mapping. The `generateZuperSpecification()` function in `catalog-fields.ts` already handles this — it reads multiple spec fields from the internal product and produces a category-specific summary string (e.g., MODULE: `"410W Mono PERC"`). The mapping table references these generators via a `generator` property on push-only edges:

```ts
// In the mapping table, push-only composites reference a generator
{ system: "zuper", externalField: "specification", internalField: "_specification",
  normalizeWith: "trimmed-string", direction: "push-only",
  generator: "zuperSpecification" }  // resolved to generateZuperSpecification()
```

### Normalization Rules

Normalization functions live alongside the mapping table. Each `normalizeWith` value maps to a pure function:

```ts
const normalizers: Record<string, (v: unknown) => string | number | null> = {
  "number": (v) => { /* parse to float, null if NaN */ },
  "trimmed-string": (v) => { /* String(v).trim() */ },
  "enum-ci": (v) => { /* String(v).trim().toLowerCase() */ },
};
```
