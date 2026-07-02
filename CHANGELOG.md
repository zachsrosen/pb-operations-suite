# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-06 → 2026-07-02

### Participate Energy (Major Expansion)
- Full PE Analytics dashboard: submissions/approvals per week, doc-level rejections, lifecycle basis (Ready/Submitted/Resubmitted), day/week/month grain, segment/bar drill-down
- Doc Uploaders view — attribution, owner/fractional/last-submitter credit modes, approval rates, By-Doc-Type/By-Day, Uploads Explorer
- Payment timing cards: Submit→Pay, Construction Complete→Pay, Inspection/PTO→Submit, CC→Pay; nightly cron writes avg-days forecast legs
- Rejections: Re-Rejected After Approval report, ANCHOR clawback alert, Rejections-by-Document, per-team QC reviewer notes, auto-advance Rejected→Ready-to-Resubmit
- Docs Tracker: By-Team bucket filter, collapsible sections, Copy/CSV per view, PE Info Needed at deal level, BOM as conditional M1 doc, "Not Required" status
- HubSpot integration: Deal card for PE status, doc status push, pe_doc_*_notes from reviewer input, address-based portal auto-stamping, invoice-paid → Paid milestone advancement
- Sync: manual "Sync now" button, "Last synced X ago" indicator, retire buggy portal scraper webhook, skip overnight, full-mode every 30 min
- Self-serve Photos-per-Policy + Final-Permit builders resolvable by PROJ# or customer name

### Project Pipeline Funnel
- New tabbed page combining Pipeline Funnel + Monthly Activity; Bottlenecks and Cohorts tabs
- Milestone Progression cohort chart (Sales Closed → Closed Out) with weekly bins, drill-down
- Ready-to-Build 3-way split (interconnection / blocks / bench); RTB-Blocked reason fallbacks
- Incoming tab: DA → RTB inflow forecast, "not here yet" stacking, capacity & backlog runway
- Data Quality panel, on-hold/cancelled segmentation, PM/owner filters, URL state, revenue by-cohort table
- Company-wide access, daily-trend panel (event throughput + backlog state), sales-cohort funnel

### D&E Funnel (New)
- Design & Engineering funnel with revision loops and status-funnel tree view
- Buckets: Awaiting Site Survey, Awaiting Design Upload, Design Review; PE + On-Hold filters

### Tech Ops Bot (Renamed from OOO Bot)
- Proactive morning-sweep digest DM'd to owners; scoped team Google Chat room posts
- HubSpot task creation with named-assignee resolution, process-request filing
- New tools: get_project_team, get_project_service, count_deals_by_status, PE M1/M2 milestone breakdowns, location filtering, revenue rollups
- Admin Escalations + Corrections tab with Apply-to-playbook button, log_correction tool
- Real fleet schedule from ScheduleRecord (replaces calendar stub)

### EagleView / TrueDesign
- Full orders page with status filters, PB-location filter, deal links, order-details drawer
- TrueDesign CAD/DXF pull — OAuth foundation + reviewed webhook (flag-off)
- Stamp order status onto HubSpot deals/tickets; DB-backed HubSpot-stamping toggle
- Design Lead surfaced per order; geocoded-address ordering; late measurement-file backfill

### Scheduler
- New Construction as its own tab; Needs Revisit + New Construction shown in three groups
- Scheduler v2 Phase 1: construction dispatch board (flag-gated)
- No survey availability on PB holidays; Lenny replaces Rolando for CO Springs; DTC filter fix

### Workflow / Flow Map (New)
- Live HubSpot automation + SOP reference dashboard; zoomable pipelines → stages → workflows flowchart
- Curated vertical-swimlane Process view with plain-English walkthrough, resumable backfill, admin Build/Re-sync

### Other
- FreshService: create tickets via API instead of email
- Atlas map card embedded in Operations/PM/Service suites as top-level destination
- Page Traffic admin analytics (views, dwell, dead-weight)
- Production Issues Service view; TSRF calculator estimates annual clipping hours
- Cross-instance shared cache + single-flight for projects/deals
- Directory identity links (User ↔ HubSpot owner / Zuper user / CrewMember)
- Vishtik project_id/url synced onto deals; centralized Claude model IDs

---

## 2026-05

