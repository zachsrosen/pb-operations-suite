# PowerHub ↔ Property ↔ Zuper Cross-System Linking — Design Spec

**Date:** 2026-05-18
**Author:** Claude + Zach
**Status:** Draft
**Teams:** Service, Design & Engineering, Field Techs (Zuper), Admin
**Builds on:**
- `2026-05-06-powerhub-integration-design.md` (PowerHub Phase 1 — API client, cron sync, `PowerhubSite` table)
- `2026-05-16-zuper-property-sync-design.md` (Zuper Property module write direction, `mergeZuperMetaData` pattern)
- `2026-05-17-property-hub-enhancements-design.md` (Property Hub tab architecture)

## Problem

PowerHub Phase 1 (in flight) lands the Tesla site cache, an internal fleet dashboard, and a three-tier `PowerhubSite ↔ HubSpotPropertyCache` link. But the link is currently only useful inside PB Ops:

- HubSpot users (Service reps in Customer 360, PMs in deal records) can't jump from a HubSpot Property or Deal record to the corresponding Tesla GridLogic portal — they have to log into Tesla separately, find the site, and cross-reference by address.
- Field techs in the Zuper mobile app have zero awareness that a property even has a Tesla monitoring portal. When they're on-site troubleshooting a Powerwall, they call the office.
- Inside PB Ops Suite, the link is shown only on the Fleet dashboard and a thin Customer 360 "System Health" panel — it doesn't surface on the Property Hub drawer, deal detail, or service tickets where most users actually live.

The underlying linkage exists. What's missing is **the URL** — a clickable deep-link to `gridlogic.tesla.com/sites/<siteId>` — propagated as first-class data into HubSpot's Property, Deal, and Ticket objects, into Zuper's Property and Job modules, and rendered consistently across every suite where the linked records appear.

## Goal

Make the Tesla PowerHub portal one click away from anywhere a user looks at a linked property, deal, ticket, or job — in HubSpot, in Zuper, and in PB Ops Suite. Same URL, same data, same place.

## Scope

### In scope

1. **Portal URL synthesis** — derive `portalUrl` from `PowerhubSite.siteId` using a configurable URL template; persist it on `PowerhubSite`.
2. **Multi-site primary selection** — when a property has >1 Tesla site, choose a single "primary" site (newest by STE date in `siteName`) for external system pushes. Property Hub shows all sites.
3. **HubSpot push** — new custom properties (`tesla_portal_url`, `tesla_site_id`) on the Property, Deal, and Ticket objects; populated via existing sync paths.
4. **Zuper push** — new custom fields ("Tesla PowerHub", "Tesla Site ID") on the Property and Job modules; populated via existing `zuper-property-sync` cron and a new job-level cascade.
5. **Property Hub Monitoring tab** — 8th tab showing all linked Tesla sites with status badges, telemetry snapshot, active alerts, and a prominent "Open in Tesla PowerHub ↗" button per site.
6. **Suite UI surfacing** — Service Suite (Customer 360, Tickets, Priority Queue), Design & Engineering (Fleet, Project Detail), Deals Detail, Property Drawer all get a `<PowerhubLink>` component.
7. **Backfill** — one-time script populates URLs on already-linked sites and pushes to HubSpot + Zuper.

### Out of scope

- Embedded Tesla portal iframes inside PB Ops Suite. Deep links only.
- Bidirectional sync (Tesla → PB writes). Read-only from Tesla.
- Pushing URLs to Zuper Customer/Contact records (only Property + Job).
- New telemetry signals or new Tesla API calls. This spec is plumbing on top of the existing Phase 1 API client.
- Multi-site disambiguation UI for HubSpot/Zuper (we pick primary; admins can override via the existing PowerHub admin linkage page).

### Hard dependencies (must ship first)

- `2026-05-06-powerhub-integration-design.md` Phase 1 → `PowerhubSite` table exists and is being populated.
- `2026-05-16-zuper-property-sync-design.md` → `HubSpotPropertyCache.zuperPropertyUid` is being populated; `mergeZuperMetaData` pattern is in production.
- `2026-05-17-property-hub-enhancements-design.md` → Tab architecture exists for the Monitoring tab to plug into.

Feature flag: `POWERHUB_CROSSLINK_ENABLED`. Disabled until all three dependencies are in production.

