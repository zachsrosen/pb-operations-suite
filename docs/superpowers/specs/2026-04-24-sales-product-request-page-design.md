# Sales Product Request Page — Design

**Date:** 2026-04-24
**Status:** Draft
**Author:** Zach Rosen + Claude

## Problem

Sales reps quote systems in OpenSolar. When a customer asks for a specific panel, inverter, battery, EV charger, or an adder that isn't in Photon Brothers' OpenSolar component library, the rep today has no self-service way to get it added. They ping Tech Ops ad hoc over email or in person, requests get lost, the rep doesn't know when the product is finally available, and Tech Ops has no single queue to work from.

Meanwhile, internal Ops already has a structured catalog pipeline (`/dashboards/submit-product`) that creates `InternalProduct` rows and syncs to HubSpot/Zuper/Zoho — but that wizard expects the submitter to know spec fields (Voc, Isc, temperature coefficients, MPPT channels) that sales reps don't have. It's the wrong tool for them.

## Goals

- One page in the Sales & Marketing Suite where reps can request products be added to OpenSolar.
- Two request types: **Equipment** (8 catalog categories) and **Adder** (MPU / trenching / steep roof / etc.).
- Rep input is minimal — reps give brand/model or adder basics; they don't fill spec fields.
- Optional datasheet upload auto-extracts specs (via existing Claude extraction) so Tech Ops has a head start.
- Single Tech Ops review queue, merged into the existing `/dashboards/catalog/review` page.
- Nothing touches OpenSolar, HubSpot, Zoho, or Zuper until Tech Ops approves.
- Rep is emailed when their request is resolved (added or declined).
- Shipped behind a feature flag; safe to merge with no user-visible change until flipped on.

## Non-goals

- Automatic approval of sales requests. Tech Ops always reviews.
- OpenSolar API integration work — out of scope here; we queue an OpenSolar push that is stubbed today (behind an existing-style kill switch) and becomes real when the separate OpenSolar API discovery spec ships.
- Replacing the existing `/dashboards/submit-product` wizard. That remains the internal ops tool.
- Extending the Adder Catalog's own editor UI. This project creates requests; promoting an approved adder request into the Adder Catalog reuses the existing adder model and sync.
- Slack notifications. PB doesn't use Slack — email + dashboard only.

## User decisions captured during brainstorming

| Question | Decision |
|----------|----------|
| What happens after submit | **C** — Dual-write: creates a catalog-review request AND flags "needs OpenSolar add" |
| How much the rep fills in | **C** — Minimal form + optional datasheet upload with Claude extraction |
| Scope of categories | **B** — Equipment (all 8 categories) + adders in one page |
| Who reviews | All requests go to **Tech Ops** (single owner) |
| Notifications | **D** — Email + dashboard |
| Queue location | **III** — Merged into existing `/dashboards/catalog/review` with a Source filter |

## Architecture

### Route & shell

```
/dashboards/request-product  →  src/app/dashboards/request-product/page.tsx
  └─ <DashboardShell title="Request a Product" accentColor="cyan">
      └─ <RequestProductClient>
          ├─ <ModeSelectStep>       (Equipment vs Adder)
          ├─ <EquipmentRequestForm> (minimal fields + datasheet drop)
          ├─ <AdderRequestForm>     (adder shape: category/name/unit/price/desc)
          ├─ <ConfirmationScreen>   ("Submitted. Tech Ops notified.")
          └─ <MyRequestsTable>      (rep's own submissions with status)
```

Added as a card to `src/app/suites/sales-marketing/page.tsx`:

```ts
{
  href: "/dashboards/request-product",
  title: "Request a Product",
  description: "Can't find a panel, inverter, battery, or adder in OpenSolar? Request it here.",
  tag: "REQUEST",
  icon: "📦",
  section: "Tools",
}
```

### Data model

**Equipment requests — extend existing `PendingCatalogPush`:**

No new table for equipment. We extend the existing model with two additive columns and reuse existing `systems` and `source` semantics.

```prisma
model PendingCatalogPush {
  // ...existing fields...
  openSolarId       String?   // ID returned by OpenSolar push; null until added
  salesRequestNote  String?   // Rep's "why I need this"; kept distinct from reviewer `note`
}
```

- `systems` array grows to accept `"OPENSOLAR"` as a valid target.
- `source` field receives a new valid value: `"SALES_REQUEST"`.
- `requestedBy` — rep email (existing).
- `dealId` — optional deal link (existing).
- `metadata` JSON — carries Claude-extracted specs when a datasheet was uploaded (existing field, new contents).

**Adder requests — new table `AdderRequest`:**

Adders don't fit the equipment schema (basePrice, direction ADD/DISCOUNT, shopOverrides, unit labels). A separate table is cheaper than polymorphing `PendingCatalogPush`.

