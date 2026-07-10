# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-07-10

### Tech Ops Bot (Major)
- Rewrote deal queries as a single `query_projects` tool covering multi-pipeline sub-status, date filtering, cancelled-inclusion, and two-level grouping (replaces `list_deals_by_status` and prior stage counters)
- Added `query_jobs` general Zuper field-job query for deeper field visibility
- Added PE payments, revenue goals, exact stage revenue, and PE week-by-week payment tools
- Filtered stage/status counts to PE deals; corrected close-out vs closed vocabulary
- Fixed metric fabrication (no more inventing breakdowns from aggregates) and mid-content reply truncation via max_tokens + chunk splitting
- Neutralized commentary tone and produced one clean final answer without drafting narration
- Documented `create_hubspot_task` assignee parameter

### RTB Review Queue (Major)
- New RTB Review Queue with status labels, deal stage, PM/location filters, and PM review gate for RTB-Blocked
- Added IC status, deal/Drive links, line items, PM names, and DA Paid columns
- Added project type and revenue columns with sortable headers
- Compressed queue table width for readability

### IDR Meeting Hub
- Added D&R / Service design review type and New Construction as separate review types
- Attach escalation photos to items in the meeting hub
- Fixed customer name display for Service/D&R deals
- Fixed accidental "End without syncing" recovery and two-click confirm

### PE (Participate Energy)
- Added PE Change Orders as a conditional document
- Excluded NOT_REQUIRED docs from doc-approval-rate denominator
- Bucketed milestones by document state on the Milestones tab
- Opened PE AVL dashboard to all roles
- Trimmed resurfaced rejection notes to the current review cycle (doc + team paths)
- Fixed Ready-view stat cards to match their drill lists

### Scheduler & Portal
- Blocked survey double-bookings at booking time and on portal book/reschedule flows
- Closed customer survey invites when Ops books via the app
- Fixed double-book guard that falsely blocked surveys behind multi-day installs
- Added kill switch for customer-facing survey portal emails
- Hid PWA install prompt on the survey portal and set the tab title
- Fixed availability scan that matched every survey when crew `zuperUserUid` was blank

### Admin Workflows
- New `create-zuper-job` action with full Tray parity, linking the job to the deal's Zuper project
- Property-change webhook feed accepting `propertyName`/`value` via query params
- Enriched service-task entries from the master record

### On-Call
- Real emails for the PTO and swap lifecycles (replaces notification stubs)
- Allowed swaps any distance out; whole week blocks
- Swap picker now shows one row per week with the full date range

### Bug Fixes & Infrastructure
- Fixed Zuper `job_timezone` stamping so CA customers receive Pacific-time notifications
- Stopped attaching the demo customer to newly created Zuper jobs
- Weekly Neon preview-branch sweep to cap extra-branch cost
- Middleware no longer caches role-denial redirects
- Reconciled Interconnection Cleared / Awaiting Interconnection Approval buckets with the backlog
- Patched runtime dependency vulnerabilities
- Fixed "Deal" buttons across scheduler/IDR to open HubSpot rather than the internal page

---

## 2026-06

### Bot (Major)
- Renamed OOO bot to Tech Ops bot; added Google Chat delivery with domain-wide delegation, per-user DM provisioning, and audit log
- Proactive daily digests DM'd to each owner, scoped tailored per-room digests, real fleet schedule from `ScheduleRecord`, preview mode via `?preview=1`
- Full-pipeline status coverage: DA / design / permitting / construction / inspection / PTO breakdowns with PE M1/M2 milestone rollups
- Tools: `get_project_status`, `get_project_team`, `get_project_service`, `count_deals_by_status`, revenue rollups, milestone date-range queries, location filtering, `log_correction`
- Task creation with exact deal matching, requester-based assignment, task-vs-process-request judgment, and process-request filing under a non-agent requester
- Corrections tab on Bot Escalations with Apply-to-playbook button
- Personal weekday worklist cron, real-time bot usage mirror to owner tracking space, weekday personal-worklist cron, deep-links + conversations tab
- Fixed exec-summary status-dimension scoping, DA lifecycle phasing (Review In Progress = pre-send), fabricated task creation, stale "Zach is out of office" implication, and stuck-deals empty section

