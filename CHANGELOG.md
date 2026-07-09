# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-06-29

### Participate Energy Suite (Major)
- New unified PE Hub at `/dashboards/pe` consolidating Deals, Documents, Analytics, Doc Uploaders, and Submission Gap tabs
- PE Document Tracker — per-doc status, sectioned by Onboarding / IC / PC milestones, By-Team bucket filter, collapsible deal groups, Copy/CSV exports
- PE Analytics dashboard — submissions/approvals/rejections per week, lifecycle cohorts, milestone progression, segment-level drill-downs, Day/Week/Month grain
- PE Timing card — Submit→Pay, CC→Pay, Inspection/PTO→Submit, M1→M2 forecast legs with nightly cron writing avg days back to deal properties
- Two-way PE document status sync with HubSpot deal properties; replaced PE portal HTML scraper with official PE API and webhook
- PE Pipeline Tracker — by stage and status with construction + inspection columns and revenue rollups
- PE Doc Uploaders — payment $ attribution (Owner vs Fractional), per-uploader approval rates, By-Time/By-Doc-Type/Approved $ views with day/week/month chart
- PE Submission Gap report — CC-hit deals with incomplete M1/M2, 4-tab split with dollar amounts and dates
- PE Document Rejection workflow — per-team rejection notes, auto-create HubSpot tasks per QC team, auto-advance Rejected → Ready to Resubmit when tasks complete
- HubSpot Deal card surfacing PE status; "Synced X ago" indicator + manual Sync now button across PE tabs
- Internally Rejected status, "Not Required" status for conditional docs (BOM), Bill of Materials as conditional M1 doc
- Short-pay tracking so PE Revenue Collected reflects actual dollars; advance Approved milestones → Paid from invoice paid-in-full date
- PE Approved Vendor List dashboard

### PE Submission Tooling (Major)
- PE File Preparation — AI vision audit of Zuper + Drive photos against PE shot list, PandaDoc auto-pull, prep dashboard
- PE Prep landing page with deal queue and audit history overlay; deep PE verification for photos and documents
- Photos-per-Policy self-serve builder (web tool) and Final Permit PDF assembly
- PE Action Tasks Cross-Reference MVP — Planset / Hardware / SalesOrder analyzers cross-check planset, PowerHub nameplate, and SO line items against PE action items
- Inbox Scan Analyzer — find PE docs in shared mailboxes
- AVL cross-check + few-shot reference library for vision classifier; concurrency caps, retry, cached file IDs
- Drive-folder-aware permit search (Inspections + Permitting subfolders), PandaDoc multi-template support with name-only fallback

### Tesla PowerHub & Enphase Enlighten (Major)
- Tesla PowerHub fleet monitoring integration — OAuth2 client_credentials auth, batched asset / telemetry / alert sync, per-DIN alert mapping
- HubSpot UI Extension (full card + compact sidebar) with HMAC v3 signature verification
- Auto-link Tesla sites to HubSpot Properties via geo-coordinate matching with greedy 1:1 scoring; cross-system Tesla portal URLs (HubSpot + Zuper + Suite)
- Push all Tesla device serials + model numbers to Zuper Property/Job
- PowerHub alert scoring fed into Service Priority Queue; battery SoC derivation, full telemetry signals, alert metadata capture
- Enphase Enlighten integration at PowerHub parity — fleet discovery, telemetry/consumption/battery snapshots (15-min cron), micro health monitoring (30-min cron), HubSpot card, Partner + Developer OAuth flows

### Property Hub & HubSpot Property Object (Major)
- HubSpot Property custom object v1 — canonical address per HubSpotPropertyCache row with deal/ticket/contact link tables and rollups
- Inngest queue for property sync workflows; workflow-sync endpoint replacing PendingPropertyOverride cron
- Property Hub full-page view at `/properties/[id]` with Equipment, Photos, Activity tabs; Zuper job photos surfaced
- Enriched header with equipment summary, revenue, HubSpot + Zuper external links
- Map, stages, ID lookup fixes; deal names instead of IDs in drawer; AHJ/Utility (state, zip) memoization for backfill
- Zuper Property sync write direction — associate properties with customer, link Zuper projects, ticket-only property handling
- Shovels API property enrichment — permits, residents, contractors

