# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-04-22

### Accounting Suite & Payment Tracking (Major)
- New Payment Tracking dashboard with per-project DA / CC / PTO + PE M1 / PE M2 milestone progress
- New ACCOUNTING user role scoped to the Accounting Suite (migration + allowlist)
- Split into two dedicated pages: Payment Tracking (status) and Payment Action Queue (what to invoice next)
- HubSpot invoices attached to payment rows, matched to milestones by line item name (incl. PTO + PE)
- Ready-to-Invoice attention signals derived from project-stage triggers
- 5-section groupings with filters restored; sortable columns; stage-phase pill
- Active-only filter + per-pipeline `Eq` filtering (replaces incorrect `In` behavior)
- PE deals hero cards refresh: Ready to Invoice, collected / outstanding subtitles
- Outstanding = invoiced-but-unpaid only; % collected uncapped for over-collection visibility
- PE treated as a portion of `deal.amount`, not additional revenue; PTO milestone is non-PE only
- Bug fixes: appCache wrapper unwrap, % collected showing 0 when fully paid, tooltip amounts, stage labels

### Customer-Facing Solar Estimator v2 (Major)
- Phase 1 rebuild: shared pure-function pricing/production engine + public New Install flow
- Five quote-type flows: Solar, EV, Battery, Battery Expansion, D&R
- Ported pricing + production config from the original estimator
- Iframe embed mode with customer-facing page title; internal widgets suppressed
- Slimmed HubSpot property writes from 14 → 3
- Google Places autocomplete reliability: fallback to `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, typed-address fallback when `place_changed` misses, cross-flow nav fixes
- Continue-button race resolved via `flushSync` + hydrated gate; visual polish pass

### My Tasks & Freshservice Integration (Major)
- New `/dashboards/my-tickets` page for non-IT staff showing tickets they filed as requester
- My Tasks: snooze, inline create, completed-this-week view, bulk mark-done
- Inline status + queue edit, keyboard shortcuts, URL state sync, count badge
- Typeahead lookups + "New Task" from deal panel; autofocus first row; admin-managed queue names
- Freshservice: show tickets assigned to current user (not filed by), name-lookup fallback when email mismatch
- Include Closed tickets + Closed filter chip; hide overdue on Resolved/Closed
- Keyboard-focused row visibility + `useSearchParams` Suspense wrap

### Roles Phase 1 — Scoped Suite Roles
- Added 6 scoped suite roles: DESIGN, PERMIT, INTERCONNECT, INTELLIGENCE, ROOFING, MARKETING
- New Sales & Marketing suite
- 4-phase migration plan from monolithic TECH_OPS → split DESIGN / PERMIT / INTERCONNECT
- Post-Phase-2 admin cleanup: legacy users pruned, admin section split, followups doc added

### Scheduler & IDR Meeting
- Scheduler day-cell availability count now filtered by project location
- CA site-survey availability revised with cross-office block support
- IDR meeting view: survey Zuper link, design approval status, tag fix

### UI, Branding & Home
- Rebranded "PB Operations Suite" → "PB Tech Ops Suite"
- Home page stripped of curated dashboard stack; suite cards only
- HubSpot portal labels now rendered for `design_status` and `layout_status`

### Bug Fixes
- Bug report email: added optional `type?` to `SendBugReportEmailParams` (unstuck prod build)
- Audit: userId attribution on activity events; feedback form adds "feature request" option
- Executive suite link restored

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