### Bottleneck Monitor (Major)
- Age/volume/flow engine, dashboard, and bot digest identifying stalled vs zombie deals
- Owner rollup and real activity signal (v2)
- Bottlenecks tab on the project pipeline funnel page
- Digest polish: hyperlinked deals, team worklists, personal DMs, presets

### Project Pipeline Funnel (Major)
- Added Milestone Progression cohort chart (weekly bins, PE-style sizing, click-through drill-down)
- Data Quality panel for missing reasons; RTB-Blocked and Pending Sales Change reason flags with Kat's / install notes fallback
- PE + On-Hold filters, per-status revenue in Pipeline Backlog, hide project-rejected toggle
- Cohort-based Revenue Conversion table, backlog aging, sales-change reason fallback
- Incoming tab: DA→RTB inflow forecast, stack "Not here yet" by where deals are, avg time upstream
- Sales Funnel tab, Bottlenecks tab, per-location matrix, deals cancelled at each gate
- 3-way RTB split (interconnection / blocks / bench), daily-trend panel, company-wide access
- Ready-to-Build milestone bucket, Closed Out milestone (later reverted), Interconnection Approved monotonic milestone count
- Cohort lifecycle drill-down details, revenue conversion by cohort, sortable backlog columns
- Fix: cancelled deals no longer counted as reaching every funnel milestone; reopened deals not painted as Cancelled

### D&E Funnel (Major)
- New Design & Engineering funnel with revision loops
- Status funnel + by-deal-stage breakdown, Awaiting Site Survey / Design Upload / Design Review buckets
- Rendered Status Funnel as a branch/tree; reused project-funnel milestone logic for buckets
- Added PE + On-Hold filters and Awaiting Site Survey bucket

### Workflow Map / Flow Map (Major)
- New Workflow Map — live HubSpot automation + SOP reference dashboard
- Zoomable flowchart (pipelines → stages → workflows) with task edges and status mapping
- Curated vertical-swimlane Process view; family-lane stage layout
- Process view: plain-English end-to-end pipeline walkthrough (expandable per stage)
- Resumable backfill with admin Build/Re-sync button, `maxDuration=300` refresh

### PE (Participate Energy) — Major
- Complete PE Analytics rebuild: weekly submissions, approvals, rejections, ready-to-submit cohort views, Lifecycle basis, resubmitted bands, day/week/month toggles across all charts
- Doc Uploaders explorer: submissions / by-day / approved $ tabs, distinct-deal counts, drill-down on all outcomes, Copy/CSV exports, address-based project matching, admin owner-override
- Ownership modes: Owner⇄Shared fractional credit, "Last submitter" mode, Layla-attributed unattributed uploads
- Live-pulled per-team M1 rejection notes on rejection with reviewer input flowing to `pe_doc_*_notes`
- Two-way PE doc status sync with HubSpot deal properties (replaces scraper as source of truth)
- Auto-advance Rejected → Ready to Resubmit when rejection tasks done (loosen matcher, retry storm fix)
- HubSpot Deal card for Participate Energy status; live-sync button + "Last synced X ago"
- PE Timing views (Submit → Pay, CC → Payment M1/M2, Inspection/PTO → Submit) with nightly cron writing avg days to all PE deals
- Milestone/Lifecycle split, Remittance & Expected-Paid charts, milestone bar drill-downs
- Bill of Materials tracked as its own conditionally-required M1 document with "Not Required" status
- PE Photos-per-Policy self-serve builder; PE portal + Drive links in analytics drill-downs
- Rejections cohort view, Rejected After Approval report, ANCHOR clawback alert, Re-Rejected report
- Retired PE portal scraper webhook (corrupted statuses); daily snapshot of Document Tracker card metrics
- Superseded uploads drill-down showing who superseded each doc

### Project Management & Pipelines
- Fixed Project Pipeline Funnel: row-boundary conversion reset, Ops Lead owner ID
- Awaiting DA Send column shows design approval status; sortable backlog columns and calendar-timeframe fix
- Trend vs. prior comparison, URL state persistence, by-location hero matrix