### Admin Workflow Builder (Major)
- Visual workflow builder backend scaffold + editor UI + CRUD API (admin only)
- Action palette grew to 10+ actions: send-email, ai-compose, update-hubspot-property / contact / note / task, update-zuper-property, run-bom-pipeline, log-activity, fetch-zuper-job, find-hubspot-contact, http-request
- Control flow — delay, stop-if, parallel, for-each loops; drag-to-reorder canvas with visual preview
- Triggers — MANUAL, HUBSPOT_PROPERTY_CHANGE, ZUPER_PROPERTY_CHANGE, CUSTOM_EVENT, CRON dispatcher
- Webhook fan-out for HubSpot + Zuper; per-workflow rate limits, action-level + best-effort idempotency, dry-run mode, failure alerts
- Workflow versioning with snapshot + rollback, analytics dashboard, JSON export/import, per-run detail page with step output drill-in
- Dynamic option re-fetch + unified property options; select/multiselect dropdowns with dynamic options
- Inngest auto-sync on deploy + manual re-sync button

### Pipeline Funnels & Throughput Analytics (Major)
- Project Pipeline Funnel dashboard — 9-stage sales-to-construction with hero cards, conversion arrows, cohort tables, drill-downs
- Funnel cohort views — milestone, lifecycle, sales, design & engineering, revenue conversion by cohort
- Daily-trend panel (event throughput + recorded backlog state), location matrix, RTB 3-way split (interconnection / blocks / bench)
- Incoming tab — DA→RTB inflow forecast, "not here yet" stacked by current stage, avg time-to-arrive per step
- Active Pipeline tab — Capacity & Backlog row (RTB bench + runway)
- Backlog aging, sales-change reason fallback, On Hold / Cancelled / Pending Sales Change flags with reason rollups
- Milestone Progression cohort chart with pill selector, weekly bins, lifecycle view, click-to-drill-down
- Workflow Map — live HubSpot automation + SOP reference dashboard with zoomable flowchart, family-lane stage layout, resumable backfill
- D&E Funnel with revision loops, awaiting-DA bucket, status branch tree, PE + On-Hold filters
- Monthly Activity throughput dashboard

### Office Performance Dashboards (Major)
- Per-office TV carousel dashboards — surveys, installs, inspections, pipeline, customer success rotating slides with CountUp / ProgressRing / animated bars
- All-Locations overview slide and dedicated `/office-performance/all` route
- OfficeGoal model — per-office monthly targets editable in admin
- Goals & Pipeline carousel slides; Office Calendar carousel; Service section; 4th hero card per section
- Customer Success — sentiment scoring, 5-star reviews, contact response time drill-downs
- Drill-downs on all count-based metrics, leaderboards, per-surveyor turnaround, individual pass rates
- Combined California dashboard (SLO + Camarillo); weekend exclusion; cache-warming cron to fix 504 death spiral
- Weekly Shop Health Dashboard with revenue hero, pipeline detail, Preconstruction throughput + cycle times, multiple bottleneck entries per shop

### Scheduling System
- Master Scheduler — service + D&R overlay, day-view timed grid, weekend toggle, on-call electrician overlay, drag-drop with editable date picker, sub-job breakdown for construction cards, mode-aware tentative vs live indicators
- Scheduler V2 — Phase 1 Construction Dispatch Board (flag-gated), New Construction tab between Ops Surveys and Pre-Sale
- Per-office daily survey cap, no survey availability on PB holidays, alias-aware location mapping, completed/passed jobs no longer show as overdue
- Pre-sale Zuper survey flow with diagnostic logging; pre-sale survey cards on calendar with click modal
- Sub-job scheduling — same/separate modes, cascade reschedule across siblings scoped to same deal, individual sub-job Zuper links, Solar/Battery/EV construction split
- Crew Schedule dashboard — see where every crew member works each day
- Show Needs Revisit + New Construction surveys in 3 groups; orphaned resurvey/re-inspection jobs surfaced
- Forecast ghosts for all pre-construction stages
- Lenny Uematsu replaces Rolando for Colorado Springs

