# PowerHub ↔ Property ↔ Zuper Cross-System Linking — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Tesla PowerHub portal one click away from any linked property, deal, ticket, or job — in HubSpot, in Zuper, and in PB Ops Suite — by propagating a portal URL through every connected system.

**Architecture:** Compute `portalUrl` from `PowerhubSite.siteId` via a configurable template; persist on the row. Select a "primary" site per property (newest STE date). Push `tesla_portal_url` + `tesla_site_id` to HubSpot Property + Deal + Ticket objects synchronously after every PowerhubSite upsert. Cascade through the existing `zuper-property-sync` dirty-detection mechanism, with a new inline fan-out to push the same fields onto every linked Zuper job. Surface a new Property Hub "Monitoring" tab and a shared `<PowerhubLink>` component across Service, D&E, and Deal Detail.

**Tech Stack:** Next.js 16.1 + React 19.2 (TypeScript), Prisma 7.3 on Neon Postgres, HubSpot Node SDK (`@hubspot/api-client`), Tailwind v4 with theme tokens, Jest for tests.

**Spec:** `docs/superpowers/specs/2026-05-18-powerhub-property-zuper-linking-design.md`

**Predecessor specs** (assume landed before execution begins):
- `2026-05-06-powerhub-integration-design.md` (PowerHub Phase 1 — `PowerhubSite` table, `tesla-powerhub.ts`, `powerhub-sync.ts`)
- `2026-05-16-zuper-property-sync-design.md` (`zuper-property-sync.ts`, `mergeZuperMetaData`)
- `2026-05-17-property-hub-enhancements-design.md` (`property-hub.ts` `HubTab` union, tab dispatcher)

**Feature flags:**
- `POWERHUB_CROSSLINK_ENABLED` — master kill switch. All push logic short-circuits to no-op when false.
- `POWERHUB_ZUPER_CASCADE_ENABLED` — independent flag for the Zuper job custom field cascade (lets us validate HubSpot push at fleet scale before turning on Zuper writes).

**Environment variables:**
- `TESLA_POWERHUB_PORTAL_URL_TEMPLATE` (default: `https://gridlogic.tesla.com/sites/{siteId}`)
- `HUBSPOT_PROPERTY_OBJECT_TYPE` (already defined for Phase 1 — referenced, not introduced here)

**Manual pre-launch steps** (out-of-band, before flag flips on in production):
1. Create HubSpot custom properties (6 total — see Chunk 1 Task 1 for table).
2. Create Zuper custom fields (4 total — see Chunk 3 Task 1 for table).
3. Confirm Tesla GridLogic portal URL pattern with Tesla account manager.

---

## File structure

### New files
| Path | Responsibility |
|------|---------------|
| `prisma/migrations/<timestamp>_powerhub_crosslink/migration.sql` | Schema additions + partial unique index |
| `src/lib/powerhub-crosslink.ts` | Core: `computePortalUrl`, `resolvePrimarySite`, `pushToHubSpotForProperty`, `enqueueCrossSystemPush` |
| `src/lib/powerhub-crosslink-backfill-lock.ts` | Singleton lock for `PowerhubCrosslinkBackfillRun` (clones `property-backfill-lock.ts`) |
| `src/components/powerhub/PowerhubLink.tsx` | Reusable anchor (button / inline / icon variants) |
| `src/components/powerhub/SystemHealthBadge.tsx` | Compact alert badge for table rows |
| `src/components/property/PropertyMonitoringTab.tsx` | Property Hub Monitoring tab content |
| `src/app/api/powerhub/properties/[propertyId]/sites/route.ts` | GET — list Tesla sites for property |
| `src/app/api/powerhub/properties/[propertyId]/resync/route.ts` | POST — force re-resolve + push (admin) |
| `scripts/backfill-powerhub-crosslinks.ts` | One-time backfill |
| `__tests__/powerhub-crosslink.test.ts` | Unit tests for crosslink module |
| `__tests__/powerhub-crosslink-zuper-cascade.test.ts` | Unit tests for Zuper job cascade |

### Modified files
| Path | What changes |
|------|--------------|
| `prisma/schema.prisma` | Add `PowerhubSite.portalUrl`, `primaryForProperty`; `HubSpotPropertyCache.teslaPortalUrl`, `teslaSiteId`; new `PowerhubCrosslinkBackfillRun` model |
| `src/lib/tesla-powerhub.ts` | Export `computePortalUrl(siteId)` helper |
| `src/lib/powerhub-sync.ts` | After asset upsert, set `portalUrl` and call `enqueueCrossSystemPush` |
| `src/lib/zuper-property-sync.ts` | Add 2 new field labels; extend `PropertyFieldSource`; new `cascadeUrlToJobs` function |
| `src/lib/hubspot.ts` | Existing `updateDealProperty` — re-use as-is |
| `src/lib/hubspot-tickets.ts` | New `updateTicketProperties(ticketId, props)` helper exporting raw property update |
| `src/lib/hubspot-property.ts` | Add `tesla_portal_url`, `tesla_site_id` to synced field list (via existing `updateProperty`) |
| `src/lib/property-hub.ts` | Add `"monitoring"` to `HubTab` union; new `fetchMonitoring`; wire into dispatcher |
| `src/lib/query-keys.ts` | Add `powerhub.propertySites(propertyId)` key |
| `src/components/property/PropertyHubTabs.tsx` | Add Monitoring tab navigation entry |
| `src/components/property/PropertyDrawer.tsx` (or wherever tabs render) | Render `<PropertyMonitoringTab>` |
| `src/components/powerhub/SystemHealth.tsx` | Add `<PowerhubLink variant="button">` at top |
| Service tickets detail page | New row showing `<PowerhubLink variant="inline">` |
| Service priority queue page | New "System" column with `<SystemHealthBadge>` |
| D&E project detail panel | New "Tesla PowerHub" row |
| Deals detail panel | New "Tesla PowerHub" row in property section |

---

## Chunk 1: Schema migration + portal URL synthesis

**Goal:** Land all DB changes (additive only), introduce `computePortalUrl`, and wire `portalUrl` writes into the existing `powerhub-sync.ts` asset upsert path. After this chunk, every `PowerhubSite` row has a `portalUrl`, but nothing is pushed externally yet.

### Task 1: Pre-launch checklist — HubSpot custom properties

**Files:**
- Modify: `docs/superpowers/plans/2026-05-18-powerhub-property-zuper-linking.md` (add a "Pre-launch checklist" section to the plan, NOT for an engineer to do)

**Manual admin step (not Claude or a subagent — performed by an admin via HubSpot UI before this code goes live):**

Create the following custom properties:

| Object | Property name | Type | Group | Field label (UI) |
|--------|--------------|------|-------|------------------|
| Property (custom object) | `tesla_portal_url` | URL | Tesla PowerHub | Tesla PowerHub |
| Property (custom object) | `tesla_site_id` | Single-line text | Tesla PowerHub | Tesla Site ID |
| Deal | `tesla_portal_url` | URL | Tesla PowerHub | Tesla PowerHub |
| Deal | `tesla_site_id` | Single-line text | Tesla PowerHub | Tesla Site ID |
| Ticket | `tesla_portal_url` | URL | Tesla PowerHub | Tesla PowerHub |
| Ticket | `tesla_site_id` | Single-line text | Tesla PowerHub | Tesla Site ID |

The internal property names (`tesla_portal_url`, `tesla_site_id`) must match exactly — these are what the code references. The code no-ops with a warning log if a property doesn't exist (HubSpot returns 400), so a missing property never breaks production.

- [ ] **Step 1: No engineering work; surface to user before flag flip**

Print this checklist to the user when running this plan in subagent mode so they can verify HubSpot admin work was done.

### Task 2: Add schema fields and `PowerhubCrosslinkBackfillRun` model

**Files:**
- Modify: `prisma/schema.prisma` (in three places — see steps)

- [ ] **Step 1: Add `portalUrl` and `primaryForProperty` to `PowerhubSite`**

In `prisma/schema.prisma`, locate the `PowerhubSite` model (around line 4169) and add two fields after `aggregatorSiteId`:

```prisma
model PowerhubSite {
  id         String @id @default(cuid())
  siteId     String @unique
  siteName   String
  instanceId String
  aggregatorSiteId String?

  // NEW — cross-link fields
  portalUrl          String?  // Computed via TESLA_POWERHUB_PORTAL_URL_TEMPLATE
  primaryForProperty Boolean  @default(false)  // At most one true per propertyId (enforced by partial unique index in migration SQL)

  // ... existing fields unchanged ...
}
```

- [ ] **Step 2: Add `teslaPortalUrl` and `teslaSiteId` to `HubSpotPropertyCache`**

Locate the `HubSpotPropertyCache` model (line 749) and add two fields after the Zuper sync block (around line 845):

```prisma
  // Zuper Property sync (write direction)
  zuperPropertyUid      String?   @unique
  zuperPropertySyncedAt DateTime?
  zuperSyncFailCount    Int       @default(0)

  // NEW — Tesla PowerHub denormalized fields (populated from primary PowerhubSite)
  teslaPortalUrl String?
  teslaSiteId    String?
```

- [ ] **Step 3: Add new `PowerhubCrosslinkBackfillRun` model**

At the end of `prisma/schema.prisma` (after the last PowerHub model — `PowerhubAlert`), add:

```prisma
model PowerhubCrosslinkBackfillRun {
  id              String    @id @default(cuid())
  status          String    // "running" | "completed" | "failed" | "paused"
  cursor          String?   // Last processed propertyId (HubSpotPropertyCache.id)
  totalCount      Int?
  processedCount  Int       @default(0)
  failedCount     Int       @default(0)
  startedAt       DateTime  @default(now())
  heartbeatAt     DateTime  @default(now())
  completedAt     DateTime?
  errorMessage    String?

  @@index([status])
  // NOTE: A partial unique index — at most one row with status='running' —
  // is added via raw SQL in the migration (Step 6 below). Prisma's @@unique
  // cannot express a WHERE clause. The Chunk 6 backfill lock catches the
  // P2002 raised by that index when a second run tries to acquire while
  // another is in progress, so this index is REQUIRED for correctness.
}
```

- [ ] **Step 4: Validate schema syntax**

Run: `npx prisma format && npx prisma validate`
Expected: No errors.

- [ ] **Step 5: Generate the migration (do NOT apply yet)**

Run: `npx prisma migrate dev --name powerhub_crosslink --create-only`
Expected: Creates `prisma/migrations/<timestamp>_powerhub_crosslink/migration.sql`. Inspect the generated SQL to confirm it only contains `ALTER TABLE ADD COLUMN` and `CREATE TABLE` statements (no `DROP` or `ALTER COLUMN`).

- [ ] **Step 6: Append the partial unique indexes to the migration SQL**

Open the generated `migration.sql` and append at the end. **Both indexes are required** — the first enforces single-primary-per-property; the second is the singleton-running lock for the backfill, consumed by Chunk 6's `acquireBackfillLock` (without it, concurrent backfills can start simultaneously).

```sql
-- Partial unique index: at most one primary PowerhubSite per property
CREATE UNIQUE INDEX "PowerhubSite_primary_per_property"
  ON "PowerhubSite" ("propertyId")
  WHERE "primaryForProperty" = true;

-- Partial unique index: at most one PowerhubCrosslinkBackfillRun with status='running' at a time
-- The ((1)) expression creates a singleton-style index where the column value is constant,
-- so any second insert with status='running' will hit the unique constraint and raise P2002.
CREATE UNIQUE INDEX "PowerhubCrosslinkBackfillRun_singleton_running"
  ON "PowerhubCrosslinkBackfillRun" ((1))
  WHERE "status" = 'running';
```

Both are hand-written because Prisma's `@@unique` does not support `WHERE` clauses.

- [ ] **Step 7: Apply the migration locally**

Run: `npx prisma migrate dev`
Expected: Migration applies, Prisma client regenerates.

- [ ] **Step 8: Verify both indexes exist**

Run: `psql "$DATABASE_URL" -c "SELECT indexname FROM pg_indexes WHERE indexname IN ('PowerhubSite_primary_per_property', 'PowerhubCrosslinkBackfillRun_singleton_running');"`
Expected: Two rows returned, one per index name.

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(powerhub): add crosslink schema (portalUrl, primaryForProperty, denormalized cache fields, backfill run model)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

**Note on production deploy:** Production migration is run by a human via `scripts/migrate-prod.sh` AFTER this code is merged to main but BEFORE the flag flips on. Subagents must not run `prisma migrate deploy` against production. The migration is additive-only so order-of-operations is forgiving — code that doesn't reference the new columns ships first, migration applies, then crosslink code starts populating them.

### Task 3: `computePortalUrl` helper

**Files:**
- Modify: `src/lib/tesla-powerhub.ts`
- Test: `__tests__/powerhub-crosslink.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `__tests__/powerhub-crosslink.test.ts`:

```typescript
import { computePortalUrl } from "@/lib/tesla-powerhub";