### Scheduler & Ops
- Scheduler v2 Phase 1: construction dispatch board (flag-gated, additive)
- Added New Construction as its own tab between Ops Surveys and Pre-Sale; Needs Revisit group; Lenny Uematsu replacing Rolando for Colorado Springs
- DTC office filter no longer hides all survey availability; completed surveys and passed inspections no longer show overdue
- No survey availability slots on PB holidays; kept revisits in Ops Surveys after status flip

### EagleView / TrueDesign
- Added EagleView Orders dashboard with defaults, PB location filter, deal links, order details drawer
- View in TrueDesign link on the EagleView panel; auto-pull via HubSpot v3 signature webhook
- DB-backed toggle for HubSpot stamping (env-or-SystemConfig); Design Lead resolved via owner map
- Shade files saved as .zip; late-arriving measurement files backfilled

### Team Activity & Analytics
- New cross-system Employee Activity report + admin page — 6 sources (HubSpot / Zuper / Google / Aircall / PB Tech Ops / Participate Energy)
- Ad-hoc "look up anyone" section, source-toggle chips, day-level drilldown with real event timeline
- Aircall call detail, Zuper + task names, Copy button in drilldown; roster identity corrections
- Parallelized per-person HubSpot/Google pulls, 14-day default

### Freshservice & Ops
- Switched Freshservice ticket creation from email to API (with email fallback)
- Morning sweep: proactive daily task & ticket digest (Ops)
- Production Issues Service view (tickets + completed-project deals)

### Atlas & Maps
- Embedded Atlas as a top-level destination; surfaced Atlas map card in Operations, PM, and Service suites

### Bug Fixes & Infrastructure
- Cross-instance shared cache + single-flight for projects/deals; funnel routes given 300s budget
- Paused 3 HubSpot-heavy crons during rate-limit outage; PE doc sync switched to full every 30 min, skipped overnight (10pm-6am MT)
- Fixed stuck-empty backlog fields in deal-reader, phantom action-resolutions from uploader stats, superseded doc metadata
- Fixed EagleView Drive folder ID extraction from URL, PascalCase → camelCase normalization
- Directory identity links (User ↔ HubSpot owner / Zuper user / CrewMember)

---

## 2026-05

### Tesla PowerHub (Major)
- New Tesla PowerHub fleet monitoring integration: JWT auth, rate limiting, three-tier site-to-deal linkage, asset/telemetry/alert sync orchestration, cron handlers
- OAuth2 client_credentials auth via Fly proxy (`dfw` region), fallback to `site_id` when `site_name` null
- Fleet monitoring dashboard with expandable site table showing HubSpot deal, property, contacts, and full telemetry
- Every Tesla device on site surfaced with part #/serial #, telemetry signals, and alert metadata
- Auto-link Tesla sites to HubSpot properties with greedy 1:1 scoring and address backfill from linked deals
- HubSpot UI Extension: native Tesla PowerHub sidebar card with v3 signature verification
- Cross-system Tesla portal URL linking (HubSpot + Zuper + Suite); PowerHub alert scoring in service priority queue
- Pushed all Tesla device serials + models to Zuper Property/Job

### Enphase Enlighten (Major)
- New Enphase Enlighten API integration at PowerHub parity: fleet discovery, telemetry, alerts, status monitoring
- Partner OAuth setup route for installer auth flow

### PE (Participate Energy) — Major
- New PE Raceway API sync replacing HTML scraper: two-way status sync, incremental + hourly cron, action items feed
- PE File Preparation tool with AI vision audit, PandaDoc auto-pull, prep dashboard, few-shot classifier
- PE Cross-Reference: MVP + PE Action Tasks Cross-Reference with Planset / SalesOrder / Hardware analyzers (P1-P10)
- PE Prep landing page (deal queue + audit history overlay); PE audit split into docs + photos pipelines
- PE Submission Gap report (CC-hit deals with incomplete M1/M2), 4-tab split with dollar amounts
- PE Program Report and PE Deals dashboards with document breakdown, invoice audit, email sync
- PE Approved Vendor List dashboard, PE portal CSV import to supplement scraper data
- Instant email notification on PE doc status changes with 4-section restructure
- Document-level progress per deal; scraper status diffs tracked between sync runs
- Two-way PE Document Tracker with payment timeline, payment volume chart, Under Review hero card
- New PE Doc Tracker at `/dashboards/pe-docs` and PE Pipeline Tracker with per-stage revenue
- Split PE Deals into Pre-Construction vs Construction+, Awaiting PTO segment, multi-column sort