## Architecture

### Data flow

```
PowerHub asset-sync cron (existing)
  └─ upsert PowerhubSite
       │
       ├─ compute portalUrl = template.replace("{siteId}", siteId)
       │   stored on PowerhubSite.portalUrl
       │
       └─ if linkMethod ∈ {PROPERTY, ADDRESS_MATCH, MANUAL}:
             │
             ▼
       enqueue cross-system push for propertyId
             │
             ▼
       resolvePrimarySite(propertyId) ──► PowerhubSite.id (newest STE date)
             │
             ├──► HubSpot Property object
             │     PATCH /crm/v3/objects/{HUBSPOT_PROPERTY_OBJECT_TYPE}/{id}
             │     (env var, already defined for Phase 1 Property sync)
             │     properties: { tesla_portal_url, tesla_site_id }
             │
             ├──► For each PropertyDealLink:
             │     HubSpot Deal PATCH (same fields)
             │
             ├──► For each PropertyTicketLink:
             │     HubSpot Ticket PATCH (same fields)
             │
             └──► mark HubSpotPropertyCache dirty
                     (updatedAt > zuperPropertySyncedAt)
                     │
                     ▼
                   existing zuper-property-sync cron picks it up
                     ├──► Zuper Property custom fields updated
                     │     (mergeZuperMetaData with new labels)
                     │
                     └──► For each ZuperJobCache linked to property:
                            PUT /api/jobs custom_fields cascade
                            (new function in zuper-property-sync.ts)
```

### Components

| File | Purpose | New / Modified |
|------|---------|---------------|
| `src/lib/powerhub-crosslink.ts` | New module: `resolvePrimarySite`, `pushToHubSpotForProperty`, `enqueueCrossSystemPush` | New |
| `src/lib/tesla-powerhub.ts` | Add `computePortalUrl(siteId)` helper | Modified |
| `src/lib/powerhub-sync.ts` | After site upsert, call `enqueueCrossSystemPush` if linked | Modified |
| `src/lib/zuper-property-sync.ts` | Add 2 new field labels; add `cascadeUrlToJobs(propertyUid)` function | Modified |
| `src/lib/hubspot-property.ts` | Add `tesla_portal_url`, `tesla_site_id` to synced field list | Modified |
| `src/lib/hubspot.ts` | Add `updateDealProperties` and `updateTicketProperties` helpers if not already present | Modified |
| `src/lib/property-hub.ts` | Add `monitoring` to `HubTab` union; new `fetchMonitoring()` function | Modified |
| `src/components/powerhub/PowerhubLink.tsx` | Reusable "Open in Tesla PowerHub ↗" anchor | New |
| `src/components/powerhub/SystemHealthBadge.tsx` | Compact badge (status + alert count) for table rows | New |
| `src/components/property/MonitoringTab.tsx` | Property Hub tab content | New |
| `src/app/dashboards/service-customers/...` | Add `<PowerhubLink>` to Customer 360 header | Modified |
| `src/app/dashboards/service-tickets/...` | Add `<PowerhubLink>` to ticket detail context section | Modified |
| `src/app/dashboards/service/...` (priority queue) | Add `<SystemHealthBadge>` column when site has active alerts | Modified |
| `src/app/dashboards/design-engineering/...` | Add `<PowerhubLink>` to project detail panel | Modified |
| `src/components/DealDetailPanel.tsx` (or equivalent) | Add Tesla PowerHub row when `tesla_portal_url` set | Modified |
| `scripts/backfill-powerhub-crosslinks.ts` | One-time backfill of all linked sites | New |

## Data Model Changes

### `PowerhubSite` additions

```prisma
model PowerhubSite {
  // ... existing fields from 2026-05-06 spec ...

  portalUrl          String?  // Computed: template.replace("{siteId}", siteId). Persisted so we don't recompute on every read and so it survives template changes for historical records (intentional snapshot — see "URL template versioning" below).
  primaryForProperty Boolean  @default(false)  // True if this is the chosen primary site for its propertyId. Maintained by resolvePrimarySite() on every upsert. At most one true per propertyId (enforced by partial unique index).

  // Partial unique index ensures at most one primary per property:
  // @@index([propertyId]) (existing)
  // CREATE UNIQUE INDEX powerhub_site_primary_per_property
  //   ON "PowerhubSite" ("propertyId")
  //   WHERE "primaryForProperty" = true;
}
```

