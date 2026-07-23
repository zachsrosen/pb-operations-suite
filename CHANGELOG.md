# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-07 (through 2026-07-17)

### Permit & Interconnection Hub (Major)
- Consolidated the six-tab job view into one organized layout with tabbed queues grouped by action kind
- IC Hub now maps the as-built round trip to real action kinds and mirrors permit-hub tabs including "Other"
- Dropped in-flight revision statuses and "Rejected" from the queue (design owns those)
- Show deal stage in hub queues, exclude roofing terminal stages, and display HubSpot status labels instead of internal values
- AHJ turnaround now renders in days (was raw milliseconds)
- Scope Hub correspondence to the project rather than the shared utility/AHJ email
- Extract clean identifier tokens from polluted app/permit fields
- Fixed mark-done actions writing invalid status values
- Fixed CA shared-inbox addresses
- Multiple layout fixes: tab strip wrap, dropdown drag scoping, five-tab single-row fit

### PowerHub Fleet Monitor (Major)
- Sortable columns, filters, and CSV export on fleet monitor
- Alert Type filter, active alerts toggle, inline alert names + open-ticket links
- Dedicated Monitor column on every row; Monitor link for sites without active alerts
- Alert chips link to the site's live monitoring; show all chips per row (dropped +N overflow)
- Tesla concern ticket links, customer column, HubSpot label resolution (deal names, ticket subjects, contact names, stage labels)
- Resolve customer via PropertyDealLink for GEO-linked sites
- Capture Tesla RMA severity and stop dropping unmapped alerts
- Refresh severity on existing alert rows during poll
- Info columns, voltage-based grid cell derivation (dead grid_connected_status signal replaced)
- Count Powerwall 3 as batteries, not gateways; idempotent device-count backfill
- Persist Tesla token in SystemConfig to stop token-endpoint throttling
- Calm fleet monitor UI: stable rows, customer-first identity, visible sort

### SolarEdge Integration (Major)
- Live SolarEdge fleet monitor (schema → sync → dashboard)
- Customer/deal links, open-ticket enrichment, table polish
- Named alerts and alert-type filter (export-sourced)

### Tech Ops Bot (Google Chat)
- Per-rep daily worklist DM (their own deals, 4 sections); scoped to their own deals, blocks company-wide aggregates
- Manager rollup worklists (Ben gets all DAs pending sales changes)
- Mirror every outbound bot message to the oversight space; stop double-mirroring
- New tools: `get_pe_docs` bulk PE document-status lookup, `query_jobs` general Zuper field-job query, `query_projects` multi-pipeline + two-level grouping + date filtering + includeReason
- `get_deal` returns full labeled status snapshot including DA/layout_status, exposes sales-change/rejection reason notes, answers "why is PROJ-X <any state>"
- PE payments, revenue goals, exact stage revenue tools; real week-by-week PE payment breakdown
- Real tables via monospace code blocks (Chat blocks markdown tables)
- Prompt-cache the system prompt and tool schemas (toolRunner)
- One clean final answer, chunk long messages, higher max_tokens to prevent truncation
- Rotate 'thinking' ack messages, help/menu reply, neutral metric commentary
- Full pbtechops.com URLs for app pages (not bare SOP paths)
- Deactivated owners → manager routing on worklist delivery
- Raised Chat webhook maxDuration from 60s to 300s for heavy queries
- Stop fabricating breakdowns from aggregates; data-integrity prompt rule

### Ready-to-Build Review Queue
- New RTB Review Queue tab on the review page with status labels, deal stage, PM/location filters
- Added columns: project type, revenue, IC status, deal/drive links, line items, PM names, DA Paid, payment method, loan status, earliest install availability, permitting status, days-in-stage
- Fully sortable un-merged columns, always-visible line items, condensed table width
- RTB-Blocked PM review gate with editable notes
- Ready tab 'Released' reads pm_rtb_approved_date, not the flag
- Fixed re-blocked deal reading un-released until Release is pressed again

### Sales Funnel & Pipeline
- Blocked toggle + waiting-since/scheduled dates in drill-downs
- New Construction indicator with hide/show toggle
- "Hide cancelled" and "hide project-rejected" toggles (mirroring on-hold)
- Use Close Out Status for the Close Out stage and backlog
- Reconciled Interconnection Cleared card with the backlog
- Scoped Awaiting Interconnection Approval to genuine IC waits
- Fixed total:0 empty searches blanking the pipeline
- Sales Funnel defaults to This Year; drill-down polish

### Deal Sync
- 15-min cron refresh with visible "deals synced N ago" freshness badge
- Batch writes, stabilize the diff, add a staleness alert
- Repointed HubSpotProjectCache readers to the Deal mirror table

### Team Activity Report
- Weekly report-card email digest
- Tasks/day and Property updates/day metrics
- Drop integration-app Drive events from the google source

### Bottleneck Monitor
- Bottleneck Monitor v2: stalled vs. zombie, owner rollup, real activity signal
- Bottlenecks tab on the project pipeline funnel page
- Bottleneck digest polish: hyperlinked deals, team worklists, personal DMs, presets

### Participate Energy
- Milestones tab bucketed by document state
- Opened PE AVL dashboard to all roles
- Trim resurfaced rejection notes to the current review cycle (doc + team paths)
- Stabilized pe_doc_*_notes ordering to stop duplicate rejection emails
- Match Ready-view stat cards to their drill lists

### IDR Meeting Hub
- New Construction and D&R/Service design review types
- Escalation photo attachments in the IDR meeting hub; escalation photos above site photos
- Show customer name for Service/D&R deals in the meeting queue

### Scheduler
- Survey invite button generates a copyable link (no email sent)
- Re-enabled PM survey invite with status badges and gated button
- Close customer survey invite when ops books via the app
- Blocked survey double-bookings at booking time and on customer book/reschedule
- Portal customer-facing survey portal emails kill switch

### On-Call Rotations
- Real emails for the PTO lifecycle (replaces notification stubs)
- Email notifications for the swap lifecycle
- Allow swaps any distance out, swap whole week blocks
- Swap picker shows one row per week with full date range

### Admin Workflow Builder
- New `create-zuper-job` action with property-change webhook feed
- Links created job to the deal's Zuper project; full Tray parity
- Accept propertyName/value via query params on the property webhook

### Bug Fixes & Infrastructure
- Service ticket time-in-stage measured from stage-entry date, not modified date
- Score ticket age in priority queue; Type dropdown filter on service overview
- Restrict priority-queue overrides to ADMIN only
- Zuper: stamp `job_timezone` so CA customers get Pacific-time notifications; stop attaching demo customer to created jobs
- Blank crew zuperUserUid matched every survey in conflict scan (fixed)
- Middleware: never cache role-denial redirects; allowlist product-sync and zuper-field-activity-sync crons
- Weekly Neon preview-branch sweep cron to cap extra-branch cost
- Move feedback + chat launchers into the header chrome

