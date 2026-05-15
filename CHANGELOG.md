# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-05-15

### Property Hub (Major)
- Full-page property view at `/properties/[id]` with tabbed layout: Activity (unified timeline), Deals, Tickets, Zuper Jobs, Schedule slots, and Equipment/BOM history
- Single API route with per-tab data loading and fan-out caps to stay within HubSpot rate limits
- Inngest queue for property sync workflows (`INNGEST_PROPERTY_SYNC_ENABLED`) — global concurrency 3 + 3 retries, eliminates 429 cascade during bulk HubSpot workflow re-enrollment
- Three-tier dedup (placeId → normalizedAddress → street components) with adopt-and-enrich for bare HubSpot Property records; cleanup script archives ~41K bare duplicates
- Input validation: CO/CA only, reject streets containing emails/URLs/domains/numeric-only fragments
- Property drawer now shows resolved deal names, ticket subjects, and contact names with HubSpot deep links
- Fixed satellite map (corrected env var to `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`), deal stage names via `getStageMaps()`, flexible ID lookup accepting both `hubspotObjectId` and Prisma cuid
- Correct USER_DEFINED association type IDs for Property object (contacts:399, deals:403, tickets:401, companies:397)
- Accept HubSpot native webhook payload format in workflow-sync; ticket address fields use `street_address`/`city`/`state`/`zip`

### Pipeline Trackers (Major)
- New general Pipeline Tracker dashboard (Construction, Inspection, Site Survey tabs) — removed M1/M2 columns from PE-specific tracker
- Per-stage revenue breakdown in PE Pipeline hero cards + total revenue hero card
- Status filters split into per-type filters with sortable columns
- Zuper job links on both trackers, paginated HubSpot search to handle large result sets
- Cross-linked navigation: Pipeline Tracker ↔ PE Pipeline page

### PE / Accounting
- PE Raceway API sync replacing fragile HTML scraper — typed client (`pe-api.ts`), cursor pagination, retry with backoff
- New `PeActionItem` + `PeApiSyncRun` models; hourly cron + incremental sync
- PE action items feed grouped by deal with clickable HubSpot + PE Portal links; collapsible deal groups; auto-resolve on doc approval
- Moved PE doc reviews and action items from ops pipeline to accounting `pe-deals` view
- Sync status accuracy: stopped false APPROVED state with source priority resolution
- Recurse into subfolders when auditing PE turnover Drive folders

### TV Dashboard / Office Performance
- Rich deal list with assignees, Zuper status, PE flags, deal amounts; merged in-progress + completed into unified sorted list
- New Service carousel slide for office performance dashboards
- Calendar week/day views, improved readability
- Stacked deal lists above compliance block; fixed goals labels, completed deal counts, "inspections" rename
- 5-star review goals lowered to 20 base / 25 stretch company-wide
- Assignees now display on all calendar event types

### Schedulers
- Tentative vs live mode now visually obvious across all schedulers
- Allow tentative install scheduling without an assignee
- Survey lead time relaxed to 1 day for California sales reps
- Fixed cross-deal sub-job bleed on same-customer projects
- Renamed legacy sub-job badge "ALL" → "CONST"

### Reviews / Design
- Escalation revisions now trigger as-built design status
- IDR sync completes the HubSpot task and adds a RE-REVIEW badge
- Show escalation submitter in IDR detail panel
- AI design review no longer flags utility meters as production meters
- Concatenated revision notes are now labeled for clarity

### Service
- Service deal BOMs now appear in the Service BOM history page
- `pb_location` read directly from service tickets (no more deal fallback)

### Bug Fixes
- Corrected `HubSpotProperties` type to accept null values
- Fixed email addresses for Nathan and Nick

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
