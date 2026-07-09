# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-06-16

### PE Document Tracker (Major)
- Consolidated into a single PE dashboard ("the hub") — retired the separate pe-report behind admin
- Documents tab redesign: collapse-by-default across Sections, By-Team, and Deals views with less visual noise
- By-Team view: bucket filter + collapsible status sections, sub-group doc counts on collapsed rows, deals + docs counts on bucket chips
- By-Team grouping into Rejected / Action Required / Not Uploaded; "Rejected" later folded into a unified summary
- By-Team deals now show all outstanding docs inline (no per-deal expand)
- Per-doc blocker notes replaced with deal-level "PE Info Needed" status; M1/M2 milestones gained editable "Waiting on Information" reason
- Manual "Sync now" button + auto-waive of moot docs on done milestones
- Retired the PE portal scraper webhook — it was corrupting doc statuses

### PE Analytics (Major)
- "By Document" view on the Docs page — Missing + Open Rejections per doc
- Doc Rework folded into a unified Analytics section (dropped standalone tab)
- Rejections-by-Document drill-downs split into open / resubmitted / approved
- Doc Uploaders: Owner ⇄ Shared credit toggle (fractional by version), Owner/Fractional toggle for Approved-$
- Uploads Explorer: filter Doc Uploaders by document + uploader with drill-downs everywhere
- Click an uploader's chart segment to drill into that day's docs
- Doc Uploaders timeline segmented by doc type with month axis and multi-select
- Copy/CSV buttons on Analytics drill-down lists
- Daily snapshot of Document Tracker card metrics + trend history
- Misc analytics fixes: Paid $ split, Missing-by-Document, short-pay fix, day-scroll, open-only notes

### PE Revenue Tracking
- Recorded short-pays so PE Revenue Collected reflects actual dollars
- Wired short-pay correction into the hub's Deals & Payments tab

### PE Photo Submission Skills & Builder
- New self-serve Photos-per-Policy builder (web tool)
- New PE photo-submission skills: final-permit and policy-photos
- PE Photo Builder resolves by PROJ number or customer name
- Fixed policy-photos over-filtering — keep all required shots, label each page

### Tech Ops Bot (Major)
- New proactive daily digest DM'd to the owner
- Scoped daily digests posted to team Google Chat rooms
- Tailored per-room digests (intro, sections, content focus)
- `?preview=1` query param renders digests without posting
- Real fleet schedule pulled from `ScheduleRecord` (replaces calendar stub)
- New `get_project_team` and `get_project_service` lookup tools
- Rotating "thinking" ack messages
- Tasks assigned to a named person + smarter task-vs-process-request judgment
- Idempotency keys resolved + honest process-request email status reporting
- Fixed: stuck-deals section empty (filter to active stages), fleet schedule filtered by deal `pb_location` (not BookedSlot), room name match handles parenthetical suffixes, `/api/cron/tech-ops-bot-digest` allowed through middleware, stop implying Zach is out of office

### D&E Funnel
- Status Funnel rendered as a branch/tree
- New "Awaiting Site Survey" bucket; completed revisions are now dulled

### Bug Fixes
- Excluded reverted status flips from PE submission counts
- Dropped phantom action-resolutions from uploader stats and relabeled "Unknown"
- Excluded moot docs from Missing-by-Document
- Removed unused `sel` var that broke the production build

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