### IDR Meeting Hub (Major)
- Design & Ops Meeting Hub added to Operations Suite; scoped to Colorado, California, or all
- BOM Review & Line Item Editor added to IDR
- IDR revision workflow: re-review toggle, auto-appear, revision reason sync, RE-REVIEW badge, task completion on sync
- PandaDoc DA link + plan docs in the meeting queue
- Escalation submitter shown in detail panel; previous review notes for re-reviews
- Design revision toggle + auto-advance on sync
- Compare planset layout against DA layout in design review
- Stale numeric lead ID resolution in completed snapshots

### Property Hub / Property Object (Major)
- New Property Hub full-page view at `/properties/[id]` with equipment summaries, revenue, Zuper link
- Photos tab with Zuper job photos, Activity tab enriched with engagement metadata
- HubSpot and Zuper external links on tabs; contact names on drawer
- Cross-system property enrichment: Shovels API (permits, residents, contractors), Zuper Property sync (write direction)
- Verify address match for single-candidate property links; ticket-only properties included in Zuper sync

### Shop Health Dashboard (Major)
- New Weekly Shop Health Dashboard: revenue hero card, pipeline revenue detail, target-driven grading
- Customer Success section with sentiment scoring, 5-star reviews, contact response metrics
- Preconstruction section with throughput and cycle times; Service + D&R/Roofing sections
- Drill-downs for all count-based metrics + Customer Success metrics
- Deal-level response rollups; cache warming to prevent thundering herd

### Scheduler & Sub-Jobs (Major)
- Construction job split by product (Solar / Battery / EV) with per-project sub-job breakdown modal
- SubJobScheduleModal with same/separate modes wired into master + construction schedulers
- Reschedule all sibling construction sub-jobs together (with tentative-safe skip, same-deal scope, audit logging)
- Sub-job breakdown view for construction cards; Zuper job status in all scheduler modals
- Day view timed grid for surveys/inspections; on-call electrician overlay on master schedule
- Pre-sale survey cards rendered on calendar; dedupe + click modal for pre-sale
- Weekend visibility toggle; California site-survey availability revisions
- Editable date picker on drag-drop reschedule confirmation
- Orphaned resurvey/re-inspection jobs shown in master scheduler with `pb_location` fallback

### Aircall Call Analytics
- Phase 1+2 call analytics dashboard, per-user answer rate via ring tracking
- Analytics+ ringing-attempts CSV import for historical data
- Executive call analytics with On-Call Calls section from `OnCallCallLog`
- On-call follow-up now auto-creates a HubSpot service ticket

### DA Drift & Cost Audit
- DA status drift detector as backup for HubSpot connector (approval-dropdown-based, not `document.completed`)
- Cost Audit dashboard: cross-reference Zoho bills against item purchase rates, sales price, margin, cross-system link badges
- Bulk-sync costs to latest bill with suggested sales price; Sync Health page for InternalProduct/HubSpot/Zuper/Zoho drift rollup

### Office Performance & TV Dashboards
- Office performance cards on operations suite; California SLO + Camarillo combined into one dashboard
- Rich TV dashboard: deal list with Zuper status, PE flags, unified layout, stacked deal lists

### Google Chat OOO Bot (Early)
- Google Chat OOO bot foundation with multi-JWKS fallback, base64 service account key, async diagnostics
- Support for Workspace add-on envelope format; async post errors captured to DB
- Replies posted to main timeline instead of a thread

### Bug Fixes & Infrastructure
- Zoho token refresh retry on Access Denied; catalog service SO fallback without custom field
- Portal redesign to match photonbrothers.com; subdomain isolation, brand color, inline cancel, scroll fix
- Reduced Zuper API calls ~97% by caching job list in lookup endpoint; sync-cache cron cut 30m → 4h; property-sync cron cut 2h → 6h
- Zuper drift PM dashboard with per-sub-type evaluation and install_status rollup integrity
- Freshservice ticket batch fixes; auto-reload pages on new deployment
- Two-tier base + stretch goals with gold progress bar; California annual revenue target set to $9M
- Payment Timeline dashboard for Accounting suite; weekly goals digest email (one per office)

