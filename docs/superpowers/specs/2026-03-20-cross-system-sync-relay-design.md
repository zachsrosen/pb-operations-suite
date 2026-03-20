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
| `vendor-pair`    | vendor_name + vendor_id         | Companion pair — pulled together          |

### 1.3 Field Mapping Edge

A single shared server-side mapping table replaces the current split between `PULL_FIELD_MAP` (client) and `buildXxxProposedFields`/`parseXxxCurrentFields` (server):

```ts
interface FieldMappingEdge {
  system: ExternalSystem;
  externalField: string;
  internalField: string;
  normalizeWith: string; // "number" | "trimmed-string" | "enum-ci"
}
```

Companion fields (e.g., `vendor_name` + `vendor_id`) are expressed as plan-time expansion rules in the mapping table, not ad-hoc client behavior.

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
      source: "manual";
    }
  | {
      kind: "push";
      system: ExternalSystem;
      field: string;
      value: string | number | null;
      source: "manual" | "cascade";
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
- **Edge case**: if `updateInternalOnPull = false` AND no downstream system benefits from the effective value (all siblings are `skip` or `manual` with a different direction), the pull resolves to a **no-op**. The UI should gray out the field or show a hint: "No effect — no downstream targets."
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
2. Applies intents to derive pull operations.
3. Computes effective internal state from pulls.
4. Derives downstream push/create operations from effective state.
5. Expands companion fields (vendor_name → vendor_name + vendor_id).
6. Detects conflicts.
7. Computes `planHash` over the canonical plan.

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

The approval token signs `productId + planHash + issuedAt`. No longer signs individual systems or a filtered changes hash — the plan hash covers everything.

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

Execute push and create operations in parallel (one per system). Each operation returns a `SyncOperationOutcome`:

```ts
interface SyncOperationOutcome {
  kind: "pull" | "push" | "create" | "internal-patch";
  system: ExternalSystem | "internal";
  status: "success" | "skipped" | "failed";
  message: string;
  source: "manual" | "cascade";
}
```

### Step 4: Return Results

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
function computePlanHash(plan: SyncPlan): string {
  const canonical = {
    productId: plan.productId,
    internalPatch: sortKeys(plan.internalPatch),
    operations: plan.operations
      .sort((a, b) => opSortKey(a).localeCompare(opSortKey(b)))
      .map(canonicalizeOp),
  };
  return sha256(JSON.stringify(canonical));
}
```

The plan hash is deterministic: same intents + same external state = same hash.

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

The new API endpoints (`/sync/plan`, revised `/sync/execute`) can coexist with the current endpoints during development. The SyncModal switches to the new flow in a single PR. No gradual migration needed — the modal is the only consumer.

### Mapping Table Location

The shared field mapping table (`FieldMappingEdge[]`) lives in `src/lib/catalog-sync-mappings.ts` (new file). It replaces:
- `buildZohoProposedFields` / `parseZohoCurrentFields` field lists
- `buildHubSpotProposedFields` / `parseHubSpotCurrentFields` field lists
- `buildZuperProposedFields` / `parseZuperCurrentFields` field lists
- `PULL_FIELD_MAP` in SyncModal
- `COMPANION_FIELDS` in SyncModal

The existing `buildXxxProposedFields` and `parseXxxCurrentFields` functions are refactored to read from the mapping table rather than hardcoded field lists.

### Normalization Rules

Normalization functions live alongside the mapping table. Each `normalizeWith` value maps to a pure function:

```ts
const normalizers: Record<string, (v: unknown) => string | number | null> = {
  "number": (v) => { /* parse to float, null if NaN */ },
  "trimmed-string": (v) => { /* String(v).trim() */ },
  "enum-ci": (v) => { /* String(v).trim().toLowerCase() */ },
};
```
