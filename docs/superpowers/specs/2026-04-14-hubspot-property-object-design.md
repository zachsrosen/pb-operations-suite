# HubSpot Property Custom Object

**Date:** 2026-04-14
**Scope:** Introduce a new HubSpot custom object `Property` as the durable anchor for install + service history at a physical address. Associate Property with Contacts, Deals, Tickets, Companies, AHJ, Utility, and Location. Cache in Neon, keep in sync via HubSpot webhooks, surface in the Service Suite and via a reusable Property drawer.

## Background & Motivation

Today, install + service history lives on Contact and Deal records. This creates two problems:

1. **Ownership changes break history.** When a homeowner sells a solar-equipped home, the new owner becomes a new Contact. Future service calls on that address lose the link to the original install. The equipment history effectively restarts.
2. **Multi-property customers are ambiguous.** A Contact who owns rentals, a vacation home, or a commercial portfolio has multiple installs. There's no clean way to answer "what's installed at THIS specific address" — the data is spread across deals with inconsistent address spellings.

A `Property` custom object — keyed on the physical location (not the owner) — solves both. Each Property aggregates every deal, ticket, and owner ever associated with that address. Ownership history is preserved via association labels (Current Owner, Previous Owner, etc.) rather than mutation.

**This spec covers v1: creating the object, sync infrastructure, and a minimal UI surface.** ATTOM property-data enrichment is scoped out and will follow as a separate spec — the schema includes ATTOM-sourced fields so no migration is needed when enrichment is wired up.

## Goals

- Create `Property` custom object in HubSpot with identity, rollup, geographic, and (empty-for-now) property-attribute fields.
- Associate Property with 7 objects: Contact, Deal, Ticket, Company, AHJ, Utility, Location.
- Use association labels on Contact/Company to represent ownership history without losing records.
- Automatically create + associate Property records on Contact address change, Deal creation, and Ticket creation.
- Backfill Property records for all Contacts who have been on a Deal.
- Cache in Neon (`HubSpotPropertyCache` + link tables) for fast aggregated reads.
- Surface Property data in Service Suite customer-360 and via a reusable `PropertyDrawer` reachable from any address-click in the app.

## Non-Goals

- ATTOM API integration or population of structural/roof/parcel fields (future spec).
- Dedicated Properties dashboard (`/dashboards/properties`). Deferred.
- In-app editing of Property fields (edits happen in HubSpot UI for v1).
- Map / geographic visualization.
- Manual association-label editing in our app.
- Historical ownership timeline inference from deal property changes.

## Design Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | **Keep all Contact ↔ Property associations forever, use labels to mark ownership state** | Answers "who owned this when we installed" without losing records. HubSpot association labels are built for this. |
| 2 | **Canonical identity = Google `place_id` + an `addressHash` unique constraint as fallback** | `place_id` is stable across re-geocodes and handles unit-level granularity. For rural addresses where Google returns no `place_id`, a SHA-256 `addressHash` over normalized(street+unit+city+state+zip) is the DB-enforced unique key. Both columns are `@unique` in Prisma so the one-property-per-address invariant holds under retries and concurrent inserts. |
| 3 | **Associate with all 7 objects: Contact, Deal, Ticket, Company, AHJ, Utility, Location** | AHJ/Utility/Location at the Property level means any future deal/ticket auto-inherits jurisdiction + utility without per-deal re-derivation. |
| 4 | **Primary creation trigger: Contact address change** | Gives Property coverage for prospects pre-deal. Dedup by `place_id` prevents explosion from tire-kickers. |
| 5 | **Backfill scope: Contacts that have been on a Deal** | Meaningful coverage (customers + serious prospects), skips dead leads. If a dead lead becomes live later, normal sync flow catches them. |
| 6 | **Cache in Neon + nightly reconciliation (Approach 2)** | Line-item rollups ("everything installed here") join deals→line items→products, fast in Postgres but slow via HubSpot batch reads. Matches existing `HubSpotProjectCache` / `ZuperJobCache` pattern. |
| 7 | **ATTOM fields live in the schema now, populated later** | Avoids a future migration. Sync code leaves them `null` until ATTOM integration ships. |
| 8 | **Line items are NOT cached locally** | They stay in HubSpot; fetched for Property detail views via existing helpers with React Query caching. Avoids duplicating a table we don't own. |

## Architecture

