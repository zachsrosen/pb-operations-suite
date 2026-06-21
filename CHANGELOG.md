# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-06-11

### Tech Ops Bot / Google Chat Assistant (Major)
- Google Chat OOO bot launched, then rebranded internally to Tech Ops bot as scope grew
- HubSpot task creation from chat — resolves deal by PROJ-XXXX, customer name, or address; assigns to requester via shared resolver
- `count_deals_by_status` tool — DA, design, permitting breakdowns with true stage counts
- Full-pipeline status coverage — construction, inspection, PTO, M1/M2 milestone breakdowns
- DA lifecycle phases encoded (Review In Progress = pre-send); leads with `waitingToBeSent` for DA questions
- `log_correction` tool — captures in-chat corrections for admin review
- Process-request filing replaces OOO framing; conversation history scoped by space (not thread)
- Replies posted to main timeline; supports Google Workspace add-on envelope format
- Base64-encoded service account key support; async error capture to DB

### Admin Bot Escalations & Corrections
- New admin dashboard: Bot Escalations review with Corrections tab
- "Apply to Playbook" button promotes in-chat corrections into prompt rules
- Data-integrity prompt rule prevents fabricated task creation

### Project Pipeline Funnel & Monthly Activity (Major)
- Executive Project Pipeline Funnel — 9-stage sales-to-construction view with cohort table, conversion arrows, named timeframe presets, hero/matrix layout
- Monthly Activity throughput dashboard with sortable backlog columns
- Per-stage revenue, Closed Out/Cancelled accuracy, PM/owner filters, trend vs prior period, URL state, by-location hero matrix
- Interconnection now shown as parallel workstream (throughput + backlog IC status columns)
- Fix: cancelled deals no longer counted as having reached every funnel milestone
- Fix: row-boundary conversion reset and correct Ops Lead owner ID

### PE Doc Tracker, Digest & Cross-Reference (Major)
- `/dashboards/pe-docs` — PE Document Tracker dashboard with Under Review hero card and inline document breakdown on row click
- PE doc status mirror digest email with actionable sections, Drive folder links, "time since last update"
- Instant email notification on PE doc status changes
- Two-way PE document status sync with HubSpot deal properties
- `UPLOADED` + `UNDER_REVIEW` merged into a single "In Review" status
- "By Team" view now only shows actionable deals; collapsible sections
- PE-doc-digest restructured into 4 actionable sections; drops "Today's Changes"
- PE Action Tasks Cross-Reference (MVP): `HardwareAnalyzer` (PowerHub vs nameplate mismatch), `SalesOrderAnalyzer`, `PlansetAnalyzer`, `InboxScanAnalyzer` (find PE docs in shared mailboxes); auto-trigger after PE audit
- PE Approved Vendor List dashboard

### PE Prep / File Preparation (Major)
- PE File Preparation pipeline: AI vision audit, PandaDoc auto-pull, prep dashboard
- PE audit split into independent docs + photos pipelines with separate timeouts
- Deep PE verification for photos and documents
- PE vision classifier with few-shot reference library + AVL cross-check
- Surfaces all Zuper photos on PE Prep detail page
- Clickable PandaDoc links on PE prep page
- PE Submission Gap report — CC-hit deals with incomplete M1/M2; M1 includes Close Out; Complete tab
- PE Prep landing page with deal queue + audit history overlay

### PE Pipeline Tracker (Major)
- `/dashboards/pe-pipeline` — multi-stage tracker with sortable status columns, per-type filters, IDR re-review badge
- Per-stage revenue hero cards; total revenue hero
- Construction/Inspection/Site Survey tabs added to general pipeline trackers
- IDR sync completes HubSpot task; RE-REVIEW badge; revision workflow with reason sync
- Zuper job links on both pipeline trackers; sortable status columns

### Tesla PowerHub Integration (Major)
- Cross-system Tesla portal URL linking (HubSpot + Zuper + Suite)
- HubSpot UI Extension card + compact sidebar variant — production, battery SoC, device serials/models, portal link
- Full Tesla telemetry capture with alert metadata
- Every Tesla device on site surfaced with part # / serial # to HubSpot Property/Job in Zuper
- Geo-coordinate matching via portal-imported lat/lng
- `import-locations` route supports `API_SECRET_TOKEN` auth

### Enphase Enlighten Integration (Major)
- Full-parity Enphase integration alongside PowerHub (see §12 Major Systems in CLAUDE.md)
- OAuth2 with DB-persisted refresh token rotation; Partner OAuth setup flow for installer auth
- Fleet discovery (daily), telemetry snapshots (15 min), status health check (30 min) crons
- HubSpot card with production, battery SoC, micro health, portal link
- Address-hash auto-linking to Properties; cross-system push cascade