---

## 2026-04

### Solar Designer / Solar Surveyor Rewrite (Major)
- Ground-up rewrite of the Solar Designer with a shared V12 engine: Stage 1 core extraction (physics, consumption, production, mismatch, clipping, timeseries aggregation)
- Stage 2: page shell, file upload with drag-and-drop DXF/JSON/CSV parsing, equipment selection with catalog dropdowns, system summary bar, site conditions panel
- Stage 3: Visualizer with shade animation + satellite background, MapAlignmentControls, click-to-assign + auto-string, StringList sidebar with voltage validation
- Stage 4: Production, Timeseries, and Inverters tabs — MPPT reassignment, clipping detection, day/week/month/year aggregation
- Per-panel shade CSVs, folder + zip uploads, Blob client upload to bypass 4.5MB body limit
- EagleViewPanel rendered when `?dealId=` URL param is set

### Office Performance TV Dashboards (Major)
- New office performance dashboard with 7-slide carousel: Team Results, Surveys, Installs, Inspections
- Per-office `OfficeGoal` DB targets; CountUp, ProgressRing, AnimatedBar, AmbientBackground components
- Leaderboards with staggered entrance and metallic podium; per-person metrics, streaks, achievement callouts
- Deal drill-down lists per section; Zuper compliance metrics live from API
- All-locations overview slide + page at `/office-performance/all`
- Compliance grading tightened, OOW usage %, side-by-side layout, revenue reconciliation
- Live clock replacing static "Updated" timestamps across dashboards

### Deal Detail Page (Major)
- New read-only deal record view at `/deals/[dealId]`
- 3-tab layout with collapsible photos; site photo gallery with Zuper photo proxy
- Deal activity timeline with composite cursor pagination; HubSpot notes moved from Communications to Activity
- Communications feed for HubSpot engagements (contact-associated emails included)
- Zuper job notes, HubSpot tasks, Zuper status history, BOM, and schedule timeline fetchers
- Note composer with background HubSpot + Zuper sync; DealNote model for internal notes
- Human-readable labels in sync changelog diffs; @mention markup stripping
- Real-time collaboration, Redis presence, SSE race guard, @mentions

### HubSpot Property Custom Object (Major)
- New HubSpot Property custom object v1: cache table + link tables + rollup fields
- `onContactAddressChange` webhook entry point, `upsertPropertyFromGeocode` for manual creates
- Contact address change → geocode → resolve-geo-links → HubSpotPropertyCache row → associate deals/tickets/contacts
- USER_DEFINED typeIds for deal/ticket associate; AHJ/Utility memoization by (state, zip)
- Property Hub full-page view + slide-in drawer with equipment, owners, deals, tickets, photos
- Property rollups: `systemSizeKwDc`, `hasBattery`, `openTicketsCount`, warranty dates
- Inngest queue for property sync workflows

### Admin Workflow Builder (Major)
- Phase 1 backend scaffold: `AdminWorkflow` model, definition JSON, trigger config
- Phase 2 editor UI + CRUD API; palette, templates, per-run detail page with step output drill-in
- Actions: `send-email`, `update-hubspot-property`, `update-hubspot-contact-property`, `add-hubspot-note`, `create-hubspot-task`, `update-zuper-property`, `run-bom-pipeline`, `log-activity`, `http-request`, `find-hubspot-contact`, `fetch-zuper-job`, `ai-compose`
- Control-flow: `delay`, `stop-if`, `parallel`, `for-each`
- Trigger types: MANUAL, HUBSPOT_PROPERTY_CHANGE, ZUPER_PROPERTY_CHANGE, CUSTOM_EVENT, CRON
- Webhook fan-out for HubSpot + Zuper triggers; select/multiselect dropdowns with dynamic options
- Workflow versioning (snapshot on save + rollback), action-level idempotency for create-actions
- Analytics dashboard, visual canvas preview, drag-to-reorder, export/import JSON, Duplicate button
- Per-workflow rate limiting; Inngest auto-sync on deploy + manual resync
- Dry-run mode, failure alerts, Zuper property discovery