```prisma
model AdderRequest {
  id               String              @id @default(cuid())
  status           AdderRequestStatus  @default(PENDING)
  category         String              // "MPU" | "TRENCHING" | "STEEP_ROOF" | "MISC" | ...
  name             String              // Short display name
  unit             String              // "each" | "sqft" | "ft" | "hour"
  estimatedPrice   Float?              // Rep's best guess; reviewer sets real price
  description      String?             // What it is, when to use it
  salesRequestNote String?             // "why I need this"
  requestedBy      String              // Rep email
  dealId           String?             // HubSpot deal ID
  openSolarId      String?             // Populated after OpenSolar push
  reviewerNote     String?             // Rejection reason (surfaced to rep in email)
  adderCatalogId   String?             // FK to promoted Adder row once approved
  createdAt        DateTime            @default(now())
  resolvedAt       DateTime?

  @@index([status])
  @@index([requestedBy])
  @@index([dealId])
}

enum AdderRequestStatus {
  PENDING
  IN_REVIEW
  ADDED
  DECLINED
}
```

Migration is purely additive (new table + two nullable columns on `PendingCatalogPush`). Safe to apply before code ships.

### Approval & push flow

**Submit-time (rep side):**

1. Rep POSTs to `/api/product-requests/equipment` or `/api/product-requests/adder`.
2. Equipment: row written to `PendingCatalogPush` with `source="SALES_REQUEST"`, `systems=["INTERNAL","HUBSPOT","ZUPER","ZOHO","OPENSOLAR"]`, `status="PENDING"`.
3. Adder: row written to `AdderRequest` with `status="PENDING"`.
4. If a datasheet PDF was attached (equipment only), the existing Claude extraction runs synchronously; extracted specs are stashed in `PendingCatalogPush.metadata`.
5. Email notification fires to Tech Ops (see Notifications).
6. **No external system is touched at submit time.** Reps can't dirty HubSpot/Zoho/Zuper/OpenSolar with bad data.

**Approve (Tech Ops side):**

1. Reviewer opens request on `/dashboards/catalog/review`.
2. Equipment approve:
   - Promotes `PendingCatalogPush` → creates `InternalProduct`.
   - Existing sync pipeline pushes to HubSpot Product + Zoho item + Zuper catalog.
   - Queues OpenSolar push behind new `OPENSOLAR_PRODUCT_SYNC_ENABLED` flag (stubbed success when off, real fetch when on — same pattern as existing `ADDER_SYNC_ENABLED`).
   - Writes `openSolarId` back to the row.
   - `status="APPROVED"` (existing enum value for `PendingCatalogPush`).
   - Emails rep.
3. Adder approve:
   - Creates an `Adder` row in the existing Adder Catalog, populates `AdderRequest.adderCatalogId`.
   - Existing adders-sync cron (`/api/cron/adders-sync`) handles OpenSolar push on its next run.
   - `status="ADDED"`, emails rep.

**Decline (either type):**

- Reviewer must provide a note (form-enforced); the note is the email body sent to the rep.
- Equipment: `PendingCatalogPush.status="REJECTED"` (existing enum value), `note` field holds reviewer message.
- Adder: `AdderRequest.status="DECLINED"`, `reviewerNote` holds message.

**Idempotency / dedup:**

- Submit-time: a check runs for brand+model (equipment) or name (adder) against existing products/adders; if a match exists the rep sees "we already have this — you can use it in OpenSolar" and the form does not submit.
- Approve-time dedup on equipment reuses the existing `DedupPanel` / canonical-key logic in the catalog pipeline.

### Reviewer UI additions

Changes to `/dashboards/catalog/review`:

- **New filter chip:** `Source: Sales Request` — toggles between existing BOM-originated pushes and the new sales-originated ones.
- **Type badge:** each row shows `EQUIPMENT` or `ADDER` to disambiguate since they open different drawers.
- **Equipment detail drawer:** opens the existing catalog wizard pre-filled with rep's input + Claude-extracted specs. Reviewer edits → Approve/Decline.
- **Adder detail drawer:** new component `AdderRequestDrawer` — category, code, name, unit, price, cost, direction, shop overrides. Reviewer fills → Approve/Decline.
- **Badge count:** the existing `/dashboards/catalog/review` header gets a pending-count indicator scoped to sales requests, driven by the existing SSE invalidation pipeline.

### Notifications

**To Tech Ops on submit:**

- Email via the dual-provider pipeline (Google Workspace → Resend fallback).
- Recipients: comma-separated env var `TECH_OPS_REQUESTS_EMAIL` (new).
- React Email template: `src/emails/SalesProductRequestNotification.tsx`.
- Subject: `[Product Request] <Category> <Brand Model>` or `[Adder Request] <Name>`.
- Body includes rep email, deal link (if any), "why" note, deep link to review page filtered to the new request ID.

**To rep on resolution:**

- React Email templates: `SalesProductRequestApproved.tsx` and `SalesProductRequestDeclined.tsx`.
- Approved email notes "may take a few minutes to appear in OpenSolar UI."
- Declined email has reviewer note as primary content.
- No emails fire for intermediate status transitions (PENDING ↔ IN_REVIEW).

**Audit:**

- New `ActivityType` enum values: `SALES_PRODUCT_REQUEST_SUBMITTED`, `SALES_PRODUCT_REQUEST_APPROVED`, `SALES_PRODUCT_REQUEST_DECLINED`.
- Logged via the existing `useActivityTracking` / server-side activity-log pipeline.