---

## 2026-06

### PE Analytics Hub (Major)
- Consolidated PE views into `/dashboards/pe` with tabbed hub (deals, docs, analytics)
- Doc Uploaders: 3 tabs (Submissions / By Day / Approved $), day/week/month grain, drill-downs on every outcome, distinct-deal counts, Owner⇄Shared credit toggle (fractional by version)
- Doc Uploaders payment ownership modes: Owner, Fractional, Last-Submitter
- Uploaders Explorer with filters by document + uploader; segment-level drill-down on charts
- Superseded uploads drill-down showing who superseded each doc
- By-Team collapsed-row summary, per-team QC rejection notes from reviewer input
- Rejections-by-Document (open/resubmitted/approved) with full drill-downs
- Live-pull per-team M1 rejection notes on rejection
- Payment $ view with drill-down; Layla credited for unattributed / pre-tracking uploads
- Copy + CSV exports on drill-down panels and by-view tables
- Weekly cron writes avg submission→payment days, CC→payment days, and forecast legs
- Timing tab: CC→pay first through remittance→pay; Inspection/PTO → Submit added; M2 aged from M1 approval
- "Expected (Submission)" and "Expected (Paid)" forecast modes on weekly chart
- Milestones/Lifecycle split; Resubmitted band; Ready/Submitted lifecycle basis
- Aggregate drill from totals cards; funnel totals strip on weekly chart
- Rejections cohort view; Re-Rejected After Approval report
- Daily ANCHOR clawback alert (approved docs re-opened)
- Advance Approved milestones to Paid from invoice paid-in-full date (gated by SystemConfig flag)
- Doc submission outcome %s and avg review times
- Cron self-heals PE payment splits so KPI funnel doesn't undercount
- HubSpot Deal card for Participate Energy status
- Manual Sync button + auto-sync on tab visit; "Last synced X ago" indicator
- API sync writes NOT_UPLOADED rows for docs the API omits
- API sync pushes doc statuses to HubSpot deal properties (fixes blank Notes)
- Loosen rejection-task matcher so task names are freely renameable
- Auto-advance Rejected → Ready to Resubmit when rejection tasks done
- Auto-advance onboarding + internal rejections too
- Retire the PE portal scraper webhook (was corrupting doc statuses)
- Address-based project matching + auto-stamp portal links
- Bill of Materials tracked as its own M1 document (conditionally required)
- "Not Required" as a real status for conditional docs
- Editable per-doc blocker notes; deal-level PE Info Needed
- Skip PE doc sync overnight (10pm-6am MT); full (not incremental) every 30 min
- Stop exhausting the PE daily API quota
- Doc-level PE re-approval count on Re-Rejected report

### Project Pipeline Funnel (Major)
- New Design & Engineering funnel with revision loops, reused project-funnel milestone logic, awaiting-design-upload / design-review / awaiting-site-survey buckets
- Status Funnel rendered as branch/tree
- Milestone Progression cohort chart: weekly bins, PE-style sizing, click-to-drill-down, Lifecycle view, chain to Closed Out
- Milestone Cohort view; sales-cohort funnel tab
- Cohort charts: finer lifecycle, drill-down detail, week/month toggle, segment drill, sort + copy, headline summary cards
- Lifecycle: Cancelled and On-Hold surfaced as their own segments
- Bottlenecks tab; RTB milestone bucket + Project Rejected reason flag
- Company-wide access + 3-way RTB split (interconnection / blocks / bench)
- Daily-trend panel (event throughput + recorded backlog state)
- Revenue Conversion by Cohort table
- Awaiting DA Send column shows design approval status
- Data Quality panel for missing reasons
- PE + On-Hold filters on Project Pipeline and D&E funnels
- RTB-Blocked reason fallback to Kat's notes; drop install notes fallback
- Backlog aging + sales-change reason fallback
- Ready-to-Build + Interconnection Approved milestone cards (monotonic)
- Incoming tab: DA→RTB inflow forecast, "not here yet" stacks by where deals are, avg upstream arrival time per step
- Capacity & Backlog row (RTB bench + runway) on Incoming
- Cancelled revenue and cancelled deals surfaced at each gate
- Location-matrix hero, PM/owner filters, trend vs prior, URL state
- Simplify conversion to compact arrow + colored numbers + legend
- Days-in-stage, per-stage revenue, status labels, conversion % polish
- Reworked D&E funnel: status funnel + by-deal-stage breakdown
- Milestone Payments view: IC/PC pipeline by stage then status
- Cache: stop transient empty fetches from blanking the pipeline page
- Ops suite: Project Pipeline Funnel card added

### Google Chat Bot Deepening
- Proactive daily digest DM'd to the owner; tailored per-room digests; `?preview=1` renders without posting
- Post scoped daily digests to team Google Chat rooms
- Real fleet schedule from ScheduleRecord (replaced calendar stub)
- New tools: `get_project_team`, `get_project_service`, `get_project_status` (returns project type + PE IC/PC payment amounts), `count_deals_by_status`, `list_deals_by_status`, `query_projects` (general deal query)
- HubSpot task creation with named-person assignment, exact deal matching, echo deal name
- `log_correction` to capture in-chat corrections; admin Corrections tab with Apply-to-playbook button
- Full-pipeline status coverage: construction, inspection, PTO; PE M1/M2 milestone status breakdowns
- Encode DA lifecycle phases (Review In Progress = pre-send); lead with waitingToBeSent for DA questions
- Revenue rollups + milestone date-range queries; location filtering on deal tools
- Rename OOO bot internals to Tech Ops bot; drop OOO framing
- Assistant bot: process-request filing; admin OOO bot escalations review dashboard
- Real personal worklists mirrored to owner tracking space
- Real-time bot usage mirror to tracking space
- Bot message audit log, personal deep-links, compliance rework
- Force-provision bot DMs via domain-wide delegation

### Team Activity Report (Major)
- Cross-system employee activity report + admin page
- 6th source: Participate Energy
- Expand Google source to Drive + Meet + Chat
- Zuper field activity as a real source (ExternalActivity)
- Ad-hoc "look up anyone" section
- Drill down into a day's raw event timeline
- Source toggle chips (view only chosen systems)
- Aircall call detail in drilldown; PB Ops renamed to PB Tech Ops
- Richer drilldown: Zuper + task names, Copy button
- Resolve deal names in drilldown; refresh lookups on range change
- Exclude PTO days (calendar OOO) from averages
- Correct roster identities (were partly fabricated)
- Parallelize per-person HubSpot/Google pulls; 14-day default
- Gate on SystemConfig DB flag + Google reports admin