### PE (Participate Energy) — Major Expansion
- PE File Preparation tool: AI vision audit, PandaDoc auto-pull, prep dashboard, deep photo/doc verification
- PE Submission Gap report (M1/M2/Complete tabs) with strict stage buckets, dollar amounts, dates
- PE Document Tracker dashboard + PE Deals row-inline doc breakdown + Under Review hero card
- PE Program Report dashboard with per-project checklist, seed data, section stats
- PE Pipeline Tracker with per-stage revenue, construction/inspection status, hero cards
- PE action items feed (hourly cron) with deal grouping, HubSpot+Portal links, auto-resolve on approval
- PE Raceway API sync (replaces HTML scraper), incremental sync, two-way HubSpot property sync
- PE cross-reference analyzers (Planset, Hardware, SalesOrder, InboxScan) auto-triggered post-audit
- PE Approved Vendor List dashboard + doc digest email restructured into 4 actionable sections + Drive links
- PE & Compliance Suite consolidating PE and compliance pages; PE Prep landing page with audit history

### Tesla PowerHub + Enphase Fleet Monitoring
- Full Tesla PowerHub integration: JWT auth client, 3-tier deal linkage, sync orchestration (assets/telemetry/alerts), fleet dashboard
- Cross-system Tesla portal URL linking across HubSpot + Zuper + Suite; auto-link to Properties via geo-coords
- Native HubSpot UI Extension card + compact sidebar showing production, SoC, device serials/models
- PowerHub alerts scored into service priority queue; full telemetry + battery SoC derivation
- Enphase Enlighten API integration at PowerHub parity (OAuth2 refresh rotation, rate limiter, crosslink, crons)
- Enphase Partner OAuth setup route for installer flow

### Shop Health & Executive Dashboards
- Weekly Shop Health dashboard: Preconstruction throughput/cycle times, Customer Success (sentiment, 5-star, response times), Service + D&R sections
- Drill-down tables on count metrics, sentiment, reviews, response time; multiple bottleneck entries per shop
- Project Pipeline Funnel (9-stage sales→construction) with timeframe presets, activity table, staff assignments, drill-down dates
- Pipeline Tracker dashboards (general + PE) with status filters, sortable columns, Site Survey/Construction/Inspection tabs
- Revenue-goal-derived targets replacing crew capacity; hero cards with pipeline revenue detail

### Property Hub + Sync
- Full-page Property Hub at `/properties/[id]`: header with equipment/revenue/Zuper link, Photos tab, HubSpot/Zuper external links
- Zuper Property write-direction sync + project-to-property linking with safety checks
- Inngest queue for property sync workflows; workflow-sync endpoint replacing PendingPropertyOverride cron
- Extended rollup fields cached locally; contact names, engagement metadata, ticket labels in drawer

### Scheduler
- Sub-job Schedule Modal (same/separate modes) wired into master + construction schedulers with sibling cascade
- Reschedule all sibling construction sub-jobs together; skip tentative siblings; cross-deal bleed fix
- Weekend visibility toggle; pre-sale survey cards on calendar; orphaned resurvey/re-inspection jobs surfaced
- Crew Schedule dashboard showing every crew member per day
- On-call electrician overlay; day-view timed grid for surveys/inspections; tentative vs live mode visual distinction

### IDR / Design Review
- IDR Meeting BOM Review & Line Item Editor; PandaDoc DA + plan doc links; previous review notes for re-reviews
- Design revision toggle with auto-advance on sync; RE-REVIEW badge; escalation triggers as-built status
- Planset vs DA layout comparison; DA drift detector as backup for HubSpot connector

### Accounting & Aircall
- Payment Timeline dashboard + payment volume bar chart (day/week/month)
- Aircall executive call analytics (Phase 1+2), per-user answer rate via ring tracking, Analytics+ CSV import
- On-call log with customer phone/address/HubSpot contact; auto-create HubSpot service ticket; roofing issue type

### Ops Infrastructure
- Google Chat OOO Bot with SOP integration and Workspace add-on envelope
- EagleView Orders dashboard + sandbox integration test
- Zuper drift dashboard with per-sub-type evaluation + install_status rollup check
- Customer portal redesign matching photonbrothers.com brand; service-to-service survey invite endpoint
- Cost Audit: cross-reference Zoho bills, bulk sync costs, sales price/margin badges, Sync Health drift rollup
- Shovels API property enrichment (permits/residents/contractors); weekly goals digest email per office

---

## 2026-04

### Meeting Hubs (Major)
- IDR / Design & Ops Meeting Hub: prep queue, escalation, snapshot-and-sync, live preview
- Shit Show Meeting Hub for at-risk deals, reusing IDR snapshot helpers
- Real-time collab, HTML notes, @mentions, End Session; scope by CO / CA / all
- Adders checklist + pricing breakdown with mismatch detection
- Deal 3-tab layout, collapsible photos, sales folder link, PM task on sync
- Accidental-meeting recovery: dedupe, auto-join, end-without-sync, two-click confirm
- Zuper survey links, DA status actions, tier adders, 10% threshold warning