### API routes

All new, added under the existing auth + role middleware.

| Route | Method | Who | Purpose |
|-------|--------|-----|---------|
| `/api/product-requests/equipment` | POST | Sales roles | Rep submits equipment request |
| `/api/product-requests/adder` | POST | Sales roles | Rep submits adder request |
| `/api/product-requests/mine` | GET | Sales roles | Rep's own submissions for "My requests" |
| `/api/admin/product-requests` | GET | Tech Ops + admins | Reviewer list (feeds review page) |
| `/api/admin/product-requests/[id]/approve` | POST | Tech Ops + admins | Reviewer approve |
| `/api/admin/product-requests/[id]/decline` | POST | Tech Ops + admins | Reviewer decline |

Adder requests and equipment requests are discriminated by a `type` field in the response payload; the list endpoint merges both tables into a single sorted list.

### Role allowlist (`src/lib/roles.ts`)

Per prior feedback: new routes and new page must be explicitly added to every role's `allowedRoutes`, or middleware silently returns 403.

- Rep-facing page + routes (`/dashboards/request-product`, `/api/product-requests/*` non-admin): add to `ADMIN`, `OWNER`, `SALES_MANAGER`, `SALES`, `MARKETING`.
- Admin routes (`/api/admin/product-requests/*`): covered by existing `ADMIN_ONLY_ROUTES` prefix check and explicitly allowed for `TECH_OPS`, `DESIGN`, `PERMIT`, `INTERCONNECT` as Tech Ops successors.
- No change to suite-switcher visibility — the Sales & Marketing suite already includes the target roles.

### Feature flags

- `SALES_PRODUCT_REQUESTS_ENABLED` — gates the page, the suite card, and the `/api/product-requests/*` routes. Off by default.
- `OPENSOLAR_PRODUCT_SYNC_ENABLED` — gates the OpenSolar push at approval time. Off by default; stubbed success when off. Paired with the existing `ADDER_SYNC_ENABLED` pattern; adder pushes continue to use the existing flag.
- `TECH_OPS_REQUESTS_EMAIL` — comma-separated email list for submit notifications.

All three env vars must be pushed to Vercel prod before flip-on (per prior feedback about env sync).

### Rollout plan

1. **Migration first.** Apply additive migration to prod (new `AdderRequest` table + two nullable columns on `PendingCatalogPush`). Safe to ship before code per prior feedback on migration ordering.
2. **Code merged behind flags off.** All three flags default to off; no user-visible change.
3. **Vercel env sync.** `SALES_PRODUCT_REQUESTS_ENABLED=false`, `TECH_OPS_REQUESTS_EMAIL=<distro>`, `OPENSOLAR_PRODUCT_SYNC_ENABLED=false` pushed to production.
4. **Tech Ops training.** Walk through the merged `/dashboards/catalog/review` with a seeded test request.
5. **Flip on.** `SALES_PRODUCT_REQUESTS_ENABLED=true`. Leave `OPENSOLAR_PRODUCT_SYNC_ENABLED=false` until OpenSolar API discovery ships — stubbed OpenSolar push is fine (everything else — HubSpot/Zoho/Zuper/Adder Catalog — is real).
6. **Monitor.** First week: watch email deliveries, watch `/dashboards/catalog/review` for confusion, take rep feedback.

## Error handling

- Datasheet extraction failure at submit time: submit still succeeds; reviewer sees "datasheet attached but extraction failed" banner. Rep is not blocked on a flaky LLM call.
- Email send failure at submit or resolution: logged to Sentry, request row is still persisted. Tech Ops picks it up via the dashboard badge regardless.
- OpenSolar push failure at approval: logged; the approval still succeeds (catalog side is done). A retry job picks it up on next cron cycle. OpenSolar push is eventually-consistent by design.
- Adder promotion failure at approval: wraps the whole approve handler in a transaction — either adder row + request status both update, or neither does. No half-promoted state.

## Testing strategy

- **Unit tests:** form validation (equipment + adder), dedup lookup, state transitions, role/flag middleware.
- **Integration tests:** submit → DB row → email sent (stubbed transport), approve → catalog pipeline invoked (stubbed external systems), decline → email sent.
- **Manual QA on preview:** rep view (submit both types, see "my requests" update), Tech Ops view (approve + decline both types), OpenSolar stub returns synthetic success, rep gets emails.

## Open questions

None blocking — all user decisions captured above. If OpenSolar API discovery reveals that OpenSolar uses different entities for equipment vs adders, the stubbed push function takes the hit; the request schema doesn't change.

## Follow-ups (out of scope here)

- OpenSolar API discovery + real push implementation (separate spec already queued per `docs/superpowers/followups/2026-04-22-opensolar-api-discovery.md`).
- Rep-side "resubmit with new info" flow after a decline (low priority — reps can just submit again today).
- Admin dashboard widget showing request SLA (time-to-approve). Worth revisiting after 30 days of real traffic.
