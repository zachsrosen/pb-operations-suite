# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-07-20

### P&I Hub (Major)
- Unified P&I hub — permit, interconnection, and PTO in one page (behind flags)
- Approval signals — detect issued/approved/granted/passed from shared inbox evidence, suggestion-only (no set-status)
- Correspondence tab reads emails in-app; dual-application IA tokenizer merges Xcel chatter threads
- Application # and Xcel IA # surfaced on Overview panel
- Inspection section added to Permit view; inspection_passed verdicts mapped to permit team
- Server-side queue cache (120s cold-build budget), visible team-switch loading, prefetch other teams
- Deal stage shown in hub queues; roofing terminal stages excluded
- Per-deal time budget on approval-scan cron so runs never 504 away progress

### Operations Scorecard (Major)
- Living Operations Scorecard dashboard with same-point year comparison
- Sale → DA approved and Sale → CC forecasting legs
- Consult-driven sales forecast; first_consult_date property
- Quarter-over-quarter tables + monthly funnel
- Projected full year, CO/CA rollups, sales-first charts, net vs total sales
- Trend coloring, prior-year revenue lost, mean+median turnarounds
- Leads and consults rows at the top of the funnel
- Per-section "how these numbers are calculated" explainers

### SolarEdge Monitoring
- Live SolarEdge fleet monitor (schema → sync → dashboard)
- Named alerts + alert-type filter (export-sourced)
- Customer/deal links, open-ticket enrichment, table polish

### PowerHub Fleet Table
- Dedicated Monitor column on every row, alert chips inline
- Alert Type filter, voltage-based grid cell, Active Alerts toggle
- Info columns and open-ticket links inline

### Bot / Google Chat
- Per-rep daily worklist (own deals, 4 sections)
- Real-time bot usage mirror to tracking space
- Sales reps scoped to own deals, blocked from company-wide aggregates
- `get_pe_docs` — bulk PE document-status lookup (action required / rejected)
- `get_deal` answers "why is PROJ-X <any state>" from real reason fields
- Bulk state reasons via `query_projects includeReason` (no per-deal fan-out)
- Polish: no markdown tables in Chat, help/menu reply, stage breakdowns ordered by pipeline sequence

### Team Activity
- Weekly report-card email digest
- Tasks/day + Property updates/day metrics
- PE uploads count as deal touches
- Exclude PTO days (calendar OOO) from averages

### RTB / Ready to Build
- Ready to Build tab on the review queue
- Payment method, loan status, earliest install availability columns
- Permitting status column + fully sortable un-merged columns
- Editable RTB-Blocked notes; always-visible line items; days-in-stage column
- Ready tab 'Released' reads pm_rtb_approved_date

### Deal Sync / Cache
- 15-min cron + visible "deals synced N ago" freshness badge

### Scheduler
- Survey invite button generates a copyable link (no email sent), status badges, gated button

### Funnel
- Sales Funnel defaults to This Year; drill-down polish
- Blocked toggle + waiting-since/scheduled dates in drill-downs
- Uses Close Out Status for Close Out stage + backlog
- Hide project-rejected toggle, per-status revenue in Pipeline Backlog
- New Construction indicator + hide/show toggle

### Miscellaneous
- Colorado Springs office renamed to Pueblo (app code)

---

## 2026-06

### PE Analytics (Major)
- PE Analytics dashboard + auth-redirect cache fix
- Weekly chart views: submissions per week, approvals per week, submissions stacked by outcome, doc submission outcome %s + avg review times
- Lifecycle view on PE Analytics weekly chart; Ready/Submitted lifecycle basis + Rejected segment
- Rejections cohort view + action-required drill; daily document-level rejections chart
- Bar drill-down and segment-level drill-down on all charts
- Currently-rejected slice + Ready-to-Submit cohort + Ready-Not-Submitted backlog
- Funnel totals strip; deal counts + operational ready dates in totals
- Milestones / Lifecycle split + Remittance & Expected-Paid charts
- Copy + CSV on milestone and drill-down panels
- Segment drilldowns: awaiting split, 3-way awaiting on Submitted card, Resubmitted band
- Day/Week/Month toggles on all charts