The partial unique index is created via raw SQL in the migration (Prisma's `@@unique` doesn't support `WHERE` clauses).

### `HubSpotPropertyCache` additions

```prisma
model HubSpotPropertyCache {
  // ... existing fields ...

  teslaPortalUrl  String?  // Denormalized from primary PowerhubSite.portalUrl. Powers Property Drawer header without joining.
  teslaSiteId     String?  // Denormalized from primary PowerhubSite.siteId. Used for searchability + Zuper field.
}
```

Both nullable. Both populated by `pushToHubSpotForProperty` after resolving the primary site. Cleared (set to null) if no Tesla site is linked to the property anymore.

### `PowerhubCrosslinkBackfillRun` (new model)

Mirror of the existing `PropertyBackfillRun` lock pattern for the one-time backfill script. Tracks progress across `propertyId` cursor so the script is resumable.

```prisma
model PowerhubCrosslinkBackfillRun {
  id            String    @id @default(cuid())
  status        String    // "running" | "completed" | "failed" | "paused"
  cursor        String?   // Last processed propertyId (Prisma cuid)
  totalCount    Int?      // Total properties to process (set at start)
  processedCount Int      @default(0)
  failedCount   Int       @default(0)
  startedAt     DateTime  @default(now())
  heartbeatAt   DateTime  @default(now())
  completedAt   DateTime?
  errorMessage  String?
}

// Partial unique index for singleton lock:
// CREATE UNIQUE INDEX powerhub_crosslink_backfill_singleton
//   ON "PowerhubCrosslinkBackfillRun" ((1))
//   WHERE "status" = 'running';
```

Heartbeat-based stale detection (5 min) identical to `PropertyBackfillRun` — see `src/lib/property-backfill-lock.ts` for the reference implementation to clone.

### HubSpot custom property creation (manual admin step before deploy)

Two new properties on three object types. **Created via HubSpot admin UI**, not API — these are schema-level definitions that exist once per portal:

| Object | Property name | Type | Group |
|--------|--------------|------|-------|
| Property (custom object) | `tesla_portal_url` | URL | Tesla PowerHub |
| Property (custom object) | `tesla_site_id` | Single-line text | Tesla PowerHub |
| Deal | `tesla_portal_url` | URL | Tesla PowerHub |
| Deal | `tesla_site_id` | Single-line text | Tesla PowerHub |
| Ticket | `tesla_portal_url` | URL | Tesla PowerHub |
| Ticket | `tesla_site_id` | Single-line text | Tesla PowerHub |

Documented in the pre-launch checklist. The cross-link sync no-ops with a warning log if the property doesn't exist (HubSpot returns 400 — we catch, log, and continue rather than fail the whole batch).

### Zuper custom field creation (manual admin step before deploy)

| Module | Field label | Field type |
|--------|------------|-----------|
| Property | Tesla PowerHub | URL / Link |
| Property | Tesla Site ID | Single-line text |
| Job | Tesla PowerHub | URL / Link |
| Job | Tesla Site ID | Single-line text |

Field labels must match exactly (the merge logic keys by label). Verified during the API spike for the existing Zuper property sync.

## Key Design Decisions

### URL template versioning

`TESLA_POWERHUB_PORTAL_URL_TEMPLATE` env var (default: `https://gridlogic.tesla.com/sites/{siteId}`). The template is evaluated at the moment `PowerhubSite` is upserted, and the resulting URL is **persisted on the row**. If Tesla changes the URL structure, we change the env var and a one-time recompute script re-writes `portalUrl` on all rows + triggers a cross-link push. This is preferable to computing on every read because (a) reads are far more frequent than writes, and (b) the persisted value is what's pushed to external systems — they need to match.

### Primary site selection

A property can have multiple Tesla sites (e.g., a homeowner who added a second Powerwall years later registered as a new site). The HubSpot Property object and Zuper Property module are single-valued for this field, so we pick a "primary":

**Selection rule:** Newest STE date in `siteName`. Tesla site names follow the pattern `STE<YYYYMMDD>-<NNNNN>` (verified in existing Phase 1 spec). Parse the date segment; pick the largest. Tie-break: lexicographic on full `siteName` (deterministic).

