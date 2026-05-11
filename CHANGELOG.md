# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-05-11

### IDR Meeting Hub (Major)
- Tier 1 (15%) and Tier 2 (20%) auto-calculated percentage-based adders with mutual exclusivity (#477)
- New `opsRevisionNotes` field alongside meeting notes; expanded deal history cards now surface all meeting fields (adders, flags, install planning, all notes) (#477)
- Yellow warning banner when sales change delta is under 10% of project cost; "Shit Show" status line written into HubSpot timeline when flagged (#477)
- HubSpot roof type auto-populates from deal property; new adder amount property, % of deal calculation, and waiver warnings (#487)
- Pricing calculator delta replaced with user-entered `salesChangeAmount` field; adder costs shown inline in checklist instead of `PricingBreakdown` (#483, #484, #485)
- React hooks ordering fix in `ProjectDetail`; cleanup of duplicate `pricingDeltaPct` and unused `useMemo` (#480, #481, #488)

### Aircall Call Analytics (Major)
- Phase 1: call analytics dashboard with Postgres cache (provider-discriminated for future Zuper Connect ingestion), webhook + cron sync, Admin sandbox at `/dashboards/admin/calls` (#501)
- Per-user answer rate via ring tracking (#502)
- Analytics+ ringing-attempts CSV importer for historical backfill (#503)
- Phase 2: executive call analytics dashboard (#505)
- On-Call Calls section sourced from `OnCallCallLog` (#507)

### On-Call Workflow
- Roofing issue type, 3-way outcome selector, pool-filtered crew dropdown on the on-call form (#496)
- Auto-create HubSpot service ticket when call outcome is "follow-up needed" (#500)
- Customer phone/address fields capture + HubSpot contact find-or-create (search by phone, exact + digits-only); follow-up tickets auto-associate the contact (#504)
- Increased publish timeout to support 6-month assignment horizon (#499)
- On-call electrician overlay on master scheduler with CO/CA region chips; toggle persists in localStorage (#511)

### Service BOM Pipeline
- New Service BOM page covering both deals and tickets, with ticket-keyed snapshots (#506)
- Ticket-context link fixes and `dealname` cleanup on service BOMs (#508)
- `bom-so-create` falls back without the custom field if the Zoho org lacks it, unblocking ticket SOs (#510)
- Zoho Inventory retries token refresh on Access Denied (#509)
- BOM table consolidates the Catalogs column into the product badge (#513)

### Scheduler Enhancements
- Day view timed grid for surveys and inspections (#516)
- Sub-job breakdown view on construction cards, only shown when a deal has 2+ sub-jobs (#518, #520)
- Construction job split (Solar / Battery / EV) — centralized deal-level aggregation in `lib/zuper-construction.ts` covering revenue calendar, schedule optimizer, calendar events, metrics, with completion-stamping cron (#515)
- Zuper job status shown in all scheduler modals (#519)
- Zuper assignment metadata persisted on confirm (#478)
- Calendar shows events for combined location groups (California) (#526)

### Cost Audit & Sync Health
- Cost Audit: cross-references Zoho bills against item purchase rates (#491)
- Sales price, margin, and cross-system link badges (#493)
- Bulk-sync costs to latest bill with suggested sales price (#495)
- Sync Health page: drift rollup across InternalProduct/HubSpot/Zuper/Zoho with 9 issue tiles deep-linking into `/dashboards/product-comparison` with filters pre-applied (#497)
- Canonical `writeCrossLinkIds` now used for all systems (#517)

### PandaDoc Integration
- DA status drift detector cron polls PandaDoc every 15 min for terminal-status DA documents and writes mismatches to new `DaStatusDrift` table; admins review at `/dashboards/admin/da-drift` (#528)
- DA status now read from the approval dropdown rather than `document.completed` (#529)

### Operations Suite & Office Performance
- 6 office performance cards (All Locations + Westminster, Centennial, Colorado Springs, SLO, Camarillo) added to operations suite; role-gated via `SuitePageShell.allowedRoutes` (#527)
- Cache-first fetching cuts office performance dashboard load time (#525)

### Comms
- Initial "include HubSpot emails outside inbox" rollout (#482) reverted after issues (#521)
- Diagnostic logging added to messages API (#523)
- Gmail fetch capped and rate-limit errors surfaced to UI (#524)

### Admin & Infra
- New admin testing suite landing page (`/suites/testing`)
- 23 missing `SUITE_MAP` breadcrumb entries added; stale overrides removed (#514)
- `product-comparison` page wrapped in Suspense to fix prod build (#498)
- Zuper downstream follow-up handling for pending state; three follow-up type fixes (#472, #474, #475, #476)

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