### Catalog & Cross-System Sync (Major)
- SyncModal redesign — wide comparison table, per-cell source selection, smart defaults, dropdown filtering
- Sync Health page — drift rollup across InternalProduct / HubSpot / Zuper / Zoho
- Cost Audit — cross-reference Zoho bills against item purchase rates, sales price + margin + cross-system link badges, bulk-sync costs to latest bill
- Phase B catalog hygiene — auto-fixable repairs, orphan reconciliation (302 InternalProducts + Zuper), Zoho category_id writes, casing/Generic rebrand
- HubSpot manufacturer enum enforcement with auto-add + TechOps notification for unknown brands
- Zuper spec custom fields via meta_data, dimensions on product create
- Cross-system product pricing comparison; preferred-vendor PO splitting
- Phase 1+2 EquipmentSku → InternalProduct rename
- ScheduleEventLog capturing Zuper reschedules and crew changes

### BOM Pipeline & IDR Meeting Hub (Major)
- IDR Meeting Hub (Design & Ops Meeting Hub) — meeting prep queue with escalation, DA status actions, dense two-column layout, real-time collaboration, HTML notes with @mentions
- BOM Review & Line Item Editor; AHJ & Utility Codes tab; previous review notes on re-reviews
- Adders Checklist + Pricing Breakdown components, custom adder support, sync to HubSpot adder summary on save
- IDR revision workflow — re-review toggle, auto-appear, revision reason sync, auto-complete HubSpot task on sync, RE-REVIEW badge
- Compare planset layout against DA layout in AI design review
- Inngest workflow engine spike for BOM (INNGEST_BOM_ENABLED flag); planset size guard; Zoho token/cache refresh dedup
- Shit Show Meeting Hub
- Search history; remove project from queue; scope start by location (CO/CA/all)
- AC disconnect standardized to TGN3322R

### Deal Detail & Activity Timeline (Major)
- New `/dashboards/deals/[dealId]` read-only deal record view with 3-tab layout, full timeline (HubSpot engagements + tasks + Zuper notes/status + BOM + schedule)
- Deal Activity Timeline & Notes — composite cursor pagination, internal DealNote model, background HubSpot + Zuper sync
- Photo gallery via Zuper service task form submissions with proxy + unique attachment UIDs
- Sync changelog with human-readable field labels; expand/collapse notes; rendered engagement HTML with @mention stripping
- On-demand HubSpot sync when deal not in mirror; Deal Mirror sync engine and cross-system Product Sync
- Internal Deal link surfaced across scheduler family and other UI surfaces

### Accounting Suite (Major)
- Accounting Suite + Payment Tracking dashboard + ACCOUNTING role
- Payment Action Queue split from Payment Tracking; Ready-to-Invoice attention signals
- HubSpot invoices attached to payment-tracking rows; PTO and PE line-item matching
- PE Deals & Payments dashboard with M1/M2 status dropdowns, Partially Paid section, customer paid column, stage groups
- PE Deals — split Pre-Construction vs Construction+, Awaiting PTO segment, customer payment status from HubSpot invoices
- Payment Timeline dashboard with day/week/month payment volume bar chart
- Customer-facing solar estimator v2 (Phase 1) — Places autocomplete, 5 quote-type flows (EV/Battery/Expansion/D&R), iframe embed mode, slim HubSpot properties

### Sales & Marketing / Estimator
- Sales & Marketing suite + 6 scoped suite roles (SALES, SALES_MANAGER, MARKETING, etc.) in Phase 1 roles
- Sales product request page — equipment + adders → OpenSolar
- DA Drift Detector as backup for HubSpot DA-status connector
- Pricing Calculator moved from Accounting → Sales & Marketing
- Adder Catalog (Phase 1 Chunk 1) — governed adder catalog with DB-backed path, triage recommendation engine, rep-facing mobile triage UI, OpenSolar sync scaffold

### EagleView Integration (Major)
- EagleView TrueDesign auto-pull pipeline — OAuth foundation + webhook, full-order URL properties, sandbox + production credentials
- TrueDesign CAD/DXF pull behind flag; View in TrueDesign link; deal-style HubSpot address fields
- EagleView Orders dashboard with default list, status filters, PB location filter, deal links, order details drawer
- Stamp order status onto HubSpot deal/ticket; HMAC v3 signature auth on reviewed webhook
- Resolve Design Lead via owner map; show Design Lead on each order; order by geocoded address
- Save shade as .zip and backfill late-arriving measurement files