### On-Call Electrician System (Major)
- V1 on-call electrician rotations with per-state Google Calendar staging
- Sun-Sat weeks, 6pm-10pm weekday / 8am-12pm weekend shifts (later Monday-start weeks)
- Weekly rotation + self-service swap UI, merged Colorado pool
- Emergency call log captured by on-call electricians, admin call logging, HR sheet export
- Admin/Executive Activity view — all swap + PTO requests
- On-call form: roofing issue type, 3-way outcome, pool-filtered crew dropdown
- Publish works on large pools + surfaces errors as JSON; VIEWER role access

### Multi-Role Access & Home-Page Redesign (Major)
- Phase 1: multi-role access + home-page redesign, per-user extra route grants
- Phase 2A/2B: migrated `role` → `roles` across all callers; dropped `User.role` column shim
- Per-role capability overrides; read-only Role Inspector at `/admin/roles`
- Runtime-editable role definitions (routes, landing cards, suites)
- Super-admin break-glass safeguard with UI badge in UserMenu and drawer note
- Withhold super-admin email during impersonation
- Added 6 scoped suite roles (ACCOUNTING, MARKETING, SALES, SALES_MANAGER, etc.) + Sales & Marketing suite

### Admin Shell & IA (Major)
- Consolidated `/suites/admin` into `/admin` — one admin landing with in-shell search
- AdminShell + primitive components: table, filter bar, detail drawer, bulk action bar, form, kv grid, detail header
- `/admin/activity`, `/admin/tickets`, `/admin/directory`, `/admin/audit`, `/admin/security`, `/admin/crew-availability`, `/admin/roles`, `/admin/users` all adopted primitives
- Back-to-home link + UserMenu affordances in admin shell

### PM Accountability & Tasks (Major)
- New PM Accountability dashboard + weekly digest (Phase 1)
- Exception-based PM assignment system with kill switch, aggressive thresholds, compound-risk + shit-show rules
- Live mode: page-load eval replaces daily cron
- PM Queue reconciliation moved off page load; milestone evaluation fix
- HubSpot deal links + owner-id assignment fallback + missing-PM seed
- My Tasks dashboard: personal HubSpot tasks with keyboard shortcuts, URL state, inline status/queue edit, deal-stage filter, sort modes, snooze, bulk done, admin-managed queue names, typeahead lookups, New Task from deal panel
- Freshservice tickets: admin page + UserMenu badge for user's own tickets; Closed filter chip; email + name fallback lookup
- Ticket details include Zuper job notes and HubSpot tasks in Activity

### EagleView TrueDesign Auto-Pull (Major)
- TrueDesign auto-pull pipeline (Tasks 1-9): PlaceOrder API + webhook handler + Drive persistence
- EagleView imagery API integration with dealId on `SolarProject`
- Sandbox integration test page for Go-Live proof; production PlaceOrder request format
- OAuth foundation for TrueDesign CAD/DXF pull (flag-off)

### Interconnection Hub & Permit Hub
- Interconnection Hub v1 at `/dashboards/ic-hub`
- Permit Hub two-pane workspace for permitting team at `/dashboards/permit-hub`
- Per-inbox OAuth workaround for blocked DWD scope; shared inbox thread fetch on correspondence tab
- Inline action panel, permit-lead filter, stacked filter row; resolved names + header quick-links + AHJ fallback

### IDR Meeting Hub (Major)
- IDR Meeting Hub schema (session, item, note models) + API routes (sessions, items, sync, readiness, notes, search)
- Meeting prep queue with escalation + design review support, DA status actions, dense two-column layout
- AddersChecklist + PricingBreakdown components with mismatch detection
- Live preview mode, escalation re-queue, auto-sync, AHJ/Utility codes, tags, HubSpot notes
- Search history, sales folder, PM task on sync, open-all links
- Shit Show Meeting Hub with equipment snapshots and IDR helpers

### Adder Catalog & Triage
- Adder Catalog Phase 1 (governed catalog + foundation, Chunks 1-6)
- Triage recommendation engine + `/api/triage/*`; rep-facing mobile triage UI + deal-detail embed
- IDR adders: HubSpot roof type auto-populate, adder amount property, % of deal + waiver warnings