**Edge cases:**
- `siteName` doesn't match the STE pattern → fall back to `PowerhubSite.createdAt` (most recently added to our cache).
- No sites linked → clear `HubSpotPropertyCache.teslaPortalUrl` / `teslaSiteId` and push nulls to HubSpot + Zuper.
- Tie at every level → lexicographic on `PowerhubSite.id` (cuid). Always deterministic.

**Re-evaluation triggers:** `resolvePrimarySite(propertyId)` runs after every `PowerhubSite` upsert that touches a site with that `propertyId`, AND after manual linkage changes via the existing PowerHub admin UI. The function:
1. Loads all `PowerhubSite` rows where `propertyId = X`.
2. Picks the primary by the rule above.
3. Sets `primaryForProperty = true` on the winner; `false` on losers.
4. Writes `teslaPortalUrl` / `teslaSiteId` onto `HubSpotPropertyCache`.
5. Enqueues HubSpot + Zuper push.

The partial unique index in DB guarantees we never have two primaries for the same property; if `resolvePrimarySite` is racing with another instance, the second write hits the unique constraint and retries (same pattern as `PropertyBackfillRun` lock from existing specs).

### Cascade timing & idempotency

**HubSpot push** runs synchronously in the same transaction as the `PowerhubSite` upsert (small payload — three PATCH calls max for property + deal + ticket per linked record). Failures are logged but don't block the upsert. The next asset-sync cron cycle (6h) retries naturally because we re-resolve primary on every upsert.

**Zuper push** is asynchronous via existing dirty detection: `pushToHubSpotForProperty` calls `markPropertyDirty(propertyId)` which bumps `HubSpotPropertyCache.updatedAt`. The next `zuper-property-sync` cron cycle (15 min) picks it up. No new cron job.

**Zuper job cascade** is new logic: after `zuper-property-sync` updates a property's custom fields, it loads `ZuperJobCache` rows linked to that property (via `PropertyDealLink` → `dealId` → `ZuperJobCache.hubspotDealId`) and updates each job's "Tesla PowerHub" + "Tesla Site ID" custom fields using the same `mergeZuperMetaData` pattern. This happens inline with the property sync (small fan-out — typically 1-3 jobs per property), wrapped in `Promise.allSettled` so one job failure doesn't block the others.

**Job cascade scope:** all jobs linked to the property regardless of `jobStatus` (active, completed, cancelled). Cost is negligible (small fan-out + idempotent merge), and historical completed jobs benefit from the URL when a tech later references them. Cancelled jobs are also touched — harmless and keeps the logic simple (no status-based filtering branch).

**Idempotency:** Every push reads the current external value before writing. If `tesla_portal_url` already equals the new value, skip the PATCH. Saves API quota and avoids unnecessary HubSpot audit log noise. The Zuper merge pattern naturally does this — `mergeZuperMetaData` is a no-op when nothing changed (after merge, compare arrays; if equal, skip PUT).

### Service tickets in the cascade

Tickets are first-class in the cascade because Service techs work from tickets, not deals. `PropertyTicketLink` is the join. When a ticket is opened against a property that has a primary Tesla site, the URL is pushed onto the ticket. When a ticket is *closed*, we don't unset the URL — historical tickets keep the link for reference.

