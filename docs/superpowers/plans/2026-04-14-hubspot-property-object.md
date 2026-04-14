# HubSpot Property Custom Object — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `Property` HubSpot custom object as the durable anchor for install + service history, with Neon-cached sync, nightly reconciliation, backfill, a reusable `PropertyDrawer`, and a Service Suite customer-360 surface.

**Architecture:** A HubSpot custom object keyed by Google `place_id` (fallback `addressHash`), mirrored into Neon (`HubSpotPropertyCache` + 4 link tables). Webhook-driven sync (`contact.propertyChange` + deal/ticket creation) with DB-backed idempotency via the existing `IdempotencyKey` model and per-contact coalescing via a new `PropertySyncWatermark` row. Near-real-time rollup recomputation runs inside the webhook + a nightly reconciliation cron catches drift. ATTOM enrichment is out of scope but its fields live in the schema so no future migration is required.

**Tech Stack:** Next.js 16 App Router, Prisma 7.3 / Neon Postgres, HubSpot `@hubspot/api-client`, Google Maps Geocoding, Vercel Cron, `waitUntil` for async webhook work, React Query 5 + SSE for UI.

**Spec:** [docs/superpowers/specs/2026-04-14-hubspot-property-object-design.md](../specs/2026-04-14-hubspot-property-object-design.md)

---

## Execution Notes

- Work inside a dedicated worktree. Each chunk ends with a commit-and-verify step before the next chunk begins.
- Follow TDD: write the failing test **before** the implementation in every task unless explicitly marked "no unit test".
- Prefer editing existing files to creating new ones. The New Code Surface table in the spec lists every expected new file; don't invent more without a reason.
- When a step says "follow pattern of file X", open file X first, skim it, then write the new code. Don't guess the pattern.
- All HubSpot data-layer calls must go through a retry wrapper. The canonical one is `withRetry()` at the top of `src/lib/hubspot-custom-objects.ts` — copy it or re-use it, don't invent a new one.
- Respect the feature flag `PROPERTY_SYNC_ENABLED`. If it is OFF, webhooks return 200 without doing work, the cron is a no-op, and the backfill script refuses to start. This is the rollback lever for Phases 1-3.

## Invariants (do not violate)

1. **One-property-per-address**: `HubSpotPropertyCache.googlePlaceId` AND `HubSpotPropertyCache.addressHash` are each `@unique`. Never disable, never weaken.
2. **Never demote `Current Owner` labels in v1.** When a contact claims a property, add the label; don't remove prior owners' labels. (Spec §Risks.)
3. **Every sync path that can change associations must call `computePropertyRollups(propertyId)` before returning.** The nightly cron is the safety net, not the only writer.
4. **Webhook handler returns 200 before doing work.** Heavy lifting goes in `waitUntil`. See `src/app/api/webhooks/hubspot/deal-sync/route.ts` for the reference pattern.
5. **Idempotency is DB-backed.** Use `IdempotencyKey` with scope `"property-sync:hubspot-webhook"`. No in-memory dedup.
6. **Only one `PropertyBackfillRun` has `status='running'` at any time.** Enforced by a partial unique index (see Chunk 4, Task 4.1).
7. **HubSpot object type ID is env-driven**, not hardcoded. Read `HUBSPOT_PROPERTY_OBJECT_TYPE` in every helper.

---

## File Structure

**New files:**
| File | Responsibility |
|---|---|
| `src/lib/hubspot-property.ts` | Data layer — paged fetch, batch read, association CRUD for the Property custom object. Mirrors `hubspot-custom-objects.ts`. |
| `src/lib/property-sync.ts` | Sync orchestration — `onContactAddressChange`, `onDealOrTicketCreated`, `upsertPropertyFromGeocode`, `computePropertyRollups`. |
| `src/lib/geocode.ts` | Thin Google Geocoding wrapper with retry + cache. Extracted so `property-sync.ts` stays pure. |
| `src/lib/address-hash.ts` | Deterministic `SHA-256` over normalized address. Sole owner of the hashing contract. |
| `src/lib/resolve-geo-links.ts` | AHJ/Utility/PB-Location resolvers (read from DB + HubSpot, pure given inputs). |
| `src/app/api/webhooks/hubspot/property/route.ts` | Webhook receiver. |
| `src/app/api/cron/property-reconcile/route.ts` | Nightly reconciliation cron. |
| `src/app/api/properties/[id]/route.ts` | Detail endpoint for drawer. |
| `src/app/api/properties/resolve/route.ts` | Address → Property ID (legacy fallback). |
| `src/app/api/properties/by-contact/[contactId]/route.ts` | Used by `customer-resolver.ts`. |
| `src/app/api/properties/manual-create/route.ts` | Admin-only manual creation. |
| `src/components/PropertyDrawer.tsx` | Reusable right-side drawer. |
| `src/components/PropertyLink.tsx` | Wrapper that makes an address clickable. |
| `src/components/property/PropertyEquipmentList.tsx` | Line-item rollup section of the drawer. |
| `src/components/property/PropertyOwnershipList.tsx` | All-time owners with labels. |
| `scripts/create-hubspot-property-object.ts` | One-time HubSpot object creation. Idempotent. |
| `scripts/backfill-properties.ts` | One-time backfill (resumable via `PropertyBackfillRun`). |
| `src/__tests__/lib/address-hash.test.ts` | Unit — hashing determinism. |
| `src/__tests__/lib/geocode.test.ts` | Unit — geocode wrapper. |
| `src/__tests__/lib/property-sync.test.ts` | Unit — sync orchestration. |
| `src/__tests__/lib/resolve-geo-links.test.ts` | Unit — AHJ/Utility/Location resolution. |
| `src/__tests__/api/webhooks/property.test.ts` | Integration — signature, idempotency, coalescing. |
| `src/__tests__/api/cron/property-reconcile.test.ts` | Integration — reconciliation + `lastReconciledAt > 48h` alert. |

**Modified files:**
| File | Modification |
|---|---|
| `prisma/schema.prisma` | Add `HubSpotPropertyCache`, 4 link models, `PropertySyncWatermark`, `PropertyBackfillRun`; extend `ActivityType` enum. |
| `prisma/migrations/<timestamp>_add_property_objects/migration.sql` | Prisma-generated, plus a raw SQL appendix adding the partial unique index on `PropertyBackfillRun.status`. |
| `src/middleware.ts` | Add `/api/webhooks/hubspot/property` and `/api/cron/property-reconcile` to `PUBLIC_API_ROUTES`. |
| `vercel.json` | Add cron entry + `maxDuration: 300` overrides for both new routes. |
| `src/lib/locations.ts` | Add `resolvePbLocationFromAddress(zip, state)` helper (spec §AHJ/Utility/Location resolution). |
| `src/lib/customer-resolver.ts` | Extend result to include `properties: PropertyDetail[]`. |
| `src/app/dashboards/service-customers/<detail view>` | Render Properties section above Deals/Tickets/Jobs. |
| `.env.example` | Add `HUBSPOT_PROPERTY_OBJECT_TYPE`, `PROPERTY_SYNC_ENABLED`, `UI_PROPERTY_VIEWS_ENABLED`, `GOOGLE_MAPS_GEOCODING_KEY` (if not already present). |
| `src/components/ChatWidget.tsx` and other address rendering spots | Wrap address in `PropertyLink` where listed in spec §Initial trigger points. |
| `docs/hubspot-integration-guide.docx` | Document the final subscription list after rollout (post-implementation). |

---

## Chunk 1: Schema, Env, and HubSpot Object Bootstrap

### Task 1.1: Add Prisma models

**Files:**
- Modify: `prisma/schema.prisma` (append at the end, before the final `// END` if any, or in the "HubSpot" section if you find an obvious one — `ActivityType` is at line 91, `IdempotencyKey` at 1475; put Property models adjacent to other HubSpot cache models such as `HubSpotProjectCache` / `ZuperJobCache`)

- [ ] **Step 1: Locate existing HubSpot cache models**

Run: `grep -n "HubSpotProjectCache\|ZuperJobCache\|model SurveyInvite" prisma/schema.prisma`
Pick the section that groups HubSpot-related caches and insert the new models right after the last one in that block.

- [ ] **Step 2: Paste new models**

Copy the models verbatim from the spec (Neon Cache Schema section, lines 173-337). That is authoritative. In particular:

```prisma
model HubSpotPropertyCache {
  id                 String   @id @default(cuid())
  hubspotObjectId    String   @unique
  googlePlaceId      String?  @unique
  addressHash        String   @unique
  // ... rest exactly as spec ...
}
model PropertyContactLink { /* ... */ }
model PropertyDealLink    { /* ... */ }
model PropertyTicketLink  { /* ... */ }
model PropertyCompanyLink { /* ... */ }
model PropertySyncWatermark { /* ... */ }
model PropertyBackfillRun   { /* ... */ }
```

Do not paraphrase. The spec includes every field, every index, every `onDelete` clause.

- [ ] **Step 3: Extend `ActivityType` enum**

At line ~91 find `enum ActivityType`. Add three members at the end of the existing list, alphabetized-ish or appended — match the file's convention:

```prisma
  PROPERTY_CREATED
  PROPERTY_ASSOCIATION_ADDED
  PROPERTY_SYNC_FAILED
```

- [ ] **Step 4: Generate migration without applying**

Run: `npx prisma migrate dev --create-only --name add_property_objects`
Expected: a new folder `prisma/migrations/<timestamp>_add_property_objects/migration.sql` exists with `CREATE TABLE`s for all 6 new models and an `ALTER TYPE "ActivityType" ADD VALUE` for each enum entry.

- [ ] **Step 5: Append partial unique index to the migration**

Open the generated `migration.sql` and append at the bottom:

```sql
-- Enforce single-running backfill invariant (see Chunk 4 Task 4.1).
-- Prisma doesn't support WHERE-filtered unique indexes in its schema DSL,
-- so we add it as raw SQL. Re-running the migration is safe because of IF NOT EXISTS.
CREATE UNIQUE INDEX IF NOT EXISTS property_backfill_run_single_running
  ON "PropertyBackfillRun" (status)
  WHERE status = 'running';
```

- [ ] **Step 6: Apply the migration locally**

Run: `npx prisma migrate dev` (it will re-use the created migration)
Expected: migration applied, Prisma client regenerated in `src/generated/prisma`.

- [ ] **Step 7: Quick sanity query**