### Workflow Map & Flow Map
- Workflow Map: live HubSpot automation + SOP reference dashboard
- Zoomable flowchart view (pipelines → stages → workflows)
- Process view: plain-English end-to-end pipeline walkthrough (expandable per stage)
- Curated vertical-swimlane Process view (Design intertwines, Permitting parallel)
- Accurate Design process (parallel tracks → AND-gate → stamps branch)
- Family-lane stage layout, write-only status mapping, name+status stage mapping, task edges
- Resumable backfill, admin Build/Re-sync button

### EagleView / TrueDesign Orders
- Full TrueDesign CAD/DXF pull: OAuth foundation + webhook (flag-off)
- Orders dashboard: default filter, status filters, PB location filter, deal links
- Order details drawer; link Report # to EagleView TrueDesign
- View in TrueDesign link on EagleView panel; DB-backed toggle for HubSpot stamping
- Save shade as .zip; backfill late-arriving measurement files
- Order TrueDesign by geocoded address, not stale stored coords
- Show Design Lead on each order (resolved via owner map)
- Stamp order status onto HubSpot deal/ticket

### Enphase Enlighten Integration (Major)
- Enphase Enlighten API integration at PowerHub parity (schema → sync → dashboard)
- Partner OAuth setup route for installer auth flow

### Atlas / Map
- Embed Atlas as a top-level destination
- Surface Atlas map card in Operations, PM, and Service suites

### Freshservice
- Create tickets via API instead of email (with email fallback)

### PowerHub
- Clear stale alerts on sites that drop out of the poll

### IDR Meeting Hub
- Remove a project from the queue

### Scheduler v2 (Flag-Gated)
- Phase 1: construction dispatch board (flag-gated, additive)
- Gate on SystemConfig flag (Vercel env cap workaround)

### Scheduler
- No survey availability slots on PB holidays
- New Construction as its own tab between Ops Surveys and Pre-Sale
- Show Needs Revisit + New Construction surveys in three groups
- Keep revisits in Ops Surveys after status flips to Ready to Schedule
- Fixed DTC office filter hiding all survey availability
- Swap Rolando → Lenny for all Colorado Springs field work
- Completed surveys & passed inspections no longer show as overdue

### Vishtik
- Sync `vishtik_project_id` + `vishtik_project_url` onto deals
- Offset pagination for Get-Project lifts silent ~2,280-row fetch cap

### Bug Fixes & Infrastructure
- Cross-instance shared cache + single-flight for projects/deals
- Pause 3 HubSpot-heavy crons to relieve rate-limit outage
- TSRF Calculator: estimate annual clipping hours
- Morning sweep: proactive daily task & ticket digest
- Ops suite: Project Pipeline Funnel card
- SystemConfig-backed runtime config + TrueDesign public-client wiring
- Portal: hide PWA install prompt on survey portal
- Centralize Claude model IDs, replace retiring Sonnet 4, bump to current models
- Directory identity links: User ↔ HubSpot owner / Zuper user / CrewMember
- Page Traffic analytics (admin): views, dwell, dead-weight, per-user
- Merge UPLOADED and UNDER_REVIEW into a single "In Review" status
- On-call: Monday-start weeks + drop California Sunday coverage
- Cohort chart labels placed directly above each bar

---

## 2026-05

### Participate Energy Pipeline (Major)
- PE Deals dashboard: split into Pre-Construction vs Construction+; stage buckets on pipeline bar; multi-column sort; Awaiting PTO segment; auto-rename Other → On Hold
- PE Report / Analytics: sortable columns, customer payment status from HubSpot invoices, actionable ownership visibility (PE Program Report)
- PE document tracking with portal data; per-project document checklist and filters
- PE Portal CSV import to supplement scraper data; PE scraper sync parses portal HTML reports into PeDocumentReview
- PE Raceway API sync replacing HTML scraper; PE portal scraper GCS cron removed (webhook is sole sync path)
- Two-way PE document status sync with HubSpot deal properties
- Instant email notification on PE doc status changes
- PE deals doc breakdown + invoice audit + email sync
- PE action items feed + incremental sync + hourly cron
- Group PE action items by deal with clickable HubSpot + PE Portal links; collapsible deal groups; auto-resolve on doc approval
- Cross-reference PE Action Tasks (MVP) with PlansetAnalyzer, HardwareAnalyzer, SalesOrderAnalyzer, InboxScanAnalyzer
- Auto-trigger cross-ref after PE audit completion
- PE Submission Gap report: CC-hit deals with incomplete M1/M2
- Under Review hero card; payment volume bar chart with day/week/month toggle
- Payment Timeline dashboard for Accounting suite
- PE portal + Drive links in analytics drill-down rows
- Rename confusing 'Milepts' column to 'Milestones'
- PE Approved Vendor List dashboard page
- PE & Compliance Suite consolidating PE + compliance pages
- PE Prep landing page (deal queue + audit history overlay)
- PE Photo Builder: self-serve Photos-per-Policy builder (web tool), resolvable by PROJ number or customer name
- PE audit split into docs + photos pipelines (independent timeouts)

### PE File Preparation (Major)
- AI vision audit, PandaDoc auto-pull, prep dashboard
- Vision classifier: few-shot reference library + AVL cross-check
- PandaDoc name-only + customer-name fallback searches; multi-template-id support
- Pre-upload photos + cache Anthropic file IDs to eliminate redundant work
- Batch photo triage: 1 API call replaces 36+
- Deep PE verification for photos and documents
- Recursively list Drive subfolders for doc candidates; widen AHJ permit search to Inspections + Permitting folders
- Prioritize PE-named photos for triage; scale triage max_tokens with photo count
- PE-file-prep skill documented in claude/skills

### Tesla PowerHub Integration (Major)
- Fleet monitoring dashboard with expandable site table
- Three-tier site-to-deal linkage with tests; auto-link Tesla sites to HubSpot properties
- Cron handlers for asset sync, telemetry, and alerts
- PowerHub alert scoring feeds service priority queue
- OAuth2 client_credentials auth; live-verified API alignment
- Correct API base URL to gridlogic-api.sn.tesla.services
- Fly.io proxy region: dfw (den deprecated)
- Enrich SiteDetail with HubSpot deal, property, and system details
- Capture every Tesla telemetry signal + alert metadata; surface all device serials
- Cross-system Tesla portal URL linking (HubSpot + Zuper + Suite)
- Push all Tesla device serials + models to Zuper Property/Job
- Geo-coordinate matching via portal-imported lat/lng
- Rewrite alert sync to use group-level API with DIN mapping
- Batch telemetry, alert, and asset polls to avoid Vercel function timeout
- Query available signals before telemetry; handle invalid alert dates
- Filter empty sites, sort by data, add search + stats
- Fallback to site_id when site_name is null
- Derive battery SoC from energy-remaining when SoC signal is missing
- HubSpot PowerHub sidebar card (compact) — native UI Extension with v3 signature verification
- Persist Tesla product model columns in Prisma