```
┌──────────────────┐    webhooks     ┌──────────────────────────┐
│    HubSpot       │ ──────────────▶ │  /api/webhooks/property  │
│                  │                  │  (sync handler)          │
│  Contact addr    │                  └────────────┬─────────────┘
│  Deal created    │                               │
│  Ticket created  │                               ▼
└──────────────────┘                  ┌──────────────────────────┐
       ▲                               │   lib/property-sync.ts   │
       │ associations                  │   - geocode              │
       │                               │   - find-or-create       │
       └───────────────────────────────│   - resolve AHJ/Util/Loc │
                                       │   - upsert cache         │
                                       └────────────┬─────────────┘
                                                    │
                                                    ▼
                                       ┌──────────────────────────┐
                                       │   Neon Postgres          │
                                       │   HubSpotPropertyCache   │
                                       │   + link tables          │
                                       └────────────┬─────────────┘
                                                    │
                       ┌────────────────────────────┼──────────────────────────┐
                       ▼                            ▼                          ▼
              ┌──────────────────┐        ┌──────────────────┐        ┌──────────────────┐
              │ Customer Resolver│        │ Property Drawer  │        │  Future: property│
              │ (Service Suite   │        │ (any address     │        │  dashboards,     │
              │  customer detail)│        │  click in app)   │        │  ATTOM, maps     │
              └──────────────────┘        └──────────────────┘        └──────────────────┘
```

**Write path**: HubSpot change → webhook → `property-sync.ts` → Neon cache + HubSpot associations
**Read path**: UI → Neon cache (fast) → hydrates with live HubSpot fetches only when needed
**Reconciliation**: nightly cron scans HubSpot Properties against cache, repairs drift

## New Code Surface

- `src/lib/hubspot-property.ts` — data-layer helpers (matches `hubspot-custom-objects.ts` pattern: `fetchAllProperties`, `fetchPropertyById`, `fetchPropertiesForContact`, etc.)
- `src/lib/property-sync.ts` — sync orchestration: `onContactAddressChange`, `onDealOrTicketCreated`, `upsertPropertyFromGeocode`, `computeRollups`, AHJ/Utility/Location resolvers
- `src/app/api/webhooks/hubspot/property/route.ts` — webhook receiver (HubSpot v3 signature validated via `lib/hubspot-webhook-auth.ts`, matches deal-sync pattern)
- `src/app/api/properties/[id]/route.ts` — detail endpoint (for drawer)
- `src/app/api/properties/resolve/route.ts` — address → Property ID (for legacy records)
- `src/app/api/properties/manual-create/route.ts` — admin-only manual creation
- `src/app/api/properties/by-contact/[contactId]/route.ts` — used by customer-resolver
- `src/app/api/cron/property-reconcile/route.ts` — nightly drift repair (CRON_SECRET bearer-token validated in route)
- `src/components/PropertyDrawer.tsx` — reusable drawer component
- `src/components/PropertyLink.tsx` — wrapper that makes an address clickable → opens drawer
- Prisma: `HubSpotPropertyCache` + `PropertyContactLink`, `PropertyDealLink`, `PropertyTicketLink`, `PropertyCompanyLink`
- `scripts/backfill-properties.ts` — one-time backfill
- `src/lib/customer-resolver.ts` — extended to return `properties: PropertyDetail[]`

## HubSpot Object Schema

**Object name**: `Property`.

**Object type ID is env-driven**, not hardcoded. Add `HUBSPOT_PROPERTY_OBJECT_TYPE` env var (e.g., `2-XXXXXXX`) so sandbox and prod portals can point to different internal IDs — the existing `hubspot-custom-objects.ts` hardcodes portal-specific IDs (`2-7957390` for AHJ, etc.), which is a known limitation we're not propagating here. All new data-layer helpers read the ID from env.

### Fields