### Office Performance TVs (Major)
- Per-location and all-locations dashboards with 7-slide carousel
- Leaderboard, Team Results, Installs, Surveys, Inspections, Pipeline, Goals slides
- CountUp, ProgressRing, AnimatedBar, ambient background, directional transitions
- Deal drill-down lists; live Zuper compliance replaces cache-based scoring
- Compliance attribution by deal location (not team) + aggregate grade
- California = SLO + Camarillo combined; Office Calendar + Goals slides added
- Turnaround cohorts, uid keying, bounded pass rate — statistical audit

### Solar Designer / Surveyor (New)
- 4-stage build: V12 physics engine, upload, Visualizer/Stringing, Production
- Built-in catalog (8 panels / 9 inverters / 6 ESS), DXF/JSON/CSV parsers
- Click-to-string with voltage validation on satellite background
- Production, Timeseries, Inverters tabs with MPPT reassignment + clipping
- Per-panel shade CSVs, folder/zip upload, Blob client upload past 4.5MB limit
- EagleViewPanel activated via `?dealId=`; Service suite swaps Designer for Surveyor

### Admin Workflow Builder (Major)
- Phases 1–16: editor UI, palette of 10+ actions, template library, versioning
- Triggers: MANUAL, HUBSPOT_PROPERTY_CHANGE, ZUPER_PROPERTY_CHANGE, CRON, CUSTOM_EVENT
- Control flow: delay, stop-if, parallel, for-each; drag-to-reorder canvas preview
- Per-workflow rate limits, dry-run mode, DB-checkpoint idempotency, failure alerts
- Export/import JSON; snapshot-on-save + rollback
- Analytics dashboard + per-run detail with step output drill-in
- Inngest auto-sync on deploy + manual resync button

### Accounting & PE Deals
- Payment Tracking + Payment Action Queue split with 5-section groupings
- New Ready-to-Invoice, Accounts Receivable, Payment Data Mismatch pages
- HubSpot invoices attached to rows, matched to milestones by line item name
- PE deals: Paid, Partially Paid, Approved (Full/Partial), Waiting on Payment sections
- New ACCOUNTING role; Accounting suite tightened to ADMIN/EXEC/ACCOUNTING
- Ready-to-invoice attention signals from project triggers

### Roles & Admin Consolidation
- Multi-role Phase 1/2A/2B: `user.roles[]` everywhere, legacy `role` column dropped
- 6 new scoped suite roles + Sales & Marketing suite
- Runtime-editable role definitions; per-role capability overrides; per-user route grants
- Super-admin break-glass with SUPER badge + impersonation email withholding
- Unified `/admin` landing + primitives (table, filter bar, drawer, form, kv grid)
- Consolidated `/admin/users`, `/admin/roles`, `/admin/crew-availability`, `/admin/audit`

### Catalog & Product Sync
- HubSpot manufacturer enum enforcement + auto-add unknown brands
- Zoho writes switched from `group_name` to `category_id`; images pushed on approval
- Zuper spec custom fields via `meta_data`; dimensions on create
- 302 Zoho orphan reconciliation + integrity audit + auto-fixable repairs
- Sync observability: ActivityLog entries, watermark columns
- Sales Product Request page (equipment + adders to OpenSolar)

### Deal Detail, Timeline & Property Object
- Read-only deal record view: 3-tab layout, collapsible photos, on-demand HubSpot sync
- Composite-cursor timeline: HubSpot engagements, Zuper events, BOM, schedule
- Note composer with background sync to HubSpot + Zuper; site photo gallery from Zuper
- Internal Deal link added across scheduler family
- HubSpot Property custom object v1: cache + link tables, nightly reconcile cron, 4-phase backfill
- Contact-address-change webhook fan-out; AHJ/Utility memoized by (state, zip)

### Other Major Adds
- On-Call rotations: weekly, self-service swaps, HR export, per-state Calendars
- Jobs Proximity Map: installs, service, crews, tickets, morning briefing
- Customer-facing Solar Estimator v2 with 5 quote flows + iframe embed
- Permit Hub two-pane workspace + Interconnection Hub v1
- Adders Catalog + triage engine + rep-facing mobile UI + OpenSolar sync scaffold
- PM Accountability dashboard + exception-based PM assignment flag system
- SOP Guide overhaul: WYSIWYG editor, Drafts, Suites/Tools tabs, submission queue
- Deal Mirror sync engine + Comms Dashboard + cross-system Product Sync
- Freshservice `/dashboards/my-tickets` + personal HubSpot Tasks dashboard
- EagleView TrueDesign auto-pull pipeline; Territory Map for CO boundaries