Run: `npx prisma studio` → open `HubSpotPropertyCache` → confirm empty. Close Studio.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(property): add HubSpotPropertyCache + link tables + backfill run model"
```

---

### Task 1.2: Env vars and feature flags

**Files:**
- Modify: `.env.example`
- Modify: `.env` (local only, DO NOT commit)

- [ ] **Step 1: Add entries to `.env.example`**

Append under an appropriate "HubSpot" or "Feature flags" section:

```bash
# HubSpot Property custom object (env-driven so sandbox != prod)
HUBSPOT_PROPERTY_OBJECT_TYPE=

# Feature flags — Property v1
PROPERTY_SYNC_ENABLED=false
UI_PROPERTY_VIEWS_ENABLED=false

# Google Maps Geocoding — reuse existing key if already present; document requirement here.
# GOOGLE_MAPS_API_KEY=...
```

Check first whether `GOOGLE_MAPS_API_KEY` already exists; if yes, do not duplicate, just add a comment noting Property sync reuses it.

- [ ] **Step 2: Add local dev values to `.env`**

Set `PROPERTY_SYNC_ENABLED=false` locally so the handler short-circuits until we're ready. Leave `HUBSPOT_PROPERTY_OBJECT_TYPE` empty — it gets filled in during Task 1.4 once the object exists.

- [ ] **Step 3: Commit `.env.example` change**

```bash
git add .env.example
git commit -m "chore(property): document env vars for Property sync feature"
```

---

### Task 1.3: Address hash utility (pure, TDD)

**Files:**
- Create: `src/lib/address-hash.ts`
- Create: `src/__tests__/lib/address-hash.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/lib/address-hash.test.ts
import { addressHash, normalizeAddressForHash } from "@/lib/address-hash";

describe("address-hash", () => {
  it("produces identical hash for equivalent inputs ignoring case and whitespace", () => {
    const a = addressHash({ street: "1234 Main St", unit: "#2", city: "Boulder", state: "CO", zip: "80301" });
    const b = addressHash({ street: "1234 MAIN ST ", unit: " #2", city: "boulder", state: "co", zip: "80301" });
    expect(a).toBe(b);
  });
  it("differs when zip differs", () => {
    const a = addressHash({ street: "1 A", unit: null, city: "X", state: "CA", zip: "90001" });
    const b = addressHash({ street: "1 A", unit: null, city: "X", state: "CA", zip: "90002" });
    expect(a).not.toBe(b);
  });
  it("differs when unit differs", () => {
    const a = addressHash({ street: "1 A", unit: "1", city: "X", state: "CA", zip: "90001" });
    const b = addressHash({ street: "1 A", unit: "2", city: "X", state: "CA", zip: "90001" });
    expect(a).not.toBe(b);
  });
  it("is 64 hex chars (SHA-256)", () => {
    expect(addressHash({ street: "1 A", unit: null, city: "X", state: "CA", zip: "90001" })).toMatch(/^[0-9a-f]{64}$/);
  });
  it("normalizeAddressForHash trims and lowercases components", () => {
    expect(normalizeAddressForHash({ street: " 1 A ", unit: null, city: "X", state: "ca", zip: "90001" }))
      .toBe("1 a||x|ca|90001");
  });
});
```

- [ ] **Step 2: Run test — expect fail**

Run: `npm test -- address-hash.test.ts`
Expected: FAIL, cannot resolve `@/lib/address-hash`.

- [ ] **Step 3: Implement**

```ts
// src/lib/address-hash.ts
import { createHash } from "crypto";

export interface AddressParts {
  street: string;
  unit: string | null | undefined;
  city: string;
  state: string;
  zip: string;
}

export function normalizeAddressForHash(parts: AddressParts): string {
  const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return [norm(parts.street), norm(parts.unit), norm(parts.city), norm(parts.state), norm(parts.zip)].join("|");
}