| Group | Field | Type | Source |
|---|---|---|---|
| **Identity** | `record_name` | string | computed ("1234 Main St, Boulder CO 80301") |
| | `google_place_id` | string | Google Geocoding |
| | `normalized_address` | string | computed |
| | `full_address` | string | Google Geocoding |
| | `street_address`, `unit_number`, `city`, `state`, `zip`, `county` | string | Google Geocoding |
| | `latitude`, `longitude` | number | Google Geocoding |
| | `attom_id` | string | ATTOM (future) |
| **Parcel / ownership** | `parcel_apn` | string | ATTOM (future) |
| | `zoning` | string | ATTOM (future) |
| | `assessed_value` | number | ATTOM (future) |
| | `last_sale_date` | date | ATTOM (future) |
| | `last_sale_price` | number | ATTOM (future) |
| | `public_record_owner_name` | string | ATTOM (future) |
| **Structure** | `property_type` | enum | ATTOM / manual (Residential / Multi-Family / Commercial / Land) |
| | `year_built` | number | ATTOM (future) |
| | `square_footage` | number | ATTOM (future) |
| | `lot_size_sqft` | number | ATTOM (future) |
| | `stories` | number | ATTOM (future) |
| | `bedrooms`, `bathrooms` | number | ATTOM (future) |
| | `foundation_type` | string | ATTOM (future) |
| | `construction_type` | string | ATTOM (future) |
| **Roof** | `roof_material` | string | ATTOM (future) |
| | `roof_age_years` | number | ATTOM (future; derived) |
| | `roof_last_replaced_year` | number | ATTOM (future) |
| | `roof_condition_notes` | string | Manual |
| **Risk / permitting** | `flood_zone` | string | ATTOM (future) |
| | `wildfire_risk_zone` | string | ATTOM (future) |
| | `hoa_name` | string | ATTOM (future) / Manual |
| **Electrical** | `main_panel_amperage` | number | Manual / install-captured |
| | `main_panel_manufacturer` | string | Manual / install-captured |
| | `service_entrance_type` | string | Manual / install-captured |
| **Rollups** (sync-maintained, read-only in HubSpot UI) | `first_install_date` | date | computed from deals |
| | `most_recent_install_date` | date | computed |
| | `associated_deals_count` | number | computed |
| | `associated_tickets_count` | number | computed |
| | `open_tickets_count` | number | computed |
| | `system_size_kw_dc` | number | computed from line items |
| | `has_battery`, `has_ev_charger` | bool | computed |
| | `last_service_date` | date | computed from tickets |
| | `earliest_warranty_expiry` | date | computed from deals |
| **Geographic links** (denormalized for HubSpot-side filtering) | `ahj_name`, `utility_name`, `pb_location` | string | computed |
| **Sync metadata** | `attom_last_synced_at` | date | sync (future) |
| | `attom_match_confidence` | string | sync (future) |
| **Notes** | `general_notes` | rich text | Manual |

### Associations

| Associated object | Cardinality | Labels |
|---|---|---|
| Contact | many-to-many | `Current Owner`, `Previous Owner`, `Tenant`, `Property Manager`, `Authorized Contact` |
| Deal | one-to-many | (no labels) |
| Ticket | one-to-many | (no labels) |
| Company | many-to-many | `Owner`, `Manager` |
| AHJ (custom) | many-to-one | |
| Utility (custom) | many-to-one | |
| Location (custom) | many-to-one | |

**Uniqueness**: HubSpot custom-object properties don't support hard uniqueness constraints. Dedup enforcement lives in `property-sync.ts` (search-by-`place_id` before create). The cache table has the real unique index.

## Neon Cache Schema

