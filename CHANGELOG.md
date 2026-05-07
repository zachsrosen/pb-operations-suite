# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-05-07

### Tesla PowerHub Fleet Monitoring (Major)
- New PowerHub integration: Prisma models (Site, Telemetry, Alert), JWT-authed API client with rate limiting, and three-tier site-to-deal linkage
- Cron-driven sync orchestration for assets, telemetry, and alerts
- PowerHub alert scoring fed into the service priority queue
- Fleet monitoring dashboard with expandable site table, admin linkage manager, and SystemHealth embed
- Dashboard cards added to Service and D&E suite landing pages
- Direct Tesla API key auth (mTLS proxy scaffolding removed) — uses `gridlogic-api.sn.tesla.services/v2` with `{ user_id, instance_id }` token request

### Aircall Call Analytics (Major)
- **Phase 1**: Admin sandbox dashboard at `/dashboards/admin/calls` with volume + responsiveness + per-user breakdown, ingested via webhook + drift-correction cron (`AircallCallCache`, `AircallUserCache`)
- **Phase 2**: Executive-facing dashboard at `/dashboards/executive-calls` (ADMIN/OWNER/EXECUTIVE), reuses Phase 1 client behind `AIRCALL_DASHBOARD_ENABLED`
- **Per-user answer rate via ring tracking**: `call.ringing_on_agent` + `call.answered` webhooks populate `AircallCallRing`, giving true per-agent denominators (previously every named user showed 100%)
- **Analytics+ CSV import**: accept ringing-attempts CSV exports for historical per-user answer rates pre-webhook (`AircallAnalyticsSummary`, admin import route, CLI script)
- **On-Call Calls section**: aggregates `OnCallCallLog` rows alongside Aircall on the analytics dashboard (totals, resolved-remotely rate, dispatched, escalation rate, hours worked, safety risks, by-issue-type breakdown, per-electrician table)

### On-Call Electrician (Major)
- **PTO + swap UX**: Request PTO button + inline form on `/on-call/me`, dedicated Time Off section showing pending + approved PTO; clearer swap inbox (you-cover/they-cover grid), exchange preview in swap modal
- **Auto-create HubSpot service ticket** when a call log outcome is "follow-up needed"
- **Customer phone/address capture** in the call log form, with HubSpot contact find-or-create on every call with a phone number; follow-up tickets associate the contact via typeId 16
- **Roofing issue type** added; outcome is now 3-way (resolved remotely / dispatched / follow-up needed); active-crew dropdown filters to on-call pool members
- **On-call overlay on master scheduler**: per-region (CO/CA) emerald chips in month/week cells, toggle persists in localStorage
- 6-month assignment publish horizon: increased Vercel function and Prisma transaction timeouts

### PandaDoc DA Status Drift Detector
- Backup reconciliation cron polls PandaDoc every 15 min for terminal-status (completed/declined) DA-template documents and writes mismatches to `DaStatusDrift` for human review at `/dashboards/admin/da-drift`
- **Approval source-of-truth fix**: read the "Design Approval Selection" template dropdown (not `document.completed`) — customers who pick "Design Rejected" still sign the document, so PandaDoc's status alone was ambiguous
- Behind `PANDADOC_RECONCILE_ENABLED`; flag-only at launch (no auto-correct yet); `scripts/backfill-da-drift.ts` for ad-hoc historical sweeps

### Construction Job Split — Solar / Battery / EV (Major)
- New Zuper categories (`Construction - Solar/Battery/EV`) supported across the stack; legacy `Construction` category preserved for rollback via `CONSTRUCTION_JOB_SPLIT_ENABLED`
- New `lib/zuper-construction.ts` helper module: predicates, deal-level aggregator, N-way deal-value allocator (generalizes the D&R 50/50 split); 20 unit tests
- **Revenue calendar**: deal value split across construction sub-jobs (a 3-system $90k deal no longer triple-counts to $270k)
- **Cache helpers, status comparison, availability, assisted-scheduling, schedule routes, compliance scoring, inspection metrics**: widened to accept the four-category union so sub-jobs aren't silently dropped
- **Scheduler sub-job breakdown view**: opt-in Compact/Breakdown toggle on construction and master schedulers showing per-system (PV/ESS/EV/ALL) status pills; only activates for deals with 2+ sub-jobs
- **Sibling cascade reschedule**: scheduling/confirming a construction job now reschedules all sibling sub-jobs for the same deal (Solar/Battery/EV) with the same dates and crew, with audit logging and tentative-sibling skip
- **Calendar event labels**: install events now show system types ("Install — Smith Residence (Solar, Battery)")
- **Master scheduler "Other" overlay**: new sub-category UIDs added to exclusion list

