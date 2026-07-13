# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-07-12

### Ready to Build Review Queue (Major)
- New RTB Review Queue with status labels, deal stage, and PM/location filters
- "Ready to Build" tab surfaces released deals; "Released" now reads `pm_rtb_approved_date` instead of the boolean flag so re-blocked deals correctly read un-released until Release is pressed again
- Editable RTB-Blocked notes with clarified header and RTB-Blocked PM review gate
- Columns: project type, revenue, payment method, loan status, earliest install availability, IC status, permitting status, PM names, DA Paid, days-in-stage, always-visible line items, deal/drive links
- Sortable un-merged columns; condensed layout from 17 → 11 columns, compressed table width
- Semicolon-separated project types now stack one per line

### PowerHub / Tesla Fleet Monitor (Major)
- Sortable columns, filters, and CSV export on the fleet monitor
- Info columns, voltage-based grid cell, and Active Alerts toggle on the fleet table
- Grid status now derives from grid voltage instead of the dead `grid_connected_status` signal
- Tesla concern ticket links and customer column; inline alert names + open-ticket links
- Capture Tesla RMA severity and stop dropping unmapped alerts; refresh severity on existing alert rows during poll
- Live HubSpot label resolution (deal names, ticket subjects, contact names, stage labels)
- Customer resolution via `PropertyDealLink` for GEO-linked sites
- Calm UI — stable rows, customer-first identity, visible sort
- Persist Tesla token in `SystemConfig` to stop token-endpoint throttling

### Bot (Slack AI) (Major)
- `query_projects` — one general deal query, replaces `list_deals_by_status`; multi-pipeline, two-level grouping, date filtering, and `includeReason` for bulk state reasons (no per-deal fan-out)
- `query_jobs` — general Zuper field-job query for deeper Zuper access
- `get_deal` returns full labeled status snapshot (incl. DA/`layout_status`), exposes sales-change / rejection reason note, and answers "why is PROJ-X `<any state>`" from the real reason fields
- PE payments, revenue goals, and exact stage-revenue tools; real week-by-week PE payment breakdown (stop fabricating); PE $ uses payment amount, not deal amount
- Filter stage/status counts to Participate Energy deals; order stage breakdowns by pipeline sequence, not by size
- Mirror live personal worklists to the owner tracking space; add revisions + final design reviews to design worklists
- Chat polish: no markdown tables (use monospace code blocks), help/menu reply, one clean final answer (no drafting narration), neutral metric commentary, close-out vs. closed vocab
- Fixes: cross-question list contamination, mid-list doubt, truncation; replies no longer truncate mid-content (max_tokens + chunk long messages); never fabricate a breakdown from an aggregate
- Prompt-cache the system prompt + tool schemas (`toolRunner`) for lower latency
- Force-provision bot DMs via domain-wide delegation; capture user DM spaces for personal worklist delivery
- Bot message audit log, personal deep-links, compliance rework, worklist-first tab; routing, resolver, conversations tab, perf, weekday personal-worklist cron
- Real-time bot usage mirror to the tracking space

### Bottleneck Monitor (Major)
- Age/volume/flow engine, dashboard, and bot digest
- v2 with stalled vs. zombie classification, owner rollup, and real activity signal
- Bottlenecks tab on the project pipeline funnel page
- Digest polish — hyperlinked deals, team worklists, personal DMs, presets

### Team Activity / Report Cards
- Weekly report-card email digest
- Tasks/day + Property updates/day metrics; deals-touched per day
- Copy-paste report card format; PE uploads count as deal touches
- Exclude PTO days (calendar OOO) from averages
- Drop integration-app Drive events from the Google source

### Participate Energy (PE)
- Track PE Change Orders as a conditional document
- Milestones tab buckets by document state
- Exclude `NOT_REQUIRED` docs from the doc-approval-rate denominator
- Trim resurfaced rejection notes to the current review cycle (doc + team paths)
- Ready-view stat cards now match their drill lists
- PE AVL dashboard opened to all roles

### IDR (Initial Design Review)
- New Construction and D&R/Service review types in the IDR meeting hub
- Escalation photo attachments; escalation photos shown above site photos in the detail panel
- Customer name shown for Service/D&R deals in the meeting queue
- Restored escalation gallery + D&R/Service pills clobbered by #1356

### On-Call Scheduling
- Allow swaps any distance out; swap whole week blocks
- Swap picker shows one row per week with full date range
- Email notifications for the swap lifecycle; real emails for the PTO lifecycle (replaces notification stubs)

### Admin Workflows
- `create-zuper-job` action with full Tray parity; job links to the deal's Zuper project
- Property-change webhook feed; accepts `propertyName`/`value` via query params
- `service-task` entries enriched from the master record

### Scheduler / Portal
- Close customer survey invite when ops books via the app
- Block survey double-bookings at booking time and on customer book/reschedule
- Double-book guard no longer falsely blocks surveys behind multi-day installs
- Kill switch for customer-facing survey portal emails

### Funnel / Pipeline
- Blocked toggle + waiting-since/scheduled dates in drill-downs
- Drill-down polish; Sales Funnel defaults to This Year
- "Hide cancelled" toggle (mirrors on-hold/rejected)

### Production Check
- Production-guarantee fix verification & approval workflow
- Task creation now passes the required due date

### Service
- Score ticket age in the priority queue
- Type dropdown filter on the service overview header
- Priority-queue overrides restricted to ADMIN only

### Worklists
- Manager rollup worklists — e.g. Ben gets all DAs pending sales changes
- Ops first on the bottlenecks worklist page

### Zuper
- Stamp `job_timezone` so CA customers get Pacific-time notifications
- Stop attaching the demo customer to created jobs

### Infrastructure & Fixes
- Repoint `HubSpotProjectCache` readers to the Deal mirror table
- Middleware: allowlist `zuper-field-activity-sync` + `product-sync` crons; never cache role-denial redirects
- Weekly Neon preview-branch sweep cron to cap extra-branch cost
- Blank crew `zuperUserUid` no longer matches every survey in conflict scan
- Vishtik: offset pagination for Get-Project lifts silent ~2,280-row fetch cap
- Build: move `fetchPipelineDeals` to a server-only module (unbreak client build)
- Deals scheduler/IDR "Deal" buttons link to HubSpot, not internal page
- Patched runtime dependency vulnerabilities

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