```prisma
model HubSpotPropertyCache {
  id                 String   @id @default(cuid())

  // HubSpot identity
  hubspotObjectId    String   @unique

  // Dedup keys — BOTH are unique to enforce one-property-per-address invariant
  googlePlaceId      String?  @unique           // canonical key when Google returns a place_id
  addressHash        String   @unique           // SHA-256 of normalized(street+unit+city+state+zip); enforces dedup when googlePlaceId is null (rural, PO Box, new construction)
  normalizedAddress  String                     // human-readable search index, NOT authoritative
  attomId            String?  @unique

  // Address
  fullAddress        String
  streetAddress      String
  unitNumber         String?
  city               String
  state              String
  zip                String
  county             String?
  latitude           Float
  longitude          Float

  // Denormalized attrs — FULL MIRROR of HubSpot (ATTOM-sourced fields empty until integration ships)
  propertyType              String?
  yearBuilt                 Int?
  squareFootage             Int?
  lotSizeSqft               Int?
  stories                   Int?
  bedrooms                  Int?
  bathrooms                 Float?
  foundationType            String?
  constructionType          String?
  roofMaterial              String?
  roofAgeYears              Int?
  roofLastReplacedYear      Int?
  roofConditionNotes        String?
  parcelApn                 String?
  zoning                    String?
  assessedValue             Int?
  lastSaleDate              DateTime?
  lastSalePrice             Int?
  publicRecordOwnerName     String?
  floodZone                 String?
  wildfireRiskZone          String?
  hoaName                   String?
  generalNotes              String?   @db.Text

  // Electrical (manual)
  mainPanelAmperage      Int?
  mainPanelManufacturer  String?
  serviceEntranceType    String?

  // Rollups (sync-maintained)
  firstInstallDate        DateTime?
  mostRecentInstallDate   DateTime?
  associatedDealsCount    Int      @default(0)
  associatedTicketsCount  Int      @default(0)
  openTicketsCount        Int      @default(0)
  systemSizeKwDc          Float?
  hasBattery              Boolean  @default(false)
  hasEvCharger            Boolean  @default(false)
  lastServiceDate         DateTime?
  earliestWarrantyExpiry  DateTime?

  // Geographic links
  ahjObjectId        String?
  ahjName            String?
  utilityObjectId    String?
  utilityName        String?
  locationObjectId   String?
  pbLocation         String?

  // Sync metadata
  geocodedAt           DateTime
  attomLastSyncedAt    DateTime?
  attomSyncStatus      String?           // OK | FAILED | PENDING | NO_MATCH
  attomMatchConfidence String?           // HIGH | MEDIUM | LOW
  lastReconciledAt     DateTime
  updatedAt            DateTime @updatedAt
  createdAt            DateTime @default(now())

  // Relations
  contactLinks         PropertyContactLink[]
  dealLinks            PropertyDealLink[]
  ticketLinks          PropertyTicketLink[]
  companyLinks         PropertyCompanyLink[]

  @@index([normalizedAddress])
  @@index([city, state])
  @@index([latitude, longitude])
  @@index([attomSyncStatus])
  @@index([pbLocation])
}

model PropertyContactLink {
  id           String   @id @default(cuid())
  propertyId   String
  property     HubSpotPropertyCache @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  contactId    String
  label        String                    // Current Owner | Previous Owner | Tenant | Property Manager | Authorized Contact
  associatedAt DateTime @default(now())

  @@unique([propertyId, contactId, label])
  @@index([contactId])
}

model PropertyDealLink {
  id           String   @id @default(cuid())
  propertyId   String
  property     HubSpotPropertyCache @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  dealId       String
  associatedAt DateTime @default(now())

  @@unique([propertyId, dealId])
  @@index([dealId])
}

model PropertyTicketLink {
  id           String   @id @default(cuid())
  propertyId   String
  property     HubSpotPropertyCache @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  ticketId     String
  associatedAt DateTime @default(now())

  @@unique([propertyId, ticketId])
  @@index([ticketId])
}

model PropertyCompanyLink {
  id           String   @id @default(cuid())
  propertyId   String
  property     HubSpotPropertyCache @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  companyId    String
  label        String                    // Owner | Manager
  associatedAt DateTime @default(now())

  @@unique([propertyId, companyId, label])
  @@index([companyId])
}

model PropertySyncWatermark {
  contactId   String   @id            // HubSpot contact ID
  lastSyncAt  DateTime

  @@index([lastSyncAt])                // cleanup cron drops rows > 7 days old
}

model PropertyBackfillRun {
  id              String    @id @default(cuid())
  startedAt       DateTime  @default(now())
  completedAt     DateTime?
  status          String                             // "running" | "completed" | "failed" | "paused"
  phase           String                             // "contacts" | "deals" | "tickets" | "reconcile"
  cursor          String?                            // HubSpot paging cursor for the current phase
  totalProcessed  Int       @default(0)
  totalCreated    Int       @default(0)
  totalAssociated Int       @default(0)
  totalFailed     Int       @default(0)
  lastError       String?

  @@index([status])
}
```

`PropertyBackfillRun` is a new model specific to this backfill. It is intentionally separate from the generic `HubSpotSyncRun` model to keep phase/cursor semantics clear, and because the backfill's 4-phase flow (contacts → deals → tickets → reconcile) doesn't map onto any existing run model. Only one row is `status=running` at a time; the script reads the latest row on startup and resumes from `phase` + `cursor` if it was interrupted.