### HubSpot Property Custom Object (Major)
- Custom HubSpot Property object anchoring deals, tickets, contacts, equipment to canonical addresses
- One property per normalized address with SHA-256 `addressHash` + optional `googlePlaceId` dedup
- Webhook-driven sync from contact address changes → geocode → resolve geo links (PB shop, AHJ, utility) → upsert property → associate links → compute rollups
- Cache mirror (`HubSpotPropertyCache`) + link tables with ownership labels (Current/Previous Owner, Authorized Contact)
- Nightly reconcile cron (drift repair) + resumable 4-phase backfill script with DB-tracked progress
- Inngest queue for property sync workflows
- Two feature flags: `PROPERTY_SYNC_ENABLED` (kill switch) and `NEXT_PUBLIC_UI_PROPERTY_VIEWS_ENABLED` (UI surfaces)

### Property Hub UI
- Full-page property view at `/properties/[id]`
- Photos tab with Zuper job photos
- Header enriched with equipment summaries, revenue, Zuper link
- Activity tab with engagement metadata
- HubSpot + Zuper external links on tabs
- Zuper Property sync (write direction); auto-associate properties with customer on create/update; link Zuper projects to properties during sync
- `<PropertyDrawer>` slide-in detail wired on Service Suite customer-360, deal detail address row

### Admin Workflow Builder (Major — Phases 1–16)
- Visual workflow builder for chaining existing/new actions into automated sequences (see §11 Major Systems)
- Inngest runtime; one file per action with `kind`/`fields[]`/`inputsSchema`/`handler`
- 10 production actions + 2 control-flow kinds (delay, stop-if); for-each loop and parallel control-flow
- Triggers: `MANUAL`, `HUBSPOT_PROPERTY_CHANGE`, `ZUPER_PROPERTY_CHANGE`, `CRON`, `CUSTOM_EVENT`
- Template library + export/import workflow JSON + duplicate workflow
- Editor UI with drag-to-reorder, visual canvas preview, step output drill-in
- Per-run detail page, cross-workflow run history page, analytics dashboard
- Workflow versioning (snapshot on save + rollback), per-workflow rate limiting, dry-run mode
- Action-level idempotency for create-actions; DB-checkpoint best-effort idempotency
- Webhook fan-out for HubSpot + Zuper triggers; Inngest auto-sync on deploy + manual resync
- Dynamic option re-fetch, unified property options, select/multiselect dropdowns
- Failure alerts + Zuper property discovery; `http-request` + `find-hubspot-contact` actions
- Feature flags: `ADMIN_WORKFLOWS_ENABLED`, `ADMIN_WORKFLOWS_FANOUT_ENABLED`

### IDR Meeting Hub
- BOM Review & Line Item Editor — full pricing breakdown with mismatch detection, adders checklist, sync to HubSpot on manual + auto-sync
- Previous review notes for re-reviews + richer search results
- IDR Meeting Search History dashboard
- Recovery from accidental "End without syncing" + two-click confirm
- Sales folder, PM task on sync, open-all links; drop needs-resurvey UI
- Scope start meeting to Colorado, California, or all locations
- Survey Zuper link + design approval status surfaced

### Deal Detail Page (Major Redesign)
- Read-only deal record view at `/deals/[dealId]`
- 3-tab layout (Overview / Activity / Communications) with collapsible site photo gallery
- Activity Feed with pagination, note composer, Zuper job notes + HubSpot tasks
- Communications Feed (HubSpot engagements, contact-associated emails)
- Composite-cursor timeline pagination
- `DealNote` model for internal deal notes; background HubSpot + Zuper sync
- Human-readable labels in sync changelog diffs (FIELD_LABELS map)
- Zuper status history, BOM, schedule timeline fetchers
- Internal Deal link added alongside HubSpot/Zuper links across scheduler family + UI surfaces

### Multi-Role Auth Phase 1 (Major)
- `User.roles: UserRole[]` array model — Phase 1 migration complete (legacy `User.role` pending manual drop)
- 6 scoped suite roles added: DESIGN, PERMIT, INTERCONNECT, ROOFING, MARKETING, SALES_MANAGER, SALES, ACCOUNTING, INTELLIGENCE, SERVICE
- Sales & Marketing suite added; suite switcher visibility per role
- Runtime-editable role definitions (routes, landing cards, suites)
- Per-role capability overrides + per-user extra route grants
- Read-only Role Inspector at `/admin/roles`
- Super-admin break-glass safeguard + SUPER badge in UserMenu/admin user list
- ACCOUNTING role with Payment Tracking dashboard
- Redirect to last page after login
- Home page redesign for multi-role users
- Admin impersonation now uses `pb_effective_roles` JSON array cookie (legacy single-role cookie removed in Part 2B)