When a property gains a primary site for the first time (e.g., Tesla install completed, asset-sync discovers it, links it), we push retroactively to **all open tickets** for that property. Closed tickets are left alone (closed > 30 days ago, per the existing ticket cache retention policy — anything older gets the URL only if it's still in the cache).

## API Routes

| Route | Method | Description | Auth |
|-------|--------|-------------|------|
| `/api/powerhub/properties/[propertyId]/sites` | GET | List all Tesla sites linked to a property (for Monitoring tab) | Session (anyone with property drawer access) |
| `/api/powerhub/properties/[propertyId]/resync` | POST | Force `resolvePrimarySite` + push | Session (Admin) |

Both routes added to the existing `/api/powerhub` route group, so role allowlist additions from the PowerHub Phase 1 spec already cover them. No new role grants needed.

## UI Surfaces

### Shared component: `<PowerhubLink>`

```tsx
<PowerhubLink
  url={teslaPortalUrl}
  siteName={siteName}      // optional, for tooltip
  variant="button" | "inline" | "icon"
/>
```

- `button` variant: full-width button styled with Tesla red accent, "Open in Tesla PowerHub ↗" label. Used in Customer 360 header, Monitoring tab, Project detail.
- `inline` variant: text link with external-link icon. Used in deal detail, ticket detail rows.
- `icon` variant: just the external-link icon. Used in table rows (priority queue, fleet dashboard).

Returns null if `url` is null/empty — no broken states.

### Monitoring tab (Property Hub)

New tab in `src/lib/property-hub.ts` `HubTab` union. Lazy-loaded like every other tab. Header shows count badge of active alerts across all linked sites.

Content:
- **Per-site card** (one card per linked `PowerhubSite`):
  - Site name + STE ID
  - `<PowerhubLink variant="button">` prominent at top right
  - Current telemetry snapshot (solar W, battery SoC %, grid status) from `PowerhubTelemetrySnapshot`
  - Active alert list with severity badges from `PowerhubAlert`
  - "Primary" badge on the chosen primary site
  - "Last synced X minutes ago" stamp
- **No sites linked** state: Empty illustration + "This property has no Tesla PowerHub sites linked. [Open Admin Linkage ↗]" (admin-only link visible to non-admins as informational text only).

Fetch function `fetchMonitoring(propertyId)`:
1. Load `PowerhubSite` rows where `propertyId = X`.
2. For each, load latest `PowerhubTelemetrySnapshot` (single row) and active `PowerhubAlert` rows.
3. Return shaped payload `{ sites: SitePayload[], primarySiteId, totalActiveAlerts }`.

Cached for 60 seconds (telemetry updates every 15 min upstream — 60s freshness is plenty).

### Service Suite

- **Customer 360** (`/dashboards/service-customers`): existing System Health panel gets the prominent `<PowerhubLink variant="button">` at top. Today the panel embeds inline status but no jump-out link.
- **Service Tickets detail**: new row in the context section: "Tesla PowerHub" with `<PowerhubLink variant="inline">`. Shown only if the ticket's linked deal's linked property has a `teslaPortalUrl`.
- **Priority Queue**: new column "System" with `<SystemHealthBadge>` — shows alert severity dot + clickable icon link. Only renders for rows where the deal's property has a primary site.

### Design & Engineering Suite

- **Fleet dashboard** (existing PowerHub Phase 1): no change needed — already shows sites.
- **Project Detail panel**: new "Tesla PowerHub" row in the equipment section with `<PowerhubLink variant="inline">`. Conditioned on the deal having `tesla_portal_url` (via HubSpot deal property fetch).

### Deal Detail

In whatever component renders deal detail (Deals Suite, Project detail), add a row in the property/address section: "Tesla PowerHub: STE20240105-008 ↗" — `<PowerhubLink variant="inline">` with `siteName` as label fallback.

## Backfill

`scripts/backfill-powerhub-crosslinks.ts`:

1. Load every `PowerhubSite` with `propertyId IS NOT NULL`.
2. Group by `propertyId`.
3. For each property: run `resolvePrimarySite`, then `pushToHubSpotForProperty` (Property + Deal + Ticket), then mark cache dirty.
4. Zuper push happens naturally via the next `zuper-property-sync` cron cycle.
5. Resumable — tracks progress in a new `PowerhubCrosslinkBackfillRun` row (same lock pattern as `PropertyBackfillRun`).
6. Rate-limited: max 5 properties/sec to stay within HubSpot's 100 req/sec floor (each property = 3 PATCHes max).

Expected runtime: ~1,200 currently linked Tesla sites / 5 per second = ~4 minutes for HubSpot push. Zuper cascade then takes one cron cycle (15 min) to fully propagate.

**Execution gate:** Backfill script is invoked by the orchestrator with explicit user approval — not safe for subagent execution (it triggers fleet-scale external API writes to HubSpot, and the existing PB convention is that subagents never run migrations or destructive batch operations).

## Error Handling

| Failure mode | Handling |
|--------------|----------|
| HubSpot property doesn't exist (custom property not created) | Log warning with property name, continue. Pre-launch checklist catches this. |
| HubSpot 429 rate limit | Existing `searchWithRetry` exponential backoff applies. |
| HubSpot Deal/Ticket no longer exists (deleted in HubSpot) | Catch 404, mark `PropertyDealLink` / `PropertyTicketLink` for reconciliation, continue. |
| Zuper custom field label not configured | `mergeZuperMetaData` appends as new entry; field shows up in Zuper as the user-facing label. Pre-launch checklist requires admin to create labels first so they're typed (URL vs text). |
| Zuper Property UID null (sync hasn't created Zuper property yet) | Skip Zuper push for this cycle; next cycle will retry once `zuperPropertyUid` is populated. |
| Tesla `siteName` doesn't match STE pattern | Log info, fall back to `createdAt` for primary selection. |
| `resolvePrimarySite` race | Partial unique index forces serialization; loser retries (max 3 attempts, then logs warning and skips — extremely rare in practice). |
| URL template change | Recompute script updates all `PowerhubSite.portalUrl` then enqueues batch push. Documented runbook. |

## Testing Strategy

- **Unit tests** (`__tests__/powerhub-crosslink.test.ts`):
  - `computePortalUrl` with various templates
  - `resolvePrimarySite` with 0, 1, multiple sites; with and without STE-pattern names; tie-break determinism
  - `pushToHubSpotForProperty` with mocked HubSpot client (verify PATCH payloads + skip when unchanged)
  - Cascade idempotency (run push twice, assert second is no-op)
- **Integration tests** (`__tests__/powerhub-crosslink.integration.test.ts`):
  - End-to-end against test HubSpot portal + a sandbox `HubSpotPropertyCache` row
  - Multi-site primary selection with real DB
- **Manual QA checklist** (in spec PR description):
  - Create a test PowerhubSite linked to a known property, verify URL appears in HubSpot UI within seconds
  - Verify URL appears in Zuper Property + linked Job within 15 min
  - Verify Monitoring tab renders with sites, telemetry, alerts
  - Verify all five suite surfaces show the link
  - Toggle `POWERHUB_CROSSLINK_ENABLED=false` and verify everything no-ops gracefully

## Rollout

Phase order, gated by `POWERHUB_CROSSLINK_ENABLED`:

1. **Schema migration** (additive: `PowerhubSite.portalUrl`, `primaryForProperty`; `HubSpotPropertyCache.teslaPortalUrl`, `teslaSiteId`; partial unique index).
2. **HubSpot admin step** — create 6 custom properties (3 objects × 2 fields).
3. **Zuper admin step** — create 4 custom fields (2 modules × 2 fields).
4. **Deploy code with flag OFF** — new modules ship dormant. Existing flows untouched.
5. **Enable flag in dev/preview** — manual QA via test linkage.
6. **Run backfill script** in production with flag on but Zuper cascade gated by a second flag (`POWERHUB_ZUPER_CASCADE_ENABLED`) — verify HubSpot push works at fleet scale before triggering Zuper writes.
7. **Enable Zuper cascade flag** — let one cron cycle run, audit results.
8. **Announce** to Service + D&E + field tech leads.

Rollback: flip `POWERHUB_CROSSLINK_ENABLED=false`. All push logic short-circuits. UI components return null. No data corruption — the URL fields on HubSpot/Zuper just go stale until re-enabled.

## Open Questions

None blocking. Two to confirm during implementation:

1. **Exact Tesla GridLogic portal URL pattern** — `https://gridlogic.tesla.com/sites/{siteId}` is the assumed template. Confirm with the Tesla GridLogic account manager OR by logging in and inspecting a real site URL. If pattern differs, just update the env var default. No code changes.
2. **HubSpot ticket retention** — verify our ticket cache retention policy (referenced as "30 days" above based on memory; need to confirm against `HubSpotTicketCache` or equivalent). If retention is longer, backfill cascade reaches more historical tickets. Not blocking.

## References

- `2026-05-06-powerhub-integration-design.md` — PowerHub Phase 1
- `2026-05-16-zuper-property-sync-design.md` — Zuper Property sync + `mergeZuperMetaData` pattern
- `2026-05-17-property-hub-enhancements-design.md` — Property Hub tab architecture
- `src/lib/zuper-catalog.ts:347-376` — `mergeZuperMetaData` reference implementation
- `src/lib/property-sync.ts` — `markPropertyDirty` reference
- CLAUDE.md → "Property Object" system documentation
