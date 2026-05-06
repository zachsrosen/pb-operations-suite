# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-05-06

### Aircall Call Analytics (Major)
- New admin sandbox at `/dashboards/admin/calls` and executive view at `/dashboards/executive-calls` with KPIs (missed rate, time-to-answer, voicemail rate, talk time), stacked daily volume chart, hour heatmap, sortable per-user table, and paginated recent-calls list
- Webhook + cron ingestion into `AircallCallCache` / `AircallUserCache` with HMAC-SHA256 signature verification and idempotent unique-index conflict handling
- Per-user answer rate via `call.ringing_on_agent` + `call.answered` webhook subscription — fixes false 100% rates by attributing rung-but-missed calls to ring-group agents
- Analytics+ CSV import (`AircallAnalyticsSummary`) for historical ring-attempt data the REST API doesn't expose; admin import route + `aircall:analytics-import` script
- Provider discriminator on cache table reserves room for Phase 3 Zuper Connect ingestion

### IDR Meeting Hub & Pricing Calculator (Major)
- "Shit Show" status line, Ops Revision Notes field, and auto-calculated Tier 1 (15%) / Tier 2 (20%) adders with mutual exclusivity (#473/#477)
- Yellow warning banner when sales-change delta is under 10% of project cost; expanded deal-history cards show all meeting fields
- Roof adder checkboxes auto-populate from HubSpot `roof_type` on session creation; total adder dollar amount pushed to new `idr_adder_amount` deal property
- Inline `% of deal` display on each adder with "may be waived" warning under 10%
- Replaced pricing-calculator delta with user-entered `salesChangeAmount`; removed PricingBreakdown in favor of inline checklist; show adder rates when system size is unknown
- HubSpot roof type auto-populate, adder amount property push, percentage-of-deal warnings on waiver thresholds

### Master Scheduler
- Construction job split: deals now break into Solar / Battery / EV sub-jobs via `lib/zuper-construction.ts`, with deal-level aggregation feeding revenue calendar, schedule optimizer, calendar events, and metrics
- Sub-job breakdown view on construction cards with PV/ESS/EV pill tags; Compact/Breakdown toggle persisted in localStorage; only activates for deals with 2+ sub-jobs
- On-call electrician overlay on master schedule (toggleable, region-labeled emerald chips)
- Day-view timed grid: surveys and inspections now placed at actual Zuper scheduled times instead of all-day "UNSCHEDULED"
- Zuper job status row added to all four scheduler modals (master, construction, site survey, inspection) — color-coded green/yellow/blue alongside HubSpot stage
- California combined-location calendar fixed (canonical-list resolution in `generateProjectEvents` / `generateZuperEvents`)

### On-Call Dispatch
- Auto-create HubSpot service ticket when call-log outcome is "follow-up needed"
- 3-way outcome (resolved / dispatched / follow-up) replaces 2-way boolean; Roofing issue type added; crew dropdown filtered to active on-call pool
- Customer phone + address fields with HubSpot contact find-or-create by phone (exact + digits-only); contact associated to any follow-up ticket
- Google Sheet export gains Phone, Address, Outcome columns
- Publish timeout raised for 6-month assignment horizon (Vercel 120s + Prisma transaction limits)

### Service BOM
- New `/dashboards/service-bom` page scoping search to service deals + service tickets in parallel; shared backend with existing BOM dashboard via `BomPipelineConfig` prop
- New `TicketBomSnapshot` model — ticket BOMs versioned independently from any associated deal's BOM
- New API routes: `/api/bom/ticket-history`, `/ticket-history/all`, `/ticket-create-so` mirror the deal-keyed shape
- Zoho SO creation for ticket context: `createTicketSalesOrder` tags SO with HubSpot ticket ID, derives `SO-T-<ticketId>`, falls back without custom field if Zoho lacks it
- BOM table consolidates Catalogs column into product badge

### Cost Audit & Sync Health
- New `/dashboards/inventory/cost-audit` cross-references Zoho bills against item purchase rates; surfaces drift, sales price, margin %, and IP/HS/ZP cross-system link badges
- Bulk-sync write path: `POST /api/inventory/cost-audit/sync-costs` updates Zoho `purchase_rate` + mirrors to `InternalProduct.unitCost`, logs `CATALOG_PRODUCT_UPDATED`, suggests sales price = bill × 1.5
- New `/dashboards/sync-health` drift-rollup landing page: 9 issue tiles (name, SKU, price, broken links, missing in HS/ZP/Zoho, orphaned, duplicates) with deep-links into product-comparison filters
- Product-sync now uses canonical `writeCrossLinkIds` for all systems including the source — fixes peer-ID propagation gaps in `setCrossLinkFields`

### PandaDoc DA Status Drift Detector
- New `DaStatusDrift` table + cron polls PandaDoc every 15 min for DA-template terminal-status documents modified in last 2h, matched to deals via `metadata.hubspot.deal_id`
- Backup for the HubSpot-PandaDoc native connector which silently drops events; flag-only at launch (no auto-correct), admin review at `/dashboards/admin/da-drift`
- Reads the "Design Approval Selection" dropdown to distinguish customer rejection from approval — both produce `document.completed` so signature alone is ambiguous
- Re-drift after Resolve auto-reopens the row; gated on `PANDADOC_RECONCILE_ENABLED`

### Office Performance & Operations Suite
- 6 office performance cards (All Locations + Westminster, Centennial, COSP, SLO, Camarillo) added to operations suite with role-aware visibility
- Cache-first fetching: dropped client `?refresh=true` and accept stale per-location caches in `/all` aggregator; 2-worker pool replaces strict-serial uncached-group fetches
- Warm load 30–60s → <2s; cold worst case 55s → ~25s

### Admin Testing Suite
- New admin testing suite landing page consolidating sync health, cost audit, Aircall sandbox, DA drift, and sub-app debug tools

### Comms
- Reverted "include HubSpot emails outside inbox" (#482) after user reports of broken inbox view
- `fetchGmailPage` capped at 200 (was unbounded `Infinity`) to prevent 15k/min Gmail quota burn; pagination via `gmailNextPage` preserved
- Surface `rateLimitExceeded` as 429 with `rateLimited: true` flag; UI shows "Gmail rate limit reached, wait ~60s" instead of empty-state

### Zuper & Pending-Zuper Pipeline
- Pending Zuper downstream follow-up handler with dedicated agents, skills, and settings hardening
- Persist Zuper assignment metadata on confirm
- Multiple deploy type-error fixes for the pending-Zuper pipeline

### Bug Fixes & Misc
- Breadcrumbs: 23 missing `SUITE_MAP` entries added, stale overrides removed
- Service BOM ticket-context links cleaned up; `dealname` normalization fixed
- Zoho inventory token refresh retries on Access Denied
- Product-comparison page wrapped in Suspense (Next.js 16 static prerender requirement)
- React hooks ordering fixed in IDR ProjectDetail
- Removed duplicate `pricingDeltaPct` definition from squash-merge artifact

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