### Shop Health Dashboard (Major)
- Weekly Shop Health Dashboard with drill-downs for sentiment, 5-star reviews, response time
- Preconstruction section expanded with throughput and cycle times
- Customer Success section with sentiment scoring, 5-star reviews, contact response metrics
- Multiple bottleneck entries per shop per week
- Service + D&R/Roofing sections
- Revenue hero card and pipeline revenue detail
- Targets derived from OfficeGoal DB revenue goals
- Deal-level response rollups; review drill-down fix
- Cache fetchAllProjects to prevent concurrent 429s; lightweight overview path

### Google Chat OOO Bot (Major)
- New Google Chat OOO bot
- Support Google Workspace add-on envelope format
- Multiple JWKS sources for Google Chat JWT auth; accept multiple JWT audiences
- Post replies to main timeline instead of a thread
- Base64-encoded service account key handling
- Detailed Chat API error capture + async diagnostics

### PE Doc Change Digest
- Restructure digest into 4 actionable sections
- Drop Today's Changes; add Google Drive folder link to each deal
- Mirror digest email with actionable sections + Drive links
- Show time since last update on the PE Doc Update email
- Show full status breakdown in Nearly Complete section
- Relabel notes-only PE doc changes instead of "Uploaded → Uploaded"

### Property Hub (Major)
- Full-page property view at `/properties/[id]`
- Map, stages, ID lookup, rollup fields
- Show deal names instead of IDs
- Contact names and HubSpot link in Property drawer
- Photos tab with Zuper job photos
- HubSpot and Zuper external links to Property Hub tabs
- Header with equipment summaries, revenue, and Zuper link
- Cache extended rollup fields locally
- Zuper Property sync (write direction)
- Link Zuper projects to properties during sync
- Associate Zuper properties with customer on create/update
- Verify address match for single-candidate property links
- Correct Property association type IDs
- Inngest queue for property sync workflows
- Enrich Activity tab with engagement metadata
- Show HubSpot line items in Equipment tab

### Aircall Call Analytics (Major)
- Call analytics dashboard (Phase 1); executive Phase 2
- Per-user answer rate via ring tracking
- Analytics+ ringing-attempts CSV import for historical data
- On-Call Calls section from OnCallCallLog
- Customer phone/address + HubSpot contact on call log

### Pipeline Tracker & Design & Ops Meeting Hub
- New general Pipeline Tracker dashboard with Construction/Inspection/Site Survey tabs
- Status filters (per-type), sortable status columns; PE Pipeline Tracker with M1/M2 removed
- Total revenue and per-stage revenue hero cards
- Design & Ops Meeting Hub in Operations Suite
- IDR sync completes HubSpot task + RE-REVIEW badge
- IDR revision workflow: re-review toggle, auto-appear, revision reason sync
- IDR Meeting BOM Review & Line Item Editor
- Previous review notes for re-reviews + richer search results
- Compare planset layout against DA layout in design review
- Fix AI design review flagging utility meters as production meters

### Zuper Integration
- Per-endpoint API call counter + admin read endpoint
- ~97% reduction in API calls by caching job list in lookup endpoint
- Zuper-drift PM dashboard for Zuper↔HubSpot status drift; per-sub-type evaluation + install_status rollup integrity check
- Throttled: property-sync 2h→6h, backfill hourly→6h, sync-cache 30m→4h, zuper-property-sync /15min→/30min
- Explicit caller attribution for [zuper-call] log
- Skip API sweep on DB-cache hits + cache /jobs/by-category
- Restore custom_fields for pre-sale jobs; omit job_type on pre-sale creation; fix customer name
- Zuper API fallback for sibling lookup + status update
- Reschedule lookup sorts jobs newest-first

### Portal / Customer-Facing Survey
- Redesign customer survey portal, brand palette to match photonbrothers.com
- Subdomain isolation, inline cancel, scroll fix
- Service-to-service survey invite endpoint for Olivia
- Remove unrecognized phone number from footer

### Scheduler
- Show orphaned resurvey/re-inspection jobs in master scheduler
- Editable date picker to drag-drop reschedule confirmation
- Weekend visibility toggle (weekend toggle no longer shifts events to Saturday)
- Only pre-sale jobs show as purple cards
- Dedup pre-sale cards + click modal
- Sub-job breakdown view for construction cards; show Zuper job status in all scheduler modals
- Reschedule all sibling construction sub-jobs together
- Skip tentative siblings in cascade reschedule
- Day view timed grid for surveys/inspections
- On-call electrician overlay on master schedule
- Construction job split: Solar / Battery / EV
- Individual sub-job Zuper links in schedule modal
- Add SubJobScheduleModal (wired into master + construction schedulers)
- Show pre-sale surveys on calendar
- Preserve sub-category in ZuperJobCache when scheduling/confirming

### EagleView
- EagleView Orders dashboard page
- Sandbox integration test page for Go-Live proof; production PlaceOrder request format
- Normalize PascalCase API response keys to camelCase

### Executive / Funnel
- Project Pipeline Funnel dashboard (9-stage sales-to-construction)
- Monthly Activity table on project pipeline funnel; named timeframe presets
- Staff assignment columns to drill-downs
- Add close out, activity table, drill-down dates
- Rework D&E funnel; PandaDoc DA link + plan docs on IDR
- Rename OWNER→EXECUTIVE across role guards

### Freshservice
- Comprehensive batch fixes
- Increase publish timeout for 6-month horizon

### On-Call
- Auto-create HubSpot service ticket on follow-up
- Roofing issue type, 3-way outcome, pool-filtered crew dropdown

### Product Catalog Sync Health
- Sync Health page: drift rollup across InternalProduct/HubSpot/Zuper/Zoho
- Cost Audit: cross-reference Zoho bills against item purchase rates; bulk-sync costs to latest bill; suggested sales price
- Sales price, margin, and cross-system link badges

### TV Dashboards
- Rich deal list with Zuper status, PE flags, unified layout
- Fixed completed deals, goals labels, inspections rename
- Show all calendar event types with assignees
- Lower 5-star review goals to 20 base / 25 stretch company-wide
- Stack deal lists above compliance block