---

## 2026-03-15 → 2026-03-31

### Design Pipeline Funnel (New Dashboard)
- New funnel dashboard with bars, conversion arrows, monthly grouped bars, and cohort conversion table
- Backlog callouts, DA pacing (from actual approval dates), cancelled revenue, pending-sales-change tracking
- Multi-select locations, expanded timeframes, drill-down deal lists per backlog bucket
- Rolling-day cutoff (not calendar-month) with implied stage progression
- Wired into Executive and D&E suites

### End-of-Day Summary (New)
- New `DealStatusSnapshot` model with morning save / evening diff and idempotent cron
- Milestone detection with HubSpot property-history enrichment and completed-task search
- HTML email builder, restructured per-person with per-person change/task counts
- Attributes changes to who made them; Natasha added, Daniel removed

### Revenue Goal Tracker (New)
- Executive hero with variant A (progress rings) and variant B (thermometer bars); canvas fireworks on goal hits
- Monthly breakdown chart with hit/miss indicators, stacked bars scaled against actuals, multi-select filter
- Zuper-based recognition for Service and Roofing groups (cross-year window, pipeline/stage filters)
- Admin config GET/PUT for goal targets, cache/SSE cascade, auto-seed

### Metrics Dashboards (New)
- Design Approval, Site Survey turnaround, Inspection, Construction, and Preconstruction metrics dashboards
- Construction: CC→Inspection Passed, RTB→Const Start, drill-downs, per-status revenue cards on scheduler
- Location filters, sortable columns, Zuper links in drill-downs
- Execution/metrics tables reshuffled; StatCards, status pills, All-Locations summary polish

### Catalog & Sync Relay
- Cross-system Sync Relay: plan-based execute with stale detection, plan-hash confirmation, auto-cascade hook
- SyncModal rewritten: wide comparison table, per-cell source selection, value-flow view, generator toggles
- Selective sync with per-field direction controls; 10 new mapping edges; Zoho part_number/unit bidirectional
- Catalog form validation (numeric ranges, inline errors, photo size/type, vendor pair warning)
- Zoho↔Zuper cross-link with validated API responses; stale zohoVendorId detection

### Service Suite (Phases 1–4)
- Suite split with priority queue and tickets (Phase 1+2)
- Service Catalog + SO Creation (Phase 4): auto-populate slide-over from HubSpot line items, dynamic pipeline stages, multiselect filters, ticket owner column
- Customer History v2 rebuilt on contact-based lookup (search, slide-over, deal/ticket/Zuper association resolution)
- Shared enrichment layer + Zuper cache sync cron (every 30 min)

### Accounting Suite & PE
- New Accounting suite with PE Deals & Payments dashboard, M1/M2 status dropdowns, HubSpot sync on page load
- Pricing calculator with deal import search, comparison banner, and auto-populate
- Energy Community check swapped to Zippopotam.us; compact PE table layout

### Scheduler & Scheduling
- Service and D&R Zuper job overlays in month/week/Gantt with popover, distinct styling, localStorage toggles
- Collapsible project sidebar (persisted), completed month/year stats, overdue revenue
- Forecast ghosts for all pre-construction stages; Zoho revenue in scheduler views
- Pre-sale site visit Zuper flow; Camarillo/SLO availability bleed fixed

### BOM Pipeline & Zoho
- Preferred-vendor PO splitting (auto-split BOM items by Zoho vendor); CREATE_PO gated to RTB with manual retry
- Warehouse-aware Sales Orders; HubSpot deal record ID on Zoho SOs; PO summary in pipeline emails
- BOM push to HubSpot with UI and migration; webhook restored with dual auth + Tray payload support
- EquipmentSku → InternalProduct rename (Phases 1–3); `/api/inventory/skus` → `/products`

### Platform, Roles & SOP
- OWNER → EXECUTIVE role rename with SALES_MANAGER added; migrations and guard compatibility
- Security hardening: admin recovery code, redacted debug endpoint, scoped token key fallback
- Install-photo-review, site-survey-readiness, and FDR webhooks (Inspection-stage triggered)
- SOP Guide bumped to v4.0: tab visibility, PB brand theme, merged Workflows/Reference and Sales/Other Pipelines
- Zuper status comparison: fail-date cross-check, hubspot-ahead filtering, timezone fix, 1-day tolerance
- Daily focus email cron for P&I and Design leads; survey reassignment notifications to both surveyors

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