### Accounting Suite Split
- New Payment Tracking + Payment Action Queue pages replacing single Accounting suite dashboard
- Invoice-first bucketing + three new accounting pages
- PE Deals hero cards refreshed with Ready to Invoice + collected/outstanding subtitles
- Attach HubSpot invoices to payment-tracking rows; match invoices to milestones by line item name
- Ready-to-invoice attention signals from project triggers; Not Invoiced column
- Sales product request page (equipment + adders → OpenSolar) with cost estimates and deal lookup
- ACCOUNTING user role added

### Customer-Facing Estimator v2
- Phase 1 solar estimator v2 (iframe embed mode, slim HubSpot properties 14 → 3)
- All 5 quote-type flows (EV, Battery, Expansion, D&R); ported pricing + production config from original
- Reliable Places autocomplete + cross-flow nav; internal widgets suppressed on customer page
- Continue works from typed address even if `place_changed` misses

### Jobs Proximity Map
- Phases 1-3: installs + service + crews, Week/Backlog view, tickets, inspection/survey
- Assignee filter, scheduled-today markers never cluster, dispatcher office pin + morning briefing + nearby highlights
- Project numbers, richer info, D&R + roofing markers, shop filter
- Call + add-note quick actions

### SOP System (Major)
- WYSIWYG TipTap editor replaces raw HTML CodeMirror; auto-link `<code>/route</code>` mentions
- Batch SOPs: Catalog, Service, Scheduling, Forecast, AHJ & Utility, Executive, Accounting, Sales & Marketing, Suites, Tools, Action Queues
- Split Tech Ops tab into Design / Permitting / Interconnection
- Submit-a-new-SOP feature with admin review queue; Drafts tab; hub-mode visibility flip
- Role-gated SOP tabs and sections to prevent info leaking to wrong teams
- Meta-SOP: "How to Use the SOP Guide"

### Deal Activity Timeline (Major)
- DealActivityPanel, CommunicationsFeed for HubSpot engagements, ActivityFeed with pagination and note composer
- TimelineEventRow, NoteComposer components; POST /notes with background sync
- Fix HubSpot note ID collision; cross-source cursor with overlap band
- Include contact-associated emails in Communications

### Deal Mirror & Comms
- Deal Mirror sync engine, Comms Dashboard, and cross-system Product Sync
- Comms redesign: expandable message rows, sender avatars, entity decoding
- OAuth redirect URI derived from request headers; Gmail identity verification during connect
- Include HubSpot emails outside inbox (later reverted after runaway load)

### Bug Fixes & Infrastructure
- Auto-reload pages on new deployment; solar surveyor dynamic breadcrumbs
- Cross-system Zuper cross-link IDs written via `meta_data` instead of `custom_fields` (routing catalog spec changes correctly)
- Phased HubSpot manufacturer enum enforcement; Zoho category_id writes replace `group_name`
- Race-safe external-record create + link-back; catalog Sync Modal logged to ActivityLog
- Territory Map for CO office boundary analysis
- Site survey readiness checker + FDR webhook; install photo review webhook for Inspection stage
- EOD summary email cron with per-person change count, HubSpot completed-task search
- Daily focus email for P&I and Design leads
- Payment Tracking dashboard shifts from EPC price comparison to invoice-based
- Bug report emails now send from the reporter
- Renamed PB Operations Suite to PB Tech Ops Suite

---

## 2026-03-28

### Cross-System Sync Relay (Major)
- Rewrote SyncModal with plan-based flow, auto-cascade, and value-based dropdowns
- Plan derivation engine with conflict detection and hash; plan execution with effective state overlay
- Mapping table with normalizers, generators, transforms; per-cell source selection with wide comparison table
- Snapshots + defaultIntents surfaced via `GET /sync`; new `POST /sync/plan` endpoint
- Selective sync with per-field direction controls; 10 new mapping edges; bidirectional part_number and unit
- Removed legacy sync API paths; sync noise reduction and column separation