### Bug Fixes & Infrastructure
- Compliance-v2: per-service-task scoring + status bucket fixes (flag-gated)
- Extend spreadsheet update script for AHJ/Utility custom objects
- Auto-reload pages on new deployment (superseded by newer patterns)
- Weekly goals digest email — one per office
- Two-tier base + stretch goals with gold progress bar
- Add Site Survey and PTO Granted goal lines to monthly goals
- Update California annual revenue target to $9M ($750K/month)
- Crew schedule dashboard — see where every crew member works each day
- Cache-warming cron for office performance to fix 504 death spiral
- Comms: verify Gmail identity matches PB user during OAuth connect; wrap useSearchParams in Suspense; fail-closed mailbox verification
- Fix 460 Sentry events from OWNER enum deserialization
- Escalation revisions trigger as-built design status
- Unified timelines + property sync validation
- Relax survey lead time to 1 day for California sales reps
- Add Pipeline Tracker link to PE Pipeline page
- Design & Ops Meeting Hub added to Operations Suite
- Sub-job scheduler bypasses tentative mode; default scheduler Zuper sync to tentative
- Read pb_location directly from service tickets
- Ticket-context BOM links + clean dealname; Service BOM page (deals + tickets) with ticket-keyed snapshots
- PandaDoc DA status drift detector as backup for HubSpot connector

---

## 2026-04

### Admin Workflow Builder (Major)
- Backend scaffold (Phase 1) + editor UI + CRUD API (Phase 2)
- Palette: send-email, ai-compose, update-hubspot-property, update-hubspot-contact-property, add-hubspot-note, create-hubspot-task, update-zuper-property, run-bom-pipeline, log-activity, http-request, find-hubspot-contact, fetch-zuper-job, plus control flow (delay, stop-if, parallel, for-each)
- Webhook fan-out for HubSpot + Zuper triggers; CUSTOM_EVENT trigger type + emit helper
- CRON trigger type + dispatcher cron; per-workflow rate limiting
- Best-effort idempotency via DB checkpoints; action-level idempotency for create-actions
- Dry-run mode; failure alerts + Zuper property discovery
- Workflow versioning (snapshot on save + rollback); export/import workflow JSON
- Duplicate workflow; step reordering; drag-to-reorder on canvas
- Visual canvas preview; analytics dashboard; per-run detail page with step output drill-in
- Cross-workflow run history page
- Select/multiselect dropdowns with dynamic options; dynamic option re-fetch + unified property options
- Inngest auto-sync on deploy + manual resync button
- Templates library + starter templates

### PE Deals & Accounting Overhaul
- New Accounting Suite with PE Deals & Payments dashboard
- Payment Tracking + Payment Action Queue split into two pages
- Attach HubSpot invoices to payment-tracking rows; match invoices to milestones by line item name (incl PTO + PE)
- Invoice-first bucketing + three new accounting pages
- Ready-to-Invoice attention signals from project triggers
- PE Deals: Fully vs Partially Approved split, Approved—Waiting on Payment section, Partially Paid section
- Static Treasury zip set for EC lookup replaces live ArcGIS
- Compact PE deals table (truncated names, short locations/types)
- Payment Tracking dashboard + ACCOUNTING role

### Solar Designer (Major)
- New Solar Designer app: DXF/JSON layout parser, V12-faithful physics/consumption/production, CSV shade parser
- Built-in equipment catalog with 8 panels, 9 inverters, 6 ESS
- Auto-string algorithm with voltage validation; mismatch module; clipping event detection
- Web Worker entry point for CoreRunner
- Stage 2: file upload panel with drag-and-drop, equipment/site conditions panels
- Stage 3: VisualizerTab with shade animation + satellite background; PanelCanvas SVG renderer; MapAlignmentControls; StringingTab with click-to-assign + auto-string; StringList with voltage validation badges
- Stage 4: ProductionTab, TimeseriesTab, InvertersTab with MPPT cards + reassignment + clipping
- Bypass Vercel 4.5MB body limit with Blob client upload
- Support per-panel shade CSVs, zip upload, folder drag-and-drop
- Merge incremental uploads instead of full reset
- Preserve manual MPPT layout on analysis re-run

### Office Performance Dashboards (Major)
- Full carousel dashboard: 7-slide TV rotation per office
- All-locations overview page at `/office-performance/all`
- OfficeGoal DB model for per-office monthly targets
- Team Results slide replaces Pipeline Overview
- Surveys/Installs/Inspections sections with CountUp, ProgressRing, AnimatedBar, AmbientBackground, staggered entrance, metallic podium
- Live Zuper API metrics replace cache-based compliance
- Compliance grading tightened, OOW usage %, side-by-side layout
- Reconcile crew breakdown with top-line totals
- Live clock replaces static "Updated" timestamp on all dashboards
- Statistical audit: turnaround cohorts, uid keying, bounded pass rate
- Cross-office crew attributed by deal location, not team
- Combine SLO + Camarillo into single California dashboard
- Add Service carousel slide to office performance dashboards
- Goals & Pipeline + Office Calendar carousel slides

### Deal Detail & Timeline (Major)
- Full deal detail page: read-only deal record view
- Deal timeline aggregation with composite cursor pagination
- POST notes API with background HubSpot + Zuper sync; DealNote model
- HubSpot engagement fetch and deal note creation
- ActivityFeed + CommunicationsFeed + TimelineEventRow + NoteComposer + DealActivityPanel components
- Zuper job notes, HubSpot tasks, status history, BOM, schedule timeline fetchers
- 3-tab layout + collapsible photos; site photo gallery
- Contact-associated emails in Communications
- Move HubSpot notes from Communications to Activity; move Zuper service tasks to Activity
- Strip HubSpot @mention markup from engagement HTML
- Human-readable labels in sync changelog diffs
- Auto-expand notes + fix boolean sync for "Yes" values
- Internal Deal link across scheduler family and remaining UI surfaces
- On-demand sync from HubSpot when deal not in mirror
- Photo proxy: unique attachment UIDs; unwrap Zuper envelope
- 13 enhancements to deal detail page