### Admin Shell & IT Endpoints
- Unified `AdminShell` + single `/admin` landing with in-shell search; consolidates `/suites/admin`
- Admin Shell primitives — table, filter bar, detail drawer, bulk action bar, form, kv grid, detail header
- Exit affordances — back-to-home link + UserMenu in admin shell
- IT endpoints: audit-sessions, anomaly-events, user-roster, read-only activity-log export

### Office Performance TV Dashboards (Major)
- Per-location TV carousel with 7 slides (Surveys, Installs, Inspections, Pipeline, Team Results, Goals, Office Calendar)
- All-locations overview at `/office-performance/all` + carousel slide
- Visual upgrades: CountUp, ProgressRing, AnimatedBar, AmbientBackground, metallic podium leaderboard
- Per-person metrics, streaks, achievement callouts; PM/designer/owner leaderboards
- Live Zuper compliance metrics (replaces cache); OOW usage %; deal drill-down lists
- SLO + Camarillo combined into single California dashboard
- Service carousel slide added; Roofing + Other Zuper jobs visible
- Live clock replaces static "Updated" timestamp

### My Tasks (Personal HubSpot Tasks)
- Personal HubSpot tasks dashboard
- Snooze, create, completed-this-week, bulk done, mark complete, sort modes
- Deal-stage filter, inline status + queue edit, keyboard shortcuts, URL state
- Typeahead lookups + New Task from deal panel
- Autofocus first row; admin-managed queue names
- Explicit HubSpot owner link per user

### Permit Hub & Interconnection Hub
- `/dashboards/permit-hub` two-pane workspace for permitting team
- Shared inbox thread fetch on correspondence tab
- Per-inbox OAuth workaround for blocked DWD scope
- Resolved names + header quick-links + AHJ fallback
- Interconnection Hub v1 (`/dashboards/ic-hub`)

### Jobs Proximity Map (Phases 1–3)
- Installs + service + crews on map; Week/Backlog views; tickets, inspection, survey markers
- Project numbers, richer info, D&R + roofing markers, shop filter
- Dispatcher office pin + morning briefing + nearby highlights
- Assignee filter; scheduled-today markers never cluster
- Call + add-note quick actions

### EagleView TrueDesign Auto-Pull
- Full pipeline (Tasks 1–9) — auto-pull stamped report when deal closes
- EagleView Orders dashboard page
- Sandbox integration test page for Go-Live proof
- Solar Surveyor renders `EagleViewPanel` when `?dealId=` URL param is set

### Catalog / Inventory / Sync
- Auto-add unknown brands to HubSpot manufacturer enum + notify TechOps
- Phased HubSpot manufacturer enum enforcement
- Zoho writes switched from `group_name` to `category_id`
- Spec-derived custom fields plumbed on Zuper product create; dimensions passed through
- Sync observability — ActivityLog hooks, watermark columns, `catalog-activity-log` helpers
- Sync Modal executions logged to ActivityLog

### SOP System
- WYSIWYG editor (TipTap) replaces raw HTML CodeMirror
- Tech Ops tab split into Design / Permitting / Interconnection
- Submit-a-new-SOP feature with admin review queue
- Drafts tab with PM Guide rewrite + Pipeline Overview
- Auto-link `<code>/route</code>` mentions to actual app pages
- Hub-mode visibility flip — open by default

### On-Call Electrician System
- V1 weekly rotation + self-service swaps + merged Colorado pool
- Sun-Sat → Monday-start weeks (June); 6pm–10pm weekday / 8am–12pm weekend shifts
- Per-state Google Calendar; stage calendar without invites then flip on
- Electrician self-service swap UI
- Admin/executive Activity view — all swap + PTO requests
- Admin call logging and HR sheet export
- Emergency call log captured by on-call electricians
- Drop California Sunday coverage

### PM Accountability & Flags
- PM Accountability dashboard + weekly digest (Phase 1)
- Exception-based PM assignment system
- Live mode — page-load eval replaces daily cron
- HubSpot deal links + owner-id assignment fallback + missing-PM seed
- Project Management Suite landing page