### Master Scheduler
- **Day view timed grid**: surveys/inspections with non-midnight Zuper times now placed at their actual time slots (previously always "ALL DAY / UNSCHEDULED")
- **Job Status row** in detail/schedule modals across all four schedulers (master, construction, site survey, inspection) — color-coded (green/yellow/blue)
- **California group fix**: project + Zuper event generators now accept `CanonicalLocation[]`, resolving the dashboard group label ("California") to its canonical list (San Luis Obispo, Camarillo) — previously blank calendar

### Service BOM (Major)
- New Service Suite BOM page at `/dashboards/service-bom` scoping search to service deals AND service tickets (project-pipeline page unchanged)
- **Ticket-keyed snapshots** via new `TicketBomSnapshot` model and migration; ticket BOMs are independent from any associated deal's BOM
- New API routes: `/api/bom/ticket-history`, `/api/bom/ticket-history/all`, `/api/bom/ticket-create-so` (mirrors deal-keyed flow)
- Ticket SO creation tags `HubSpot Ticket Record ID` custom field with fallback when the field is missing in Zoho (retries without the custom field)
- Service deals/tickets surface design folders via `service_documents`/`ticket_documents` properties
- BOM dashboard refactored to accept a `BomPipelineConfig` prop; Push-to-HubSpot and Zoho PO actions hidden in ticket context

### Cost Audit (Major)
- New `/dashboards/inventory/cost-audit` cross-references Zoho bills against item purchase rates to surface drift
- **Sales price, margin %, and cross-system link badges**: Zoho items joined with `InternalProduct` to show HubSpot/Zuper/Internal sync state; margins color-coded (red <5%, amber <15%, green ≥15%)
- **Bulk-sync costs to latest bill**: `POST /api/inventory/cost-audit/sync-costs` (ADMIN/OWNER/PM, max 500/request) updates Zoho `purchase_rate` + mirrors to `InternalProduct.unitCost`, logs `CATALOG_PRODUCT_UPDATED` activity, bounded concurrency
- Suggested sale price = latest bill × 1.5; per-row checkboxes + confirmation modal previews Current → New → Δ before applying

### Sync Health
- New "what's broken right now?" landing page rolling up drift across InternalProduct/HubSpot/Zuper/Zoho — read-only, deep-links to `/dashboards/product-comparison` with `?reasons=…&missing=…` filters pre-applied
- Source health row, top-line summary, 9 issue tiles (name, SKU, price, broken links, missing in HS/ZP/Zoho, orphaned, duplicates), top-25 worst-offender ranking
- Wired into the Testing suite

### Office Performance
- **504 death spiral fix**: bumped `maxDuration` to 120s per-location / 300s for `/all`; added cache-warming cron self-fetching every 4 minutes to keep Lambda containers warm
- **Cache-first fetching**: dropped `?refresh=true` from client fetch sites so React Query + server SWR cache do their jobs; `/all` and `/goals-pipeline/all` accept stale per-location caches; uncached-group fetching uses a 2-worker pool (warm load 30-60s → <2s; cold worst case ~55s → ~25s)
- **Operations suite**: 6 office performance cards (All Locations + 5 office locations) added; auto-hide based on role `allowedRoutes`

### IDR Adders / Pricing Calculator
- **User-entered `salesChangeAmount`** replaces the pricing-calculator delta for the 10% sales change threshold (live percentage display, 10% warning); propagated through prep save, session consume, preview, re-queue
- Removed full pricing breakdown section; adder costs now shown inline in the IDR checklist
- Per-watt rates and per-system costs displayed when system size is unknown (e.g. "$0.35/W", "$3,500 + $0.80/W")
- **Roof-type auto-populate** from HubSpot `roof_type` deal property on session creation; total adder dollar amount pushed to new `idr_adder_amount` HubSpot property; "may be waived" warning on adders under 10% of deal amount; total adders summary line