### IDR Meeting Hub (Major)
- IDR Meeting Hub — session/item/note schema, API routes, frontend
- Design & Ops Meeting Hub rename; hero card layout, line items, full names
- Meeting prep queue with escalation + design review support
- Live preview mode; DA status actions; end session button
- Real-time collaboration, HTML note formatting, @mentions
- Redis presence, SSE race guard; note lag eliminated
- Recovery from accidental "End without syncing" + two-click confirm
- Sales folder, PM task on sync, open-all links
- IDR Meeting Search History
- Auto-advance on sync; design revision toggle
- Start meeting scoped to Colorado, California, or all
- Full-width photos, standardize AC disconnect to TGN3322R
- Adders checklist + pricing breakdown integrated (10% threshold warning, tier adders, ops revision notes)
- Adders sync to HubSpot on manual and auto-sync
- Escalation revisions trigger as-built design status
- IDR Meeting Photos full-width layout
- Move AHJ & Utility Codes to left column for layout symmetry
- Escalation submitter surfaced in detail panel
- HubSpot Roof Type auto-populate; adder amount property, waiver warnings

### Property Object v1 (Major)
- HubSpot Property custom object v1
- USER_DEFINED typeIds for deal/ticket associate; drop AHJ/Utility HubSpot-side links
- Memoize AHJ/Utility by (state, zip) to cut backfill HubSpot calls
- Remove stale deal/ticket links during property reconcile
- Include ticket-only properties in Zuper sync
- Fix Zuper property misassociation with safety checks
- Property Hub — full-page property view at `/properties/[id]`
- Enhance Property Hub header with equipment summaries, revenue, Zuper link
- Show deal names instead of IDs in property drawer

### Sales & Marketing Suite + Estimator
- New Sales & Marketing Suite with 4 focused cards
- Add 6 scoped suite roles (Phase 1)
- Customer-facing solar estimator v2 (Phase 1)
- All 5 quote-type flows (EV, Battery, Expansion, D&R)
- Slim HubSpot properties (14 → 3) + iframe embed mode
- Port pricing + production config from original estimator
- Sales product request page (equipment + adders → OpenSolar); cost estimates + deal lookup
- Move Pricing Calculator from Accounting to Sales & Marketing
- Executive suite refinements; simplify to 4 focused cards

### Adder Catalog (Governed)
- Phase 1: governed Adder Catalog (foundation) — DB model + admin catalog
- Chunk 2: `/dashboards/adders` catalog UI
- Chunk 3: triage recommendation engine + `/api/triage/*`
- Chunk 4: rep-facing mobile triage UI + deal-detail embed
- Chunk 5: DB-backed adder path in pricing calc (opt-in)
- Chunk 6: OpenSolar sync scaffold behind kill switch
- Move catalog + triage cards to Sales & Marketing suite with IN PROGRESS flag

### My Tasks Dashboard
- Personal HubSpot tasks dashboard
- Personal HubSpot owner link per user
- Snooze, create, completed-this-week, bulk done
- Mark complete, sort modes, deal-stage filter
- Inline status + queue edit, shortcuts, URL state
- Typeahead lookups + New Task from deal panel; autofocus first row; admin-managed queue names
- Fall back to first.last@domain when login email is an alias
- Count badge; Suspense wrapping for useSearchParams

### Freshservice (Phase 1)
- Admin page + UserMenu badge for user's own tickets
- User-facing `/dashboards/my-tickets`
- Show tickets assigned to me (not filed by me); include Closed tickets with Closed filter chip

### Solar Surveyor
- Solar Surveyor renders EagleViewPanel when `?dealId=` URL param is set

### Roles & Multi-Role Access
- Phase 1: multi-role access + home-page redesign
- Phase 2A: migrate role → roles across all callers
- Phase 2B: delete shim, remove back-compat (column drop deferred)
- Runtime-editable role definitions (routes, landing cards, suites)
- Per-role capability overrides; per-user extra route grants
- Read-only Role Inspector at `/admin/roles`
- Super-admin break-glass safeguard; withhold super-admin email during impersonation
- Rebrand: PB Operations Suite → PB Tech Ops Suite

### Admin Shell (Major)
- Unified AdminShell + `/admin` landing + in-shell search (phase 1 IA)
- Consolidate `/suites/admin` into `/admin` — one admin landing
- Primitives batch 1: table, filter bar, detail drawer
- Primitives batch 2: bulk action bar, form, kv grid, detail header
- Refactor `/admin/activity`, `/admin/tickets`, `/admin/directory`, `/admin/audit`, `/admin/security`, `/admin/crew-availability`, `/admin/roles` to primitives
- `/admin/users` consolidates 3 modals into tabbed drawer
- Back-to-home link + UserMenu on admin shell

### On-Call Rotations V1 (Major)
- V1 on-call electrician rotations
- Weekly rotation + self-service swaps + merged Colorado pool
- Electrician self-service swap UI
- Admin/executive Activity view — all swap + PTO requests
- Emergency call log captured by on-call electricians
- Admin call logging and HR sheet export
- Per-state Google Calendar; go-live policy Apr 28
- Sun-Sat weeks + 6pm-10pm weekday / 8am-12pm weekend shifts
- Prefill dispatch timestamps
- Grant VIEWER role access to `/dashboards/on-call`
- Roofing issue type, 3-way outcome, pool-filtered crew dropdown

### PM Accountability
- PM Accountability dashboard + weekly digest (Phase 1)
- Exception-based PM assignment system
- HubSpot deal links + owner-id assignment fallback + missing-PM seed
- Live mode: page-load eval replaces daily cron
- Kill switch + scope + assign-by-PM (urgent) fixes
- Compound-risk + shit-show rules
- Project Management Suite landing page

### Shit Show Meeting Hub
- Shit Show Meeting Hub
- Decouple queue from active session
- Auto-snapshot on session create, always-on add button, refresh button
- IDR snapshot helpers for owners + statuses + equipment

### SOP Guide
- Batch SOPs: Catalog, Service, Scheduling, Forecast, AHJ & Utility
- Submitting a New Product SOP; Suites tab (overview + per-suite SOPs)
- Tools tab: BOM + AI Design Review + Service extras
- Executive + Accounting + Sales & Marketing tabs (role-gated)
- Meta-SOP: "How to Use the SOP Guide"
- Split Tech Ops tab into Design / Permitting / Interconnection
- WYSIWYG editor (TipTap) replaces raw HTML CodeMirror
- Auto-link `<code>/route</code>` mentions to actual app pages
- Drafts tab with PM Guide rewrite + Pipeline Overview
- Submit-a-new-SOP feature with admin review queue
- Hub-mode visibility flip — open by default
- Action Queues tab + Tools extensions

### Jobs Proximity Map (Major)
- Phase 1: installs + service + crews on a map
- Phase 2+3: Week/Backlog, tickets, inspection/survey, UX polish
- Assignee filter + scheduled-today markers never cluster
- Dispatcher office pin + morning briefing + nearby highlights
- Timezone-agnostic date comparison + per-kind count breakdown
- Layout fixes + strip completed jobs; D&R + roofing markers, shop filter
- Call + add-note quick actions
- Project numbers, richer info; territory map with office star markers

