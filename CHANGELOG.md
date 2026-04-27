# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-04-27

### Permit Hub & Interconnection Hub (Major)
- New `/dashboards/permit-hub` two-pane workspace for the permitting team — aggregated deal + AHJ + Gmail + Drive context in one screen, writeback via HubSpot task completion (#374)
- Sister `/dashboards/ic-hub` Interconnection Hub built on shared workspace-hub framework (#392)
- Action panels with submit-to-AHJ, resubmit, review-rejection, complete-revision, provide-information, follow-up, mark-approved actions
- Sticky inline action panel, grouped queue, multiselect location filter, permit-lead filter (#386, #387, #388)
- Header quick-links, resolved names, AHJ fallback (#389)
- Shared inbox thread fetch on correspondence tab; Gmail OR-clause search broadening (#390, #391)
- Per-inbox OAuth workaround for blocked DWD scope (#400)
- Diagnostic probes: cron-secret, token-exchange error body, verbose Gmail errors (#393, #395, #397)

### EagleView TrueDesign Auto-Pull Pipeline (Major)
- HubSpot workflow → `/api/webhooks/hubspot/eagleview-tdp-order` automatically orders TrueDesign for Planning report the day before a survey (#404)
- EagleView posts back to `/api/webhooks/eagleview/file-delivery` when files are ready; cron poller every 30 min as safety net
- Manual `<EagleViewPanel>` on deal review page; renders on Solar Surveyor when `?dealId=` is set (#406)
- Verified against EagleView sandbox (auth, product IDs, camelCase shape, live availability)
- Ships behind `EAGLEVIEW_AUTO_PULL_ENABLED` flag (default false); rollout runbook included (#405)

### Map Dashboard
- Dispatcher office pin with auto-detect from `User.allowedLocations[0]`, morning briefing, nearby highlights (#373)
- Project numbers, richer marker info, D&R + roofing markers, shop filter (#371)
- Assignee filter; scheduled-today markers never cluster (#376)
- Call + add-note quick actions on marker popovers (#394)
- Layout fixes, completed-job stripping, real office street addresses (#375, #385)
- Timezone-agnostic date comparison + per-kind count breakdown (#378)
- Resolved Zuper crew names; excluded RTB-Blocked from schedulable (#382)

### Sales Product Request (Major)
- New rep-facing Sales product request page — equipment + adders submitted to a single Tech Ops queue, dual-write to catalog + OpenSolar flag (#377)
- Datasheet auto-extract for new equipment requests
- DealSearchField combobox replaces raw deal-id input on both forms (#379)
- Optional "estimated cost per unit" (equipment) and "our cost" (adders) pre-fill reviewer drawers
- `force-dynamic` + email from requester; CDN cache excludes auth-gated pages (#380, #381, #384)

### Product Catalog — Phase B Operational + Hardening (Major)
- Auto-add unknown brands to HubSpot manufacturer enum + notify TechOps (replaces Phase C block-and-prompt) (#410)
- Phased HubSpot manufacturer enum enforcement (Task 2.4)
- Switched Zoho writes from `group_name` to `category_id` (drives the actual Zoho category UI; M3.1)
- Plumbed spec-derived custom fields on Zuper product create; route spec changes via `meta_data` on update path (M3.4, #413)
- Pass dimensions on Zuper product create
- HubSpot manufacturer enum + Zoho categories operational (added 31 brands incl. IronRidge, Square D, Siemens, Eaton, Unirac)
- Sync observability: enums, watermark columns, ActivityLog wiring on Sync Modal + push approval (Tasks 1.3/1.4)
- Race-safe external-record create + link-back; cross-link writer extracted to shared helper
- Zoho orphan reconciliation: 302 new InternalProducts created from existing Zoho/Zuper data; 311-row CSV exported for review
- Phase B data hygiene: test-product cleanup, casing fixes, "Generic" rebrand
- Push product photo to Zoho Inventory on approval (#396); description + part_number propagated on item update (#401)
- Backfill script for Zoho item images from historical pushes (#398)

### SOP System Expansion
- Role-gated SOP tabs and sections — `TAB_ROLE_GATES` + `SECTION_ROLE_GATES` stop team-specific content from leaking to other teams (#421)
- Multi-role users get the union of permissions; `/api/sop/tabs` runs `canAccessSection` per section
- New Suites tab — overview + per-suite SOPs (#415)
- New Tools tab — BOM + AI Design Review, expanded with Pricing, P&I Hubs, Surveyor, Schedule, Optimizer, Map (#416, #417)
- New Action Queues tab + Tools extensions for Workflow Builder, Property Drawer, Deal Detail, Equipment Backlog (#418)
- New Executive + Accounting + Sales & Marketing tabs (role-gated) (#422)
- Batch SOPs added: Catalog, Service, Scheduling, Forecast, AHJ & Utility (#414)
- "Submitting a New Product" SOP for ops tab (#412)

### IT / Compliance Endpoints
- Read-only `/api/it/activity-log` export API for IT team aggregation (#298)
- New `/api/it/audit-sessions` (session-level facts, filterable) (#402)
- New `/api/it/anomaly-events` (risk-scored rule hits / SIEM feed)
- New `/api/it/user-roster` endpoint
- All gated behind `IT_EXPORT_TOKEN` bearer via middleware

### Compliance v2
- Per-service-task scoring (PV Install, Electrical Install, Loose Ends) — PV crew no longer penalized for battery/electrical delays on the same job (#369)
- Status bucket fixes: Return Visit Required, Loose Ends Remaining
- Union of `service_task.assigned_to[]` and form submission `created_by` as credit set with 1/N fractional attribution
- Flag-gated rollout

### Schedule Event Log
- New `ScheduleEventLog` captures Zuper reschedules and crew changes that bypass the Photon scheduler (#399)
- Closes a gap where 5 of 6 of one tech's recent jobs had no `ScheduleRecord` because dispatchers schedule directly in Zuper

### On-Call Schedule
- Trial schedule: weeks now run Sunday → Saturday (was Mon → Sun) (#409)
- Weekday on-call window: 6:00 PM → 10:00 PM (was 5:00 PM → 7:00 AM next day)
- Weekend on-call window: 8:00 AM → 12:00 PM
- May trial seeds shifted by one day to align with new week boundary

### Bug Fixes
- BOM: include `suggestedAdditions` when building Zoho SO line items (#370)
- Cache: reorder headers for no-cache override; exclude auth-gated product-request pages from CDN cache (#381, #383)
- Pricing: clarified `DC_QUALIFYING_MODULE_BRANDS` empty-by-design (#420)
- Activity log: `getActivityTypes` now includes all enum values
- Catalog activity log: split `notImplementedCount`, add `userName/source` to update helper
- Map: timezone-agnostic date comparison, RTB-Blocked exclusion, real office addresses

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