### Comms
- **Gmail rate limit fix**: capped `fetchGmailPage` at 200 (was unbounded), detect `rateLimitExceeded` and return 429 with `rateLimited: true`, surface clear "wait ~60s and refresh" UI instead of empty-state copy
- Reverted "include HubSpot emails outside inbox" (#482)

### Bug Fixes
- **Product sync**: replaced `setCrossLinkFields` with canonical `writeCrossLinkIds`; cross-linking now always runs after creates and writes to the source system, not just newly-created systems
- **PE Receivable**: hero card now sums per-milestone (only IC/PC where the corresponding milestone is Approved or Paid) instead of summing `pePaymentTotal` across all filtered deals
- **BOM table**: consolidated Catalogs column into the product badge
- **Breadcrumbs**: added 23 missing `SUITE_MAP` entries and removed stale overrides
- **Zoho Inventory token refresh**: retry loop with jittered backoff (~800ms / 1600ms, 3 attempts) when concurrent Lambda cold-starts race against the same shared token (`Access Denied`)
- **product-comparison prerender**: wrap in Suspense (Next.js 16 requires it for `useSearchParams`)
- **Sibling cascade**: scope by HubSpot Deal ID (not just `customer_uid`) so unrelated deals sharing a Zuper customer aren't included; skip siblings with tentative `ScheduleRecord`s; falls back to Zuper API when `ZuperJobCache` is empty
- **Removed unused `useMemo` import**

---

## 2026-03-14

### Catalog Product Wizard (Major)
- 4-step product wizard (Start Mode → Basics → Details → Review) replacing the 660-line monolithic form
- Clone search with live search against /api/catalog/search and prefill confidence highlights
- AI datasheet extraction via Claude API with category-aware tool schema for full spec extraction
- Product photo upload via Vercel Blob with JPEG/PNG/WebP validation
- Duplicate detection with debounced multi-field lookup and merge tool
- Field tooltips, showWhen conditional fields, and category defaults
- 24 unit tests covering reducer actions, prefill flows, and category defaults

### SOP Operations Guide (Major)
- Phase 3: DB-backed sections with CodeMirror HTML editor
- Admin edit and non-admin suggest mode with optimistic locking and 409 conflict detection
- Revision history and suggestion review workflow (submit → pending → approve/reject)
- HTML sanitizer with class allowlist, cross-section deep links, URL-synced navigation

### Master Scheduler
- One-click reschedule for confirmed installs, surveys, and inspections
- Auto-sync to Zuper, Google Calendar, and crew email on reschedule
- Preserves existing crew assignments; pre-fills construction days from schedule duration

### Catalog & Notifications
- Admin email notifications on new catalog push requests
- Approval warnings for partial syncs with pending tab deep links in notification URLs
- Battery built-in inverter specs toggle for combo units (Powerwall 3, Enphase IQ)
- Edit form fields now have visible labels instead of placeholder-only

### Email & Infrastructure
- Email routing consolidated through Google Workspace with Resend fallback (catalog + audit alerts)
- Forecast accuracy API refactored to single-pass computation with caching (prevents Vercel timeout)

### Zuper Integration
- Dynamic category resolution via /product_categories API with 10-min TTL cache (replaces static map)
- Enrichment capped at 50 jobs with concurrency=5 to prevent API blast radius
- Duplicate detection excludes all terminal statuses to reduce false positives
- Zoho inventory/accounting defaults (FIFO, correct account names) preserved on product creation

### Bug Fixes
- Catalog approval route always returns JSON (fixes "Unexpected end of JSON" toast)
- pdf-parse pinned to v1.1.1 with direct lib import for serverless compatibility
- Fixed RESEND_FROM_EMAIL env var (was reading undefined RESEND_FROM)
- showWhen conditional fields clear stale data on toggle-off
- Sam Paro survey slots updated in hardcoded availability fallback

---

## 2026-03-07

### Solar Surveyor (Major)
- Migrated from cross-origin iframe to same-origin static serving (`public/solar-surveyor/`)
- Removed cross-origin bridge architecture (SolarIframeBridge, solar-cors, postMessage relay)
- Fixed login loop caused by cross-origin cookie policy (`SameSite=None` → `Lax`, removed `COOKIE_DOMAIN`)
- Rotated auth cookie names to `pbops.*` namespace to avoid legacy domain-scoped cookie collisions
- Fixed OAuth redirect landing on `/` instead of dashboard — now uses `window.top` navigation
- Added `allow-top-navigation` to iframe sandbox for OAuth flow
- Fixed session endpoint crash (unhandled Prisma error when table missing) that triggered login loop
- Fixed asset paths: set `VITE_BASE_PATH=/solar-surveyor/` so CSS/JS resolve correctly
- Added `build:solar` script to automate Vite build + copy

### AI Skills Hub
- New AI Skills dashboard page and hub component
- Granted access to ADMIN, OWNER, MANAGER, OPS_MANAGER, PM, TECH_OPS roles
- Fixed TECH_OPS missing from AI hub access (allowedRoutes, page guard, suite filter)

### Catalog & Approvals
- Replaced auto-create HubSpot/Zuper products with pending catalog approval queue
- Hard-gated line item creation without linked product ID
- De-duplicated `pendingCatalogPush` on HubSpot and Zuper push routes
- Logged SO creation success/failure and catalog match pipeline to activity log

### On Hold Stage
- Added On Hold stage color, stat card on home page, and stage filter
- Fixed On Hold showing 0 projects — normalized stage name ("On-Hold" → "On Hold"), removed from `INACTIVE_STAGE_IDS`

### Security & Auth Hardening
- Required auth on activity log endpoint to prevent audit pollution
- Validated `uploadId` as UUID in BOM chunk route to prevent path traversal
- Required `hubspotProductId` on `createDealLineItem` (no orphan line items)
- Fail-closed on cron notify when `CRON_SECRET` not configured
- Moved auth check before DB check in BOM history route

### Zuper Integration
- Removed 6 dead Zuper API endpoints, kept only `/product`
- Added `zuperCategory` to all `CATEGORY_CONFIGS` entries
- Added "Parts" fallback in `createOrUpdateZuperPart`

### Solar Projects
- Renamed `energyBalance` → `homeConsumptionConfig` (schema migration + API updates)
- Added `geoJsonUrl`, `radianceDxfUrl`, `shadeDataUrl` to project creation
- Expanded `/api/solar` access to 8 additional roles
- Shifted cleanup-pending cron from 6AM to 1PM UTC

### Tracking & Analytics
- Added ClickTracker component wired into layout
- Track CSV exports in DashboardShell
- ChatWidget supports `data-open-chat-widget` trigger attribute

---

## 2026-03-06

### SOP Guide (Major)
- Added role-specific guide tabs: Operations, Design & Permitting, Sales, and PM Guide (CO project lifecycle)
- Added deep linking support via URL hash for sharing specific sections
- Added Simple/Technical view toggle for different audience levels
- Added collapsible sidebar sections with HubSpot Guide at top
- Implemented auth requirement — all logged-in users can access
- Admin-only TBD system for unreviewed sections (restricted to ADMIN role)
- Auth uses `/api/auth/sync` GET for role check (respects impersonation)
- Added SOP Guide link to user dropdown menu
- Multiple UX fixes: hard refresh default section, Pinned Notes per-stage, wireframe cleanup, tab naming consistency
- Moved to `/sop-guide.html` to avoid app route conflict; excluded `/prototypes` from middleware matcher

### Install Photo Review
- New feature: AI comparison of install photos vs permitted planset (pass/fail equipment match report)
- Source install photos from Google Drive + plansets from permit folder
- Recursive Drive install folder search for photos
- Persist install review results to `ProjectReview` table
- Handle HEIC photos and large PDFs
- Upload photos to Files API to avoid 413 errors
- Multi-planset retry + photo-only fallback for large PDFs

### BOM & Sales Orders
- BOM page redesign with improved UX
- BOM snapshot matching refactor
- Added pagination limit to BOM history endpoint (default 200, max 500)
- Removed `(TEST)` suffix from auto-generated SO numbers

### Build & Infrastructure
- Added missing solar surveyor schema + API routes to fix Vercel build
- Fixed code review findings: `forceOverwrite` crash, feedback 404, rate limit docs
- Resolved scheduler hydration error + added missing `ZohoDedupRun` migration

### Catalog & Product
- Catalog delete functionality added

### Scheduling
- Resolved deal owner for pre-sale surveys, improved tentative scheduling UX

### Dashboards
- Renamed execution dashboards
- Removed passed/pass rate from inspections view
- Filtered inspections dashboard to only show Inspection-stage projects

### Portal & Notifications
- Portal emails now use first name + Google Workspace
- Cancel prompts now trigger reschedule flow

### Zuper Integration
- Zuper enhancements and direct function call for job lookup in install-review