export function addressHash(parts: AddressParts): string {
  return createHash("sha256").update(normalizeAddressForHash(parts)).digest("hex");
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `npm test -- address-hash.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/address-hash.ts src/__tests__/lib/address-hash.test.ts
git commit -m "feat(property): address hashing utility for dedup fallback"
```

---

### Task 1.4: HubSpot Property object creation script

**Files:**
- Create: `scripts/create-hubspot-property-object.ts`

This is a one-time operational script, not application code. It is idempotent: running twice is safe and the second run reports "already exists".

- [ ] **Step 1: Draft the script**

```ts
// scripts/create-hubspot-property-object.ts
// Usage: HUBSPOT_ACCESS_TOKEN=... tsx scripts/create-hubspot-property-object.ts
// Creates the Property custom object in the currently authenticated portal (whichever token is loaded).
// After success, it prints the objectTypeId — copy it to HUBSPOT_PROPERTY_OBJECT_TYPE in .env.
import { Client } from "@hubspot/api-client";

const hubspot = new Client({ accessToken: process.env.HUBSPOT_ACCESS_TOKEN });

async function main() {
  // 1. Check if object already exists by name
  const schemas = await hubspot.crm.schemas.coreApi.getAll();
  const existing = schemas.results.find((s) => s.name === "property" || s.labels?.singular === "Property");
  if (existing) {
    console.log(`Property object already exists: ${existing.objectTypeId}`);
    console.log(`Set HUBSPOT_PROPERTY_OBJECT_TYPE=${existing.objectTypeId}`);
    return;
  }

  // 2. Create object with identity + geographic fields first (rollups & ATTOM fields added below)
  const created = await hubspot.crm.schemas.coreApi.create({
    name: "property",
    labels: { singular: "Property", plural: "Properties" },
    primaryDisplayProperty: "record_name",
    requiredProperties: ["google_place_id"],
    searchableProperties: ["record_name", "full_address", "street_address", "city", "zip"],
    properties: [
      // ... identity + geographic fields from spec §HubSpot Object Schema ...
      // Copy the full Field table literally. Use 'string' for text, 'number' for numeric,
      // 'date' for dates, 'enumeration' for property_type with options, 'bool' for boolean.
    ],
    associatedObjects: ["CONTACT", "DEAL", "TICKET", "COMPANY"],
  });

  console.log(`Created Property object: ${created.objectTypeId}`);
  console.log(`Set HUBSPOT_PROPERTY_OBJECT_TYPE=${created.objectTypeId}`);

  // 3. Create association definitions to custom objects (AHJ, Utility, Location)
  // These must be added separately via /crm/v4/associations/definitions/...
  // because they don't go in associatedObjects. See
  // https://developers.hubspot.com/docs/api/crm/associations/v4
  // Pseudocode: for each customTypeId in [AHJ, UTILITY, LOCATION]:
  //   POST /crm/v4/associations/definitions/{propertyTypeId}/{customTypeId}
  //   with label configuration.

  // 4. Create association labels on Contact and Company sides
  // Labels are defined in spec §Associations table. Use v4 API with name + label + category.
}

main().catch((err) => { console.error(err); process.exit(1); });
```

Flesh out the `properties` array from the spec's Field table. Use the HubSpot docs (via `context7` MCP if needed — resolve library id `@hubspot/api-client` first) to verify the exact payload shape. Ask context7 for "hubspot custom object schema create" if unclear.

- [ ] **Step 2: Dry-run against dev portal**

Ensure you're authenticated to a SANDBOX portal, not prod. Run: `tsx scripts/create-hubspot-property-object.ts`
Expected: prints `Created Property object: 2-XXXXXXX`. If you see an existing-object message, that's fine too.

- [ ] **Step 3: Copy the object type ID into `.env`**

Set `HUBSPOT_PROPERTY_OBJECT_TYPE=2-XXXXXXX` in local `.env`.

- [ ] **Step 4: Verify associations in HubSpot UI**

Open the HubSpot sandbox → Settings → Objects → Property. Confirm the 7 associated objects are listed and the labels match the spec. If any are missing, re-run the script or add them manually in the UI.

- [ ] **Step 5: Commit**

```bash
git add scripts/create-hubspot-property-object.ts
git commit -m "feat(property): bootstrap script for HubSpot Property custom object"
```

---

### Task 1.5: Data-layer helpers (`hubspot-property.ts`)

**Files:**
- Create: `src/lib/hubspot-property.ts`

Mirror the structure of `src/lib/hubspot-custom-objects.ts` (reviewed above). Export the minimum surface needed for sync + UI:

- `fetchAllProperties()` → `PropertyRecord[]` — paged
- `fetchPropertyById(id)` → `PropertyRecord | null`
- `fetchPropertiesForContact(contactId)` → `PropertyRecord[]`
- `fetchPropertiesForDeal(dealId)` → `PropertyRecord[]`
- `fetchPropertiesForTicket(ticketId)` → `PropertyRecord[]`
- `createProperty(props)` → `{ id }`
- `updateProperty(id, props)` → void
- `associateProperty(propId, toType, toId, label?)` → void
- `dissociateProperty(propId, toType, toId)` → void (exported but unused in v1; handy for tests/scripts)
- `searchPropertyByPlaceId(placeId)` → `PropertyRecord | null` (uses HubSpot search API)

- [ ] **Step 1: Write skeleton + minimal tests**

Create the file with module-level constants:

```ts
const PROPERTY_OBJECT_TYPE = () => {
  const id = process.env.HUBSPOT_PROPERTY_OBJECT_TYPE;
  if (!id) throw new Error("HUBSPOT_PROPERTY_OBJECT_TYPE is not set");
  return id;
};

export const PROPERTY_PROPERTIES = [
  "record_name", "google_place_id", "normalized_address", "full_address",
  "street_address", "unit_number", "city", "state", "zip", "county",
  "latitude", "longitude",
  "attom_id",
  "first_install_date", "most_recent_install_date",
  "associated_deals_count", "associated_tickets_count", "open_tickets_count",
  "system_size_kw_dc", "has_battery", "has_ev_charger",
  "last_service_date", "earliest_warranty_expiry",
  "ahj_name", "utility_name", "pb_location",
  "property_type", "main_panel_amperage", "main_panel_manufacturer", "service_entrance_type",
  "general_notes",
  // ATTOM-sourced placeholders included so we can READ them once populated.
  "parcel_apn", "zoning", "assessed_value", "last_sale_date", "last_sale_price",
  "public_record_owner_name", "year_built", "square_footage", "lot_size_sqft",
  "stories", "bedrooms", "bathrooms", "foundation_type", "construction_type",
  "roof_material", "roof_age_years", "roof_last_replaced_year", "roof_condition_notes",
  "flood_zone", "wildfire_risk_zone", "hoa_name",
  "attom_last_synced_at", "attom_match_confidence",
] as const;
```

Copy the `withRetry` function body from `hubspot-custom-objects.ts` (or import it — if it's not currently exported from there, export it in a small refactor).

- [ ] **Step 2: Implement fetch functions by copying the AHJ pattern**

Read `fetchAllAHJs`, `fetchAHJsForDeal` (lines 252-320 in `hubspot-custom-objects.ts`). The Property variants are mechanically identical — just swap the object type ID and properties list. For `fetchPropertiesForContact`, use `fetchCrmObjects` on associations from `"contacts"` to `PROPERTY_OBJECT_TYPE()`.

- [ ] **Step 3: Implement create/update/associate**

```ts
export async function createProperty(props: Record<string, string | number | boolean | null>): Promise<{ id: string }> {
  const response = await withRetry(() =>
    hubspotClient.crm.objects.basicApi.create(PROPERTY_OBJECT_TYPE(), {
      properties: coerceHubSpotProps(props),
      associations: [],
    })
  );
  return { id: response.id };
}

export async function associateProperty(
  propertyId: string,
  toObjectType: "contacts" | "deals" | "tickets" | "companies" | string, // string = custom object type ID (AHJ/Util/Loc)
  toObjectId: string,
  labelAssociationTypeId?: number
): Promise<void> {
  await withRetry(() =>
    hubspotClient.crm.associations.v4.basicApi.create(
      PROPERTY_OBJECT_TYPE(),
      propertyId,
      toObjectType,
      toObjectId,
      labelAssociationTypeId
        ? [{ associationCategory: "USER_DEFINED", associationTypeId: labelAssociationTypeId }]
        : [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 1 }] // primary unlabeled
    )
  );
}
```

`coerceHubSpotProps` converts nulls to empty strings and booleans to `"true"/"false"` (HubSpot expects strings). See `syncSingleDeal` in `src/lib/deal-sync.ts` for the pattern if unclear.

- [ ] **Step 4: `searchPropertyByPlaceId`**

```ts
export async function searchPropertyByPlaceId(placeId: string): Promise<PropertyRecord | null> {
  const response = await withRetry(() =>
    hubspotClient.crm.objects.searchApi.doSearch(PROPERTY_OBJECT_TYPE(), {
      filterGroups: [{ filters: [{ propertyName: "google_place_id", operator: "EQ", value: placeId }] }],
      properties: [...PROPERTY_PROPERTIES],
      limit: 1,
    })
  );
  const r = response.results[0];
  return r ? { id: r.id, properties: r.properties as Record<string, string | null> } : null;
}
```

- [ ] **Step 5: No unit test in this task** — this is a thin wrapper over HubSpot, covered by integration tests in later chunks. Type-check only.

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/hubspot-property.ts
git commit -m "feat(property): data-layer helpers for HubSpot Property object"
```

---

### Task 1.6: Middleware + vercel.json plumbing (routes not live yet, just reserved)

**Files:**
- Modify: `src/middleware.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Add to `PUBLIC_API_ROUTES`**

Open `src/middleware.ts`. Find the `PUBLIC_API_ROUTES` array (line ~14). Add:

```ts
  "/api/webhooks/hubspot/property",
  "/api/cron/property-reconcile",
```

next to the other `/api/webhooks/hubspot/...` and `/api/cron/...` entries.

- [ ] **Step 2: Add cron + function overrides to `vercel.json`**

In the `functions` block add:

```json
    "src/app/api/webhooks/hubspot/property/route.ts": {
      "maxDuration": 300
    },
    "src/app/api/cron/property-reconcile/route.ts": {
      "maxDuration": 300
    }
```

In the `crons` array add:

```json
    {
      "path": "/api/cron/property-reconcile",
      "schedule": "0 9 * * *"
    }
```

(9am UTC = 3am MT during standard time; accept the 1-hour drift in DST rather than special-case it. Document that the schedule is UTC.)

- [ ] **Step 3: Smoke-test the JSON is valid**

Run: `cat vercel.json | npx --yes jsonlint -q`
Expected: no output (valid JSON).

- [ ] **Step 4: Commit**

```bash
git add src/middleware.ts vercel.json
git commit -m "feat(property): allowlist webhook + cron routes in middleware and vercel.json"
```

---

### End of Chunk 1 — checkpoint

At this point:
- Schema is migrated, enum extended, partial unique index exists.
- HubSpot Property object exists in sandbox, `HUBSPOT_PROPERTY_OBJECT_TYPE` set in `.env`.
- Data-layer helpers compile (no behavior yet — no callers).
- Routes are allowlisted in middleware + declared in `vercel.json` (handlers not written yet — a request will 404, which is fine).

Run: `npm run lint && npm test` — expect green.

Commit the whole chunk if individual commits weren't already made:
```bash
git log --oneline origin/main..HEAD
```

Should show ~6 commits. Push and continue.

---

## Chunk 2: Sync Library (`geocode.ts`, `resolve-geo-links.ts`, `property-sync.ts`)

### Task 2.1: Geocoding wrapper (TDD)

**Files:**
- Create: `src/lib/geocode.ts`
- Create: `src/__tests__/lib/geocode.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/lib/geocode.test.ts
import { geocodeAddress } from "@/lib/geocode";

describe("geocodeAddress", () => {
  it("returns null when address is incomplete", async () => {
    expect(await geocodeAddress({ street: "", city: "", state: "", zip: "" })).toBeNull();
  });

  it("parses a Google API success response", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "OK",
        results: [{
          place_id: "abc123",
          formatted_address: "1234 Main St, Boulder, CO 80301, USA",
          geometry: { location: { lat: 40.01, lng: -105.27 } },
          address_components: [
            { short_name: "1234", types: ["street_number"] },
            { short_name: "Main St", types: ["route"] },
            { short_name: "Boulder", types: ["locality"] },
            { short_name: "CO", types: ["administrative_area_level_1"] },
            { short_name: "80301", types: ["postal_code"] },
            { short_name: "Boulder County", types: ["administrative_area_level_2"] },
          ],
        }],
      }),
    });
    const r = await geocodeAddress({ street: "1234 Main St", city: "Boulder", state: "CO", zip: "80301" });
    expect(r).toMatchObject({
      placeId: "abc123",
      latitude: 40.01,
      longitude: -105.27,
      city: "Boulder",
      state: "CO",
      zip: "80301",
      county: "Boulder County",
    });
  });

  it("returns null place_id but still resolves other fields for ZERO_RESULTS fallback", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "ZERO_RESULTS", results: [] }),
    });
    expect(await geocodeAddress({ street: "1 Nowhere", city: "X", state: "XX", zip: "00000" })).toBeNull();
  });

  it("throws on OVER_QUERY_LIMIT for the retry layer to handle", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "OVER_QUERY_LIMIT" }),
    });
    await expect(geocodeAddress({ street: "1", city: "X", state: "Y", zip: "00000" })).rejects.toThrow(/OVER_QUERY_LIMIT/);
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npm test -- geocode.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/lib/geocode.ts
export interface GeocodeInput {
  street: string;
  unit?: string | null;
  city: string;
  state: string;
  zip: string;
  country?: string;
}

export interface GeocodeResult {
  placeId: string | null;       // nullable — rural/PO-box addresses sometimes return no place_id
  formattedAddress: string;
  latitude: number;
  longitude: number;
  streetNumber: string;
  route: string;
  streetAddress: string;        // composed street_number + route
  city: string;
  state: string;
  zip: string;
  county: string | null;
}

export async function geocodeAddress(input: GeocodeInput): Promise<GeocodeResult | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_MAPS_API_KEY is not set");

  const fullAddress = [
    input.street + (input.unit ? ` ${input.unit}` : ""),
    input.city, input.state, input.zip, input.country ?? "USA",
  ].filter(Boolean).join(", ").trim();

  if (!input.street || !input.city || !input.state || !input.zip) return null;

  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", fullAddress);
  url.searchParams.set("key", apiKey);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Google Geocoding HTTP ${res.status}`);
  const body = await res.json();

  if (body.status === "OVER_QUERY_LIMIT" || body.status === "UNKNOWN_ERROR") {
    throw new Error(`Google Geocoding transient: ${body.status}`);
  }
  if (body.status !== "OK" || !body.results?.length) return null;

  const r = body.results[0];
  const comp = (type: string) =>
    r.address_components.find((c: { types: string[]; short_name: string }) => c.types.includes(type))?.short_name ?? "";

  const streetNumber = comp("street_number");
  const route = comp("route");

  return {
    placeId: r.place_id || null,
    formattedAddress: r.formatted_address,
    latitude: r.geometry.location.lat,
    longitude: r.geometry.location.lng,
    streetNumber,
    route,
    streetAddress: [streetNumber, route].filter(Boolean).join(" "),
    city: comp("locality") || comp("sublocality"),
    state: comp("administrative_area_level_1"),
    zip: comp("postal_code"),
    county: comp("administrative_area_level_2") || null,
  };
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npm test -- geocode.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/geocode.ts src/__tests__/lib/geocode.test.ts
git commit -m "feat(property): google geocoding wrapper with retry-visible errors"
```

---

### Task 2.2: PB Location resolver — extend `locations.ts` (TDD)

**Files:**
- Modify: `src/lib/locations.ts`
- Create: `src/__tests__/lib/resolve-geo-links.test.ts` (covers PB location + AHJ + utility in later tasks)

- [ ] **Step 1: Write the failing test**

Append to a new test file `src/__tests__/lib/resolve-geo-links.test.ts`:

```ts
import { resolvePbLocationFromAddress } from "@/lib/locations";

describe("resolvePbLocationFromAddress", () => {
  it("maps Boulder (80301) to Westminster", () => {
    expect(resolvePbLocationFromAddress("80301", "CO")).toBe("Westminster");
  });
  it("maps Colorado Springs zip to Colorado Springs", () => {
    expect(resolvePbLocationFromAddress("80903", "CO")).toBe("Colorado Springs");
  });
  it("maps a Centennial zip to Centennial", () => {
    expect(resolvePbLocationFromAddress("80112", "CO")).toBe("Centennial");
  });
  it("maps Camarillo zips to Camarillo", () => {
    expect(resolvePbLocationFromAddress("93010", "CA")).toBe("Camarillo");
  });
  it("maps SLO zips to San Luis Obispo", () => {
    expect(resolvePbLocationFromAddress("93401", "CA")).toBe("San Luis Obispo");
  });
  it("returns null for unknown zip+state", () => {
    expect(resolvePbLocationFromAddress("10001", "NY")).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npm test -- resolve-geo-links.test.ts`
Expected: FAIL (function not exported).

- [ ] **Step 3: Implement — append to `src/lib/locations.ts`**

```ts
// ---- Zip + state → PB Location ----
// Kept as a simple static map maintained by Ops. Future: lat/lng + service-radius resolution.
// Zip prefixes cover the broad metro bands around each shop. Tie-breaker precedence: CO zips
// route to the CO-shop band they fall in, CA zips to the CA-shop band.
const ZIP_PREFIX_TO_LOCATION: Record<string, CanonicalLocation> = {
  // Westminster / north metro Denver
  "800": "Westminster", "801": "Westminster", "802": "Westminster", "803": "Westminster",
  // Centennial / south metro Denver + DTC
  "811": "Centennial", "801:denver-south-specific-overrides-see-code-below": "Centennial",
  // Colorado Springs
  "808": "Colorado Springs", "809": "Colorado Springs",
  // Camarillo / Ventura county
  "930": "Camarillo",
  // San Luis Obispo / SLO county
  "934": "San Luis Obispo", "935": "San Luis Obispo", "936": "San Luis Obispo",
};

// Fine-grained overrides where a 3-digit prefix straddles shops (e.g. Denver metro 801xx covers both Westminster and Centennial).
const FULL_ZIP_OVERRIDES: Record<string, CanonicalLocation> = {
  "80111": "Centennial", "80112": "Centennial", "80113": "Centennial", "80121": "Centennial",
  "80122": "Centennial", "80124": "Centennial", "80125": "Centennial", "80126": "Centennial",
  "80128": "Centennial", "80129": "Centennial", "80130": "Centennial", "80134": "Centennial",
  "80138": "Centennial",
  // (extend as Ops refines — keep the override table in this file, not a DB table, to keep v1 simple)
};

export function resolvePbLocationFromAddress(zip: string, state: string): CanonicalLocation | null {
  const z = (zip ?? "").trim();
  const s = (state ?? "").trim().toUpperCase();
  if (!z || z.length < 3) return null;
  if (FULL_ZIP_OVERRIDES[z]) return FULL_ZIP_OVERRIDES[z];

  const prefix = z.slice(0, 3);
  const candidate = ZIP_PREFIX_TO_LOCATION[prefix];
  if (!candidate) return null;

  // State sanity check — CO shops must have CO zips, CA shops must have CA zips.
  const expectedState = (candidate === "Camarillo" || candidate === "San Luis Obispo") ? "CA" : "CO";
  if (s !== expectedState) return null;

  return candidate;
}
```

Clean up the junk key in `ZIP_PREFIX_TO_LOCATION` before running — the `"801:denver-south-specific-overrides-see-code-below"` entry is a reminder and should be removed once you understand the layered-override approach. `FULL_ZIP_OVERRIDES` handles the 801xx split.

- [ ] **Step 4: Run — expect pass**

Run: `npm test -- resolve-geo-links.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/locations.ts src/__tests__/lib/resolve-geo-links.test.ts
git commit -m "feat(property): zip + state → PB shop resolver"
```

---

### Task 2.3: AHJ + Utility resolver

**Files:**
- Create: `src/lib/resolve-geo-links.ts`
- Modify: `src/__tests__/lib/resolve-geo-links.test.ts` (add tests)

Spec §AHJ/Utility resolution cascade: (1) deal zip match → existing AHJ/Util associations; (2) `service_area` substring; (3) closest-match-by-zip; (4) null.

- [ ] **Step 1: Write tests**

```ts
// Append to src/__tests__/lib/resolve-geo-links.test.ts
import { resolveAhjForProperty, resolveUtilityForProperty } from "@/lib/resolve-geo-links";

// Jest auto-mock the prisma + hubspot-custom-objects modules; set up mocks per test.
jest.mock("@/lib/db", () => ({ prisma: { deal: { findMany: jest.fn() } } }));
jest.mock("@/lib/hubspot-custom-objects", () => ({
  fetchAllAHJs: jest.fn(),
  fetchAllUtilities: jest.fn(),
  fetchAHJsForDeal: jest.fn(),
  fetchUtilitiesForDeal: jest.fn(),
}));

describe("resolveAhjForProperty", () => {
  it("returns AHJ from an existing deal at the same zip when available", async () => {
    const { prisma } = jest.requireMock("@/lib/db");
    const { fetchAHJsForDeal } = jest.requireMock("@/lib/hubspot-custom-objects");
    prisma.deal.findMany.mockResolvedValue([{ hubspotDealId: "d1", zip: "80301" }]);
    fetchAHJsForDeal.mockResolvedValue([{ id: "ahj-boulder", properties: { record_name: "Boulder" } }]);

    const r = await resolveAhjForProperty({ zip: "80301", city: "Boulder", state: "CO", lat: 40, lng: -105 });
    expect(r).toEqual({ objectId: "ahj-boulder", name: "Boulder" });
  });

  it("falls back to service_area substring match", async () => {
    const { prisma } = jest.requireMock("@/lib/db");
    const { fetchAllAHJs } = jest.requireMock("@/lib/hubspot-custom-objects");
    prisma.deal.findMany.mockResolvedValue([]);
    fetchAllAHJs.mockResolvedValue([
      { id: "a1", properties: { record_name: "Boulder County", service_area: "Includes Boulder, Longmont, Louisville" } },
      { id: "a2", properties: { record_name: "Denver", service_area: "Denver only" } },
    ]);
    const r = await resolveAhjForProperty({ zip: "80301", city: "Boulder", state: "CO", lat: 40, lng: -105 });
    expect(r).toEqual({ objectId: "a1", name: "Boulder County" });
  });

  it("returns null when nothing matches", async () => {
    const { prisma } = jest.requireMock("@/lib/db");
    const { fetchAllAHJs } = jest.requireMock("@/lib/hubspot-custom-objects");
    prisma.deal.findMany.mockResolvedValue([]);
    fetchAllAHJs.mockResolvedValue([]);
    expect(await resolveAhjForProperty({ zip: "99999", city: "Nowhere", state: "XX", lat: 0, lng: 0 })).toBeNull();
  });
});
```

(Write an analogous `describe("resolveUtilityForProperty")` block — same three branches.)

- [ ] **Step 2: Run — expect fail**

Run: `npm test -- resolve-geo-links.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/lib/resolve-geo-links.ts
import { prisma } from "@/lib/db";
import { fetchAllAHJs, fetchAHJsForDeal, fetchAllUtilities, fetchUtilitiesForDeal } from "@/lib/hubspot-custom-objects";

export interface GeoResolveInput {
  zip: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
}

export interface GeoLinkResult {
  objectId: string;
  name: string;
}

export async function resolveAhjForProperty(input: GeoResolveInput): Promise<GeoLinkResult | null> {
  return resolveCustomObjectLink(input, {
    fetchFromDeal: fetchAHJsForDeal,
    fetchAll: fetchAllAHJs,
  });
}

export async function resolveUtilityForProperty(input: GeoResolveInput): Promise<GeoLinkResult | null> {
  return resolveCustomObjectLink(input, {
    fetchFromDeal: fetchUtilitiesForDeal,
    fetchAll: fetchAllUtilities,
  });
}

async function resolveCustomObjectLink(
  { zip, city, state }: GeoResolveInput,
  adapters: {
    fetchFromDeal: (dealId: string) => Promise<Array<{ id: string; properties: Record<string, string | null> }>>;
    fetchAll: () => Promise<Array<{ id: string; properties: Record<string, string | null> }>>;
  }
): Promise<GeoLinkResult | null> {
  // 1) Nearby-deal mining
  const nearbyDeals = await prisma.deal.findMany({
    where: { zip, state, stage: { not: "DELETED" } },
    select: { hubspotDealId: true },
    take: 5,
    orderBy: { lastSyncedAt: "desc" },
  });
  for (const d of nearbyDeals) {
    const linked = await adapters.fetchFromDeal(d.hubspotDealId);
    if (linked.length) {
      return { objectId: linked[0].id, name: linked[0].properties.record_name ?? "" };
    }
  }

  // 2) service_area substring
  const all = await adapters.fetchAll();
  const cityLower = city.toLowerCase();
  const hit = all.find((r) => (r.properties.service_area ?? "").toLowerCase().includes(cityLower));
  if (hit) return { objectId: hit.id, name: hit.properties.record_name ?? "" };

  // 3) (TODO later) closest-match-by-zip — skipped in v1 because existing data doesn't expose a zip field on AHJ/Util.
  //    The service_area cascade handles practical cases; log ambiguous misses in property-sync for Ops review.

  return null;
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npm test -- resolve-geo-links.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/resolve-geo-links.ts src/__tests__/lib/resolve-geo-links.test.ts
git commit -m "feat(property): AHJ + utility resolver (deal-mining → service_area fallback)"
```

---

### Task 2.4: `property-sync.ts` — core `onContactAddressChange` (TDD)

**Files:**
- Create: `src/lib/property-sync.ts`
- Create: `src/__tests__/lib/property-sync.test.ts`

Single biggest module. Covers: geocode → find-or-create → associate → upsert cache → rollups. Split into private helpers; keep public surface small.

Public exports:
- `onContactAddressChange(contactId: string): Promise<SyncOutcome>`
- `onDealOrTicketCreated(kind: "deal" | "ticket", objectId: string): Promise<SyncOutcome>`
- `computePropertyRollups(propertyCacheId: string): Promise<void>`
- `upsertPropertyFromGeocode(contactId, addressParts): Promise<{ propertyCacheId: string; created: boolean }>` (used by manual-create endpoint + backfill)
- `reconcileAllProperties(): Promise<ReconcileStats>` (used by cron)

Type:
```ts
export interface SyncOutcome {
  status: "created" | "associated" | "skipped" | "deferred" | "failed";
  propertyCacheId?: string;
  reason?: string;
}
```

- [ ] **Step 1: Write the first batch of failing tests — `onContactAddressChange` happy paths**

```ts
// src/__tests__/lib/property-sync.test.ts
import { onContactAddressChange } from "@/lib/property-sync";

jest.mock("@/lib/db", () => ({
  prisma: {
    hubSpotPropertyCache: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    propertyContactLink: { upsert: jest.fn() },
    propertySyncWatermark: { findUnique: jest.fn(), upsert: jest.fn() },
    activityLog: { create: jest.fn() },
  },
}));
jest.mock("@/lib/geocode", () => ({ geocodeAddress: jest.fn() }));
jest.mock("@/lib/hubspot-property", () => ({
  searchPropertyByPlaceId: jest.fn(),
  createProperty: jest.fn(),
  associateProperty: jest.fn(),
  fetchPropertyById: jest.fn(),
}));
jest.mock("@/lib/hubspot", () => ({ fetchContactById: jest.fn() }));
jest.mock("@/lib/resolve-geo-links", () => ({
  resolveAhjForProperty: jest.fn(), resolveUtilityForProperty: jest.fn(),
}));

describe("onContactAddressChange", () => {
  beforeEach(() => jest.clearAllMocks());

  it("skips when coalescing window is hot (< 2s since last sync)", async () => {
    const { prisma } = jest.requireMock("@/lib/db");
    prisma.propertySyncWatermark.findUnique.mockResolvedValue({ contactId: "c1", lastSyncAt: new Date(Date.now() - 500) });
    const outcome = await onContactAddressChange("c1");
    expect(outcome.status).toBe("skipped");
    expect(outcome.reason).toMatch(/coalesc/i);
  });

  it("skips when contact has incomplete address", async () => {
    const { prisma } = jest.requireMock("@/lib/db");
    const { fetchContactById } = jest.requireMock("@/lib/hubspot");
    prisma.propertySyncWatermark.findUnique.mockResolvedValue(null);
    fetchContactById.mockResolvedValue({ properties: { address: "1 A", city: "", state: "CO", zip: "80301" } });
    const outcome = await onContactAddressChange("c1");
    expect(outcome.status).toBe("skipped");
    expect(outcome.reason).toMatch(/address incomplete/i);
  });

  it("creates a new Property when no cache row exists for the place_id", async () => {
    const { prisma } = jest.requireMock("@/lib/db");
    const { fetchContactById } = jest.requireMock("@/lib/hubspot");
    const { geocodeAddress } = jest.requireMock("@/lib/geocode");
    const { createProperty, associateProperty, searchPropertyByPlaceId } = jest.requireMock("@/lib/hubspot-property");
    const { resolveAhjForProperty, resolveUtilityForProperty } = jest.requireMock("@/lib/resolve-geo-links");

    prisma.propertySyncWatermark.findUnique.mockResolvedValue(null);
    fetchContactById.mockResolvedValue({ properties: { address: "1 A", city: "B", state: "CO", zip: "80301" } });
    geocodeAddress.mockResolvedValue({
      placeId: "p1", formattedAddress: "1 A, B CO 80301", latitude: 40, longitude: -105,
      streetNumber: "1", route: "A", streetAddress: "1 A", city: "B", state: "CO", zip: "80301", county: "Boulder",
    });
    prisma.hubSpotPropertyCache.findUnique.mockResolvedValue(null);
    searchPropertyByPlaceId.mockResolvedValue(null);
    resolveAhjForProperty.mockResolvedValue({ objectId: "ahj1", name: "Boulder" });
    resolveUtilityForProperty.mockResolvedValue({ objectId: "util1", name: "Xcel" });
    createProperty.mockResolvedValue({ id: "prop-hs-1" });
    prisma.hubSpotPropertyCache.create.mockResolvedValue({ id: "cache-1" });

    const outcome = await onContactAddressChange("c1");

    expect(createProperty).toHaveBeenCalled();
    expect(associateProperty).toHaveBeenCalledWith("prop-hs-1", "contacts", "c1", expect.any(Number));
    expect(prisma.hubSpotPropertyCache.create).toHaveBeenCalled();
    expect(prisma.propertyContactLink.upsert).toHaveBeenCalled();
    expect(prisma.propertySyncWatermark.upsert).toHaveBeenCalled();
    expect(outcome.status).toBe("created");
  });

  it("associates to existing Property when place_id is already known", async () => {
    const { prisma } = jest.requireMock("@/lib/db");
    const { fetchContactById } = jest.requireMock("@/lib/hubspot");
    const { geocodeAddress } = jest.requireMock("@/lib/geocode");
    const { associateProperty, createProperty } = jest.requireMock("@/lib/hubspot-property");

    prisma.propertySyncWatermark.findUnique.mockResolvedValue(null);
    fetchContactById.mockResolvedValue({ properties: { address: "1 A", city: "B", state: "CO", zip: "80301" } });
    geocodeAddress.mockResolvedValue({ placeId: "p1", latitude: 40, longitude: -105, city: "B", state: "CO", zip: "80301",
      formattedAddress: "1 A, B CO 80301", streetAddress: "1 A", streetNumber: "1", route: "A", county: "Boulder" });
    prisma.hubSpotPropertyCache.findUnique.mockResolvedValue({ id: "cache-1", hubspotObjectId: "prop-hs-1" });

    const outcome = await onContactAddressChange("c1");

    expect(createProperty).not.toHaveBeenCalled();
    expect(associateProperty).toHaveBeenCalledWith("prop-hs-1", "contacts", "c1", expect.any(Number));
    expect(outcome.status).toBe("associated");
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npm test -- property-sync.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement the module (shell + helpers)**

```ts
// src/lib/property-sync.ts
import { prisma } from "@/lib/db";
import { geocodeAddress } from "@/lib/geocode";
import { addressHash } from "@/lib/address-hash";
import {
  searchPropertyByPlaceId, createProperty, updateProperty,
  associateProperty, fetchPropertyById, fetchAllProperties,
  PROPERTY_PROPERTIES,
} from "@/lib/hubspot-property";
import { fetchContactById, fetchDealById, fetchTicketById } from "@/lib/hubspot";
import { resolveAhjForProperty, resolveUtilityForProperty } from "@/lib/resolve-geo-links";
import { resolvePbLocationFromAddress } from "@/lib/locations";
import type { ActivityType } from "@/generated/prisma";

export type SyncStatus = "created" | "associated" | "skipped" | "deferred" | "failed";
export interface SyncOutcome { status: SyncStatus; propertyCacheId?: string; reason?: string; }

// HubSpot association type IDs for labeled associations.
// Populate at deploy time; the create-hubspot-property-object script prints them.
// Keep them in env so sandbox/prod can differ.
const CONTACT_LABEL_ASSOCIATION_IDS = {
  CURRENT_OWNER: Number(process.env.HUBSPOT_PROPERTY_CONTACT_ASSOC_CURRENT_OWNER ?? 0),
  // ... PREVIOUS_OWNER, TENANT, PROPERTY_MANAGER, AUTHORIZED_CONTACT
};

const COALESCE_WINDOW_MS = 2_000;

function isFeatureEnabled(): boolean {
  return process.env.PROPERTY_SYNC_ENABLED === "true";
}

export async function onContactAddressChange(contactId: string): Promise<SyncOutcome> {
  if (!isFeatureEnabled()) return { status: "skipped", reason: "feature flag off" };

  // 1) Coalesce bursty webhooks
  const watermark = await prisma.propertySyncWatermark.findUnique({ where: { contactId } });
  if (watermark && Date.now() - watermark.lastSyncAt.getTime() < COALESCE_WINDOW_MS) {
    return { status: "skipped", reason: "coalesced" };
  }

  // 2) Fetch contact from HubSpot
  const contact = await fetchContactById(contactId, ["address", "address2", "city", "state", "zip", "country"]);
  if (!contact) return { status: "skipped", reason: "contact not found" };
  const p = contact.properties;
  if (!p.address || !p.city || !p.state || !p.zip) {
    return { status: "skipped", reason: "address incomplete" };
  }

  // 3) Geocode
  const geo = await geocodeAddress({
    street: p.address, unit: p.address2, city: p.city, state: p.state, zip: p.zip, country: p.country ?? "USA",
  });
  if (!geo) {
    await logActivity("PROPERTY_SYNC_FAILED", { contactId, reason: "geocode miss" });
    return { status: "failed", reason: "geocode failed" };
  }

  // 4) Find-or-create
  const hash = addressHash({ street: geo.streetAddress, unit: p.address2, city: geo.city, state: geo.state, zip: geo.zip });
  const existing = geo.placeId
    ? await prisma.hubSpotPropertyCache.findUnique({ where: { googlePlaceId: geo.placeId } })
    : await prisma.hubSpotPropertyCache.findUnique({ where: { addressHash: hash } });

  let result: { propertyCacheId: string; hubspotObjectId: string; created: boolean };
  if (existing) {
    result = { propertyCacheId: existing.id, hubspotObjectId: existing.hubspotObjectId, created: false };
  } else {
    result = await createNewProperty({ contactId, geo, hash, unit: p.address2 });
  }

  // 5) Associate + upsert link row (idempotent)
  await associateProperty(result.hubspotObjectId, "contacts", contactId, CONTACT_LABEL_ASSOCIATION_IDS.CURRENT_OWNER);
  await prisma.propertyContactLink.upsert({
    where: { propertyId_contactId_label: { propertyId: result.propertyCacheId, contactId, label: "Current Owner" } },
    create: { propertyId: result.propertyCacheId, contactId, label: "Current Owner" },
    update: {},
  });

  // 6) Touch watermark
  await prisma.propertySyncWatermark.upsert({
    where: { contactId }, create: { contactId, lastSyncAt: new Date() }, update: { lastSyncAt: new Date() },
  });

  // 7) Recompute rollups
  await computePropertyRollups(result.propertyCacheId);

  if (result.created) await logActivity("PROPERTY_CREATED", { contactId, propertyCacheId: result.propertyCacheId });
  else await logActivity("PROPERTY_ASSOCIATION_ADDED", { contactId, propertyCacheId: result.propertyCacheId });

  return { status: result.created ? "created" : "associated", propertyCacheId: result.propertyCacheId };
}

async function createNewProperty(args: {
  contactId: string;
  geo: NonNullable<Awaited<ReturnType<typeof geocodeAddress>>>;
  hash: string;
  unit: string | null | undefined;
}): Promise<{ propertyCacheId: string; hubspotObjectId: string; created: true }> {
  const { geo, hash, unit } = args;

  // Resolve geographic links
  const [ahj, utility] = await Promise.all([
    resolveAhjForProperty({ zip: geo.zip, city: geo.city, state: geo.state, lat: geo.latitude, lng: geo.longitude }),
    resolveUtilityForProperty({ zip: geo.zip, city: geo.city, state: geo.state, lat: geo.latitude, lng: geo.longitude }),
  ]);
  const pbLocation = resolvePbLocationFromAddress(geo.zip, geo.state);

  // Create in HubSpot
  const hs = await createProperty({
    record_name: `${geo.streetAddress}, ${geo.city} ${geo.state} ${geo.zip}`,
    google_place_id: geo.placeId ?? "",
    normalized_address: hash,             // human-readable is geo.formattedAddress; we store the hash here as search-index canonical
    full_address: geo.formattedAddress,
    street_address: geo.streetAddress, unit_number: unit ?? "", city: geo.city, state: geo.state, zip: geo.zip,
    county: geo.county ?? "",
    latitude: geo.latitude, longitude: geo.longitude,
    ahj_name: ahj?.name ?? "", utility_name: utility?.name ?? "", pb_location: pbLocation ?? "",
  });

  // Associate to AHJ / Utility / Location custom objects (if resolved)
  const { AHJ_OBJECT_TYPE, UTILITY_OBJECT_TYPE, LOCATION_OBJECT_TYPE } = await import("@/lib/hubspot-custom-objects");
  if (ahj) await associateProperty(hs.id, AHJ_OBJECT_TYPE, ahj.objectId);
  if (utility) await associateProperty(hs.id, UTILITY_OBJECT_TYPE, utility.objectId);
  // TODO: Location association — resolve Location object ID from pbLocation string (one-time map built during bootstrap).

  // Upsert cache row
  const cache = await prisma.hubSpotPropertyCache.create({
    data: {
      hubspotObjectId: hs.id,
      googlePlaceId: geo.placeId, addressHash: hash, normalizedAddress: geo.formattedAddress,
      fullAddress: geo.formattedAddress,
      streetAddress: geo.streetAddress, unitNumber: unit ?? null,
      city: geo.city, state: geo.state, zip: geo.zip, county: geo.county,
      latitude: geo.latitude, longitude: geo.longitude,
      ahjObjectId: ahj?.objectId ?? null, ahjName: ahj?.name ?? null,
      utilityObjectId: utility?.objectId ?? null, utilityName: utility?.name ?? null,
      pbLocation: pbLocation ?? null,
      geocodedAt: new Date(), lastReconciledAt: new Date(),
    },
  });

  return { propertyCacheId: cache.id, hubspotObjectId: hs.id, created: true };
}

async function logActivity(type: ActivityType, metadata: Record<string, unknown>) {
  await prisma.activityLog.create({
    data: { type, metadata: metadata as never, createdAt: new Date(), userId: null, entityType: "Property", entityId: null },
  }).catch(() => { /* non-blocking */ });
}

export async function computePropertyRollups(propertyCacheId: string): Promise<void> {
  // Implemented in Task 2.5 — stub for now so callers type-check.
  void propertyCacheId;
}

// onDealOrTicketCreated, reconcileAllProperties, upsertPropertyFromGeocode — implemented in Tasks 2.6, 2.7, 3.2.
export async function onDealOrTicketCreated(_: "deal" | "ticket", __: string): Promise<SyncOutcome> {
  throw new Error("not implemented");
}
export async function reconcileAllProperties(): Promise<{ processed: number; drifted: number; failed: number }> {
  throw new Error("not implemented");
}
export async function upsertPropertyFromGeocode(_: string, __: unknown): Promise<{ propertyCacheId: string; created: boolean }> {
  throw new Error("not implemented");
}
```

Double-check:
- The `prisma.propertyContactLink.upsert` where-clause uses the exact composite unique name Prisma generates — run `npx prisma generate` first and check `src/generated/prisma`'s types to confirm the field name is `propertyId_contactId_label`.
- `fetchContactById` exists in `src/lib/hubspot.ts`. If it doesn't, add a small helper there before proceeding.

- [ ] **Step 4: Run — expect pass for the 4 initial tests**

Run: `npm test -- property-sync.test.ts`
Expected: PASS (4 tests). Subsequent tasks add more tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/property-sync.ts src/__tests__/lib/property-sync.test.ts
git commit -m "feat(property): sync orchestration — onContactAddressChange happy paths"
```

---

### Task 2.5: Rollup computation (TDD)

**Files:**
- Modify: `src/lib/property-sync.ts`
- Modify: `src/__tests__/lib/property-sync.test.ts`

`computePropertyRollups(propertyCacheId)` reads associated deals + tickets + line items and writes:
- `firstInstallDate`, `mostRecentInstallDate`, `associatedDealsCount`
- `associatedTicketsCount`, `openTicketsCount`, `lastServiceDate`
- `systemSizeKwDc`, `hasBattery`, `hasEvCharger` (from line items; classify by Category enum on associated `InternalProduct`)
- `earliestWarrantyExpiry`

Write the cache row + push updated rollup properties back to HubSpot so the HubSpot UI and external reports reflect them.

- [ ] **Step 1: Write tests — aggregate from mocked link rows**

(Full test sketch omitted for length — follow the pattern of Task 2.4 mocks. Key cases: no deals → counts zero; 3 deals → counts three, system size summed across line items categorized as MODULE; one ticket with status="open" → openTicketsCount=1; most recent install date = max closeDate among closed-won deals.)

- [ ] **Step 2: Implement**

```ts
export async function computePropertyRollups(propertyCacheId: string): Promise<void> {
  const property = await prisma.hubSpotPropertyCache.findUnique({
    where: { id: propertyCacheId },
    include: {
      dealLinks: true,
      ticketLinks: true,
    },
  });
  if (!property) return;

  const dealIds = property.dealLinks.map((l) => l.dealId);
  const ticketIds = property.ticketLinks.map((l) => l.ticketId);

  const deals = dealIds.length
    ? await prisma.deal.findMany({
        where: { hubspotDealId: { in: dealIds } },
        select: { hubspotDealId: true, installDate: true, closeDate: true, warrantyExpiresAt: true, amount: true },
      })
    : [];

  // Aggregate deal-level fields
  const installDates = deals.map((d) => d.installDate).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime());
  const warrantyExpiries = deals.map((d) => d.warrantyExpiresAt).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime());

  // Line-item rollup: systemSizeKwDc, hasBattery, hasEvCharger
  // Read from HubSpot live; cache only the rollup, not the raw line items (spec decision 8).
  const { fetchLineItemsForDeals } = await import("@/lib/hubspot");
  const lineItems = dealIds.length ? await fetchLineItemsForDeals(dealIds) : [];
  const byCategory = categorizeLineItemsByInternalProduct(lineItems);
  const systemSizeKwDc = sumWattage(byCategory.MODULE) / 1000 || null;
  const hasBattery = byCategory.BATTERY.length > 0 || byCategory.BATTERY_EXPANSION.length > 0;
  const hasEvCharger = byCategory.EV_CHARGER.length > 0;

  // Ticket fields
  const tickets = ticketIds.length
    ? await prisma.serviceTicketCache?.findMany?.({ where: { hubspotTicketId: { in: ticketIds } } }) ?? []
    : [];
  // If no local ticket cache, fall back to a lightweight HubSpot batch read.
  const openTicketsCount = tickets.filter((t: { status?: string; stage?: string }) => {
    const stage = (t.stage ?? t.status ?? "").toLowerCase();
    return !["closed", "resolved", "cancelled"].some((s) => stage.includes(s));
  }).length;
  const lastServiceDate = tickets
    .map((t: { updatedAt?: Date; closedAt?: Date }) => t.closedAt ?? t.updatedAt ?? null)
    .filter(Boolean)
    .sort((a: Date, b: Date) => b.getTime() - a.getTime())[0] ?? null;

  // Write cache
  await prisma.hubSpotPropertyCache.update({
    where: { id: propertyCacheId },
    data: {
      firstInstallDate: installDates[0] ?? null,
      mostRecentInstallDate: installDates[installDates.length - 1] ?? null,
      associatedDealsCount: deals.length,
      associatedTicketsCount: tickets.length,
      openTicketsCount,
      systemSizeKwDc,
      hasBattery, hasEvCharger,
      lastServiceDate,
      earliestWarrantyExpiry: warrantyExpiries[0] ?? null,
      lastReconciledAt: new Date(),
    },
  });

  // Push rollup fields to HubSpot
  await updateProperty(property.hubspotObjectId, {
    first_install_date: toDateString(installDates[0]),
    most_recent_install_date: toDateString(installDates[installDates.length - 1]),
    associated_deals_count: deals.length,
    associated_tickets_count: tickets.length,
    open_tickets_count: openTicketsCount,
    system_size_kw_dc: systemSizeKwDc,
    has_battery: hasBattery,
    has_ev_charger: hasEvCharger,
    last_service_date: toDateString(lastServiceDate ?? null),
    earliest_warranty_expiry: toDateString(warrantyExpiries[0]),
  });
}

function toDateString(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

// categorizeLineItemsByInternalProduct + sumWattage — implement as private helpers; read InternalProduct.category via join.
```

If `fetchLineItemsForDeals` doesn't yet exist in `src/lib/hubspot.ts`, add it (uses `hubspotClient.crm.lineItems.batchApi.read` with `hs_product_id` → `InternalProduct` join through an existing mapping; mirror the pattern in `src/lib/bom-hubspot-line-items.ts`).

- [ ] **Step 3: Run tests**

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/property-sync.ts src/__tests__/lib/property-sync.test.ts src/lib/hubspot.ts
git commit -m "feat(property): computePropertyRollups from deals + tickets + line items"
```

---

### Task 2.6: `onDealOrTicketCreated` (TDD)

**Files:**
- Modify: `src/lib/property-sync.ts`
- Modify: `src/__tests__/lib/property-sync.test.ts`

Flow per spec §Deal/Ticket creation:
1. Read primary Contact.
2. Look up Contact's Properties via `PropertyContactLink`.
3. If exactly one → associate + upsert link row + recompute rollups.
4. If multiple → disambiguate by deal/ticket address (geocode the deal/ticket address, match by `place_id`).
5. If none → trigger `onContactAddressChange`, retry once; if still none, log WARN and return `deferred`.

- [ ] **Step 1: Tests covering all 5 branches**
- [ ] **Step 2: Implement**
- [ ] **Step 3: Run — pass**
- [ ] **Step 4: Commit** with message `feat(property): associate Properties on deal/ticket creation`

---

### End of Chunk 2 — checkpoint

Run: `npm run lint && npm test`
All property-sync tests green, geocode + address-hash + resolve-geo-links green, coverage of core sync paths in place.

---

## Chunk 3: Webhook Handler + Reconciliation Cron

### Task 3.1: Webhook route with TDD

**Files:**
- Create: `src/app/api/webhooks/hubspot/property/route.ts`
- Create: `src/__tests__/api/webhooks/property.test.ts`

**Important copy:** follow `src/app/api/webhooks/hubspot/deal-sync/route.ts` line-by-line. Differences:
- Scope for `IdempotencyKey`: `"property-sync:hubspot-webhook"`.
- Handles three subscription types: `contact.propertyChange`, `deal.creation` | `deal.propertyChange`, `ticket.creation` | `ticket.propertyChange`.
- `maxDuration = 300` (already set in `vercel.json`; keep a `export const maxDuration = 300;` at top of file for local parity).
- Short-circuits to 200 when `PROPERTY_SYNC_ENABLED !== "true"`.

- [ ] **Step 1: Test — signature verification failure**
- [ ] **Step 2: Test — valid signature, unknown subscription type → no-op**
- [ ] **Step 3: Test — duplicate eventId → skipped, no double-process**
- [ ] **Step 4: Test — `contact.propertyChange` dispatches to `onContactAddressChange`**
- [ ] **Step 5: Test — `deal.creation` dispatches to `onDealOrTicketCreated("deal", id)`**
- [ ] **Step 6: Test — feature flag off → returns 200 without work**
- [ ] **Step 7: Implement**
- [ ] **Step 8: Run — pass**
- [ ] **Step 9: Commit**: `feat(property): webhook handler with DB-backed idempotency`

---

### Task 3.2: Reconciliation cron

**Files:**
- Create: `src/app/api/cron/property-reconcile/route.ts`
- Create: `src/__tests__/api/cron/property-reconcile.test.ts`

Per spec §Nightly reconciliation:
1. Page through all HubSpot Property records.
2. For each: upsert cache row, refresh associations, recompute rollups.
3. Alert if any cache row has `lastReconciledAt` > 48h after the pass finishes (indicates webhook failure).
4. Drop `PropertySyncWatermark` rows older than 7 days (spec §Contact address change).

- [ ] **Step 1: Implement `reconcileAllProperties()` in `property-sync.ts`**

Should return `{ processed, drifted, failed }` and handle errors per-Property (don't abort the whole run on one failure).

- [ ] **Step 2: Test the cron route short-circuits without bearer token**

```ts
it("returns 401 when Authorization header is missing", async () => {
  const res = await POST(new Request("http://test/api/cron/property-reconcile"));
  expect(res.status).toBe(401);
});
```

- [ ] **Step 3: Implement the route**

Mirror `src/app/api/cron/deal-sync/route.ts` for bearer-token auth. Respect `PROPERTY_SYNC_ENABLED`.

- [ ] **Step 4: Test the route calls `reconcileAllProperties` when auth passes**

- [ ] **Step 5: Test the watermark cleanup branch**

- [ ] **Step 6: Test the `lastReconciledAt > 48h` Sentry alert branch**

Use Sentry mock.

- [ ] **Step 7: Commit**: `feat(property): nightly reconciliation cron + watermark cleanup`

---

## Chunk 4: Backfill Script + Single-Running Lock

### Task 4.1: Backfill lock helpers (the detail Zach flagged)

**Files:**
- Modify: `src/lib/property-sync.ts` (or new `src/lib/property-backfill-lock.ts` if it reads clearer)
- Create: `src/__tests__/lib/property-backfill-lock.test.ts`

**Lock mechanism (how we enforce "only one `PropertyBackfillRun` is `running`")**:

Two layers, defense-in-depth:

1. **DB-enforced** via the partial unique index added in Task 1.1 Step 5:
   ```sql
   CREATE UNIQUE INDEX property_backfill_run_single_running
     ON "PropertyBackfillRun" (status) WHERE status = 'running';
   ```
   Prisma's composite `@@unique` can't express the `WHERE` clause, so the migration carries it as raw SQL. This guarantees a second `INSERT ... VALUES (..., 'running', ...)` fails with `unique_violation` (`P2002`) — Postgres does the enforcement, not application code.

2. **Application helper** that acquires the lock idempotently and handles stale locks:

```ts
// src/lib/property-backfill-lock.ts
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma";

const STALE_LOCK_MS = 2 * 60 * 60 * 1000; // 2 hours — backfills of 8-15k addresses finish in ~1-3h

export interface AcquiredLock {
  runId: string;
  resumeFrom: { phase: string; cursor: string | null } | null;
}

export async function acquireBackfillLock(): Promise<AcquiredLock | { reason: "already-running"; runningRunId: string }> {
  try {
    const run = await prisma.propertyBackfillRun.create({
      data: { status: "running", phase: "contacts" },
    });
    return { runId: run.id, resumeFrom: null };
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") throw err;
    // P2002 = unique constraint violation on partial index → another run is in progress.
    const running = await prisma.propertyBackfillRun.findFirst({ where: { status: "running" } });
    if (!running) throw new Error("Lock violation with no running row — index corrupt?");

    // Stale-lock takeover
    if (Date.now() - running.startedAt.getTime() > STALE_LOCK_MS) {
      const stolen = await prisma.propertyBackfillRun.updateMany({
        where: { id: running.id, status: "running" },  // optimistic — only take if still running
        data: { status: "failed", lastError: "stolen by stale-lock takeover" },
      });
      if (stolen.count === 1) return acquireBackfillLock(); // retry now that the old row is flipped
      // Someone else already flipped it; fall through to already-running path.
    }
    return { reason: "already-running", runningRunId: running.id };
  }
}

export async function releaseBackfillLock(runId: string, outcome: "completed" | "failed" | "paused", error?: string) {
  await prisma.propertyBackfillRun.update({
    where: { id: runId },
    data: { status: outcome, completedAt: new Date(), lastError: error ?? null },
  });
}

export async function resumeInterruptedRun(): Promise<AcquiredLock | null> {
  // For manual CLI recovery: reads latest row, returns its phase+cursor if status='running' (i.e. crashed).
  const run = await prisma.propertyBackfillRun.findFirst({ where: { status: "running" }, orderBy: { startedAt: "desc" } });
  if (!run) return null;
  return { runId: run.id, resumeFrom: { phase: run.phase, cursor: run.cursor } };
}
```

- [ ] **Step 1: Tests**

Use a real test DB (Jest DB helper if configured) or a Prisma mock. Four test cases:
- First `acquireBackfillLock()` call → returns `{ runId, resumeFrom: null }`.
- Second concurrent call → returns `{ reason: "already-running" }`.
- Stale lock (startedAt > 2h) → is stolen, new lock acquired.
- `releaseBackfillLock(id, "completed")` flips status and clears the lock so a subsequent acquire succeeds.

- [ ] **Step 2: Implement**
- [ ] **Step 3: Pass**
- [ ] **Step 4: Commit**: `feat(property): backfill lock with DB-enforced singleton + stale takeover`

---

### Task 4.2: Backfill script

**Files:**
- Create: `scripts/backfill-properties.ts`

- [ ] **Step 1: Script skeleton**

```ts
// scripts/backfill-properties.ts
// Usage: tsx scripts/backfill-properties.ts [--resume]
// Throttling: 10 concurrent contacts, 40 geocodes/sec (below Google's 50/s limit).
import { acquireBackfillLock, releaseBackfillLock } from "@/lib/property-backfill-lock";
import { onContactAddressChange, onDealOrTicketCreated, reconcileAllProperties } from "@/lib/property-sync";
import { prisma } from "@/lib/db";
import { searchHubSpotContactsWithDeals, searchAllHubSpotDeals, searchAllHubSpotTickets } from "@/lib/hubspot";

async function main() {
  if (process.env.PROPERTY_SYNC_ENABLED !== "true") {
    console.error("PROPERTY_SYNC_ENABLED is false — refusing to run");
    process.exit(1);
  }

  const lock = await acquireBackfillLock();
  if ("reason" in lock) {
    console.error(`Another backfill is running (runId=${lock.runningRunId}). Aborting.`);
    process.exit(2);
  }

  try {
    // Phase 1: Contacts that have been on a Deal
    await runPhase(lock.runId, "contacts", async (updateCursor) => {
      let cursor = lock.resumeFrom?.phase === "contacts" ? lock.resumeFrom.cursor : null;
      do {
        const page = await searchHubSpotContactsWithDeals(cursor);
        for (const contact of page.results) {
          await onContactAddressChange(contact.id);
          await incrementCounters(lock.runId, { processed: 1 });
        }
        cursor = page.paging?.next?.after ?? null;
        await updateCursor(cursor);
      } while (cursor);
    });

    // Phase 2: Deals
    await runPhase(lock.runId, "deals", async (updateCursor) => {
      let cursor = lock.resumeFrom?.phase === "deals" ? lock.resumeFrom.cursor : null;
      do {
        const page = await searchAllHubSpotDeals(cursor);
        for (const deal of page.results) await onDealOrTicketCreated("deal", deal.id);
        cursor = page.paging?.next?.after ?? null;
        await updateCursor(cursor);
      } while (cursor);
    });

    // Phase 3: Tickets
    await runPhase(lock.runId, "tickets", async (updateCursor) => { /* mirror phase 2 */ });

    // Phase 4: Reconcile rollups in one sweep
    await runPhase(lock.runId, "reconcile", async () => {
      await reconcileAllProperties();
    });

    await releaseBackfillLock(lock.runId, "completed");
  } catch (err) {
    await releaseBackfillLock(lock.runId, "failed", err instanceof Error ? err.message : "unknown");
    throw err;
  }
}

async function runPhase(runId: string, phase: string, body: (updateCursor: (c: string | null) => Promise<void>) => Promise<void>) {
  await prisma.propertyBackfillRun.update({ where: { id: runId }, data: { phase, cursor: null } });
  await body(async (c) => {
    await prisma.propertyBackfillRun.update({ where: { id: runId }, data: { cursor: c } });
  });
}

async function incrementCounters(runId: string, deltas: { processed?: number; created?: number; associated?: number; failed?: number }) {
  await prisma.propertyBackfillRun.update({
    where: { id: runId },
    data: {
      totalProcessed: { increment: deltas.processed ?? 0 },
      totalCreated: { increment: deltas.created ?? 0 },
      totalAssociated: { increment: deltas.associated ?? 0 },
      totalFailed: { increment: deltas.failed ?? 0 },
    },
  });
}

main().catch((err) => { console.error(err); process.exit(3); });
```

- [ ] **Step 2: Dry-run against sandbox with `PROPERTY_SYNC_ENABLED=true`, limit to 10 contacts**

Add a `BACKFILL_LIMIT` env var so you can bound the run during testing:
```ts
const LIMIT = process.env.BACKFILL_LIMIT ? Number(process.env.BACKFILL_LIMIT) : Infinity;
// break out of phase 1 once processed >= LIMIT
```

- [ ] **Step 3: Run: `BACKFILL_LIMIT=10 PROPERTY_SYNC_ENABLED=true tsx scripts/backfill-properties.ts`**

Expected: 10 contacts processed, rows appear in `HubSpotPropertyCache`, Properties visible in HubSpot sandbox, `PropertyBackfillRun.status=completed`.

- [ ] **Step 4: Test resumability manually**: kill the script mid-run (ctrl-c during phase 1), then re-run with `--resume`; confirm it picks up from the stored cursor.

- [ ] **Step 5: Commit**: `feat(property): resumable backfill script (4 phases, DB-tracked progress)`

---

## Chunk 5: Read API + Customer Resolver Integration

### Task 5.1: `GET /api/properties/[id]` (drawer detail)

- [ ] Test: returns 404 when cache row missing.
- [ ] Test: returns 403 for a role that doesn't have service-suite access (use existing `canAccessRoute`).
- [ ] Test: returns hydrated `PropertyDetail` with owners + deals + tickets + equipment summary.
- [ ] Implement: read cache row + link rows + hydrate with live HubSpot fetches only for line items (they're not cached; spec decision 8).
- [ ] Commit: `feat(property): detail endpoint`

### Task 5.2: `GET /api/properties/resolve?address=...`

- [ ] Test: returns 200 + `{ propertyId }` when an existing `HubSpotPropertyCache` matches by `addressHash` of the normalized input address.
- [ ] Test: returns 404 `{ propertyId: null }` when not found.
- [ ] Test: never triggers a geocode (fast, synchronous) — legacy fallback UX.
- [ ] Implement using `addressHash` over client-sent address parts.
- [ ] Commit: `feat(property): address-resolve endpoint for legacy records`

### Task 5.3: `GET /api/properties/by-contact/[contactId]`

- [ ] Test: returns `[]` when contact has no properties.
- [ ] Test: returns sorted list (most-recently-associated first).
- [ ] Test: respects the same role guard as customer-resolver.
- [ ] Implement.
- [ ] Commit: `feat(property): by-contact properties endpoint`

### Task 5.4: `POST /api/properties/manual-create` (admin only)

- [ ] Test: returns 403 for non-admin.
- [ ] Test: 201 + Property created when admin + valid address.
- [ ] Implement — wraps `upsertPropertyFromGeocode`.
- [ ] Commit: `feat(property): admin-only manual create endpoint`

### Task 5.5: Extend `customer-resolver.ts`

**Files:**
- Modify: `src/lib/customer-resolver.ts`

- [ ] Extend the result type to include `properties: PropertyDetail[]`.
- [ ] In `resolveCustomerDetail`, after contact resolution, fetch properties via `prisma.propertyContactLink.findMany({ where: { contactId: { in: contactIds } }, include: { property: true } })`.
- [ ] Map to `PropertyDetail` shape matching spec §UI Integration.
- [ ] Add test covering a contact with 2 properties, one with open tickets.
- [ ] Commit: `feat(service-suite): surface Properties in customer resolver`

---

## Chunk 6: UI — PropertyDrawer + PropertyLink + Integration Points

### Task 6.1: `<PropertyDrawer>` component

**Files:**
- Create: `src/components/PropertyDrawer.tsx`
- Create: `src/components/property/PropertyEquipmentList.tsx`
- Create: `src/components/property/PropertyOwnershipList.tsx`

- [ ] Build the slide-in drawer using the existing drawer pattern (grep for `Drawer` in `src/components` — use the same portal + overlay + escape-close).
- [ ] Fetch via `GET /api/properties/[id]` using React Query.
- [ ] Gate render behind `UI_PROPERTY_VIEWS_ENABLED` env at the component level (read at server-component boundary).
- [ ] Sections per spec §PropertyDrawer:
  - Header: full address, PB shop, AHJ, Utility
  - Map thumbnail (Google Maps Static API; cap to 1 request per open)
  - Equipment installed (uses `PropertyEquipmentList`)
  - Owners all-time (uses `PropertyOwnershipList`)
  - Deals table
  - Tickets table with open-flag
  - Property details placeholder (collapsed + "Property data enrichment coming soon")
- [ ] No unit test for the component (UI). Visual QA after landing.
- [ ] Commit: `feat(property): reusable PropertyDrawer component`

### Task 6.2: `<PropertyLink>` wrapper

**Files:**
- Create: `src/components/PropertyLink.tsx`

- [ ] Accepts `address` (string or `AddressParts`) + optional `hubspotObjectId`.
- [ ] Renders as a button styled like a link; `onClick` opens `PropertyDrawer` via an app-level context (create `PropertyDrawerContext` if needed).
- [ ] If `hubspotObjectId` missing, fetches `/api/properties/resolve` lazily on click.
- [ ] Legacy-record fallback: "No property record yet" + admin-only "Create Property" button.
- [ ] Commit: `feat(property): PropertyLink wrapper for clickable addresses`

### Task 6.3: Wire into Service Suite customer-360 view

- [ ] Find the customer detail view file: `grep -rn "customer-resolver\|resolveCustomerDetail" src/app/dashboards`
- [ ] Add a Properties section above Deals/Tickets/Jobs, rendered per `PropertyDetail` from the resolver.
- [ ] Each card is a `PropertyLink`.
- [ ] Feature-flag behind `UI_PROPERTY_VIEWS_ENABLED`.
- [ ] Commit: `feat(service-suite): Properties section on customer-360`

### Task 6.4: Wire into the other 3 initial trigger points (spec table)

- [ ] Service ticket detail: wrap address line in `PropertyLink`.
- [ ] Deals dashboard: wrap install-address column.
- [ ] Scheduler cards (construction, service): wrap job-address in each card.
- [ ] Each in its own commit: `feat(property): link addresses from <page>`

---

## Chunk 7: Rollout, Smoke Tests, Docs

### Task 7.1: Dev-portal smoke run

- [ ] Ensure sandbox env vars are set, `PROPERTY_SYNC_ENABLED=true`, and webhook subscriptions are configured in the sandbox.
- [ ] Add 5 fresh test contacts with unique addresses. Confirm webhook creates Property in HubSpot + cache row in Neon + association labels visible.
- [ ] Modify an existing contact's address. Confirm a new Property is created + associated; previous Property keeps the old Contact as `Current Owner` (no demotion — matches v1 invariant).
- [ ] Create a deal against one of the contacts. Confirm the Property rolls up the new deal (counts increment, rollups fire).
- [ ] Create a ticket against one of the contacts. Confirm same.
- [ ] Kill the webhook subscription, update a contact's city, wait, re-enable webhook, run the reconcile cron manually. Confirm drift repair.
- [ ] Document any surprises in an appendix commit.

### Task 7.2: Prod rollout (Phase 3 per spec)

- [ ] Deploy main, leave `PROPERTY_SYNC_ENABLED=false`.
- [ ] Create prod Property object via the bootstrap script against prod portal. Copy type ID to Vercel env.
- [ ] Set labeled-association type IDs in Vercel env (from script output).
- [ ] Enable webhooks in prod portal pointing at prod URL.
- [ ] Flip `PROPERTY_SYNC_ENABLED=true` in Vercel env. Webhooks start flowing.
- [ ] Run backfill from a secure workstation: `PROPERTY_SYNC_ENABLED=true tsx scripts/backfill-properties.ts` against prod DB. (Dry-run with `BACKFILL_LIMIT=100` first.)
- [ ] Soak for 48h. Monitor Sentry, cache parity counts, geocoding spend.

### Task 7.3: UI rollout (Phase 4)

- [ ] Flip `UI_PROPERTY_VIEWS_ENABLED=true` on a weekday morning, monitor UX feedback via chat + bug-report endpoint.
- [ ] Collect issues; triage.

### Task 7.4: Docs

- [ ] Update `docs/hubspot-integration-guide.docx` with final subscription list + object type IDs.
- [ ] Add a section to CLAUDE.md's Major Systems listing the Property object.
- [ ] Commit: `docs(property): integration guide + CLAUDE.md system note`

---

## Testing Summary

Tests grouped by layer — the plan tasks above reference each:
- **Unit (Jest)**: `address-hash`, `geocode`, `resolve-geo-links`, `property-sync` (state machine branches), `property-backfill-lock`.
- **API integration (Jest, real route imports)**: `webhooks/property`, `cron/property-reconcile`, `properties/[id]`, `properties/resolve`, `properties/by-contact/[contactId]`, `properties/manual-create`.
- **Manual smoke** (documented in Chunk 7): sandbox webhook flow, backfill resumability, reconciliation drift repair.

No end-to-end test against live HubSpot in CI — the sandbox smoke pass covers it.

---

## Rollback

- **Phase 1-3**: flip `PROPERTY_SYNC_ENABLED=false`. Webhooks return 200 immediately (no-op). Cron short-circuits. Backfill refuses to start. Cache tables are empty/stale but harmless.
- **Phase 4**: flip `UI_PROPERTY_VIEWS_ENABLED=false`. Customer-360 Properties section + `<PropertyLink>` fall back to their pre-Property rendering.
- **Schema rollback**: if the feature is permanently cancelled, write a down-migration that drops the 6 new tables + removes the 3 new `ActivityType` enum values. Don't do this casually — the backfill data is useful even if the feature is paused.

---

## Follow-up (post-v1, not in this plan)

Per spec §Follow-up Specs:
1. ATTOM enrichment integration (populate the null fields).
2. Dedicated `/dashboards/properties` page.
3. In-app Property edit UI.
4. Historical ownership timeline inference.
5. Geo-polygon AHJ/Utility resolution (replace the cascade in `resolve-geo-links.ts`).
6. Owner demotion UX ("sold" event → previous owners auto-labeled).

---

## Done criteria

- [ ] All 7 chunks' tasks checked off.
- [ ] `npm run lint && npm test` green on HEAD.
- [ ] Prod backfill completed with `PropertyBackfillRun.status='completed'` and `totalFailed < 1% of totalProcessed`.
- [ ] Sentry error rate on the new routes < 0.5% over 48h soak.
- [ ] At least one real customer-360 view rendering properties end-to-end.