### Tech Ops / OOO Bot (Major)
- Google Chat OOO bot (renamed to Tech Ops bot) with HubSpot task creation, customer-name/address deal lookup, exact deal matching
- Process-request filing via Freshservice API (with email fallback)
- Proactive daily digest DM'd to owner + scoped per-room team digests (intro, sections, content focus); preview mode
- Get-project-status returns project type + PE IC/PC payment amounts; get_project_team / get_project_service tools
- Count_deals_by_status, location filtering, revenue rollups, milestone date-range queries, PE M1/M2 milestone status breakdowns
- DA lifecycle phases; data-integrity prompt rule; admin bot escalations + corrections review dashboard
- Real fleet schedule from ScheduleRecord; conversation history scoped by space
- Morning Sweep — proactive daily task & ticket digest

### Service Suite
- Service Suite Phase 1+2 split with priority queue and tickets; deferred items round 2
- Service BOM page (deals + tickets) with ticket-keyed snapshots
- Service Catalog + SO Creation Phase 4 — auto-populate SO slide-over from HubSpot line items, contact-based customer resolution
- Customer History v2 — contact-based lookup with company expansion, address scoping, deal/ticket/Zuper resolution
- Pipeline Tracker dashboard + tabs for Site Survey / Construction / Inspection; pagination of HubSpot search
- Production Issues dashboard with Flag Project / unflag actions; Service view for tickets + completed-project deals
- TV Dashboard — rich deal list with Zuper status, PE flags, unified layout

### On-Call Rotations
- On-Call electrician rotations V1 — weekly Sun-Sat, 6-10pm weekday / 8am-12pm weekend shifts, per-state Google Calendar
- Self-service swap UI for electricians, admin/executive Activity view, PTO + swap UX
- Auto-create HubSpot service ticket on follow-up; emergency call log captured by on-call electricians
- Aircall Executive Call Analytics dashboard (Phases 1+2) — per-user answer rate via ring tracking, Analytics+ CSV import
- On-Call Calls section from OnCallCallLog

### EOD & Daily Focus Emails
- End-of-Day summary email — milestone detection with property history, completed HubSpot tasks, morning/evening diff via DealStatusSnapshot
- Restructured EOD email by person with attribution to deal's role-property owner; per-person task and change counts
- Major signal-to-noise improvements
- Daily Focus email — P&I and Design leads with PE M1/M2 sections for Layla, time since last update on PE Doc Update email
- Weekly goals digest — one email per office, hide zero-delta when no prior snapshot

### PM Accountability & Roles
- Multi-role access (Phase 1 → 2A → 2B → Option E) — migrated single `User.role` column to `User.roles[]`, runtime-editable role definitions, per-role capability overrides, per-user extra route grants
- PM Accountability dashboard + weekly digest (Phase 1); PM Flags exception-based PM assignment system with kill switch, compound-risk + shit-show rules
- Project Management Suite landing page; PM Tasks dashboard
- Super-admin break-glass safeguard with badge + drawer note
- OWNER → EXECUTIVE rename; SALES_MANAGER role; ACCOUNTING role
- Unified `/admin` landing + AdminShell with in-shell search and consolidated drawers (users, roles, audit, security, tickets, directory, crew-availability, activity)

### Funnel / Sales Funnel
- Sales Funnel dashboard with bar conversion arrows, multi-select locations, drill-down lists, cohort table, pacing revenue
- Stage distribution, lookback fixes, canonical locations, cancelled revenue
- Cohort tab + active snapshot scope toggle; 4-stage classification including Pending Sales Change

### Permitting & Interconnection
- Permit Hub two-pane workspace at `/dashboards/permit-hub` — shared inbox correspondence, sticky action panel, grouped queue, multiselect location
- Interconnection Hub v1; daily focus alignment with Permitting team
- Per-inbox OAuth workaround for blocked DWD scope