### Accounting Suite
- Split into Payment Tracking + Payment Action Queue pages
- Invoice-first bucketing + three new accounting pages
- Ready-to-invoice attention signals from project triggers
- HubSpot invoices attached to payment-tracking rows
- "Not Invoiced" column on Payment Tracking row
- Preset date-window filter + invoice dots link to deal
- Payment Timeline dashboard + payment volume bar chart with day/week/month toggle
- PE deals: refresh hero cards with Ready to Invoice + collected/outstanding subtitles
- PE deals: Approved split into Fully + Partially Approved; Awaiting PTO segment; Pre-Construction vs Construction+ split
- PE deals: multi-column sort, Customer Paid? column, Cancelled excluded, Other → On Hold rename
- Pricing Calculator moved from Accounting to Sales & Marketing

### Solar Estimator v2 / Customer Estimator
- Customer-facing solar estimator v2 (Phase 1)
- All 5 quote-type flows (Solar, EV, Battery, Expansion, D&R)
- Pricing + production config ported from original estimator
- Slim HubSpot properties (14 → 3) + iframe embed mode

### Adders Catalog & Triage
- Governed Adder Catalog with `/dashboards/adders` UI
- Triage recommendation engine + `/api/triage/*`
- Rep-facing mobile triage UI + deal-detail embed
- OpenSolar sync scaffold behind kill switch
- Sales product request page (equipment + adders → OpenSolar) with cost estimates + deal lookup

### Production Issues / Design Suite
- Production Issues dashboard added to Design suite
- Flag Project button and inline unflag action
- Escalation revisions trigger as-built design status
- Compare planset layout against DA layout in design review

### Weekly Shop Health Dashboard (Major)
- Per-shop weekly health metrics with drill-down tables on all count-based metrics
- Customer Success section with sentiment scoring + 5-star reviews + response time drill-downs
- Preconstruction throughput and cycle times
- Multiple bottleneck entries per shop per week
- Revenue hero card + pipeline revenue detail
- Targets derived from revenue goals (not crew capacity)

### Page Traffic Analytics
- Admin Page Traffic dashboard — views, dwell time, dead-weight pages, per-user breakdown

### Compliance v2 / Zuper Drift
- Per-service-task scoring + status bucket fixes (flag-gated)
- Zuper↔HubSpot status drift PM dashboard
- Per-sub-type evaluation + `install_status` rollup integrity check
- ScheduleEventLog — captures Zuper reschedules and crew changes

### Shovels API Property Enrichment
- Permits, residents, contractors enrichment via Shovels API

### Tools
- TSRF Peak Power Calculator in D&E + Service suites

### Site Survey Readiness & FDR Webhook
- Site survey readiness checker
- FDR webhook integration

### EOD (End-of-Day) Email
- Cron route + HTML email builder; idempotency, snapshot diff, task query
- Per-person change count + task count
- HubSpot completed-task search for tracked leads
- Milestone detection with property history enrichment
- Morning snapshot saved after daily focus emails
- `DealStatusSnapshot` model for morning/evening diff
- Restructured by person; fix stage IDs; trim names; attribute changes by who made them
- Cron schedule + bump `maxDuration` for snapshot writes

### Daily Focus Email
- Cron for P&I and Design leads

### Service Suite Enrichment
- Shared enrichment layer + Zuper cache sync (Vercel cron every 30 min)
- Executive and Ops Manager access granted to Zuper Compliance
- Service-team sales pipeline card + last-communication preview
- Service-overview Deals/Tickets filter on priority queue
- Service-scheduler: deal/ticket detection, assignees, Scheduled Date, week/day views
- Service suite split into sections; Solar Designer swapped for Solar Surveyor
- New SERVICE user role scoped to Service Suite

### Shit Show Meeting Hub
- New cross-functional meeting hub for production issues

### Misc / Polish
- Auto-reload pages on new deployment
- Bug reports sent from the reporter
- Centralize Claude model IDs; replace retiring Sonnet 4; bump to current models
- Freshservice integration: admin page + UserMenu badge + user-facing `/dashboards/my-tickets`
- Scheduler: render pre-sale survey cards on calendar; weekend visibility toggle; flag overdue/completed Zuper overlay jobs
- Survey lead time relaxed to 1 day for California sales reps
- Zuper per-endpoint API call counter + admin read endpoint
- Project Pipeline Funnel registered in Executive suite + cache keys / query key factory

### Bug Fixes (Selected)
- Funnel: cancelled deals reaching every milestone, conversion %, Closed Out/Cancelled labels
- Scheduler: weekend cells showing events without stealing Monday
- Middleware: allowlist `/api/cron/pe-doc-digest`
- Tech Ops bot: exact deal matching, never fabricate task creation, scope history by space
- PE doc digest: notes-only changes relabeled (no more "Uploaded → Uploaded"); UPLOADED→UNDER_REVIEW convergence not logged as a change; "Synced from PE portal scraper" boilerplate not treated as a note update

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