### Metric Cards Phase 2/3 (Major)
- Suite page visual polish (Phase 1); DashboardShell chrome (Phase 2): suite accent header, PB badge nav, mobile stacking
- Phase 3: 3-tier MetricCard, `href` support, null value support, removed SummaryCard
- Promoted hero MetricCards to StatCards on executive and pi-metrics dashboards

### Metrics Dashboards
- Preconstruction metrics dashboard, Design Approval (DA) metrics with pipeline, Not Yet Sent bucket, drill-down
- Site survey turnaround metrics dashboard with location filtering, unified StatCards
- Construction metrics with RTB → Const Start, CC → Inspection Passed replacing CC → PTO
- Inspection metrics with dual-source validation, drill-downs, action queues, 11 HubSpot deal properties
- Split DA first-try into customer vs design + rework attribution

### Revenue Goal Tracker (Major)
- New Revenue Goal Tracker with `RevenueGoal` model, monthly targets, admin config
- Variant A (progress rings) + Variant B (thermometer bars) hero components
- Monthly breakdown chart with hit/miss indicators; canvas fireworks for monthly goal hits
- Zuper-based recognition for Service and Roofing groups; straight-line pace; multi-select filter

### Service Suite Phase 1+2 (Major)
- Service Suite Phase 1+2: suite split, priority queue, tickets
- Customer History v2 — contact-based lookup replacing address-only
- BOM push to HubSpot with UI, migration, and role fixes
- Forecast Schedule page with pipeline breakdown; scheduler forecast ghost events

### Accounting Suite Foundation
- New Accounting Suite with PE Deals & Payments dashboard, PE M1/M2 status dropdowns with HubSpot sync
- Compact PE deals table, filter by PE tag, Zippopotam.us EC lookup
- Compare deal amount against full EPC price; sync PE payment properties on page load

### BOM & Sales Orders
- Service Catalog + SO Creation (Phase 4): auto-populate slide-over from HubSpot line items, Zoho-sourced totals, automated notes
- Include HubSpot deal record ID on Zoho Sales Orders; preferred-vendor PO splitting (auto-split BOM items by Zoho vendor)
- Cross-system product pricing comparison endpoint; Zoho pricing quality audit endpoint
- SSO- prefix corrected to SO- matching project pipeline
- Warehouse-aware Zoho Sales Orders; RTB-triggered CREATE_PO gate

### Scheduler & Pre-Sale
- Pre-sale site visit Zuper flow with pre-sale card rendering and Service + D&R toggle buttons
- Master schedule overlay of service + D&R jobs from Zuper (localStorage-persisted toggles)
- Collapsible project sidebar with localStorage persistence
- Meeting action items: construction metrics, DA performance, availability approvals

### EOD / Daily Focus
- End-of-day summary email cron with morning snapshot, HubSpot completed-task search, per-person change/task counts
- Daily focus email cron for P&I and Design leads

### Zuper Status Comparison
- Improved Zuper status comparison accuracy: fail-date cross-check, HubSpot-ahead filtering, project_number fallback
- External_id.hubspot_deal for Zuper job linking; 1-day tolerance; timezone drift fix (UTC → Mountain)

### Roles & Auth
- OWNER → EXECUTIVE rename + SALES_MANAGER migration; fixed edge-runtime JWT role stuck at VIEWER
- Fixed OWNER enum deserialization error (460 Sentry events)
- Multi-role SALES survey guard; `requiresLocations` gate killed

### Rename EquipmentSku → InternalProduct
- Phase 1: DB rename; Phase 2: user-facing SKU → Product language; Phase 3: rename `/api/inventory/skus` → `/products`

### Bug Fixes & Infrastructure
- Survey reassignment notifications to both surveyors
- Various pricing calculator deal import & compare (deal search, comparison banner, auto-populate)
- Territory Map for CO office boundary analysis
- Executive Suite Territory Map + Design Pipeline Funnel dashboard
- Design Pipeline Funnel with monthly grouped bar chart, cohort table, backlog callouts, DA pacing
- Install photo review webhook for Inspection stage; site survey readiness checker
- ESLint extended with `no-unused-vars` + `no-console`; `noUnusedLocals` fixes across 82 violations
- Security: `ADMIN_RECOVERY_CODE` required for role recovery endpoint; private key values redacted in debug endpoint

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