**Notes:**
- Separate link tables (not JSON arrays) for indexed reverse lookup.
- `associatedAt` on every link = lightweight history audit trail.
- `attomSyncStatus` / `attomLastSyncedAt` fields exist now for future use; sync code leaves them null.
- `lastReconciledAt` enables webhook-failure alerting (> 48h means something's wrong).
- AHJ/Utility/Location denormalized as both IDs and names (joins + rendering).

## Sync Flows

### Contact address change (primary creation trigger)

**Webhook subscription**: Configure HubSpot `contact.propertyChange` subscriptions for the following properties:
`address`, `address2`, `city`, `state`, `zip`, `country`.

**Idempotency & coalescing (DB-backed, matches deal-sync pattern)**:

1. **Per-event idempotency** via the existing `IdempotencyKey` model. Each HubSpot webhook event has an `eventId`; we write `{ key: eventId, scope: "property-sync:hubspot-webhook" }` and skip processing if it already exists. This mirrors `src/app/api/webhooks/hubspot/deal-sync/route.ts`.
2. **Per-contact coalescing via `PropertySyncWatermark`**. A single form edit that touches street+city+zip fires 3 webhook events for the same contact in ~100ms. After each event's idempotency check passes, the handler reads `PropertySyncWatermark.lastSyncAt` for that `contactId` — if it's within the last 2 seconds, skip the geocode+upsert (the first event in the burst already captured the final state; HubSpot propagates edits atomically so later events in the same burst don't carry different addresses). On every successful sync, upsert the watermark row with the current timestamp.
3. **Handler is idempotent regardless**. If coalescing is defeated (race, clock skew), running `onContactAddressChange` twice in a row is safe: the geocode is deterministic, the upsert is keyed by `googlePlaceId`/`addressHash`, and associations are idempotent. Worst case is a duplicate geocode call, not a data corruption.

The watermark lives on its own small table keyed by contactId (not on `HubSpotPropertyCache`, because a contact with no address yet has no Property row):

```prisma
model PropertySyncWatermark {
  contactId   String   @id     // HubSpot contact ID
  lastSyncAt  DateTime
  @@index([lastSyncAt])        // for cleanup cron
}
```

Old watermark rows (>7 days) are dropped by the nightly reconciliation.

```
HubSpot webhook: contact.propertyChange (address|address2|city|state|zip|country)
      │
      ▼
/api/webhooks/hubspot/property (signature verification)
      │
      ▼  (per-event IdempotencyKey check; return early if seen)
      │
      ▼  (per-contact watermark check; skip if synced < 2s ago)
property-sync.ts::onContactAddressChange(contactId)
      │
      ├─ Read contact address fields from HubSpot
      ├─ Skip if address incomplete (missing street+city+state)
      │
      ├─ Geocode via Google Maps
      │   └─ If fails: log + queue retry
      │
      ├─ Look up existing Property in cache by googlePlaceId
      │
      ├─ If found:
      │   ├─ Upsert PropertyContactLink with "Current Owner" label (idempotent)
      │   └─ Create HubSpot association with label
      │
      └─ If not found (new Property):
          ├─ Resolve AHJ from lat/lng against AHJ records
          ├─ Resolve Utility from lat/lng against Utility records
          ├─ Resolve PB Location from zip/state mapping
          ├─ Create HubSpot Property (identity + geographic fields)
          ├─ Create HubSpot associations: Contact, AHJ, Utility, Location
          ├─ Upsert HubSpotPropertyCache row
          └─ Emit activity log: PROPERTY_CREATED
```

### Deal / Ticket creation → associate

```
HubSpot webhook: deal.creation | ticket.creation
      │
      ▼
property-sync.ts::onDealOrTicketCreated(kind, id)
      │
      ├─ Read primary Contact association
      ├─ Find Contact's Properties via PropertyContactLink
      │
      ├─ If exactly one → create association + link row + recompute rollups for that Property
      ├─ If multiple → disambiguate by deal/ticket address match (geocode + place_id lookup), then associate + recompute rollups
      └─ If none →
          ├─ If Contact has an address: run onContactAddressChange, then retry (once)
          └─ If Contact has no address: skip + log WARN; reconciliation cron will
             retry once the address is filled in. Do NOT block or endlessly retry.
```

**Race condition note**: Deal/Ticket creation webhooks often fire before the Contact address webhook for a brand-new customer. The single-retry path above handles the common case; the reconciliation cron is the safety net for the rest.

### Nightly reconciliation

```
Cron: /api/cron/property-reconcile (daily at 3am MT)
      │
      ├─ Page through all HubSpot Property records
      ├─ For each:
      │   ├─ Upsert cache row (catches webhook misses)
      │   ├─ Refresh associations from HubSpot (catches association drift)
      │   └─ Recompute rollups (install dates, counts, system size, warranty, service dates)
      │
      └─ Alert if any cache row has lastReconciledAt > 48h (webhook-failure indicator)
```

**Rollup computation strategy**:

Rollups are **near-real-time**, not nightly-only. Each path that can change associations — Deal creation/update webhook, Ticket creation/update webhook, manual association edit, reconciliation pass — calls `computePropertyRollups(propertyId)` at the end of its work. The nightly cron re-runs it for every Property as a safety net against drift.

This is required because the customer-360 view and PropertyDrawer render these fields directly (install dates, counts, system size, warranty, service dates). If a deal lands at 10am and rollups didn't refresh until 3am the next day, the user sees blank fields on a brand-new install.

`computePropertyRollups(propertyId)` reads from existing sources:
- Install dates, counts, system size, battery/EV flags → query associated Deals + HubSpot line items
- Warranty expiry → earliest across associated deals
- Ticket counts, service dates → query associated tickets

Single-Property rollup is ~1-3 HubSpot batch reads + a small DB write. Fast enough to be synchronous within the webhook handler.

**AHJ / Utility resolution** (v1): AHJ and Utility custom objects don't carry geo-polygons today — the `service_area` field is free text. Resolution lives in `property-sync.ts::resolveAhjForProperty(lat, lng, city, state)` and `resolveUtilityForProperty(...)` using this cascade:

1. **Zip/city/state string match against existing Deal → AHJ/Utility associations** — the most reliable signal today. If existing deals at this zip consistently attach to `AHJ:Boulder`, use it.
2. **Substring match on `service_area` text** (city/county name contained in the service-area description).
3. **Closest-match by zip within state** if the above fail.
4. **Fallback: leave null, flag for manual review**.

A future spec can replace this with proper geo-polygon resolution; the resolver helpers are the seam.

**PB Location resolution**: zip + state → PB shop mapping is **new code** in this spec. `src/lib/locations.ts` normalizes existing `pb_location` strings (e.g., "dtc" → "Centennial") but does not resolve a geographic coordinate to a shop. We add a new `resolvePbLocationFromAddress(zip, state)` helper that maps by zip-prefix + state to one of the 5 canonical shops (Westminster, Centennial, Colorado Springs, San Luis Obispo, Camarillo). The mapping is a small static table maintained by Ops, editable in config — future refinement can use lat/lng + shop service radii.

### Backfill

`scripts/backfill-properties.ts`:

```
1. Query HubSpot: all Contacts that have been on a Deal
   - Filters: associated deal count > 0, address fields non-empty
   - Paginate in batches of 100

2. For each Contact:
   - Run property-sync.ts::onContactAddressChange (same code path as webhook)
   - Throttle to HubSpot (100 req / 10s) + Google geocoding (40 req/s, below 50 limit)
   - Log progress to `PropertyBackfillRun` (phase="contacts", cursor=HubSpot paging token) for resumability

3. After Contacts done, sweep all Deals + Tickets:
   - Trigger onDealOrTicketCreated for each to backfill associations
   - Skip if already linked

4. Final pass: trigger one full reconciliation run to compute rollups for every
   Property. In normal operation rollups run near-real-time as associations
   change, but during backfill we create associations in large batches and
   skip the inline rollup (too slow). The single end-of-backfill reconciliation
   sweep catches everything up consistently.
```

Estimated volume: ~8-15k unique contacts. Google geocoding cost after free tier: under $50 one-time. No ATTOM cost (not wired up yet).

**Multi-session feasibility**: Backfill throttled at ~40 req/s geocoding + HubSpot's rate limits should complete ~8-15k contacts in 1-3 hours. Fits comfortably in a single run; the `PropertyBackfillRun` row keeps it resumable if anything interrupts.

### Failure handling

| Failure | Handling |
|---|---|
| Webhook delivery failure | HubSpot retries 10× over 3 hours; reconciliation cron catches remainder |
| Geocoding failure | Retry queue with exponential backoff, 3 attempts, then manual review |
| HubSpot rate limit | Existing `withRetry()` wrapper |
| Duplicate Properties from inconsistent geocoding | DB-enforced via `googlePlaceId` and `addressHash` unique constraints on `HubSpotPropertyCache`. A retry that geocodes to a different `place_id` for the same address is caught by the `addressHash` conflict; log + alert when the two keys disagree so we can merge. |

## UI Integration

### Service Suite customer-360 enhancement

`customer-resolver.ts` gains a `properties: PropertyDetail[]` field:

```ts
interface PropertyDetail {
  id: string;
  hubspotObjectId: string;
  fullAddress: string;
  lat: number;
  lng: number;
  pbLocation: string | null;
  ahjName: string | null;
  utilityName: string | null;

  firstInstallDate: Date | null;
  mostRecentInstallDate: Date | null;
  systemSizeKwDc: number | null;
  hasBattery: boolean;
  hasEvCharger: boolean;
  openTicketsCount: number;
  lastServiceDate: Date | null;
  earliestWarrantyExpiry: Date | null;

  ownershipLabel: "Current Owner" | "Previous Owner" | "Tenant" | "Property Manager" | "Authorized Contact";
  associatedAt: Date;

  dealIds: string[];
  ticketIds: string[];
  contactIds: string[];  // everyone ever associated

  equipmentSummary: {
    modules: { count: number; totalWattage: number };
    inverters: { count: number };
    batteries: { count: number; totalKwh: number };
    evChargers: { count: number };
  };
}
```

Customer detail page renders a new Properties section above Deals/Tickets/Jobs, one card per Property, with ownership label, install summary, warranty expiry, PB shop, and click-through to the drawer.

### PropertyDrawer (reusable)

New component: `src/components/PropertyDrawer.tsx`. Slides in from the right. Contents:

- Header: full address, PB shop, AHJ, Utility
- Map thumbnail (lat/lng; static image via Google Maps Static API)
- Equipment installed (line-item rollup across all associated deals)
- Owners (all-time; ordered by association date, labeled)
- Deals (with stage + amount + close date)
- Service tickets (open flagged)
- Property details placeholder (empty until ATTOM ships)

Trigger: `<PropertyLink address={addr} hubspotObjectId={id}>` wrapper renders the address as a button. Click opens the drawer.

**Initial trigger points (v1):**

| Page / component | Address element |
|---|---|
| Service Suite customer detail | Property card click |
| Service ticket detail | Ticket address line |
| Deals dashboard | Deal install address |
| Scheduler cards (construction, service) | Job address |

**Legacy-record fallback**: if an address is clicked on a record that predates Property creation, drawer shows "Resolving…", calls `/api/properties/resolve?address=…`, populates from the result. If still not found: "No property record yet" + admin-only "Create Property" button.

### New API endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/properties/:id` | Full detail for drawer |
| `GET /api/properties/resolve?address=…` | Address → Property ID for legacy records |
| `POST /api/properties/manual-create` | Admin-only manual creation |
| `GET /api/properties/by-contact/:contactId` | Used by customer-resolver |

## Deployment & Routing

The new webhook and cron endpoints are non-functional in production without explicit routing and auth wiring. Must-do list:

### Webhook: `/api/webhooks/hubspot/property`

1. **Middleware allowlist**: add the path to `PUBLIC_API_ROUTES` in `src/middleware.ts` (next to the existing `/api/webhooks/hubspot/deal-sync` entry). Without this, session-auth middleware blocks HubSpot's delivery.
2. **Signature validation in the route** using `validateHubSpotWebhook` from `lib/hubspot-webhook-auth.ts` — same pattern as `deal-sync/route.ts`. Bearer-token fallback (`PIPELINE_WEBHOOK_SECRET` / `API_SECRET_TOKEN`) also permitted for internal replays.
3. **`vercel.json` function override** if we need more than the default 60s `maxDuration` — initially not needed (handler returns 200 immediately and does work in `waitUntil`), but if the backfill ever routes through this endpoint we bump it to 300s to match `/api/webhooks/hubspot/deal-sync` envelope.

### Cron: `/api/cron/property-reconcile`

1. **Middleware allowlist**: add to `PUBLIC_API_ROUTES` (the existing crons — `audit-digest`, `audit-retention`, `pipeline-health`, etc. — are all in that list).
2. **Auth in the route**: validate `Authorization: Bearer $CRON_SECRET` at the top of the handler and return 401 if missing/mismatched. Matches existing cron pattern.
3. **`vercel.json` schedule entry**: add to the `crons` array:
   ```json
   { "path": "/api/cron/property-reconcile", "schedule": "0 9 * * *" }
   ```
   (3am Mountain Time = 9am UTC standard / 10am UTC daylight; cron runs in UTC. Pick one and document.)
4. **`vercel.json` function override**: 300s `maxDuration` since reconciliation pages through all Properties and recomputes rollups — same envelope as `zuper/sync-cache` (already set to 300s).

### Webhook subscription configuration (HubSpot side)

Create HubSpot webhook subscriptions pointing at `https://<env>/api/webhooks/hubspot/property` for these event types:
- `contact.propertyChange` on properties: `address`, `address2`, `city`, `state`, `zip`, `country`
- `deal.creation`
- `deal.propertyChange` on properties: `dealstage` (for rollup refresh on stage transitions), install/warranty-related properties to be listed once mapping is finalized
- `ticket.creation`
- `ticket.propertyChange` on: `hs_pipeline_stage`

The subscription configuration is managed in the HubSpot app settings; document the exact list in `docs/hubspot-integration-guide.docx` after rollout.

## Testing Strategy

| Layer | Tests |
|---|---|
| **Unit** (`src/__tests__/lib/property-sync.test.ts`) | `normalizeAddress()`, geocode-failure handling, dedupe logic, rollup computations (line-item aggregation, earliest-warranty calc), AHJ/Utility/Location resolution |
| **Integration** | `onContactAddressChange` end-to-end with mocked HubSpot + Google; `onDealOrTicketCreated` disambiguation; backfill script resumability |
| **Webhook** | Signature verification, malformed payload handling, idempotency (same webhook delivered twice → no duplicate Property) |
| **Reconciliation** | Cron detects + repairs deliberately corrupted cache row |

End-to-end tests against live HubSpot are skipped; manual smoke tests in the HubSpot sandbox cover that surface before rollout.

## Rollout Plan

### Phase 1 — Foundation (no user-visible changes)
1. Create HubSpot Property custom object + fields via HubSpot API (one-time script); set `HUBSPOT_PROPERTY_OBJECT_TYPE` env var per environment
2. Configure 7 association definitions with labels
3. Configure HubSpot webhook subscriptions (see Deployment & Routing section) pointing at dev-portal URL first
4. Ship Prisma migration for `HubSpotPropertyCache`, 4 link tables, `PropertySyncWatermark`, plus `ActivityType` enum additions (`PROPERTY_CREATED`, `PROPERTY_ASSOCIATION_ADDED`, `PROPERTY_SYNC_FAILED`)
5. Deploy `property-sync.ts` + webhook handler at `/api/webhooks/hubspot/property`, gated behind `PROPERTY_SYNC_ENABLED` env flag (OFF in prod)
6. Add webhook + cron paths to `PUBLIC_API_ROUTES` in `src/middleware.ts`
7. Add cron entry + `maxDuration` overrides to `vercel.json`
8. Deploy nightly reconciliation cron at `/api/cron/property-reconcile` with `CRON_SECRET` bearer-token validation (no-op while `PROPERTY_SYNC_ENABLED` flag is OFF)

### Phase 2 — Dev-portal validation
6. Run backfill against HubSpot sandbox/dev portal
7. Verify Property records + associations in HubSpot UI
8. Verify cache rows match HubSpot
9. Manual smoke test: add a handful of new addresses, confirm AHJ/Utility/Location resolution

### Phase 3 — Prod backfill
10. Enable `PROPERTY_SYNC_ENABLED` in prod (webhooks start flowing)
11. Run backfill script in prod (throttled, resumable)
12. Monitor: webhook error rate, geocoding spend, cache-vs-HubSpot parity
13. Soak for 48h; reconciliation cron catches any misses

### Phase 4 — UI rollout
14. Ship Service Suite customer-360 Properties section
15. Ship `PropertyDrawer` + address-click triggers on 4 target pages
16. Internal announcement; collect feedback

**Rollback:**
- Phases 1-3: flip `PROPERTY_SYNC_ENABLED` off; no user impact (no UI yet). The Prisma migration itself is not rolled back — the cache tables sit empty/stale but cause no harm. If the feature is permanently abandoned, a follow-up down-migration can drop the tables.
- Phase 4: feature-flag UI (`UI_PROPERTY_VIEWS_ENABLED`); removing the flag reverts to today's UI without code revert.

## Risks and Edge Cases

| Risk | Mitigation |
|---|---|
| Duplicate Properties from inconsistent geocoding | DB-enforced via `googlePlaceId` and `addressHash` unique constraints. Inconsistent geocode results across retries collide on `addressHash`; alert + merge workflow when `place_id` drift is detected on an existing row. |
| Webhook misses | Nightly reconciliation; `lastReconciledAt > 48h` alert |
| Google geocoding rate-limit during backfill | Throttle to 40 req/s (below 50 limit); existing retry wrapper |
| Address with no `place_id` (rural, PO Box, new construction) | `addressHash` is the authoritative dedupe key in this case (unique constraint enforces one-property-per-address). `googlePlaceId` is null; everything else still works. |
| Contact moves or corrects address | Each change creates/associates a Property; Contact accumulates associations — matches the many-to-many model |
| Association label drift (house sold, label not updated) | Manual correction in HubSpot UI (v1) |
| Multiple "Current Owner" labels per Property | In v1, `onContactAddressChange` always attaches the `Current Owner` label and NEVER demotes previous Current Owners. When a house sells, two contacts can both be labeled `Current Owner` until manually corrected in HubSpot. Acceptable trade-off for v1 — automated demotion is future work. UI should display all Current Owners (newest first by `associatedAt`) rather than pick one arbitrarily. |
| AHJ/Utility resolution ambiguous (boundary addresses) | Use AHJ `service_area` when populated; fallback to closest-match by zip; log ambiguous cases |
| PII in cache | Same classification as existing caches; no new compliance surface |
| Backfill impact on HubSpot rate limits during business hours | Run off-hours, cap concurrency at 5, use `withRetry` |

## Observability

- Activity log events: `PROPERTY_CREATED`, `PROPERTY_ASSOCIATION_ADDED`, `PROPERTY_SYNC_FAILED`
- Sentry alerts: webhook signature failure, geocode failure rate > 5%, reconciliation drift > N records
- Future admin page (not v1): `/admin/property-sync-health` with backfill status, drift count, failed records

## Follow-up Specs

Explicitly deferred to future work:

1. **ATTOM enrichment integration** — populate structural/roof/parcel/risk fields via scheduled enrichment job; 90-day TTL refresh; match-confidence scoring.
2. **Dedicated Properties dashboard** (`/dashboards/properties`) — searchable list, map view, geographic rollups.
3. **In-app Property edit UI** — manage ownership labels, manual fields without leaving PB Ops Suite.
4. **Historical ownership timeline inference** — derive previous-owner transitions from deal property-change history.