### Permit-IC Hub & Interconnection Hub
- Interconnection Hub v1
- `/dashboards/permit-hub` two-pane workspace for permitting team
- Sticky action panel + grouped queue + multiselect location
- Inline action panel, permit-lead filter, stacked filter row
- Resolved names + header quick-links + AHJ fallback
- Shared inbox thread fetch on correspondence tab
- Broaden Gmail search to OR context clauses
- Per-inbox OAuth workaround for blocked DWD scope

### EagleView TrueDesign Integration (Major)
- TrueDesign auto-pull pipeline (Tasks 1-9)

### Cross-System Product Sync & Comms
- Deal Mirror sync engine, Comms Dashboard, cross-system Product Sync
- Comms Dashboard revamp: expandable message rows, inline actions, unified inbox patterns
- Auto-pagination for inbox messages; Chat limits bumped
- OAuth redirect URI derived from request headers
- Include HubSpot emails outside inbox (reverted, then restored later)

### Compliance
- Rework scoring formula, remove Bayesian, add visible score breakdown
- Cross-office crew attribution by deal location, not team
- Aggregate grade
- Per-service-task scoring + status bucket fixes (flag-gated)

### Service Suite
- Service Suite Phase 1+2 — suite split, priority queue, tickets (extends into April)
- Service Suite: Jessica meeting followups + scheduler colors + unassigned KPI + BOM design_status trigger

### Executive & DA Metrics
- Split DA first-try into customer vs design + rework attribution
- Add Needed Sales/Ops Changes to DA summary row
- Current DA Pipeline summary cards + Not Yet Sent bucket
- Click-through drill-down on Current DA Pipeline cards
- Consolidate DA metrics, restructure approval queue, reorganize ops suite

### BOM Pipeline
- Inngest workflow engine behind INNGEST_BOM_ENABLED flag (spike)
- Sanitize filename before Claude Files API upload
- Use full drive scope for DWD token requests
- Subfolder-aware PDF listing in pipeline
- Recursive Drive subfolder search for planset PDFs

### Bug Fixes & Infrastructure
- ScheduleEventLog captures Zuper reschedules and crew changes
- Fetch Zuper photos from service task form submissions
- Deal photos: proxy Zuper photos + resolve team owner IDs to names
- Design & Ops Meeting Hub: all roles access
- Scheduler: filter day-cell availability count by project location
- Show HubSpot portal labels for design_status + layout_status
- Fix build: memoize sales funnel, extract relativeTime, optimize deal-import
- Tier refetch intervals: 15 min for low-volatility dashboards
- Send bug report emails from the reporter
- Bug/feedback launcher shows feature-request option
- Redirect to last page after login
- Preconstruction metrics dashboard
- Inspection metrics dashboard
- Territory Map dashboard for CO office boundary analysis
- EOD summary email: attribute changes by who made them
- Daily Focus email cron for P&I and Design leads; PE M1/M2 sections for Layla's morning email
- Design Pipeline Funnel: multiselect locations, pacing revenue, stage distribution, drill-down deal lists
- IDR Meeting: dynamic breadcrumb based on referring suite
- Service Suite: split into sections and swap Solar Designer for Solar Surveyor; add SERVICE user role
- Site Survey per-office daily cap + crew schedule updates
- Prevent cross-deal sub-job bleed on same-customer projects
- Tentative vs live mode visually obvious across all schedulers
- HubSpot Property object: v1 launch (full spec)
- Pin IDR sidebar/detail panels for independent scroll

---

## 2026-03 (from 2026-03-15)

### Cross-System Sync Relay (Major)
- Plan-based flow with auto-cascade replaces legacy sync API paths
- Plan derivation engine with conflict detection and hash
- Plan execution engine with effective state overlay
- POST /sync/plan API endpoint; GET /sync extended with snapshots, mappings, defaultIntents
- planHash confirmation token functions
- SyncModal rewrite: wide comparison table, per-cell source selection, value-based dropdowns
- Show effective internal values in intents view
- 10 new mapping edges; make zoho part_number and unit bidirectional
- Selective sync with per-field direction controls
- Generator rows visible and toggleable
- useSyncCascade hook for auto-cascade logic

### Customer History Dashboard (Major)
- New Customer History dashboard with contact-based lookup
- Search API: multi-entity search + grouping
- Detail API with company contacts, address scoping, deal/ticket/Zuper association resolution
- searchCustomers orchestrator + parseGroupKey validator
- Address-only detail lookup + Zuper job links
- Show customer address in slide-over panel header
- Paginate ZIP lookup, hardcode portal ID

### Service Suite Foundation (Major)
- Service Suite Phase 1+2 — suite split, priority queue, tickets
- Service suite enrichment — shared enrichment layer + Zuper cache sync
- Service catalog + SO Creation (Phase 4)
- Deal record ID on Zoho Sales Orders; auto-populate SO slide-over from HubSpot deal line items
- BOM push to HubSpot with UI, migration, and role fixes
- Multiselect filters + ticket owner for service pages; owner filter scoping
- Zuper Compliance page access for Executive + Ops Manager

### Revenue Goal Tracker (Major)
- New RevenueGoal model + REVENUE_GOAL_UPDATED activity type
- Config for revenue groups, goals logic, tests
- GET /api/revenue-goals with caching and auto-seed
- Admin config GET/PUT for revenue goal targets
- Monthly breakdown chart with hit/miss indicators; stacked bars, multi-select filter
- Variant A: progress rings hero; Variant B: thermometer bars hero
- Canvas fireworks animation for monthly goal hits
- Zuper-based recognition for Service and Roofing groups
- Executive suite integration; heroContent prop on SuitePageShell

### EOD Summary Email (Major)
- New EOD summary cron with idempotency, snapshot diff, and task query
- HTML email builder; per-person change count and task count sections
- Milestone detection with property history enrichment
- HubSpot completed-task search for tracked leads
- DealStatusSnapshot model for morning/evening diff
- Attribute automation changes to deal's role-property owner; Natasha added, Daniel removed
- Restructure EOD email by person, fix stage IDs, trim names
- Attribute automation changes to deal's role-property owner
- Signal-to-noise improvements

### Executive / D&E / Metrics Dashboards
- Design Approval metrics dashboard
- Site survey turnaround metrics dashboard
- Construction metrics: drill-down, clearer labels, RTB→Const Start rename, RTB→Schedule Date rename, CC→Inspection Passed replaces CC→PTO, in-construction table
- Preconstruction metrics dashboard
- Reshuffle execution/metrics tables
- Polish execution pages: StatCards, status pills, action table reorder
- Consolidate DA metrics, restructure approval queue, reorganize ops suite
- Design Pipeline Funnel dashboard with cohort table, monthly grouped bar chart, DA pacing, cancelled revenue, backlog callouts