### Solar Surveyor (Solar Designer)
- New Solar Designer app — V12 engine extraction, multi-stage build (Core engine, Equipment + Site, Visualizer + Stringing, Production + Timeseries + Inverters)
- Layout DXF/JSON/CSV parsing client-side; per-panel shade CSVs, zip upload, folder drag-and-drop
- MPPT reassignment, voltage validation, auto-string, clipping detection, timeseries aggregation (day/week/month/year)
- EagleViewPanel renders when `?dealId=` URL param is set
- Vercel Blob client upload to bypass 4.5MB body limit; web worker entry point

### Maps & Atlas
- Jobs proximity map (Phase 1+2+3) — installs + service + crews, tickets, inspection/survey markers, Week/Backlog views
- Quick actions (call + add note), assignee filter, scheduled-today never cluster, per-kind count breakdown
- Atlas map embedded as top-level destination; Atlas card in Operations / PM / Service suites
- Dispatcher office pin + morning briefing + nearby highlights; project numbers; D&R + roofing markers; shop filter
- Territory Map dashboard for CO office boundary analysis

### SOP Operations Guide
- WYSIWYG TipTap editor replacing CodeMirror HTML; auto-link `<code>/route</code>` mentions to actual app pages
- Submit-a-new-SOP feature with admin review queue; Drafts tab with PM Guide rewrite
- Tech Ops tab split into Design / Permitting / Interconnection
- Role-gated tabs and sections (Executive + Accounting + Sales & Marketing + Tools + Suites + Action Queues + Service); meta-SOP "How to Use the SOP Guide"
- Batch SOPs — Catalog, Service, Scheduling, Forecast, AHJ & Utility, Submitting a New Product

### Inventory & Construction Metrics
- Inspection Metrics dashboard with dual-source validation, AHJ inspection properties, 11 inspection deal properties
- Construction Metrics — drill-down + Zuper links + All Locations summary, CC→Inspection Passed replacing CC→PTO, RTB → Const Start labels
- Preconstruction Metrics dashboard
- DA Metrics — Design Approval metrics with first-try customer vs design split, rework attribution, Current DA Pipeline cards, click-through drill-down
- Survey Metrics — site survey turnaround, statistical audit fixes, location filtering

### Revenue & Forecasting
- Revenue Goal Tracker — RevenueGoal model, progress rings + thermometer hero variants, monthly breakdown chart, canvas fireworks on goal hits
- Variant config + admin GET/PUT for targets; auto-seed defaults; Zuper-based recognition for Service and Roofing
- Stacked monthly bars, multi-select filter, pace visibility, straight-line pace
- Forecast Schedule page with pipeline breakdown

### Bug Fixes & Misc
- Zuper API call reductions — per-endpoint counter, throttled crons (job-backfill hourly→6h, property-sync 15m→30m→6h, sync-cache 30m→4h), cached job list (~97% API reduction in lookup endpoint), DB-cache hits skip API sweep
- Cross-instance shared cache + single-flight for projects/deals; 3 HubSpot-heavy crons paused to relieve rate-limit outage
- Auto-reload pages on new deployment; live clock replacing static "Updated" timestamp; FeedbackButton + ChatWidget moved to header chrome
- Bug Report — feature-request option, send from reporter
- Auth — redirect to last page after login, edge-runtime JWT role fix, super-admin email withholding during impersonation
- Customer survey portal — subdomain isolation, brand color matching photonbrothers.com, inline cancel, scroll fix
- Cache: stop transient empty fetches from blanking the pipeline page; reorder no-cache headers; exclude auth-gated request-product pages from CDN
- Comms: Gmail identity verification on OAuth connect, fail-closed mailbox verification, 200-message fetch with auto-pagination
- Zoho — warehouse-aware Sales Orders, salesorder_number SO- prefix, custom field fallback, retry token refresh on Access Denied
- Centralize Claude model IDs, replace retiring Sonnet 4
- Project rebrand: PB Operations Suite → PB Tech Ops Suite
- Page Traffic analytics (admin) — views, dwell, dead-weight, per-user
- IT — read-only activity-log export, audit-sessions, anomaly-events, user-roster endpoints
- Vishtik project_id + project_url synced onto deals
- Re-Rejected After Approval report on PE Analytics

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