### PE Timing / Payments (Major)
- PE Timing dashboard from calculated timing props (averages)
- Submit → Pay timing card; Construction Complete → payment timing (M1 & M2)
- Inspection/PTO → Submit timing
- Age submitted M2s from M1 approval (PE can't review M2 until M1 approved)
- PE review aging by last upload + overdue-with-PE escalation
- Nightly cron writes avg submission→payment and CC→payment days to all PE deals (mean+median)/2
- Advance Approved milestones to Paid from invoice paid-in-full date
- "Expected (Submission)" forecast mode; two-way PE document status sync with HubSpot deal properties
- HubSpot Deal card for Participate Energy status
- Milestone Payments view — IC/PC pipeline by stage then status, multi-select subgroup bubbles

### PE Documents / By-Team
- By-Team bucket filter + collapsible status sections
- Editable per-doc blocker notes; drop "Rejected" label
- Deal-level PE Info Needed replaces per-doc blocker notes
- Doc Uploaders timeline segmented by doc type, month axis, multi-select
- Superseded uploads drill-down on the Doc Uploaders table
- Bill of Materials tracked as its own M1 document, conditionally required ("Not Required" status)
- Daily snapshot of Document Tracker card metrics + trend history

### PE Rejection Workflow
- Auto-advance Rejected → Ready to Resubmit when rejection tasks done
- Auto-advance onboarding + internal rejections
- Per-team QC rejection notes from reviewer input
- Populate `pe_doc_*_notes` from real reviewer comments (PeActionItem)
- Mark P.E. M1/M2 Documents checkboxes on rejection
- Re-Rejected After Approval report on PE Analytics
- Loosen rejection-task matcher so task names are freely renameable

### Workflow Map (Major)
- Live HubSpot automation + SOP reference dashboard
- Zoomable flowchart view (pipelines → stages → workflows), family-lane stage layout
- Process view — plain-English end-to-end pipeline walkthrough (expandable per stage)
- Curated vertical-swimlane view; accurate Design process (parallel tracks → AND-gate → stamps branch)
- Resumable backfill; admin Build/Re-sync button

### Atlas Map
- Atlas embedded as a top-level destination
- Surface Atlas map card in Operations, PM, and Service suites

### EagleView / TrueDesign
- Full order lifecycle: EagleView Orders dashboard, default list + status filters, PB location filter, deal links
- Order details drawer; Report # links to EagleView TrueDesign
- Design Lead shown on each order
- TrueDesign CAD/DXF pull — OAuth foundation + webhook (flag-off)
- Full-order URL properties and links
- DB-backed toggle for HubSpot stamping (env-or-SystemConfig)
- View in TrueDesign link on the EagleView panel

### Cache / Infrastructure
- Cross-instance shared cache + single-flight for projects/deals
- SystemConfig-backed runtime config + TrueDesign public-client wiring

### Ops / Service
- Morning sweep — proactive daily task & ticket digest
- Freshservice tickets created via API instead of email (email fallback)
- Production Issues: Service view (tickets + completed-project deals); Flag Project button + inline unflag
- TSRF calculator estimates annual clipping hours
- IDR meeting: remove a project from the queue

### Vishtik
- Sync `vishtik_project_id` + `vishtik_project_url` onto deals

---

## 2026-05

### Tesla PowerHub (Major)
- Tesla PowerHub fleet monitoring integration
- Full telemetry + equipment summary; every Tesla telemetry signal + alert metadata captured
- Push all Tesla device serials + models to Zuper Property/Job
- Geo-coordinate matching via portal-imported lat/lng
- Cross-system Tesla portal URL linking (HubSpot + Zuper + Suite)
- Native Tesla PowerHub UI Extension card for HubSpot; compact sidebar card
- `API_SECRET_TOKEN` auth on import-locations route

### Enphase Enlighten
- Enphase Enlighten API integration at PowerHub parity
- Partner OAuth setup route for installer auth flow

### PE File Preparation (Major)
- PE File Preparation — AI vision audit, PandaDoc auto-pull, prep dashboard
- PE vision classifier — few-shot reference library + AVL cross-check
- Deep PE verification for photos and documents
- PE audit splits into docs + photos pipelines (independent timeouts)
- PE Prep landing page (deal queue + audit history overlay)
- Clickable PandaDoc links; PE Approved Vendor List dashboard page
- Two-way PE document status sync; switch action items to scraper source + sync endpoints
- Instant email notification on PE doc status changes
- PE & Compliance Suite consolidating PE + compliance pages

### PE Submission Gap
- PE Submission Gap report — CC-hit deals with incomplete M1/M2
- Document-level progress per deal; M1 includes Close Out, Complete tab
- Real deal stage, close date, inspection pass / PTO granted dates

### Property Object (Major)
- Full-page property view at `/properties/[id]`
- Property Hub header with equipment summaries, revenue, and Zuper link
- Photos tab with Zuper job photos; HubSpot and Zuper external links
- Extended rollup fields cached locally and exposed in PropertyDetail
- Activity tab enriched with engagement metadata
- Show contact names and HubSpot link in Property drawer
- Zuper Property sync (write direction) — link Zuper projects to properties during sync
- Associate Zuper properties with customer on create/update
- Inngest queue for property sync workflows
- Shovels API property enrichment — permits, residents, contractors
- Unified timelines + property sync validation

### Project Pipeline Funnel (Major)
- Project Pipeline Funnel (9-stage sales-to-construction)
- Design & Engineering funnel with revision loops
- Card added to Executive suite
- Survey Scheduled stage + hero card cleanup
- Named timeframe presets; Monthly Activity table

### Weekly Shop Health (Major)
- Weekly Shop Health Dashboard
- Preconstruction throughput and cycle times
- Customer Success section with sentiment scoring, 5-star reviews, response time
- Revenue hero card + pipeline revenue detail
- Targets derived from revenue goals (not crew capacity)
- Drill-down tables on count-based metrics
- Multiple bottleneck entries per shop per week

### IDR Meeting Hub
- BOM Review & Line Item Editor
- Previous review notes for re-reviews + richer search results
- Escalation revisions trigger as-built design status
- Show escalation submitter in IDR detail panel

### PE Pipeline Tracker
- PE Pipeline Tracker dashboard
- Total revenue + per-stage revenue hero cards
- Construction & inspection status columns; Zuper job links
- Pipeline Tracker link on PE Pipeline page
- General Pipeline Tracker dashboard (M1/M2 removed from PE tracker)
- Site Survey, Construction/Inspection tabs
- Per-type status filters, sortable status columns
- Rich deal list with Zuper status, PE flags, unified layout (TV dashboard)

### PE Program (misc)
- PE Raceway API sync replacing HTML scraper
- PE action items feed + incremental sync + hourly cron
- Design planset layout compared against DA layout in design review

### Office Performance
- Service carousel slide added
- Bulk AHJ/Utility spreadsheet update script

### EagleView
- EagleView Orders dashboard
- Sandbox integration test page for Go-Live proof

### Scheduling
- Relax survey lead time to 1 day for California sales reps

### Bots
- Google Chat OOO bot

### Zuper Observability
- Per-endpoint API call counter + admin read endpoint

### Backfill
- `--skip-zuper` flag to avoid Zuper API burst

### Portal
- Service-to-service survey invite endpoint

---

## 2026-04

### Admin Workflow Builder (Major)
- Visual workflow builder — editor UI + CRUD API (Phases 1–2)
- Webhook fan-out for HubSpot + Zuper triggers
- Action library: send-email, update-hubspot-property, update-hubspot-contact-property, add-hubspot-note, create-hubspot-task, update-zuper-property, run-bom-pipeline, log-activity, http-request, find-hubspot-contact, ai-compose
- Control-flow: delay, stop-if, parallel, for-each loop
- Template library; export/import workflow JSON
- Per-run detail page with step output drill-in; cross-workflow run history
- Step reordering; drag-to-reorder on visual canvas
- Analytics dashboard; workflow versioning (snapshot on save + rollback)
- Action-level idempotency; per-workflow rate limiting; dry-run mode
- Failure alerts + Zuper property discovery
- CUSTOM_EVENT trigger type + emit helper; CRON trigger type + dispatcher cron
- Select/multiselect dropdowns with dynamic options
- Inngest auto-sync on deploy + manual resync button

### Adder Catalog + Triage (Major)
- Governed Adder Catalog (Phase 1: foundation)
- `/dashboards/adders` catalog UI
- Triage recommendation engine + `/api/triage/*`
- Rep-facing mobile triage UI + deal-detail embed
- OpenSolar sync scaffold behind kill switch
- Move to Sales & Marketing suite with IN PROGRESS flag

### Permit Hub (Major)
- `/dashboards/permit-hub` two-pane workspace for permitting team
- Resolved names + header quick-links + AHJ fallback
- Shared inbox thread fetch on correspondence tab
- Per-inbox OAuth workaround for blocked DWD scope

### Interconnection Hub (Major)
- Interconnection Hub v1

### Jobs Proximity Map (Major)
- Jobs proximity map Phase 1 (installs + service + crews)
- Phase 2+3 — Week/Backlog, tickets, inspection/survey, UX polish
- Project numbers, richer info, D&R + roofing markers, shop filter
- Dispatcher office pin + morning briefing + nearby highlights
- Assignee filter + scheduled-today markers never cluster
- Call + add-note quick actions

### Deal Detail Page (Major)
- Read-only deal record view at `/deals/[dealId]`
- Zuper status history, BOM, and schedule timeline fetchers
- Zuper job notes and HubSpot tasks in timeline
- Human-readable labels in sync changelog diffs
- Auto-expand notes + fix boolean sync for "Yes" values
- Strip HubSpot @mention markup from engagement HTML

### PM Accountability / PM Suite
- Project Management Suite landing page
- PM Accountability dashboard + weekly digest (Phase 1)
- Exception-based PM assignment system with page-load eval (live mode)
- HubSpot deal links + owner-id assignment fallback + missing-PM seed

### On-Call
- On-call electrician emergency call log
- Admin call logging and HR sheet export
- Sun-Sat weeks + 6pm-10pm weekday / 8am-12pm weekend shifts
- Per-state Google Calendar staging (invites off until go-live)

### HubSpot Property Custom Object (Major)
- HubSpot Property custom object v1
- Design spec and implementation plan committed

### Catalog / HubSpot / Zuper
- Phased HubSpot manufacturer enum enforcement
- Auto-add unknown brands to HubSpot manufacturer enum + notify TechOps
- Sync Modal executions logged to ActivityLog
- Zoho writes switched from `group_name` to `category_id`
- Zuper spec-derived custom fields on product create; dimensions on product create

### Meetings
- Shit Show Meeting Hub
- IDR Meeting Hub: prep mode, skip, shit show flag; two-column dense layout
- Meeting prep queue with escalation + design review support, DA status actions
- Real-time collaboration, HTML note formatting, @mentions
- Sales folder, PM task on sync, open-all links; drop needs-resurvey UI
- Live preview mode, exclude On Hold deals from IDR queue
- Recovery from accidental "End without syncing" + two-click confirm
- Start meeting scoped to Colorado, California, or all

### Accounting
- Invoice-first bucketing + three new accounting pages

### Office Performance
- SLO + Camarillo combined into single California dashboard

### Compliance
- Per-service-task scoring + status bucket fixes (flag-gated)

### Product Request
- Sales product request page (equipment + adders → OpenSolar)
- Cost estimates + deal lookup

### EagleView
- TrueDesign auto-pull pipeline (Tasks 1-9)

### IT / Audit
- Audit-sessions, anomaly-events, and user-roster endpoints for IT team
- Read-only activity-log export API

### Scheduling
- ScheduleEventLog — capture Zuper reschedules and crew changes

### Solar Surveyor
- Render EagleViewPanel when `?dealId=` URL param is set

---

## 2026-03-31 (mid-to-late March)

### Deal Funnel Dashboard (Major)
- New `/dashboards/funnel` — sales-to-completion funnel with conversion arrows
- Monthly grouped bar chart + cohort table with conversion percentages
- Backlog callouts, DA pacing, cancelled revenue
- Multiselect locations, pacing revenue, stage distribution
- Timeframe clarity, expanded options, pending sales change tracking
- Drill-down deal lists for each backlog bucket
- Suite navigation links to Executive and D&E suites

### End-of-Day Email (Major)
- New EOD summary email — cron-triggered snapshot diff
- Broad HubSpot queries with milestone detection + property history enrichment
- Completed-task search for tracked leads
- Per-person task and change counts
- Attribute changes by who made them; morning snapshot saved after daily focus emails

### Accounting Suite (Major)
- New Accounting Suite with PE Deals & Payments dashboard
- Payment Timeline dashboard for Accounting suite
- Payment volume bar chart with day/week/month toggle
- PE deals M1/M2 status dropdowns with HubSpot sync
- Compact PE deals table — truncated names, short locations/types
- All roles granted access to Accounting suite and PE deals

### Service Suite
- Service Suite Phase 1+2 — suite split, priority queue, tickets
- Service Catalog + SO Creation (Phase 4)
- Service suite enrichment — shared enrichment layer + Zuper cache sync
- Customer History dashboard page with search and slide-over detail
- Multi-entity search + grouping; company contacts with address scoping
- Deal/ticket/Zuper association resolution
- Multiselect filters + ticket owner for service pages

### Scheduler Overlays
- Fetch service & D&R jobs from Zuper and map to OverlayEvent
- Render overlay events in month/week/Gantt with distinct styling
- Service and D&R toggle buttons; collapsible project sidebar with localStorage persistence
- Overlay detail state, color helpers, and read-only popover

### Site Survey Readiness
- Site survey readiness checker and FDR webhook
- Sam Paro survey slots updated in hardcoded availability fallback

### Deal Mirror + Sync Relay (Major)
- Deal Mirror sync engine, Comms Dashboard, and cross-system Product Sync
- SyncModal rewrite with wide comparison table and per-cell source selection
- 10 new mapping edges; zoho `part_number` and `unit` bidirectional
- Generator fields visible and toggleable in SyncModal
- Zoho pricing quality audit endpoint; cross-system product pricing comparison

### Pricing Calculator
- Deal import & compare; deal-import API endpoint with search and import modes
- `matchLineItemToEquipment()` and `LOCATION_SCHEME` helpers

### Inspection Metrics
- New inspection-metrics dashboard with drill-downs and action queues
- API route with dual-source validation
- Route permissions, page directory, ops suite card

### Preconstruction Metrics
- New preconstruction metrics dashboard
- Meeting action items — construction metrics, DA performance, availability approvals

### Forecasting
- Forecast schedule page with pipeline breakdown

### BOM
- BOM push to HubSpot with UI, migration, and role fixes

### Office Performance TV Dashboards
- Office performance dashboard page + per-location TVs
- OfficeCarousel container with rotation, pinning, keyboard nav
- CarouselHeader, Leaderboard, GoalProgress components
- Goals & Pipeline carousel slides; Office Calendar carousel slide
- Roofing and Other Zuper jobs on TV dashboards
- Live clock replaces static "Updated" timestamp
- Two-tier base + stretch goals with gold progress bar
- Weekly goals digest email — one per office
- Site Survey and PTO Granted goal lines

### Zuper Compliance
- Executive and Ops Manager access to Zuper Compliance page
- Zuper cache sync as Vercel cron (every 30 min)
- Daily focus email cron for P&I and Design leads

### Pipeline / Service
- Pipeline selector & per-pipeline stage sorting
- Per-pipeline stat cards, clickable links & sticky table header
- Dynamic pipeline stage resolution from HubSpot API
- Pipeline-ordered stages + active only toggle on service page
- Include HubSpot deal record ID on Zoho Sales Orders

### Scheduling
- Scheduler forecast ghost events
- Survey reassignment notifications sent to both surveyors
- Crew schedule dashboard — see where every crew member works each day

### Miscellaneous
- Catalog validation + admin section cleanup
- Return all assigned users from Zuper jobs-by-category API

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