### Scheduler & Scheduling
- Forecast ghosts for all pre-construction stages
- Pre-sale site visit Zuper flow
- Service & D&R overlay on master schedule (Phase 1)
- Collapsible project sidebar with localStorage persistence
- Service and D&R toggle buttons on calendar toolbar
- Overlay events in month/week/Gantt with distinct styling
- Per-status revenue cards to construction scheduler
- Overdue revenue + formatCurrency guard; completed month/year stats
- Alias-aware location mapper for overlays
- Off-by-one day alignment fix for construction scheduler month view
- Camarillo survey slots no longer bleed SLO availability
- Milestone status (not deal stage) on scheduler event click
- Adaptive pill density for fixed-height TV slides

### Pipeline / Deals Home
- Per-pipeline stat cards, clickable links & sticky table header
- Pipeline selector & per-pipeline stage sorting
- Home: show skeleton during pipeline fetch instead of false zero
- Owner and PM filters on all pipelines
- Hard navigation to Master Schedule card

### Catalog Form Validation
- Numeric range validation, inline errors, photo validation, vendor pair warning
- Inline validation errors in BasicsStep + DetailsStep + CategoryFields
- Client-side photo file size and type validation
- Detect stale zohoVendorId and show re-select hint

### Zoho Inventory
- Warehouse-aware Sales Orders and SO API improvements
- Preferred-vendor PO splitting — auto-split BOM items by Zoho vendor
- Cross-system product pricing comparison endpoint
- Zoho pricing quality audit endpoint
- ?format=csv query param for browser-friendly CSV download
- Dynamic pipeline stage resolution from HubSpot API
- SO creation: proper product names, Zoho-sourced totals, automated notes
- Use SO- prefix (not SSO-) matching project pipeline exactly
- Retry token refresh on Access Denied
- Correct Zoho Inventory URL patterns; add revenue to scheduler views

### BOM Pipeline
- Gate CREATE_PO step to RTB trigger + manual retry with prior PO state
- PO summary in pipeline notification emails
- Restore BOM pipeline webhook — add route alias, dual auth, health monitor
- Accept workflow/Tray payloads and fetch stage when missing
- Extract catalog matching helpers into bom-catalog-match.ts
- parseBomTag helper for BOM line item ownership
- fetchLineItemsForDealStrict throws on API failure

### Forecast Schedule Page
- Forecast schedule page with pipeline breakdown

### Zuper Status Comparison
- Add fail date comparison columns and cross-check between Zuper and HubSpot
- Hubspot-ahead filtering, fail-date check, admin job endpoints
- Fall back to project_number lookup when Zuper job has no deal ID
- Add 1-day tolerance to date comparison; UTC to Mountain fix
- Improve Zuper status comparison accuracy and add filters

### PE Deals & Payments
- PE deals M1/M2 status dropdowns with HubSpot sync
- Filter PE deals by Participate Energy tag (not HAS_PROPERTY)
- Sync PE payment properties to HubSpot on page load
- Move Paid section to top; reorder sections (Paid > M2 > M1 > All); compact table layout
- Partially Paid section for deals with one milestone paid
- Show Project Complete deals with pending PE payments
- Replace live ArcGIS EC lookup with static Treasury zip set; show cents

### DashboardShell Polish (Phase 2)
- Suite accent header, PB badge nav, title border, mobile stacking
- Suite page visual polish (Phase 1)

### Site Survey Readiness
- Site survey readiness checker and FDR webhook
- Bearer token auth + workflow payload support to readiness webhooks
- Install photo review webhook for Inspection stage
- Replace self-referential fetch with direct call in install-review webhook

### Auth & Permissions
- Grant all roles access to deals page; remove Solar Surveyor from SALES
- Prefer live Zuper email over stale local CrewMember records
- Add /dashboards/construction to OPERATIONS and OPERATIONS_MANAGER roles
- Grant qc-metrics API access to roles with construction-metrics dashboard
- Resolve edge-runtime JWT role stuck at VIEWER
- Fix suite card routes for OPERATIONS and OPERATIONS_MANAGER
- OWNER→EXECUTIVE rename + SALES_MANAGER migrations
- Add ADMIN_RECOVERY_CODE for role recovery endpoint
- Remove non-auth secrets from token key fallback chain
- Fully redact private key values in debug endpoint

### Product / SKU Rename
- Phase 1: rename EquipmentSku → InternalProduct
- Phase 2: rename user-facing SKU → Product language
- Phase 3: rename /api/inventory/skus to /api/inventory/products

### SOP Guide
- Apply PB brand theme to database-driven SOP page
- Tab visibility: public tabs for all, PM Guide for select users
- Center search bar, rename to SOP Guide (v3.2 → v4.0)
- Merge Sales into Other Pipelines, Zuper into Operations; Workflows into Reference tab
- Visual indicators for role-specific and admin-only tabs
- D&E workflows documented, fix surveyor resolution
- API access control, stale editing, mobile nav, editor a11y

### Survey Reassignment Notifications
- Send survey reassignment notifications to both surveyors
- Include blank-address contacts in company group resolution

### Bug Fixes & Infrastructure
- Sync modal hardening & UX polish
- Remove generator abstraction from catalog sync; convert generator rows to regular dropdown rows
- Restore product search/linking lost in PR #123 merge resolution
- Make "Create new" always visible without searching first
- Metric cards: differentiate 3 tiers, add href/null support, remove SummaryCard
- Promote hero MetricCards to StatCards on executive and pi-metrics dashboards
- Skip pipeline-health cron alert on weekends
- Coerce string-typed numbers before Prisma Float writes in catalog sync
- Whitelist numeric fields for type coercion in catalog sync
- Auto-commit custom brand on blur/click-outside
- Fix Zuper preview field mapping for product_* prefixed API response
- Fix "Invalid confirmation token" on selective sync
- Sync PE payment properties to HubSpot on page load
- Fix catalog approval sync bugs + Zoho↔Zuper cross-link
- Validate Zuper cross-link API response status
- Base ESLint additions: no-unused-vars and no-console rules
- Enable noUnusedLocals, fix 82 violations
- SolarFeedback(status, createdAt) index; equipment query safety cap with hasMore flag
- Nick surveyor assignment and Camarillo construction crew list fixes
- Replace misleading KPI cards with real metrics
- Codebase improvements: security, performance, DX
- Neon adapter passed to PrismaClient in backfill script (Prisma 7 compat)

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
