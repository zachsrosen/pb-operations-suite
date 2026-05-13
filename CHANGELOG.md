# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-05-12

### Pipeline Trackers (Major)
- New general Pipeline Tracker dashboard surfacing deals across Site Survey, Construction, and Inspection stages
- PE Pipeline Tracker dashboard with total revenue + per-stage revenue hero cards
- Construction and Inspection status columns on PE Pipeline Tracker
- Tabs added for Site Survey, Construction, and Inspection on the general Pipeline Tracker
- M1/M2 columns removed from PE tracker; Contact column removed from both
- Status filters on both pipeline trackers, split into per-type filters for finer control
- Sortable status columns on both pipeline trackers
- Cross-links between PE Pipeline page and Pipeline Tracker
- Pipeline tracker APIs paginate HubSpot search to handle large pipelines
- Tracker descriptions updated to include site survey scope

### PE Document Tracker (Major)
- New PE Document Tracker dashboard at `/dashboards/pe-docs` with IC/PC document breakdown
- Inline document breakdown on PE Deals rows; traceable IC/PC breakdown with reconciliation bar
- PE deals doc breakdown + invoice audit + email sync
- Under Review hero card on PE doc tracker
- Approval rate now counts only decided docs (excludes Under Review)
- PE Report cleanup: doc grouping, per-section stats, table totals
- Deal-reader exposes `pePortalUrl` / `peProjectId` and additional PE fields
- PE notification sender corrected from `noreply@` to `ict@participate.energy`

### Payment Timeline (Accounting Suite)
- New Payment Timeline dashboard for the Accounting suite
- Payment volume bar chart with day/week/month toggle
- Fix: payment timeline rendered no payments because of null date fields
- Fix: payment volume bars invisible due to `items-center` collapsing height (now `items-stretch`)

### IDR Revision Workflow
- IDR revision workflow: re-review toggle, auto-appear on revision, revision reason sync
- IDR sync now completes the linked HubSpot task and adds a `RE-REVIEW` badge
- AI design review no longer flags utility meters as production meters
- Use HubSpot internal value for `design_status` auto-advance

### TV Dashboard
- Rich deal list with Zuper status, PE flags, and unified layout
- Stack deal lists above the compliance block for readability
- Completed deals shown; goals labels and inspections terminology updated
- Calendar week/day views and overall readability improvements

### Weekly Goals Digest
- Weekly goals digest email — one per office, with BCC to Zach
- Suppress zero-delta entries when no prior snapshot exists
- Lower 5-star review goals to 20 base / 25 stretch company-wide

### Zuper Drift Compliance
- New PM dashboard for Zuper↔HubSpot status drift
- Per-sub-type evaluation + `install_status` rollup integrity check
- Cron `LOOKBACK_DAYS` dropped 90→14 to stay under the 60s Vercel budget

### Operations Suite
- New Design & Ops Meeting Hub added to the Operations Suite
- Show assignees on all calendar event types (not just installs)

### Catalog & Shared Inbox
- Catalog writes Zuper cross-link IDs via `meta_data` instead of `custom_fields`
- Shared inbox OAuth connect now requests `openid` + `email` scopes
- `tpo@` added to the shared inbox connections admin page

### Bug Fixes
- HubSpot properties type accepts `null` values (matches API responses)
- Removed unused `DashboardLocationGroup` import that broke the build
- Redeploy chore to pick up `ZUPER_RECONCILE_ENABLED=true`

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