describe("computePortalUrl", () => {
  const originalEnv = process.env.TESLA_POWERHUB_PORTAL_URL_TEMPLATE;
  afterEach(() => {
    process.env.TESLA_POWERHUB_PORTAL_URL_TEMPLATE = originalEnv;
  });

  it("uses the default template when env var is unset", () => {
    delete process.env.TESLA_POWERHUB_PORTAL_URL_TEMPLATE;
    expect(computePortalUrl("abc-123")).toBe("https://gridlogic.tesla.com/sites/abc-123");
  });

  it("uses the configured template when env var is set", () => {
    process.env.TESLA_POWERHUB_PORTAL_URL_TEMPLATE = "https://example.com/site/{siteId}/view";
    expect(computePortalUrl("xyz-789")).toBe("https://example.com/site/xyz-789/view");
  });

  it("returns null for empty siteId", () => {
    expect(computePortalUrl("")).toBeNull();
  });

  it("returns null for whitespace-only siteId", () => {
    expect(computePortalUrl("   ")).toBeNull();
  });

  it("encodes special characters safely", () => {
    // Tesla site UUIDs are alphanumeric+dashes but be defensive
    expect(computePortalUrl("a b/c")).toBe("https://gridlogic.tesla.com/sites/a%20b%2Fc");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/powerhub-crosslink.test.ts -t computePortalUrl`
Expected: FAIL — `computePortalUrl is not a function`.

- [ ] **Step 3: Implement `computePortalUrl`**

At the bottom of `src/lib/tesla-powerhub.ts`, before the final closing of the file, add:

```typescript
/**
 * Compute the Tesla GridLogic portal deep-link URL for a site.
 * Template is configurable via TESLA_POWERHUB_PORTAL_URL_TEMPLATE env var.
 * Returns null for empty/whitespace siteId.
 *
 * The {siteId} placeholder is URL-encoded so the function is safe for any
 * site identifier shape Tesla might return (even though current UUIDs are
 * URL-safe).
 */
export function computePortalUrl(siteId: string): string | null {
  const trimmed = siteId?.trim();
  if (!trimmed) return null;
  const template =
    process.env.TESLA_POWERHUB_PORTAL_URL_TEMPLATE ||
    "https://gridlogic.tesla.com/sites/{siteId}";
  return template.replace("{siteId}", encodeURIComponent(trimmed));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/powerhub-crosslink.test.ts -t computePortalUrl`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tesla-powerhub.ts __tests__/powerhub-crosslink.test.ts
git commit -m "feat(powerhub): add computePortalUrl helper for Tesla GridLogic deep links

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 4: Wire `portalUrl` into `powerhub-sync.ts` asset upsert

**Files:**
- Modify: `src/lib/powerhub-sync.ts`
- Test: existing tests should keep passing; no new test (this is a pure data passthrough — covered by integration when crosslink module lands in Chunk 2)

- [ ] **Step 1: Find the PowerhubSite upsert call**

Run: `grep -n "prisma.powerhubSite.upsert\|prisma.powerhubSite.update\|prisma.powerhubSite.create" src/lib/powerhub-sync.ts`
Expected: Lists 1-3 lines. Identify the asset-sync upsert (the one in the function that runs every 6h).

- [ ] **Step 2: Add `portalUrl` to the upsert payload**

In each upsert/create call that writes a new `PowerhubSite` row OR refreshes asset data, add to BOTH the `create` and `update` payload blocks:

```typescript
portalUrl: computePortalUrl(site.siteId),
```

Import at the top of the file: `import { computePortalUrl } from "@/lib/tesla-powerhub";` (or adjust import if already pulling from there).

- [ ] **Step 3: Verify by running asset sync in dev**

Run: `npm run dev` (in another terminal)
Then trigger asset sync manually via the existing admin route or curl:
`curl -X POST http://localhost:3000/api/cron/powerhub-asset-sync -H "Authorization: Bearer $CRON_SECRET"`

Run: `npx prisma studio` and inspect `PowerhubSite.portalUrl` on a row — should be `https://gridlogic.tesla.com/sites/<uuid>`.

If you don't have access to a live Tesla API in dev, skip this step — the integration test in Chunk 2 will catch it.

- [ ] **Step 4: Commit**

```bash
git add src/lib/powerhub-sync.ts
git commit -m "feat(powerhub): persist portalUrl during asset sync

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 5: Add `tesla_portal_url` / `tesla_site_id` to HubSpot Property cache sync list

**Files:**
- Modify: `src/lib/hubspot-property.ts`

The existing `hubspot-property.ts` has a list of synced fields. Per the spec, the new fields piggyback on the existing push path (no separate API call per property — the same `updateProperty` call now carries the extra two keys when set).

- [ ] **Step 1: Find the field list**

Run: `grep -n "tesla_\|systemSizeKwDc\|coerceHubSpotProps" src/lib/hubspot-property.ts | head -20`
Identify where `HubSpotPropertyCache` fields are mapped to HubSpot property names (look for the function that builds the properties object passed to `updateProperty`).

- [ ] **Step 2: Add the two new fields to the mapping**

In the property-builder function (likely named something like `buildHubspotPropertyProps` or inline in `pushPropertyToHubSpot`), add after the existing rollup fields:

```typescript
// Tesla PowerHub (populated by powerhub-crosslink module)
tesla_portal_url: cache.teslaPortalUrl ?? null,
tesla_site_id: cache.teslaSiteId ?? null,
```

The `coerceHubSpotProps` helper already converts `null` to `""` for HubSpot's API.

- [ ] **Step 3: Manual smoke test (optional in dev)**

If you've already created the HubSpot custom property via the admin UI in a dev portal:
- Manually set `teslaPortalUrl` on a test row: `npx prisma studio` → edit a `HubSpotPropertyCache` row.
- Trigger property reconcile: `curl -X POST http://localhost:3000/api/cron/property-reconcile -H "Authorization: Bearer $CRON_SECRET"`
- Inspect the HubSpot Property record in the dev portal — `Tesla PowerHub` field should show the URL.

If the property doesn't exist in the dev portal, the call will return a 400 with a warning logged but won't fail — this is intentional graceful degradation.

- [ ] **Step 4: Commit**

```bash
git add src/lib/hubspot-property.ts
git commit -m "feat(hubspot-property): add tesla_portal_url and tesla_site_id to sync mapping

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Chunk 2: Primary-site selection + crosslink core module

**Goal:** Build `src/lib/powerhub-crosslink.ts` with `resolvePrimarySite`, `pushToHubSpotForProperty`, and `enqueueCrossSystemPush`. Wire it into `powerhub-sync.ts` so every asset upsert that touches a linked site triggers a push. After this chunk, HubSpot Property + Deal + Ticket records carry the URL on a 6h sync cadence.

**Conscious divergence from spec — read-before-write idempotency:**
The spec mandates "read current external value before writing; skip the PATCH if unchanged." This chunk implements **unconditional PATCH** instead, accepting the cost (a few thousand extra HubSpot PATCHes per backfill, then ~50/day in steady state) in exchange for:
1. No extra GET round-trip per record (3× per property × 1200 properties = 3600 extra GETs)
2. Simpler error semantics (PATCH is idempotent; HubSpot dedupes audit log entries for identical writes)
3. Resilience to external drift (if someone edits the field in HubSpot UI, we re-assert our value next cycle)

A future Phase 2 follow-up can add cache-side skip-on-unchanged tracking (storing `lastPushedTeslaPortalUrlHash` on `HubSpotPropertyCache`) if the noise becomes a problem. Marking this as a deliberate decision so the implementer doesn't try to "fix" it.

### Task 1: `resolvePrimarySite` — primary site selection logic

**Files:**
- Create: `src/lib/powerhub-crosslink.ts`
- Modify: `__tests__/powerhub-crosslink.test.ts` (extend existing test file)

- [ ] **Step 1: Write failing tests for parsing STE date**

Append to `__tests__/powerhub-crosslink.test.ts`:

```typescript
import { parseSteDateFromName, pickPrimarySite } from "@/lib/powerhub-crosslink";

describe("parseSteDateFromName", () => {
  it("parses standard STE pattern STE20240105-008", () => {
    expect(parseSteDateFromName("STE20240105-008")).toEqual(new Date("2024-01-05T00:00:00Z"));
  });

  it("returns null for non-STE names", () => {
    expect(parseSteDateFromName("PB-Custom-001")).toBeNull();
    expect(parseSteDateFromName("")).toBeNull();
  });

  it("returns null for malformed STE (bad date)", () => {
    expect(parseSteDateFromName("STE20240230-001")).toBeNull(); // Feb 30
    expect(parseSteDateFromName("STE99999999-001")).toBeNull();
  });
});

describe("pickPrimarySite", () => {
  type S = { id: string; siteName: string; createdAt: Date };
  const mk = (id: string, siteName: string, createdAt: string): S => ({
    id, siteName, createdAt: new Date(createdAt),
  });

  it("returns null for empty array", () => {
    expect(pickPrimarySite([])).toBeNull();
  });

  it("returns the only site when there's one", () => {
    const sites = [mk("a", "STE20240105-008", "2024-01-10")];
    expect(pickPrimarySite(sites)?.id).toBe("a");
  });

  it("picks newest STE date", () => {
    const sites = [
      mk("a", "STE20230101-001", "2023-01-10"),
      mk("b", "STE20240105-008", "2024-01-10"),
      mk("c", "STE20220601-002", "2022-06-15"),
    ];
    expect(pickPrimarySite(sites)?.id).toBe("b");
  });

  it("tie-breaks lexicographically on siteName when STE dates tie", () => {
    const sites = [
      mk("a", "STE20240105-005", "2024-01-10"),
      mk("b", "STE20240105-008", "2024-01-10"),
      mk("c", "STE20240105-003", "2024-01-10"),
    ];
    expect(pickPrimarySite(sites)?.id).toBe("b"); // 008 sorts last
  });

  it("falls back to createdAt when STE pattern is missing", () => {
    const sites = [
      mk("a", "Custom-A", "2024-01-10"),
      mk("b", "Custom-B", "2024-05-10"),
    ];
    expect(pickPrimarySite(sites)?.id).toBe("b");
  });

  it("STE-named sites beat fallback-named sites", () => {
    const sites = [
      mk("a", "Custom-A", "2024-06-01"),
      mk("b", "STE20230101-001", "2023-01-10"),
    ];
    expect(pickPrimarySite(sites)?.id).toBe("b"); // STE wins even if older createdAt
  });

  it("final tie-break is id (lexicographic)", () => {
    const sites = [
      mk("c", "Custom-X", "2024-01-10"),
      mk("a", "Custom-X", "2024-01-10"),
      mk("b", "Custom-X", "2024-01-10"),
    ];
    expect(pickPrimarySite(sites)?.id).toBe("c"); // lexicographic max
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/powerhub-crosslink.test.ts -t "parseSteDateFromName\\|pickPrimarySite"`
Expected: FAIL — module/exports don't exist.

- [ ] **Step 3: Create `powerhub-crosslink.ts` with parsing + selection**

Create `src/lib/powerhub-crosslink.ts`:

```typescript
/**
 * src/lib/powerhub-crosslink.ts
 *
 * Cross-system propagation of Tesla PowerHub portal links into
 * HubSpot Property/Deal/Ticket records and Zuper Property/Job custom fields.
 *
 * Entry points:
 *   - resolvePrimarySite(propertyId): pick a single primary site per property,
 *     update DB, return the chosen site (or null if no sites linked)
 *   - pushToHubSpotForProperty(propertyId): push tesla_portal_url + tesla_site_id
 *     to the HubSpot Property object and every linked Deal + open Ticket
 *   - enqueueCrossSystemPush(propertyId): the full cascade — resolve primary,
 *     push to HubSpot, mark cache dirty so the existing Zuper sync cron picks
 *     it up
 *
 * All entry points no-op when POWERHUB_CROSSLINK_ENABLED !== "true".
 */

export interface PrimarySiteCandidate {
  id: string;
  siteName: string;
  createdAt: Date;
}

const STE_PATTERN = /^STE(\d{8})-\d+$/;

/**
 * Parse the date portion of a Tesla STE site name.
 * Format: STE<YYYYMMDD>-<NNN>
 * Returns null if the name doesn't match the pattern or the date is invalid.
 */
export function parseSteDateFromName(name: string): Date | null {
  const m = name?.match(STE_PATTERN);
  if (!m) return null;
  const ymd = m[1];
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(4, 6));
  const day = Number(ymd.slice(6, 8));
  if (year < 2000 || year > 2099) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  // Use UTC to avoid timezone drift
  const dt = new Date(Date.UTC(year, month - 1, day));
  // Validate (e.g., Feb 30 rolls over to March)
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  return dt;
}

/**
 * Choose the primary site from a list of candidates.
 *
 * Rules:
 *   1. Newest STE date wins
 *   2. Tie → lexicographically max siteName
 *   3. No STE pattern → newest createdAt
 *   4. STE-named sites beat any fallback-named site
 *   5. Final tie-break: lexicographically max id (cuid)
 *
 * Returns null only if the input is empty.
 */
export function pickPrimarySite<T extends PrimarySiteCandidate>(sites: T[]): T | null {
  if (sites.length === 0) return null;
  const enriched = sites.map((s) => ({
    site: s,
    steDate: parseSteDateFromName(s.siteName),
  }));
  enriched.sort((a, b) => {
    // STE-named always beats fallback-named
    if (a.steDate && !b.steDate) return -1;
    if (!a.steDate && b.steDate) return 1;
    // Both STE-named
    if (a.steDate && b.steDate) {
      const diff = b.steDate.getTime() - a.steDate.getTime();
      if (diff !== 0) return diff;
      // Tie: lexicographic siteName desc
      if (a.site.siteName !== b.site.siteName) {
        return b.site.siteName.localeCompare(a.site.siteName);
      }
    } else {
      // Both fallback: newest createdAt desc
      const diff = b.site.createdAt.getTime() - a.site.createdAt.getTime();
      if (diff !== 0) return diff;
    }
    // Final tie-break: lexicographic id desc
    return b.site.id.localeCompare(a.site.id);
  });
  return enriched[0].site;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/powerhub-crosslink.test.ts`
Expected: PASS — all `parseSteDateFromName` and `pickPrimarySite` tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/powerhub-crosslink.ts __tests__/powerhub-crosslink.test.ts
git commit -m "feat(powerhub-crosslink): add primary site selection logic

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 2: `resolvePrimarySite` — DB-aware orchestrator

**Files:**
- Modify: `src/lib/powerhub-crosslink.ts`
- Modify: `__tests__/powerhub-crosslink.test.ts`

This wraps `pickPrimarySite` with DB reads, writes (set `primaryForProperty`), and the denormalized cache update on `HubSpotPropertyCache`.

- [ ] **Step 1: Write failing test using a mocked prisma**

Append to `__tests__/powerhub-crosslink.test.ts`. (If a `prisma` mock helper doesn't exist yet, follow the existing test files' pattern — `grep -l "jest.mock.*@/lib/db" __tests__/`.)

```typescript
import { resolvePrimarySite } from "@/lib/powerhub-crosslink";
import { prisma } from "@/lib/db";

jest.mock("@/lib/db", () => ({
  prisma: {
    powerhubSite: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    hubSpotPropertyCache: {
      update: jest.fn(),
    },
    $transaction: jest.fn((ops) => Promise.all(ops)),
  },
}));

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe("resolvePrimarySite", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns null and clears cache when no sites are linked", async () => {
    (mockPrisma.powerhubSite.findMany as jest.Mock).mockResolvedValue([]);

    const result = await resolvePrimarySite("prop-1");

    expect(result).toBeNull();
    expect(mockPrisma.hubSpotPropertyCache.update).toHaveBeenCalledWith({
      where: { id: "prop-1" },
      data: { teslaPortalUrl: null, teslaSiteId: null },
    });
    expect(mockPrisma.powerhubSite.updateMany).not.toHaveBeenCalled();
  });

  it("picks newest STE site and writes denormalized fields", async () => {
    (mockPrisma.powerhubSite.findMany as jest.Mock).mockResolvedValue([
      { id: "s1", siteId: "tesla-old", siteName: "STE20230101-001", createdAt: new Date("2023-01-01"), portalUrl: "https://gridlogic.tesla.com/sites/tesla-old", primaryForProperty: false },
      { id: "s2", siteId: "tesla-new", siteName: "STE20240105-008", createdAt: new Date("2024-01-05"), portalUrl: "https://gridlogic.tesla.com/sites/tesla-new", primaryForProperty: false },
    ]);

    const result = await resolvePrimarySite("prop-1");

    expect(result?.id).toBe("s2");
    expect(mockPrisma.hubSpotPropertyCache.update).toHaveBeenCalledWith({
      where: { id: "prop-1" },
      data: {
        teslaPortalUrl: "https://gridlogic.tesla.com/sites/tesla-new",
        teslaSiteId: "tesla-new",
      },
    });
    // Demote losers, promote winner
    expect(mockPrisma.powerhubSite.updateMany).toHaveBeenCalledWith({
      where: { propertyId: "prop-1", id: { not: "s2" } },
      data: { primaryForProperty: false },
    });
    expect(mockPrisma.powerhubSite.update).toHaveBeenCalledWith({
      where: { id: "s2" },
      data: { primaryForProperty: true },
    });
  });

  it("no-ops when the chosen primary is already marked", async () => {
    (mockPrisma.powerhubSite.findMany as jest.Mock).mockResolvedValue([
      { id: "s1", siteId: "tesla-1", siteName: "STE20240101-001", createdAt: new Date(), portalUrl: "https://x", primaryForProperty: true },
    ]);
    // Cache already matches
    (mockPrisma.hubSpotPropertyCache.update as jest.Mock).mockResolvedValue({});

    const result = await resolvePrimarySite("prop-1");

    expect(result?.id).toBe("s1");
    // Still writes (idempotent); test doesn't check whether write was skipped
    expect(mockPrisma.powerhubSite.update).toHaveBeenCalled();
  });

  it("retries on P2002 from the partial unique index", async () => {
    (mockPrisma.powerhubSite.findMany as jest.Mock).mockResolvedValue([
      { id: "s1", siteId: "tesla-1", siteName: "STE20240101-001", createdAt: new Date(), portalUrl: "https://x", primaryForProperty: false },
    ]);
    // First update call throws P2002 (concurrent race), second succeeds
    const p2002 = Object.assign(new Error("Unique violation"), { code: "P2002" });
    (mockPrisma.powerhubSite.update as jest.Mock)
      .mockRejectedValueOnce(p2002)
      .mockResolvedValueOnce({});

    const result = await resolvePrimarySite("prop-1");

    expect(result?.id).toBe("s1");
    expect(mockPrisma.powerhubSite.update).toHaveBeenCalledTimes(2); // retried once
  });

  it("gives up after maxAttempts P2002 errors and throws", async () => {
    (mockPrisma.powerhubSite.findMany as jest.Mock).mockResolvedValue([
      { id: "s1", siteId: "tesla-1", siteName: "STE20240101-001", createdAt: new Date(), portalUrl: "https://x", primaryForProperty: false },
    ]);
    const p2002 = Object.assign(new Error("Unique violation"), { code: "P2002" });
    (mockPrisma.powerhubSite.update as jest.Mock).mockRejectedValue(p2002);

    await expect(resolvePrimarySite("prop-1")).rejects.toThrow();
    expect(mockPrisma.powerhubSite.update).toHaveBeenCalledTimes(3); // maxAttempts = 3
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/powerhub-crosslink.test.ts -t resolvePrimarySite`
Expected: FAIL — `resolvePrimarySite is not exported`.

- [ ] **Step 3: Implement `resolvePrimarySite`**

Append to `src/lib/powerhub-crosslink.ts`:

```typescript
import { prisma } from "@/lib/db";

export interface ResolvedPrimarySite {
  id: string;
  siteId: string;
  siteName: string;
  portalUrl: string | null;
}

/**
 * Look up all PowerhubSite rows for a property, pick the primary, write
 * the `primaryForProperty` flag, and update the denormalized
 * teslaPortalUrl + teslaSiteId on HubSpotPropertyCache.
 *
 * Returns the primary site (or null if no sites are linked to this property).
 *
 * Idempotent: safe to call repeatedly. Race-safe via the partial unique
 * index — if a concurrent caller flips primaryForProperty on a different
 * site, this caller's update will hit the index constraint and we retry once.
 */
export async function resolvePrimarySite(propertyId: string): Promise<ResolvedPrimarySite | null> {
  const sites = await prisma.powerhubSite.findMany({
    where: { propertyId },
    select: {
      id: true,
      siteId: true,
      siteName: true,
      portalUrl: true,
      createdAt: true,
      primaryForProperty: true,
    },
  });

  if (sites.length === 0) {
    // No sites: clear cache + demote any orphaned primary flags (defense in depth)
    await prisma.hubSpotPropertyCache.update({
      where: { id: propertyId },
      data: { teslaPortalUrl: null, teslaSiteId: null },
    });
    return null;
  }

  const primary = pickPrimarySite(sites)!;

  // Two writes in sequence (NOT a transaction — the demote-then-promote order
  // avoids the partial unique index conflict naturally).
  await prisma.powerhubSite.updateMany({
    where: { propertyId, id: { not: primary.id } },
    data: { primaryForProperty: false },
  });
  await retryOnUniqueConflict(() =>
    prisma.powerhubSite.update({
      where: { id: primary.id },
      data: { primaryForProperty: true },
    })
  );

  // Update denormalized fields on the property cache
  await prisma.hubSpotPropertyCache.update({
    where: { id: propertyId },
    data: {
      teslaPortalUrl: primary.portalUrl,
      teslaSiteId: primary.siteId,
    },
  });

  return {
    id: primary.id,
    siteId: primary.siteId,
    siteName: primary.siteName,
    portalUrl: primary.portalUrl,
  };
}

/**
 * Retry helper for the partial unique index race: a concurrent caller may
 * have promoted a different site, so we retry once after re-demoting.
 */
async function retryOnUniqueConflict<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastErr = err;
      const code = (err as { code?: string })?.code;
      if (code !== "P2002") throw err;
      // Tiny jitter before retry
      await new Promise((r) => setTimeout(r, 50 * (i + 1)));
    }
  }
  throw lastErr;
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest __tests__/powerhub-crosslink.test.ts -t resolvePrimarySite`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/powerhub-crosslink.ts __tests__/powerhub-crosslink.test.ts
git commit -m "feat(powerhub-crosslink): implement resolvePrimarySite orchestrator

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 3: HubSpot push — Property + Deal + Ticket

**Files:**
- Modify: `src/lib/powerhub-crosslink.ts`
- Modify: `src/lib/hubspot-tickets.ts` (add `updateTicketProperties` helper)
- Modify: `__tests__/powerhub-crosslink.test.ts`

- [ ] **Step 0: Verify the HubSpot helpers we depend on exist**

Run: `grep -n "export.*updateDealProperty\b\|export.*function updateProperty\b" src/lib/hubspot.ts src/lib/hubspot-property.ts`
Expected output:
- `src/lib/hubspot.ts: export async function updateDealProperty(` (around line 1712)
- `src/lib/hubspot-property.ts: export async function updateProperty(` (around line 340)

If either is missing or the signature differs (e.g., `(id, key, value)` instead of `(id, propsRecord)`), STOP and reconcile before continuing — the rest of this task imports them directly.

- [ ] **Step 1: Expose a generic ticket update helper**

Check `src/lib/hubspot-tickets.ts:792` — it has inline ticket update logic in an action function. Extract a reusable helper.

Find the section that calls `hubspotClient.crm.tickets.basicApi.update(ticketId, { properties })` (around line 792). At the bottom of the file (before the last export), add:

```typescript
/**
 * Update arbitrary properties on a HubSpot ticket.
 * Used by the powerhub-crosslink module to push tesla_portal_url + tesla_site_id.
 * Returns true on success, false on any failure (logs warning).
 */
export async function updateTicketProperties(
  ticketId: string,
  properties: Record<string, string | null>
): Promise<boolean> {
  try {
    // Coerce nulls to empty strings (HubSpot pattern)
    const coerced: Record<string, string> = {};
    for (const [k, v] of Object.entries(properties)) {
      coerced[k] = v == null ? "" : String(v);
    }
    await hubspotClient.crm.tickets.basicApi.update(ticketId, { properties: coerced });
    return true;
  } catch (err) {
    const status = (err as { code?: number })?.code;
    if (status === 404) {
      console.warn(`[hubspot-tickets] Ticket ${ticketId} not found (404); skipping property update`);
      return false;
    }
    console.error(`[hubspot-tickets] Failed to update ticket ${ticketId}:`, err);
    return false;
  }
}
```

Imports at the top of the file already include `hubspotClient` — if not, add: `import { hubspotClient } from "./hubspot";` (or match the existing import pattern).

- [ ] **Step 2: Write failing test for `pushToHubSpotForProperty`**

Append to `__tests__/powerhub-crosslink.test.ts`:

```typescript
import { pushToHubSpotForProperty } from "@/lib/powerhub-crosslink";
import { updateDealProperty } from "@/lib/hubspot";
import { updateTicketProperties } from "@/lib/hubspot-tickets";
import { updateProperty as updateHubSpotProperty } from "@/lib/hubspot-property";

jest.mock("@/lib/hubspot", () => ({
  updateDealProperty: jest.fn().mockResolvedValue(true),
}));
jest.mock("@/lib/hubspot-tickets", () => ({
  updateTicketProperties: jest.fn().mockResolvedValue(true),
}));
jest.mock("@/lib/hubspot-property", () => ({
  updateProperty: jest.fn().mockResolvedValue(undefined),
}));

describe("pushToHubSpotForProperty", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.POWERHUB_CROSSLINK_ENABLED = "true";
  });

  it("no-ops when feature flag is off", async () => {
    process.env.POWERHUB_CROSSLINK_ENABLED = "false";

    (mockPrisma.hubSpotPropertyCache.findUnique as jest.Mock).mockResolvedValue({
      id: "prop-1",
      hubspotObjectId: "hs-prop-1",
      teslaPortalUrl: "https://x",
      teslaSiteId: "abc",
      dealLinks: [{ dealId: "deal-1" }],
      ticketLinks: [{ ticketId: "ticket-1" }],
    });

    await pushToHubSpotForProperty("prop-1");

    expect(updateHubSpotProperty).not.toHaveBeenCalled();
    expect(updateDealProperty).not.toHaveBeenCalled();
    expect(updateTicketProperties).not.toHaveBeenCalled();
  });

  it("pushes to Property, all Deals, and all Tickets when flag is on", async () => {
    (mockPrisma.hubSpotPropertyCache.findUnique as jest.Mock).mockResolvedValue({
      id: "prop-1",
      hubspotObjectId: "hs-prop-1",
      teslaPortalUrl: "https://gridlogic.tesla.com/sites/abc",
      teslaSiteId: "abc",
      dealLinks: [{ dealId: "deal-1" }, { dealId: "deal-2" }],
      ticketLinks: [{ ticketId: "ticket-1" }],
    });

    await pushToHubSpotForProperty("prop-1");

    expect(updateHubSpotProperty).toHaveBeenCalledWith("hs-prop-1", {
      tesla_portal_url: "https://gridlogic.tesla.com/sites/abc",
      tesla_site_id: "abc",
    });
    expect(updateDealProperty).toHaveBeenCalledTimes(2);
    expect(updateDealProperty).toHaveBeenCalledWith("deal-1", {
      tesla_portal_url: "https://gridlogic.tesla.com/sites/abc",
      tesla_site_id: "abc",
    });
    expect(updateTicketProperties).toHaveBeenCalledWith("ticket-1", {
      tesla_portal_url: "https://gridlogic.tesla.com/sites/abc",
      tesla_site_id: "abc",
    });
  });

  it("pushes nulls when teslaPortalUrl is cleared", async () => {
    (mockPrisma.hubSpotPropertyCache.findUnique as jest.Mock).mockResolvedValue({
      id: "prop-1",
      hubspotObjectId: "hs-prop-1",
      teslaPortalUrl: null,
      teslaSiteId: null,
      dealLinks: [{ dealId: "deal-1" }],
      ticketLinks: [],
    });

    await pushToHubSpotForProperty("prop-1");

    expect(updateHubSpotProperty).toHaveBeenCalledWith("hs-prop-1", {
      tesla_portal_url: null,
      tesla_site_id: null,
    });
    expect(updateDealProperty).toHaveBeenCalledWith("deal-1", {
      tesla_portal_url: null,
      tesla_site_id: null,
    });
  });

  it("continues if one deal push fails", async () => {
    (mockPrisma.hubSpotPropertyCache.findUnique as jest.Mock).mockResolvedValue({
      id: "prop-1",
      hubspotObjectId: "hs-prop-1",
      teslaPortalUrl: "https://x",
      teslaSiteId: "abc",
      dealLinks: [{ dealId: "deal-1" }, { dealId: "deal-2" }],
      ticketLinks: [],
    });
    (updateDealProperty as jest.Mock).mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await expect(pushToHubSpotForProperty("prop-1")).resolves.not.toThrow();
    expect(updateDealProperty).toHaveBeenCalledTimes(2); // didn't stop after failure
  });
});
```

Also add the prisma mock entry for `hubSpotPropertyCache.findUnique` at the top:

```typescript
// Update the existing prisma mock to include findUnique
jest.mock("@/lib/db", () => ({
  prisma: {
    powerhubSite: { findMany: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
    hubSpotPropertyCache: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn((ops) => Promise.all(ops)),
  },
}));
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest __tests__/powerhub-crosslink.test.ts -t pushToHubSpotForProperty`
Expected: FAIL — `pushToHubSpotForProperty is not exported`.

- [ ] **Step 4: Implement `pushToHubSpotForProperty`**

Append to `src/lib/powerhub-crosslink.ts`:

```typescript
import { updateDealProperty } from "@/lib/hubspot";
import { updateTicketProperties } from "@/lib/hubspot-tickets";
import { updateProperty as updateHubSpotProperty } from "@/lib/hubspot-property";

const CROSSLINK_FLAG = "POWERHUB_CROSSLINK_ENABLED";

function isCrosslinkEnabled(): boolean {
  return process.env[CROSSLINK_FLAG] === "true";
}

/**
 * Push tesla_portal_url + tesla_site_id to HubSpot Property + all linked
 * Deals + all linked Tickets. Reads denormalized fields from
 * HubSpotPropertyCache (which must be up to date — call resolvePrimarySite
 * first if needed).
 *
 * No-ops if POWERHUB_CROSSLINK_ENABLED !== "true".
 *
 * Failures on individual deal/ticket updates are logged but don't stop the
 * batch — partial-success is preferable to all-or-nothing rollback for
 * idempotent property writes.
 */
export async function pushToHubSpotForProperty(propertyId: string): Promise<void> {
  if (!isCrosslinkEnabled()) return;

  const cache = await prisma.hubSpotPropertyCache.findUnique({
    where: { id: propertyId },
    include: { dealLinks: true, ticketLinks: true },
  });
  if (!cache) {
    console.warn(`[powerhub-crosslink] Property ${propertyId} not found in cache; skipping push`);
    return;
  }

  const props = {
    tesla_portal_url: cache.teslaPortalUrl,
    tesla_site_id: cache.teslaSiteId,
  };

  // 1. HubSpot Property object — fail loud, not silent (this is the source of truth)
  try {
    await updateHubSpotProperty(cache.hubspotObjectId, props);
  } catch (err) {
    console.error(
      `[powerhub-crosslink] Failed to update HubSpot Property ${cache.hubspotObjectId}:`,
      err
    );
    // Do not throw — continue to deals/tickets. Next sync cycle will retry.
  }

  // 2. Deals — push in parallel with Promise.allSettled
  const dealResults = await Promise.allSettled(
    cache.dealLinks.map((link) => updateDealProperty(link.dealId, props))
  );
  const dealFailures = dealResults.filter((r) => r.status === "rejected" || (r.status === "fulfilled" && r.value === false)).length;
  if (dealFailures > 0) {
    console.warn(`[powerhub-crosslink] ${dealFailures}/${cache.dealLinks.length} deal updates failed for property ${propertyId}`);
  }

  // 3. Tickets — push in parallel with Promise.allSettled
  const ticketResults = await Promise.allSettled(
    cache.ticketLinks.map((link) => updateTicketProperties(link.ticketId, props))
  );
  const ticketFailures = ticketResults.filter((r) => r.status === "rejected" || (r.status === "fulfilled" && r.value === false)).length;
  if (ticketFailures > 0) {
    console.warn(`[powerhub-crosslink] ${ticketFailures}/${cache.ticketLinks.length} ticket updates failed for property ${propertyId}`);
  }
}
```

- [ ] **Step 5: Run tests**

Run: `npx jest __tests__/powerhub-crosslink.test.ts -t pushToHubSpotForProperty`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/powerhub-crosslink.ts src/lib/hubspot-tickets.ts __tests__/powerhub-crosslink.test.ts
git commit -m "feat(powerhub-crosslink): push tesla_portal_url to HubSpot Property, Deals, Tickets

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 4: `enqueueCrossSystemPush` — the full cascade entry point

**Files:**
- Modify: `src/lib/powerhub-crosslink.ts`
- Modify: `__tests__/powerhub-crosslink.test.ts`

- [ ] **Step 1: Write failing test**

Append:

```typescript
import { enqueueCrossSystemPush } from "@/lib/powerhub-crosslink";

describe("enqueueCrossSystemPush", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.POWERHUB_CROSSLINK_ENABLED = "true";
  });

  it("no-ops when feature flag is off", async () => {
    process.env.POWERHUB_CROSSLINK_ENABLED = "false";
    await enqueueCrossSystemPush("prop-1");
    expect(mockPrisma.powerhubSite.findMany).not.toHaveBeenCalled();
  });

  it("runs resolve → push → mark dirty in order", async () => {
    (mockPrisma.powerhubSite.findMany as jest.Mock).mockResolvedValue([
      { id: "s1", siteId: "tesla-1", siteName: "STE20240105-001", createdAt: new Date(), portalUrl: "https://x", primaryForProperty: false },
    ]);
    (mockPrisma.hubSpotPropertyCache.findUnique as jest.Mock).mockResolvedValue({
      id: "prop-1",
      hubspotObjectId: "hs-1",
      teslaPortalUrl: "https://x",
      teslaSiteId: "tesla-1",
      dealLinks: [],
      ticketLinks: [],
    });

    await enqueueCrossSystemPush("prop-1");

    // Verify resolve ran (findMany called for sites)
    expect(mockPrisma.powerhubSite.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { propertyId: "prop-1" } })
    );
    // Verify push ran (findUnique called for cache)
    expect(mockPrisma.hubSpotPropertyCache.findUnique).toHaveBeenCalled();
    // Verify mark-dirty: the cache update for teslaPortalUrl IS the dirty mark
    // (because updatedAt auto-bumps on any update).
    expect(mockPrisma.hubSpotPropertyCache.update).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/powerhub-crosslink.test.ts -t enqueueCrossSystemPush`
Expected: FAIL — `enqueueCrossSystemPush is not exported`.

- [ ] **Step 3: Implement**

Append to `src/lib/powerhub-crosslink.ts`:

```typescript
/**
 * Full cross-system cascade for a property:
 *   1. resolvePrimarySite — pick primary, update flags + denormalized cache fields
 *      (this updates HubSpotPropertyCache.updatedAt, which is the dirty signal
 *      for the existing zuper-property-sync cron)
 *   2. pushToHubSpotForProperty — push URL to HubSpot Property + Deals + Tickets
 *
 * The Zuper push happens asynchronously: the cache update from step 1 bumps
 * updatedAt, which causes findDirtyProperties (in zuper-property-sync.ts) to
 * pick up this property on the next 15-min cron cycle.
 *
 * No-ops when POWERHUB_CROSSLINK_ENABLED !== "true".
 */
export async function enqueueCrossSystemPush(propertyId: string): Promise<void> {
  if (!isCrosslinkEnabled()) return;
  try {
    await resolvePrimarySite(propertyId);
    await pushToHubSpotForProperty(propertyId);
  } catch (err) {
    console.error(`[powerhub-crosslink] enqueueCrossSystemPush failed for ${propertyId}:`, err);
    // Don't re-throw — caller is usually a sync loop that processes many properties
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest __tests__/powerhub-crosslink.test.ts`
Expected: PASS — all tests in this file (parseSteDateFromName, pickPrimarySite, resolvePrimarySite, pushToHubSpotForProperty, enqueueCrossSystemPush).

- [ ] **Step 5: Commit**

```bash
git add src/lib/powerhub-crosslink.ts __tests__/powerhub-crosslink.test.ts
git commit -m "feat(powerhub-crosslink): add enqueueCrossSystemPush cascade entry point

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 5: Wire `enqueueCrossSystemPush` into `powerhub-sync.ts`

**Files:**
- Modify: `src/lib/powerhub-sync.ts`

- [ ] **Step 1: Locate the asset-sync function that upserts PowerhubSite**

Run: `grep -n "function.*[sS]ync\|powerhubSite.upsert\|powerhubSite.update" src/lib/powerhub-sync.ts | head`

Identify the function that runs as part of the 6h asset sync. It already calls `prisma.powerhubSite.upsert` (or equivalent) per site.

- [ ] **Step 2: Verify the upsert returns `propertyId` and `linkMethod`**

Prisma upserts return the full row by default unless `select` is used. Run:
`sed -n '<lineN>,<lineN+30>p' src/lib/powerhub-sync.ts` for the upsert call identified in Step 1.

Confirm one of:
- The upsert has no `select` — returns the full row, both fields available.
- The upsert has a `select` — verify `propertyId: true, linkMethod: true` are present, or add them.

If the upsert assigns to a variable other than `upsertedSite` (e.g., `site`, `record`), use that name in Step 3 instead.

- [ ] **Step 3: Add the cascade call after each successful upsert**

After the upsert, when `linkMethod` is not `UNLINKED` AND `propertyId` is set, call `enqueueCrossSystemPush`:

```typescript
import { enqueueCrossSystemPush } from "@/lib/powerhub-crosslink";

// ... inside the per-site loop, AFTER the prisma.powerhubSite.upsert call ...
if (upsertedSite.propertyId && upsertedSite.linkMethod !== "UNLINKED") {
  // Awaited inside the loop iteration — keeps error logging tied to the
  // current site context. enqueueCrossSystemPush catches its own errors
  // internally so this await never throws.
  await enqueueCrossSystemPush(upsertedSite.propertyId);
}
```

If the existing sync loop processes sites in parallel (e.g., inside a `Promise.all(sites.map(...))`), keep the call inside that map — `enqueueCrossSystemPush` is safe to run concurrently for different propertyIds (the partial unique index serializes contention per propertyId).

- [ ] **Step 4: Lint and type-check**

Run: `npm run lint` (whole-repo) and `npx tsc --noEmit`
Expected: No new errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/powerhub-sync.ts
git commit -m "feat(powerhub-sync): trigger cross-system push after linked-site upsert

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Chunk 3: Zuper cascade — property and job custom fields

**Goal:** Add "Tesla PowerHub" and "Tesla Site ID" to the existing Zuper Property sync, AND introduce a new fan-out that writes the same two fields onto every linked Zuper job. After this chunk, when a property's primary Tesla site changes, the URL appears in Zuper Property + every linked Zuper Job within one cron cycle (15 min).

### Task 1: Pre-launch checklist — Zuper custom fields

**Manual admin step** (Zuper UI, before flag flip):

Create the following custom fields:

| Module | Field label | Field type |
|--------|------------|-----------|
| Property | Tesla PowerHub | URL / Link |
| Property | Tesla Site ID | Single-line text |
| Job | Tesla PowerHub | URL / Link |
| Job | Tesla Site ID | Single-line text |

The label string is what `mergeZuperMetaData` matches on. Exact match required.

- [ ] **Step 1: No engineering work; surface to user before flag flip**

### Task 2: Extend `ZUPER_PROPERTY_FIELD_LABELS` and `PropertyFieldSource`

**Files:**
- Modify: `src/lib/zuper-property-sync.ts`
- Test: extend existing tests if they exist; otherwise add minimal new ones

- [ ] **Step 1: Add the new labels**

In `src/lib/zuper-property-sync.ts`, find the `ZUPER_PROPERTY_FIELD_LABELS` array (line 18) and append:

```typescript
export const ZUPER_PROPERTY_FIELD_LABELS = [
  "System Size (kW)",
  "Has Battery",
  "Has EV Charger",
  "Install Date",
  "Year Built",
  "Square Footage",
  "Stories",
  "PB Location",
  "AHJ",
  "Utility",
  // NEW — Tesla PowerHub cross-link
  "Tesla PowerHub",
  "Tesla Site ID",
] as const;
```

- [ ] **Step 2: Extend `PropertyFieldSource`**

In the same file, find the `PropertyFieldSource` interface (line 35) and add:

```typescript
export interface PropertyFieldSource {
  systemSizeKwDc: number | null;
  hasBattery: boolean;
  hasEvCharger: boolean;
  firstInstallDate: Date | null;
  yearBuilt: number | null;
  squareFootage: number | null;
  stories: number | null;
  pbLocation: string | null;
  ahjName: string | null;
  utilityName: string | null;

  // NEW
  teslaPortalUrl: string | null;
  teslaSiteId: string | null;
}
```

- [ ] **Step 3: Extend `buildPropertyCustomFields`**

Find `buildPropertyCustomFields` (line 64) and append two entries to the array it builds (label/value/type structure should match existing entries — likely `{ label, value, type: "SINGLE_LINE" }` or similar):

```typescript
{ label: "Tesla PowerHub", value: property.teslaPortalUrl ?? "", type: "SINGLE_LINE" },
{ label: "Tesla Site ID",  value: property.teslaSiteId  ?? "", type: "SINGLE_LINE" },
```

- [ ] **Step 4: Extend the `syncPropertyToZuper` field mapping**

Find `syncPropertyToZuper` (line 253). It calls `buildPropertyCustomFields` with a literal object. Add:

```typescript
const fields = buildPropertyCustomFields({
  // ... existing properties ...
  teslaPortalUrl: property.teslaPortalUrl,
  teslaSiteId: property.teslaSiteId,
});
```

- [ ] **Step 5: Verify type compiles**

Run: `npx tsc --noEmit`
Expected: No errors. (If `property.teslaPortalUrl` is unknown to the Prisma type, regenerate: `npx prisma generate`.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/zuper-property-sync.ts
git commit -m "feat(zuper-property-sync): add Tesla PowerHub + Site ID to property custom fields

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 3: `cascadeUrlToJobs` — fan-out to linked Zuper jobs

**Files:**
- Modify: `src/lib/zuper-property-sync.ts`
- Test: `__tests__/powerhub-crosslink-zuper-cascade.test.ts` (new)

- [ ] **Step 1: Write failing test**

Create `__tests__/powerhub-crosslink-zuper-cascade.test.ts`:

```typescript
import { cascadeUrlToJobs } from "@/lib/zuper-property-sync";
import { prisma } from "@/lib/db";

jest.mock("@/lib/db", () => ({
  prisma: {
    hubSpotPropertyCache: { findUnique: jest.fn() },
    zuperJobCache: { findMany: jest.fn() },
  },
}));

// Mock the Zuper API call (we'll capture invocations)
const fetchMock = jest.fn();
global.fetch = fetchMock as unknown as typeof fetch;

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe("cascadeUrlToJobs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock.mockReset();
    process.env.POWERHUB_CROSSLINK_ENABLED = "true";
    process.env.POWERHUB_ZUPER_CASCADE_ENABLED = "true";
    process.env.ZUPER_API_KEY = "test-key";
    process.env.ZUPER_API_URL = "https://test.zuperpro.com/api";
  });

  it("no-ops when POWERHUB_ZUPER_CASCADE_ENABLED is off", async () => {
    process.env.POWERHUB_ZUPER_CASCADE_ENABLED = "false";
    await cascadeUrlToJobs("prop-1");
    expect(mockPrisma.zuperJobCache.findMany).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("no-ops when property has no teslaPortalUrl", async () => {
    (mockPrisma.hubSpotPropertyCache.findUnique as jest.Mock).mockResolvedValue({
      id: "prop-1", teslaPortalUrl: null, teslaSiteId: null,
      dealLinks: [{ dealId: "d1" }],
    });

    await cascadeUrlToJobs("prop-1");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("updates every linked job's Tesla PowerHub custom field", async () => {
    (mockPrisma.hubSpotPropertyCache.findUnique as jest.Mock).mockResolvedValue({
      id: "prop-1",
      teslaPortalUrl: "https://x",
      teslaSiteId: "tesla-1",
      dealLinks: [{ dealId: "d1" }, { dealId: "d2" }],
    });
    (mockPrisma.zuperJobCache.findMany as jest.Mock).mockResolvedValue([
      { jobUid: "job-1", hubspotDealId: "d1" },
      { jobUid: "job-2", hubspotDealId: "d2" },
    ]);
    // First fetch per job is the GET for existing custom_fields
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { custom_fields: [] } }) }) // GET job-1
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) }) // PUT job-1
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { custom_fields: [] } }) }) // GET job-2
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // PUT job-2

    await cascadeUrlToJobs("prop-1");

    expect(fetchMock).toHaveBeenCalledTimes(4);
    // Verify PUT bodies include both Tesla fields
    const putCall1 = fetchMock.mock.calls[1];
    expect(putCall1[0]).toContain("/jobs");
    const body1 = JSON.parse(putCall1[1].body);
    expect(body1.job.custom_fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Tesla PowerHub", value: "https://x" }),
        expect.objectContaining({ label: "Tesla Site ID", value: "tesla-1" }),
      ])
    );
  });

  it("preserves existing unrelated custom fields via mergeZuperMetaData", async () => {
    (mockPrisma.hubSpotPropertyCache.findUnique as jest.Mock).mockResolvedValue({
      id: "prop-1",
      teslaPortalUrl: "https://x",
      teslaSiteId: "tesla-1",
      dealLinks: [{ dealId: "d1" }],
    });
    (mockPrisma.zuperJobCache.findMany as jest.Mock).mockResolvedValue([
      { jobUid: "job-1", hubspotDealId: "d1" },
    ]);
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            custom_fields: [
              { label: "Module Wattage", value: "400", type: "NUMBER" },
              { label: "Customer Phone", value: "555-0100", type: "SINGLE_LINE" },
            ],
          },
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    await cascadeUrlToJobs("prop-1");

    const putBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    const labels = putBody.job.custom_fields.map((f: { label: string }) => f.label);
    expect(labels).toEqual(
      expect.arrayContaining(["Module Wattage", "Customer Phone", "Tesla PowerHub", "Tesla Site ID"])
    );
  });

  it("continues if one job update fails", async () => {
    (mockPrisma.hubSpotPropertyCache.findUnique as jest.Mock).mockResolvedValue({
      id: "prop-1",
      teslaPortalUrl: "https://x",
      teslaSiteId: "tesla-1",
      dealLinks: [{ dealId: "d1" }, { dealId: "d2" }],
    });
    (mockPrisma.zuperJobCache.findMany as jest.Mock).mockResolvedValue([
      { jobUid: "job-1", hubspotDealId: "d1" },
      { jobUid: "job-2", hubspotDealId: "d2" },
    ]);
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 500 }) // GET job-1 fails
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { custom_fields: [] } }) }) // GET job-2
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // PUT job-2

    await expect(cascadeUrlToJobs("prop-1")).resolves.not.toThrow();
    // job-2 PUT should still have happened
    const putCall = fetchMock.mock.calls.find((c: unknown[]) => (c[1] as { method?: string }).method === "PUT");
    expect(putCall).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/powerhub-crosslink-zuper-cascade.test.ts`
Expected: FAIL — `cascadeUrlToJobs is not exported`.

- [ ] **Step 3: Implement `cascadeUrlToJobs`**

Append to `src/lib/zuper-property-sync.ts`:

```typescript
const ZUPER_CASCADE_FLAG = "POWERHUB_ZUPER_CASCADE_ENABLED";

function isZuperCascadeEnabled(): boolean {
  return process.env[ZUPER_CASCADE_FLAG] === "true";
}

/**
 * Cascade Tesla PowerHub URL + Site ID to every Zuper job linked to a property.
 *
 * Called inline after syncPropertyToZuper. No new cron job — runs as part of
 * the existing 15-min property sync cycle. Small fan-out (typically 1-3 jobs
 * per property) wrapped in Promise.allSettled so one job failure doesn't
 * block the rest.
 *
 * No-ops if POWERHUB_ZUPER_CASCADE_ENABLED !== "true" (independent flag from
 * the master POWERHUB_CROSSLINK_ENABLED — lets us validate HubSpot push at
 * fleet scale before turning on Zuper writes).
 *
 * Touches all jobs regardless of jobStatus (active, completed, cancelled) —
 * idempotent merge means historical jobs benefit when a tech later references
 * them.
 */
export async function cascadeUrlToJobs(propertyCacheId: string): Promise<void> {
  if (!isZuperCascadeEnabled()) return;

  const property = await prisma.hubSpotPropertyCache.findUnique({
    where: { id: propertyCacheId },
    include: { dealLinks: true },
  });
  if (!property) return;
  if (!property.teslaPortalUrl) return; // Nothing to push

  const dealIds = property.dealLinks.map((l) => l.dealId);
  if (dealIds.length === 0) return;

  const jobs = await prisma.zuperJobCache.findMany({
    where: { hubspotDealId: { in: dealIds } },
    select: { jobUid: true },
  });

  if (jobs.length === 0) return;

  const newFields: ZuperMetaDataEntry[] = [
    { label: "Tesla PowerHub", value: property.teslaPortalUrl, type: "SINGLE_LINE" },
    { label: "Tesla Site ID", value: property.teslaSiteId ?? "", type: "SINGLE_LINE" },
  ];

  await Promise.allSettled(
    jobs.map((job) => updateZuperJobCustomFields(job.jobUid, newFields))
  );
}

/**
 * Update a single Zuper job's custom_fields using the safe read-merge-write pattern.
 */
async function updateZuperJobCustomFields(
  jobUid: string,
  newFields: ZuperMetaDataEntry[]
): Promise<void> {
  const apiKey = process.env.ZUPER_API_KEY;
  if (!apiKey) {
    console.warn(`[cascadeUrlToJobs] ZUPER_API_KEY not configured; skipping ${jobUid}`);
    return;
  }
  try {
    // 1. Read existing custom_fields
    const getRes = await fetch(`${ZUPER_API_URL}/jobs/${jobUid}`, {
      method: "GET",
      headers: { "x-api-key": apiKey },
    });
    if (!getRes.ok) {
      console.warn(`[cascadeUrlToJobs] GET /jobs/${jobUid} failed: ${getRes.status}`);
      return;
    }
    const getJson = (await getRes.json()) as { data?: { custom_fields?: ZuperMetaDataEntry[] } };
    const existing = getJson.data?.custom_fields ?? [];

    // 2. Merge (preserves unrelated fields)
    const merged = mergeZuperMetaData(existing, newFields);

    // 3. Write
    const putRes = await fetch(`${ZUPER_API_URL}/jobs`, {
      method: "PUT",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ job: { job_uid: jobUid, custom_fields: merged } }),
    });
    if (!putRes.ok) {
      console.warn(`[cascadeUrlToJobs] PUT /jobs ${jobUid} failed: ${putRes.status}`);
    }
  } catch (err) {
    console.error(`[cascadeUrlToJobs] Unexpected error for ${jobUid}:`, err);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest __tests__/powerhub-crosslink-zuper-cascade.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/zuper-property-sync.ts __tests__/powerhub-crosslink-zuper-cascade.test.ts
git commit -m "feat(zuper-property-sync): cascade Tesla PowerHub URL to linked jobs

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 4: Wire `cascadeUrlToJobs` into `syncPropertyToZuper`

**Files:**
- Modify: `src/lib/zuper-property-sync.ts`

- [ ] **Step 1: Find the tail of `syncPropertyToZuper`**

Run: `grep -n "syncPropertyToZuper\|return {" src/lib/zuper-property-sync.ts | head`

Locate the end of the function (look for the `return { propertyId, zuperPropertyUid, action }` or similar).

- [ ] **Step 2: Add cascade call before the return**

Just before the final `return`:

```typescript
// Cascade the URL fields to every linked Zuper job.
// Runs inside the same cron cycle. Errors are logged but don't fail the property sync.
await cascadeUrlToJobs(propertyCacheId);

return { propertyId: propertyCacheId, zuperPropertyUid, action };
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/zuper-property-sync.ts
git commit -m "feat(zuper-property-sync): invoke cascadeUrlToJobs after property sync

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Chunk 4: Monitoring tab + API routes

**Goal:** Add a new "Monitoring" tab to the Property Hub backed by two new API routes. After this chunk, users can open any Property Drawer, click "Monitoring", and see all linked Tesla sites with telemetry + alerts + a prominent portal link button.

### Task 1: Add `"monitoring"` to `HubTab` union

**Files:**
- Modify: `src/lib/property-hub.ts`

- [ ] **Step 1: Extend the union**

In `src/lib/property-hub.ts`, line 31:

```typescript
export type HubTab =
  | "activity"
  | "deals"
  | "tickets"
  | "jobs"
  | "schedule"
  | "equipment"
  | "photos"
  | "monitoring"; // NEW
```

- [ ] **Step 2: Add the typed payload interface**

After the existing tab data interfaces (around line 169), add:

```typescript
export interface MonitoringSitePayload {
  id: string;                 // PowerhubSite.id
  siteId: string;             // Tesla UUID
  siteName: string;
  portalUrl: string | null;
  status: "ACTIVE" | "OFFLINE" | "ERROR";
  isPrimary: boolean;
  lastTelemetryAt: Date | null;
  snapshot: {
    solarPowerW: number | null;
    batterySocPercent: number | null;
    gridConnectedStatus: string | null;
  } | null;
  activeAlerts: Array<{
    id: string;
    alertName: string;
    severity: "INFORMATIONAL" | "PERFORMANCE" | "CRITICAL";
    reportedAt: Date;
  }>;
}

export interface MonitoringTabData {
  sites: MonitoringSitePayload[];
  totalActiveAlerts: number;
}
```

Add to the `HubResponse` union (around line 185):

```typescript
export type HubResponse =
  | { tab: "activity"; data: ActivityTabData }
  | { tab: "deals"; data: DealsTabData }
  | { tab: "tickets"; data: TicketsTabData }
  | { tab: "jobs"; data: JobsTabData }
  | { tab: "schedule"; data: ScheduleTabData }
  | { tab: "equipment"; data: EquipmentTabData }
  | { tab: "photos"; data: PhotosTabData }
  | { tab: "monitoring"; data: MonitoringTabData }; // NEW
```

- [ ] **Step 3: Type-check (will fail because dispatcher is non-exhaustive)**

Run: `npx tsc --noEmit`
Expected: Error in `getPropertyHub` switch — the `default: never` branch breaks.

### Task 2: `fetchMonitoring` function

**Files:**
- Modify: `src/lib/property-hub.ts`

- [ ] **Step 1: Implement `fetchMonitoring`**

After `fetchPhotos` (somewhere around line 600), add:

```typescript
async function fetchMonitoring(propertyId: string): Promise<MonitoringTabData> {
  const sites = await prisma.powerhubSite.findMany({
    where: { propertyId },
    include: {
      telemetrySnapshot: true,
      alerts: { where: { isActive: true }, orderBy: { reportedAt: "desc" } },
    },
    orderBy: { primaryForProperty: "desc" }, // primary first
  });

  const payload: MonitoringSitePayload[] = sites.map((s) => ({
    id: s.id,
    siteId: s.siteId,
    siteName: s.siteName,
    portalUrl: s.portalUrl,
    status: s.status,
    isPrimary: s.primaryForProperty,
    lastTelemetryAt: s.lastTelemetryAt,
    snapshot: s.telemetrySnapshot
      ? {
          solarPowerW: s.telemetrySnapshot.solarPowerW,
          batterySocPercent: s.telemetrySnapshot.batterySocPercent,
          gridConnectedStatus: s.telemetrySnapshot.gridConnectedStatus,
        }
      : null,
    activeAlerts: s.alerts.map((a) => ({
      id: a.id,
      alertName: a.alertName,
      severity: a.severity,
      reportedAt: a.reportedAt,
    })),
  }));

  const totalActiveAlerts = payload.reduce((sum, s) => sum + s.activeAlerts.length, 0);
  return { sites: payload, totalActiveAlerts };
}
```

- [ ] **Step 2: Wire into the dispatcher**

In the `getPropertyHub` switch (line 687):

```typescript
    case "photos":
      return { tab, data: await fetchPhotos(propertyId) };
    case "monitoring":
      return { tab, data: await fetchMonitoring(propertyId) };
    default: {
      const _exhaustive: never = tab;
      throw new Error(`Unknown tab: ${_exhaustive}`);
    }
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Add counts integration**

Find `getPropertyHubCounts` (line 653). Add an entry for `monitoringAlerts`:

```typescript
const [/* existing */, monitoringAlerts] = await Promise.all([
  // ... existing parallel queries ...
  prisma.powerhubAlert.count({
    where: { isActive: true, site: { propertyId } },
  }),
]);

return {
  // ... existing keys ...
  monitoringAlerts,
};
```

And extend the `HubCounts` interface:

```typescript
export interface HubCounts {
  // ... existing ...
  monitoringAlerts: number;
}
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/property-hub.ts
git commit -m "feat(property-hub): add Monitoring tab fetch + counts

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 3: New API route — list sites for a property

**Files:**
- Create: `src/app/api/powerhub/properties/[propertyId]/sites/route.ts`

- [ ] **Step 1: Write the route**

```typescript
// src/app/api/powerhub/properties/[propertyId]/sites/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getPropertyHub } from "@/lib/property-hub";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ propertyId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { propertyId } = await params;

  try {
    const response = await getPropertyHub(propertyId, "monitoring");
    return NextResponse.json(response.data);
  } catch (err) {
    console.error(`[api/powerhub/properties/${propertyId}/sites] error:`, err);
    return NextResponse.json({ error: "Failed to load monitoring data" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify roles allowedRoutes covers this path**

Run: `grep "/api/powerhub" src/lib/roles.ts | head`
Expected: Multiple matches showing `/api/powerhub` is in allowedRoutes for ADMIN, OWNER, PROJECT_MANAGER, OPERATIONS_MANAGER, OPERATIONS, TECH_OPS, SERVICE, DESIGN.

The middleware uses prefix matching, so `/api/powerhub/properties/...` is covered by the existing `/api/powerhub` entry. **No role changes needed.**

- [ ] **Step 3: Manual smoke test**

```bash
# Start dev server
npm run dev

# In another terminal — get a property cuid from the DB
PROP_ID=$(npx prisma db execute --stdin <<'SQL' --schema prisma/schema.prisma
SELECT id FROM "HubSpotPropertyCache" LIMIT 1;
SQL
)

# Hit the route (browser cookies required — easier to use the Property Drawer UI later)
# This is mainly a syntax check
curl -i http://localhost:3000/api/powerhub/properties/<paste-id>/sites
```

Expected: 200 with `{ sites: [], totalActiveAlerts: 0 }` (or 401 if not signed in — that's also a pass since the auth check runs).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/powerhub/properties/[propertyId]/sites/route.ts
git commit -m "feat(api): GET /api/powerhub/properties/[id]/sites for Monitoring tab

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 4: New API route — force resync

**Files:**
- Create: `src/app/api/powerhub/properties/[propertyId]/resync/route.ts`

- [ ] **Step 1: Write the route**

```typescript
// src/app/api/powerhub/properties/[propertyId]/resync/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { enqueueCrossSystemPush } from "@/lib/powerhub-crosslink";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ propertyId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Admin-only — relies on the existing middleware ADMIN_ONLY check for
  // /api/admin paths. This route lives at /api/powerhub so we add an
  // explicit role check here.
  const roles = (session.user as { roles?: string[] }).roles ?? [];
  if (!roles.includes("ADMIN") && !roles.includes("OWNER")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { propertyId } = await params;

  try {
    await enqueueCrossSystemPush(propertyId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[api/powerhub/properties/${propertyId}/resync] error:`, err);
    return NextResponse.json({ error: "Resync failed" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/powerhub/properties/[propertyId]/resync/route.ts
git commit -m "feat(api): POST /api/powerhub/properties/[id]/resync (admin)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 5: Add query keys for the new tab

**Files:**
- Modify: `src/lib/query-keys.ts`

- [ ] **Step 1: Add the key factory**

In `src/lib/query-keys.ts`, find the `powerhub` block (line 58) and add:

```typescript
  powerhub: {
    root: ["powerhub"] as const,
    sites: (params?: unknown) =>
      [...queryKeys.powerhub.root, "sites", params] as const,
    site: (siteId: string) =>
      [...queryKeys.powerhub.root, "site", siteId] as const,
    fleet: () => [...queryKeys.powerhub.root, "fleet"] as const,
    // NEW
    propertySites: (propertyId: string) =>
      [...queryKeys.powerhub.root, "property", propertyId, "sites"] as const,
  },
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/query-keys.ts
git commit -m "feat(query-keys): add propertySites key for Monitoring tab

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Chunk 5: Shared UI components + Suite surfacing

**Goal:** Build the `<PowerhubLink>` and `<SystemHealthBadge>` shared components, create the `<PropertyMonitoringTab>`, and wire all of these into the Service Suite (Customer 360, Tickets, Priority Queue), Design & Engineering Suite (Project Detail), and the Deals Detail panel.

### Task 1: `<PowerhubLink>` shared component

**Files:**
- Create: `src/components/powerhub/PowerhubLink.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/powerhub/PowerhubLink.tsx
import { ExternalLink } from "lucide-react";
import clsx from "clsx";

export interface PowerhubLinkProps {
  url: string | null | undefined;
  siteName?: string | null;
  variant?: "button" | "inline" | "icon";
  className?: string;
}

/**
 * Deep link to a Tesla PowerHub site.
 *
 * Returns null when url is falsy — never renders a broken link.
 *
 * Variants:
 *   - button: full-width, themed button. Use in headers/hero areas.
 *   - inline: text link with external-link icon. Use in detail rows.
 *   - icon: bare icon. Use in compact table cells.
 */
export function PowerhubLink({
  url,
  siteName,
  variant = "inline",
  className,
}: PowerhubLinkProps) {
  if (!url) return null;

  const label = siteName ? `Open ${siteName} in Tesla PowerHub` : "Open in Tesla PowerHub";
  const linkText = siteName ?? "Tesla PowerHub";

  if (variant === "icon") {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        title={label}
        aria-label={label}
        className={clsx("inline-flex items-center text-muted hover:text-foreground transition-colors", className)}
      >
        <ExternalLink size={14} />
      </a>
    );
  }

  if (variant === "button") {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={clsx(
          "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium",
          "bg-red-600 text-white hover:bg-red-700 transition-colors",
          className,
        )}
      >
        <span>Open in Tesla PowerHub</span>
        <ExternalLink size={14} />
      </a>
    );
  }

  // inline
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={clsx(
        "inline-flex items-center gap-1 text-sm text-foreground hover:underline",
        className,
      )}
    >
      <span>{linkText}</span>
      <ExternalLink size={12} className="text-muted" />
    </a>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/powerhub/PowerhubLink.tsx
git commit -m "feat(powerhub): add PowerhubLink shared component (button/inline/icon variants)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 2: `<SystemHealthBadge>` table-row component

**Files:**
- Create: `src/components/powerhub/SystemHealthBadge.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/powerhub/SystemHealthBadge.tsx
import { PowerhubLink } from "./PowerhubLink";

export interface SystemHealthBadgeProps {
  portalUrl: string | null | undefined;
  activeAlertCount: number;
  highestSeverity?: "INFORMATIONAL" | "PERFORMANCE" | "CRITICAL" | null;
}

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: "bg-red-500",
  PERFORMANCE: "bg-yellow-500",
  INFORMATIONAL: "bg-blue-500",
};

/**
 * Compact badge for table rows.
 * Shows: severity dot (when alerts active) + clickable external-link icon.
 * Returns null when there is no portalUrl AND no alerts.
 */
export function SystemHealthBadge({
  portalUrl,
  activeAlertCount,
  highestSeverity,
}: SystemHealthBadgeProps) {
  if (!portalUrl && activeAlertCount === 0) return null;

  return (
    <div className="inline-flex items-center gap-1.5">
      {activeAlertCount > 0 && highestSeverity && (
        <span
          title={`${activeAlertCount} active ${highestSeverity.toLowerCase()} alert${activeAlertCount === 1 ? "" : "s"}`}
          className={`inline-block h-2 w-2 rounded-full ${SEVERITY_COLOR[highestSeverity]}`}
        />
      )}
      <PowerhubLink url={portalUrl ?? null} variant="icon" />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/powerhub/SystemHealthBadge.tsx
git commit -m "feat(powerhub): add SystemHealthBadge for compact table-row display

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 3: `<PropertyMonitoringTab>` component

**Files:**
- Create: `src/components/property/PropertyMonitoringTab.tsx`

- [ ] **Step 1: Look at the structure of an existing tab for the conventions**

Run: `cat src/components/property/PropertyEquipmentTab.tsx | head -80`
Note the React Query hook pattern, loading/empty/error states, and styling.

- [ ] **Step 2: Write the component**

```tsx
// src/components/property/PropertyMonitoringTab.tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { PowerhubLink } from "@/components/powerhub/PowerhubLink";
import type { MonitoringTabData } from "@/lib/property-hub";
import { formatDistanceToNow } from "date-fns";

interface Props {
  propertyId: string;
}

const SEVERITY_BADGE: Record<string, string> = {
  CRITICAL: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  PERFORMANCE: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  INFORMATIONAL: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
};

export function PropertyMonitoringTab({ propertyId }: Props) {
  const { data, isLoading, error } = useQuery<MonitoringTabData>({
    queryKey: queryKeys.powerhub.propertySites(propertyId),
    queryFn: async () => {
      const res = await fetch(`/api/powerhub/properties/${propertyId}/sites`);
      if (!res.ok) throw new Error("Failed to load monitoring data");
      return res.json();
    },
    staleTime: 60_000, // 60s — telemetry updates every 15 min upstream
  });

  if (isLoading) {
    return <div className="text-muted text-sm p-4">Loading Tesla PowerHub data…</div>;
  }
  if (error) {
    return <div className="text-red-500 text-sm p-4">Error loading monitoring data</div>;
  }
  if (!data || data.sites.length === 0) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted text-sm">This property has no Tesla PowerHub sites linked.</p>
        <p className="text-xs text-muted mt-2">
          Sites are linked automatically by the asset-sync cron.{" "}
          <a href="/dashboards/admin/powerhub" className="underline">
            Open Admin Linkage ↗
          </a>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      {data.sites.map((site) => (
        <div
          key={site.id}
          className="rounded-lg border border-t-border bg-surface p-4 shadow-card"
        >
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-foreground">{site.siteName}</h3>
                {site.isPrimary && (
                  <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                    Primary
                  </span>
                )}
                <StatusBadge status={site.status} />
              </div>
              <p className="text-xs text-muted mt-1">{site.siteId}</p>
            </div>
            <PowerhubLink url={site.portalUrl} siteName={site.siteName} variant="button" />
          </div>

          {site.snapshot && (
            <div className="grid grid-cols-3 gap-3 mb-3 text-sm">
              <SnapshotStat label="Solar" value={formatPower(site.snapshot.solarPowerW)} />
              <SnapshotStat
                label="Battery"
                value={
                  site.snapshot.batterySocPercent != null
                    ? `${site.snapshot.batterySocPercent.toFixed(0)}%`
                    : "—"
                }
              />
              <SnapshotStat label="Grid" value={site.snapshot.gridConnectedStatus ?? "—"} />
            </div>
          )}

          {site.activeAlerts.length > 0 && (
            <div className="border-t border-t-border pt-3">
              <h4 className="text-xs font-medium text-muted mb-2">
                Active Alerts ({site.activeAlerts.length})
              </h4>
              <ul className="space-y-1">
                {site.activeAlerts.map((alert) => (
                  <li key={alert.id} className="flex items-center justify-between text-sm">
                    <span className="text-foreground">{alert.alertName}</span>
                    <span className={`text-xs px-2 py-0.5 rounded ${SEVERITY_BADGE[alert.severity]}`}>
                      {alert.severity}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-xs text-muted mt-3">
            {site.lastTelemetryAt
              ? `Last synced ${formatDistanceToNow(new Date(site.lastTelemetryAt), { addSuffix: true })}`
              : "Never synced"}
          </p>
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: "ACTIVE" | "OFFLINE" | "ERROR" }) {
  const color =
    status === "ACTIVE"
      ? "bg-green-500"
      : status === "OFFLINE"
        ? "bg-gray-400"
        : "bg-red-500";
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} title={status} />;
}

function SnapshotStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="text-xs text-muted uppercase tracking-wide">{label}</div>
      <div className="text-base font-medium text-foreground">{value}</div>
    </div>
  );
}

function formatPower(w: number | null): string {
  if (w == null) return "—";
  if (Math.abs(w) >= 1000) return `${(w / 1000).toFixed(1)} kW`;
  return `${w.toFixed(0)} W`;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/property/PropertyMonitoringTab.tsx
git commit -m "feat(property): PropertyMonitoringTab — Property Hub tab content

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 4: Add Monitoring tab to PropertyHubTabs navigation

**Files:**
- Modify: `src/components/property/PropertyHubTabs.tsx`
- Modify: wherever tab content is dispatched (likely `PropertyDrawer` or `PropertyHubTabs` itself)

- [ ] **Step 1: Read the existing tabs file**

Run: `cat src/components/property/PropertyHubTabs.tsx | head -60`
Note the tab array/enum structure. There's likely a `TABS` constant or an array of `{ id, label, icon, count? }` entries.

- [ ] **Step 2: Add Monitoring entry**

Add an entry for `"monitoring"`. Use an appropriate Lucide icon (`Activity` or `Zap`). Make the count show `monitoringAlerts` from `HubCounts` with a red badge if > 0.

Example (adjust to match existing structure):

```tsx
const TABS = [
  // ... existing entries ...
  {
    id: "monitoring" as const,
    label: "Monitoring",
    icon: <Zap size={14} />,
    count: counts.monitoringAlerts,
    countTone: counts.monitoringAlerts > 0 ? "red" : "neutral",
  },
];
```

- [ ] **Step 3: Render `<PropertyMonitoringTab>` in the content area**

Locate where tab content is rendered (likely a switch on `activeTab`). Add:

```tsx
{activeTab === "monitoring" && <PropertyMonitoringTab propertyId={propertyId} />}
```

Import: `import { PropertyMonitoringTab } from "./PropertyMonitoringTab";`

- [ ] **Step 4: Visual check**

Open Property Drawer for a property with a linked PowerhubSite. Click Monitoring tab. Should render site cards, telemetry, alerts, prominent button.

- [ ] **Step 5: Commit**

```bash
git add src/components/property/PropertyHubTabs.tsx
git commit -m "feat(property-hub): add Monitoring tab navigation

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 5: Service Suite — Customer 360 + System Health

**Files:**
- Modify: `src/components/powerhub/SystemHealth.tsx`

- [ ] **Step 1: Add `<PowerhubLink>` to the existing SystemHealth panel**

Read the existing file: `cat src/components/powerhub/SystemHealth.tsx | head -60`

Find the header/title area. Add at top-right:

```tsx
import { PowerhubLink } from "./PowerhubLink";

// In the JSX, in the panel header:
<div className="flex items-start justify-between">
  <h3 className="text-base font-semibold text-foreground">System Health</h3>
  <PowerhubLink url={site?.portalUrl} siteName={site?.siteName} variant="button" />
</div>
```

(Adjust the prop name `site` to match what the component actually receives — likely `data` or `site`.)

- [ ] **Step 2: Commit**

```bash
git add src/components/powerhub/SystemHealth.tsx
git commit -m "feat(service): add Open-in-PowerHub button to Customer 360 System Health

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 6: Service Tickets detail — inline PowerHub link

**Files:**
- Modify: the Service Tickets detail page (likely `src/app/dashboards/service-tickets/[ticketId]/page.tsx` or similar)

- [ ] **Step 1: Locate the ticket detail page**

Run: `find src/app/dashboards -path "*service-ticket*" -name "page.tsx"`
Open the detail page (the one with `[ticketId]`).

- [ ] **Step 2: Add a PowerHub row in the context section**

Find the section that shows deal/contact/property info. Add a conditional row:

```tsx
import { PowerhubLink } from "@/components/powerhub/PowerhubLink";

// In the context section JSX, after the property/address row:
{ticket.teslaPortalUrl && (
  <div className="flex justify-between text-sm">
    <span className="text-muted">Tesla PowerHub</span>
    <PowerhubLink url={ticket.teslaPortalUrl} siteName={ticket.teslaSiteId ?? undefined} variant="inline" />
  </div>
)}
```

The `teslaPortalUrl` and `teslaSiteId` come from the HubSpot ticket properties (already populated by Chunk 2's push). Ensure the ticket fetch includes these properties in the HubSpot API call — locate the fetch and add to the `properties` array:

```typescript
properties: [
  // ... existing properties ...
  "tesla_portal_url",
  "tesla_site_id",
],
```

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/service-tickets/
git commit -m "feat(service): show Tesla PowerHub link on ticket detail

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 7: Service Priority Queue — System Health column

**Files:**
- Modify: the priority queue page (likely `src/app/dashboards/service/page.tsx` or `service-overview`)

- [ ] **Step 1: Locate the priority queue table component**

Run: `grep -rn "priority-queue\|PriorityQueue\|servicePriority" src/app/dashboards/service src/components/scheduler 2>/dev/null | grep -v node_modules | head`

- [ ] **Step 2: Add System column**

In the table column definition, add a new column after the existing scoring columns:

```tsx
import { SystemHealthBadge } from "@/components/powerhub/SystemHealthBadge";

// In columns:
{
  header: "System",
  cell: (row) => (
    <SystemHealthBadge
      portalUrl={row.teslaPortalUrl}
      activeAlertCount={row.activeAlertCount ?? 0}
      highestSeverity={row.highestAlertSeverity}
    />
  ),
}
```

Add the source fields to the priority queue payload. The enrichment lives in `service-priority.ts`, not the page component.

**Important:** `PowerhubAlertSeverity` is an enum (`INFORMATIONAL | PERFORMANCE | CRITICAL`). Prisma's `_max` on an enum column returns the lexicographically-max string, which is NOT the highest severity (alphabetically: CRITICAL < INFORMATIONAL < PERFORMANCE — wrong order). We need an explicit ranking. Use a plain `findMany` and a JS-side reducer with an explicit severity order.

```typescript
// Add to src/lib/service-priority.ts at the top:
const SEVERITY_RANK: Record<string, number> = {
  INFORMATIONAL: 1,
  PERFORMANCE: 2,
  CRITICAL: 3,
};

// Inside the priority queue builder, after deals are loaded:
const dealIds = deals.map((d) => d.id);

// 1. Map dealId → propertyId via PropertyDealLink (plus the property's teslaPortalUrl)
const propertyLinks = await prisma.propertyDealLink.findMany({
  where: { dealId: { in: dealIds } },
  select: {
    dealId: true,
    propertyId: true,
    property: { select: { teslaPortalUrl: true } },
  },
});
const propByDeal = new Map(propertyLinks.map((l) => [l.dealId, l.property.teslaPortalUrl]));
const dealsByProperty = new Map<string, string[]>(); // propertyId → list of dealIds
for (const l of propertyLinks) {
  const list = dealsByProperty.get(l.propertyId) ?? [];
  list.push(l.dealId);
  dealsByProperty.set(l.propertyId, list);
}

// 2. Pull active alerts grouped by site (via property)
const propertyIds = [...dealsByProperty.keys()];
const alertsBySite = propertyIds.length === 0
  ? []
  : await prisma.powerhubAlert.findMany({
      where: {
        isActive: true,
        site: { propertyId: { in: propertyIds } },
      },
      select: {
        severity: true,
        site: { select: { propertyId: true } },
      },
    });

// 3. Aggregate per propertyId: count + max severity (by SEVERITY_RANK)
const alertSummaryByProperty = new Map<string, { count: number; highest: "INFORMATIONAL" | "PERFORMANCE" | "CRITICAL" }>();
for (const a of alertsBySite) {
  const propertyId = a.site.propertyId;
  if (!propertyId) continue;
  const existing = alertSummaryByProperty.get(propertyId);
  if (!existing) {
    alertSummaryByProperty.set(propertyId, { count: 1, highest: a.severity });
  } else {
    existing.count++;
    if (SEVERITY_RANK[a.severity] > SEVERITY_RANK[existing.highest]) {
      existing.highest = a.severity;
    }
  }
}

// 4. Fan back out to each deal (a property's alerts apply to every linked deal)
const alertSummaryByDeal = new Map<string, { count: number; highest: "INFORMATIONAL" | "PERFORMANCE" | "CRITICAL" }>();
for (const [propertyId, summary] of alertSummaryByProperty) {
  const dealIdsForProperty = dealsByProperty.get(propertyId) ?? [];
  for (const dealId of dealIdsForProperty) {
    alertSummaryByDeal.set(dealId, summary);
  }
}

// 5. Attach to each row in the priority queue
for (const row of rows) {
  row.teslaPortalUrl = propByDeal.get(row.dealId) ?? null;
  const summary = alertSummaryByDeal.get(row.dealId);
  row.activeAlertCount = summary?.count ?? 0;
  row.highestAlertSeverity = summary?.highest ?? null;
}
```

Also extend the `PriorityQueueRow` type (or equivalent) in `service-priority.ts` to include the three new optional fields:

```typescript
interface PriorityQueueRow {
  // ... existing fields ...
  teslaPortalUrl?: string | null;
  activeAlertCount?: number;
  highestAlertSeverity?: "INFORMATIONAL" | "PERFORMANCE" | "CRITICAL" | null;
}
```

**Note on cache cascade:** `query-keys.ts:296-297` already routes `powerhub:alerts*` invalidations to both `queryKeys.powerhub.root` AND `queryKeys.servicePriority.root`, so alert changes will correctly invalidate the priority queue. No change needed there.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/service/ src/lib/service-priority.ts src/components/scheduler/
git commit -m "feat(service): add System health column to priority queue

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 8: D&E Project Detail + Deal Detail

**Files:**
- Modify: the project detail panel in D&E suite
- Modify: the Deal Detail panel (wherever address/property section renders)

- [ ] **Step 1: Locate the D&E project detail panel**

Run: `find src/app/dashboards -path "*design*" -name "*.tsx" | head` and `find src/components -name "*Project*"`
The project detail panel is likely `src/components/ProjectDetail.tsx` or in a design-engineering subdir.

- [ ] **Step 2: Add PowerHub row to the equipment/system section**

```tsx
import { PowerhubLink } from "@/components/powerhub/PowerhubLink";

{deal.tesla_portal_url && (
  <div className="flex justify-between text-sm">
    <span className="text-muted">Tesla PowerHub</span>
    <PowerhubLink url={deal.tesla_portal_url} siteName={deal.tesla_site_id ?? undefined} variant="inline" />
  </div>
)}
```

Ensure the deal fetch includes the two new properties in the HubSpot properties list (similar to Task 6 step 2).

- [ ] **Step 3: Same for the Deals Suite detail panel**

Run: `find src/app/dashboards -path "*deal*" -name "*.tsx" | head`
Apply the same `<PowerhubLink>` row in the address/property section.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboards/ src/components/
git commit -m "feat(de+deals): show Tesla PowerHub link on project + deal detail panels

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Chunk 6: Backfill script + rollout runbook

**Goal:** Add the one-time backfill script that walks every currently-linked PowerhubSite and triggers a push, gated by the singleton lock. Document the rollout sequence.

### Task 1: Backfill lock (clone of property-backfill-lock pattern)

**Files:**
- Create: `src/lib/powerhub-crosslink-backfill-lock.ts`

- [ ] **Step 1: Read the reference implementation**

Run: `cat src/lib/property-backfill-lock.ts`
Understand the pattern: acquire (with P2002 stale-takeover), heartbeat, release, resume.

- [ ] **Step 2: Clone for the new model**

Create `src/lib/powerhub-crosslink-backfill-lock.ts`:

```typescript
/**
 * Singleton lock for the PowerhubCrosslinkBackfillRun pipeline.
 * Clone of property-backfill-lock.ts adapted for the new Prisma model.
 */
import { prisma } from "@/lib/db";

export const HEARTBEAT_MS = 30_000;
export const STALE_LOCK_MS = 5 * 60 * 1000;

export interface AcquiredLock {
  runId: string;
  cursor: string | null;
  heartbeatAt: Date;
}

export type AcquireResult = AcquiredLock | { reason: "in_progress"; existingRunId: string };

export async function acquireBackfillLock(): Promise<AcquireResult> {
  try {
    const created = await prisma.powerhubCrosslinkBackfillRun.create({
      data: { status: "running" },
    });
    return { runId: created.id, cursor: created.cursor, heartbeatAt: created.heartbeatAt };
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code !== "P2002") throw err;

    // Another row is already 'running' — check if it's stale
    const existing = await prisma.powerhubCrosslinkBackfillRun.findFirst({
      where: { status: "running" },
    });
    if (!existing) {
      // Race won by us in the meantime — retry once
      return acquireBackfillLock();
    }
    const age = Date.now() - existing.heartbeatAt.getTime();
    if (age < STALE_LOCK_MS) {
      return { reason: "in_progress", existingRunId: existing.id };
    }
    // Stale takeover via optimistic CAS
    const taken = await prisma.powerhubCrosslinkBackfillRun.updateMany({
      where: { id: existing.id, heartbeatAt: existing.heartbeatAt },
      data: { heartbeatAt: new Date(), startedAt: new Date() },
    });
    if (taken.count === 0) {
      // Lost race
      return acquireBackfillLock();
    }
    return { runId: existing.id, cursor: existing.cursor, heartbeatAt: new Date() };
  }
}

export async function heartbeatBackfillLock(runId: string): Promise<void> {
  await prisma.powerhubCrosslinkBackfillRun.update({
    where: { id: runId },
    data: { heartbeatAt: new Date() },
  });
}

export async function releaseBackfillLock(
  runId: string,
  outcome: "completed" | "failed" | "paused",
  error?: string,
): Promise<void> {
  await prisma.powerhubCrosslinkBackfillRun.update({
    where: { id: runId },
    data: {
      status: outcome,
      completedAt: outcome === "paused" ? null : new Date(),
      errorMessage: error ?? null,
    },
  });
}

export async function updateBackfillCursor(
  runId: string,
  cursor: string,
  processedCount: number,
  failedCount: number,
): Promise<void> {
  await prisma.powerhubCrosslinkBackfillRun.update({
    where: { id: runId },
    data: { cursor, processedCount, failedCount, heartbeatAt: new Date() },
  });
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/powerhub-crosslink-backfill-lock.ts
git commit -m "feat(powerhub-crosslink): add singleton backfill lock (clone of property-backfill-lock)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 2: Backfill script

**Files:**
- Create: `scripts/backfill-powerhub-crosslinks.ts`

- [ ] **Step 1: Write the script**

```typescript
// scripts/backfill-powerhub-crosslinks.ts
/**
 * One-time backfill: walk every currently-linked PowerhubSite, group by
 * propertyId, run resolvePrimarySite + pushToHubSpotForProperty per property.
 *
 * Resumable via PowerhubCrosslinkBackfillRun cursor.
 * Rate-limited to 5 properties/sec (HubSpot floor).
 *
 * Usage:
 *   npx tsx scripts/backfill-powerhub-crosslinks.ts
 *
 * IMPORTANT: This must NOT be invoked by a subagent. Orchestrator runs it
 * with explicit user approval. See spec § "Execution gate".
 */
import { prisma } from "@/lib/db";
import {
  acquireBackfillLock,
  heartbeatBackfillLock,
  releaseBackfillLock,
  updateBackfillCursor,
  HEARTBEAT_MS,
} from "@/lib/powerhub-crosslink-backfill-lock";
import { enqueueCrossSystemPush } from "@/lib/powerhub-crosslink";

const RATE_PER_SECOND = 5;
const SLEEP_MS = Math.ceil(1000 / RATE_PER_SECOND);

async function main() {
  if (process.env.POWERHUB_CROSSLINK_ENABLED !== "true") {
    console.error("POWERHUB_CROSSLINK_ENABLED is not 'true' — push functions will no-op. Aborting.");
    process.exit(1);
  }

  const lock = await acquireBackfillLock();
  if ("reason" in lock) {
    console.error(`Another backfill is in progress (runId=${lock.existingRunId}). Exiting.`);
    process.exit(1);
  }
  console.log(`Acquired backfill lock: runId=${lock.runId}`);

  const heartbeat = setInterval(() => {
    heartbeatBackfillLock(lock.runId).catch((e) => console.warn("Heartbeat failed:", e));
  }, HEARTBEAT_MS);

  try {
    // Get distinct property IDs to process, ordered by id (cursor-friendly)
    const after = lock.cursor;
    const properties = await prisma.powerhubSite.findMany({
      where: {
        propertyId: { not: null },
        ...(after ? { propertyId: { gt: after } } : {}),
      },
      distinct: ["propertyId"],
      select: { propertyId: true },
      orderBy: { propertyId: "asc" },
    });
    const propertyIds = properties.map((p) => p.propertyId!).filter(Boolean);
    console.log(`Found ${propertyIds.length} distinct properties to process`);

    await prisma.powerhubCrosslinkBackfillRun.update({
      where: { id: lock.runId },
      data: { totalCount: propertyIds.length },
    });

    let processed = 0;
    let failed = 0;
    for (const propertyId of propertyIds) {
      try {
        await enqueueCrossSystemPush(propertyId);
        processed++;
      } catch (err) {
        failed++;
        console.warn(`Failed for property ${propertyId}:`, err);
      }
      // Save cursor every 50 properties so we can resume
      if (processed % 50 === 0) {
        await updateBackfillCursor(lock.runId, propertyId, processed, failed);
        console.log(`Progress: ${processed}/${propertyIds.length} (${failed} failed)`);
      }
      // Rate limit
      await new Promise((r) => setTimeout(r, SLEEP_MS));
    }

    await releaseBackfillLock(lock.runId, "completed");
    console.log(`Done. Processed ${processed}, failed ${failed}.`);
  } catch (err) {
    await releaseBackfillLock(lock.runId, "failed", String(err));
    console.error("Backfill failed:", err);
    process.exit(1);
  } finally {
    clearInterval(heartbeat);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Smoke-test in dry mode (set flag false to verify it no-ops gracefully)**

```bash
POWERHUB_CROSSLINK_ENABLED=false npx tsx scripts/backfill-powerhub-crosslinks.ts
```
Expected: Aborts with "POWERHUB_CROSSLINK_ENABLED is not 'true' — push functions will no-op. Aborting."

- [ ] **Step 3: Commit**

```bash
git add scripts/backfill-powerhub-crosslinks.ts
git commit -m "feat(powerhub-crosslink): resumable backfill script

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 3: Pre-launch checklist + rollout runbook

**Files:**
- Create: `docs/superpowers/runbooks/2026-05-18-powerhub-crosslink-rollout.md`

- [ ] **Step 1: Write the runbook**

```markdown
# PowerHub Crosslink Rollout Runbook

**Date:** 2026-05-18
**Spec:** docs/superpowers/specs/2026-05-18-powerhub-property-zuper-linking-design.md

## Pre-flight (admin work, done BEFORE merge to main)

- [ ] HubSpot: create 6 custom properties (`tesla_portal_url`, `tesla_site_id` × Property + Deal + Ticket). See Chunk 1 Task 1 of the plan for the exact table.
- [ ] Zuper: create 4 custom fields ("Tesla PowerHub", "Tesla Site ID" × Property + Job modules). Field type: URL for "Tesla PowerHub", text for "Tesla Site ID".
- [ ] Confirm Tesla GridLogic portal URL pattern with Tesla account manager. If different from default `https://gridlogic.tesla.com/sites/{siteId}`, set `TESLA_POWERHUB_PORTAL_URL_TEMPLATE` in Vercel production env.
- [ ] Verify predecessor specs are in production: `2026-05-06-powerhub-integration`, `2026-05-16-zuper-property-sync`, `2026-05-17-property-hub-enhancements`.

## Step 1 — Merge code + apply schema migration

- [ ] Merge PR to main.
- [ ] Auto-deploy to production (Vercel).
- [ ] Run prod migration manually: `./scripts/migrate-prod.sh` (do NOT run from a subagent — orchestrator-only with user approval).
- [ ] Verify: `npx prisma db execute --stdin <<'SQL'` returns the new columns: `SELECT column_name FROM information_schema.columns WHERE table_name = 'PowerhubSite' AND column_name IN ('portalUrl', 'primaryForProperty');`

At this point: code is live, schema is updated, flag is OFF — nothing is being pushed externally yet.

## Step 2 — Enable HubSpot push in production

- [ ] Set `POWERHUB_CROSSLINK_ENABLED=true` in Vercel production (use `vercel env add`, NOT echo — `printf '%s' "true" | vercel env add ...`).
- [ ] Verify with `vercel env ls production`.
- [ ] Wait for next deployment OR redeploy to pick up the env var.
- [ ] Watch the next asset-sync cron run (every 6h). Confirm one or two `PowerhubSite` rows have `portalUrl` populated and the linked HubSpot Property shows the new field.

## Step 3 — Run backfill

- [ ] Orchestrator runs (user approval required): `npx tsx scripts/backfill-powerhub-crosslinks.ts`
- [ ] Monitor logs: ~1,200 properties × 5/sec ≈ 4 min runtime.
- [ ] On completion, spot-check 5 random properties in HubSpot UI — `Tesla PowerHub` field should be populated on Property + Deal + Ticket.

## Step 4 — Enable Zuper cascade

- [ ] Set `POWERHUB_ZUPER_CASCADE_ENABLED=true` in Vercel production.
- [ ] Trigger one `zuper-property-sync` cron cycle (15 min normal cadence or manual curl).
- [ ] Spot-check 3 Zuper Properties and their linked Jobs in the Zuper UI — both `Tesla PowerHub` and `Tesla Site ID` fields should be populated.

## Step 5 — Announce

- [ ] Email Service team lead: new System Health column on priority queue, PowerHub button on Customer 360.
- [ ] Email D&E team lead: Tesla PowerHub link now on Project Detail panels.
- [ ] Email field tech lead: Tesla PowerHub field now visible in Zuper Job custom fields.

## Rollback

- [ ] Set `POWERHUB_CROSSLINK_ENABLED=false` in Vercel — kills all push paths.
- [ ] Set `POWERHUB_ZUPER_CASCADE_ENABLED=false` if Zuper-specific issues.
- [ ] No data corruption possible — URL fields just go stale until re-enabled.

## Verification queries

```sql
-- How many properties have a primary site assigned?
SELECT COUNT(*) FROM "PowerhubSite" WHERE "primaryForProperty" = true;

-- How many properties have the denormalized URL set?
SELECT COUNT(*) FROM "HubSpotPropertyCache" WHERE "teslaPortalUrl" IS NOT NULL;

-- Find properties with multiple Tesla sites
SELECT "propertyId", COUNT(*) AS n
FROM "PowerhubSite"
WHERE "propertyId" IS NOT NULL
GROUP BY "propertyId"
HAVING COUNT(*) > 1;
```
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/runbooks/2026-05-18-powerhub-crosslink-rollout.md
git commit -m "docs(runbook): PowerHub crosslink rollout sequence

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 4: Final integration sweep

**Files:**
- None (verification only)

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: All tests pass, including:
- `__tests__/powerhub-crosslink.test.ts`
- `__tests__/powerhub-crosslink-zuper-cascade.test.ts`
- All existing tests (no regressions)

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: PASS — Prisma generates, Next compiles.

- [ ] **Step 5: Manual checklist — visual UI verification (with flag OFF)**

With `POWERHUB_CROSSLINK_ENABLED=false`:
- Open a Property Drawer for a property that has a `PowerhubSite` linked → Monitoring tab renders (showing whatever's in DB).
- Open Customer 360 → SystemHealth panel renders the button only if `portalUrl` is set (won't be in dev without flag, so button hidden — that's correct).
- Open a Service ticket → no Tesla PowerHub row appears (no `tesla_portal_url` property on the ticket — that's correct).

This confirms the UI handles the "no data yet" case gracefully without the flag being on.

- [ ] **Step 6: Commit final cleanup if needed**

If any small fixes surfaced during the sweep:
```bash
git add -A
git commit -m "chore(powerhub-crosslink): final integration sweep fixes

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## End of plan

After completing all 6 chunks:

1. Push branch and open PR.
2. Hand off to user for review.
3. User merges → orchestrator runs migration with user approval → user follows runbook to enable flags.
4. Subagents must not run the prod migration or the backfill script.
