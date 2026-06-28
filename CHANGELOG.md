# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-06-17

### PE Document Tracker & Analytics (Major)
- Standalone PE dashboard (the hub) consolidating Documents, Deals, Payments, and Analytics tabs
- Document Tracker grouped by team with collapsible status sections, Rejected / Action Required / Not Uploaded buckets, and inline outstanding-doc rows
- Doc Uploaders view with day/week/month grain, By-Doc-Type breakdown, distinct-deal counts, and clickable drill into approval/rejection outcomes
- Owner vs. Fractional credit toggle for uploader attribution + admin owner-override
- Per-document blocker notes editable at the deal level with "Waiting on Information" reason capture for M1/M2 statuses
- Two-way PE document status sync to HubSpot deal properties, with manual "Sync now" button and daily snapshot of Document Tracker metrics for trend history
- Short-pay correction wired into Deals & Payments tab so PE Revenue Collected reflects actual dollars
- Milestone Payments view (IC/PC pipeline by stage then status) with multi-select subgroup bubbles
- Copy / CSV export buttons on Analytics drill-down lists, PE portal + Google Drive links inline on every row
- Address-based project matching auto-stamps portal links on deals
- Self-serve Photos-per-Policy and Final Permit photo builders as web tools, resolvable by PROJ number or customer name
- PE Cross-Reference analyzers (Hardware, Sales Order, Planset, Inbox Scan) auto-trigger after PE audit completion

### Project Pipeline Funnel (Major)
- New executive funnel showing project flow Sales → Construction across 9 stages with revision loops
- Incoming tab with "Not here yet" breakdown stacked by upstream stage, DA→RTB inflow forecast, and avg arrival time per step
- Capacity & Backlog row showing RTB bench and runway on the Active Pipeline tab
- Sales Funnel tab (sales-cohort) and Bottlenecks tab with compact hero cards
- Backlog buckets flag RTB-Blocked + Pending Sales Change with HubSpot reason field, with fallback to Kat's notes / install notes / install field
- "No reason given" indicator when HubSpot reason field is blank
- On Hold deals flagged in-bucket with on-hold % split of pending
- Sortable backlog columns, calendar-timeframe fix, staff assignment columns on drill-downs
- Activity table, named timeframe presets, close-out section

### D&E Funnel
- Status funnel rendered as a branch/tree with by-deal-stage breakdown
- Awaiting Site Survey, Awaiting Design Upload, and Design Review buckets
- Reuses project-funnel milestone logic for consistent bucket math
- Completed revisions visually dulled to highlight active work

### Tech Ops Bot (Major)
- Google Chat assistant (formerly OOO bot, renamed Tech Ops bot) for ad-hoc questions over deal, schedule, and PE data
- Proactive daily digest DM'd to the owner and tailored per-room digests posted to team Google Chat rooms
- `?preview=1` mode to render digests without posting
- HubSpot task creation from chat (deal resolved by PROJ number, customer name, or address) with assignment to named person or requester
- Tool palette: count_deals_by_status, get_project_team, get_project_service, revenue rollups, milestone date-range queries, location filtering
- DA lifecycle phase encoding (Review In Progress = pre-send) and PE M1/M2 milestone status breakdowns
- log_correction captures in-chat corrections; admin Corrections tab with "Apply to playbook" button for prompt improvements
- Admin OOO bot escalations review dashboard
- Real fleet schedule sourced from ScheduleRecord (replacing calendar stub)
- Rotating "thinking" ack message

---

## 2026-05

### Tesla PowerHub + Enphase Enlighten Integration (Major)
- Full Tesla PowerHub fleet monitoring dashboard with expandable site table, search, sort, and stats
- Three-tier site-to-deal linkage (admin manager, HubSpot association, geo-coordinate match via portal-imported lat/lng)
- Cron-driven asset sync, telemetry capture, and alert scoring fed into the service priority queue
- Site detail enriched with HubSpot deal, property, contacts, system details, and every Tesla device serial + model number
- Cross-system Tesla portal URL linking across HubSpot, Zuper, and the Suite, with all device serials/models pushed to Zuper Property + Job
- Native HubSpot UI Extension card for Tesla PowerHub + compact sidebar variant
- Enphase Enlighten integration at full PowerHub parity with Partner OAuth setup route
- All Tesla telemetry signals and alert metadata captured for historical analysis

### PE & Compliance Suite + PE Cross-Reference
- New PE & Compliance Suite consolidating PE and compliance pages
- PE Deals dashboard split into Pre-Construction vs Construction+, with Awaiting PTO segment, Customer Paid? column, pipeline bar by stage bucket
- Grouped by pipeline stage with stage distribution on hero, Cancelled excluded, Other auto-renamed to On Hold
- Multi-column sort with smarter Cust Paid sort; default sort on PE Total
- PE Cross-Reference MVP: PE Action Tasks Cross-Reference dashboard with HardwareAnalyzer (PowerHub vs nameplate mismatch), SalesOrderAnalyzer, PlansetAnalyzer, and InboxScanAnalyzer
- PE Approved Vendor List dashboard page
- PE Doc Digest restructured into 4 actionable sections with Google Drive folder links per deal
- Instant email notification on PE doc status changes

### Shop Health Dashboard (Major)
- Customer Success section with sentiment scoring, 5-star reviews, and contact response metrics
- Preconstruction section expanded with throughput and cycle times
- Service + D&R/Roofing sections added
- Revenue hero card with pipeline revenue detail; targets derived from revenue goals instead of crew capacity
- Drill-down tables on every count-based metric, plus sentiment / 5-star review / response time drill-downs
- Multiple bottleneck entries per shop per week
- Lightweight overview path (single Project fetch, no tickets) and fail-open service/D&R fetch

### Project Pipeline Funnel V1
- New 9-stage sales-to-construction funnel added to Executive suite
- Survey Scheduled stage with cleaned-up hero card layout, milestones inferred from deal pipeline stage
- Monthly Activity table, named timeframe presets, drill-down dates, close-out section
- Staff assignment columns on drill-downs

### Scheduler Improvements
- SubJobScheduleModal with same/separate modes for construction sub-jobs, wired into master + construction schedulers
- Sibling construction sub-jobs reschedule together
- Sub-job breakdown view for construction cards
- Day view timed grid for surveys/inspections
- On-call electrician overlay on master schedule
- Pre-sale survey cards rendered on calendar (purple)
- Weekend visibility toggle that no longer shifts events to Saturday
- Orphaned resurvey/re-inspection jobs surface in master scheduler sidebar
- Editable date picker on drag-drop reschedule confirmation
- Flag overdue/completed Zuper overlay jobs

### Google Chat OOO Bot (initial release)
- Google Chat add-on with mention-driven Q&A over deal data
- JWT auth resilient across multiple JWKS sources and multiple audiences
- Support for Google Workspace add-on envelope format
- Async post error capture to DB with detailed Chat API errors
- SOP integration so bot can answer process questions

### Zuper Drift, IDR, EagleView
- Zuper-vs-HubSpot status drift PM dashboard with per-sub-type evaluation and install_status rollup integrity check
- IDR meeting BOM Review & Line Item Editor; previous review notes available on re-reviews; richer search results
- EagleView Orders dashboard page; sandbox integration test page for Go-Live proof; production PlaceOrder request format
- EagleView TrueDesign auto-pull pipeline enabled

### Catalog & Portal
- Property Object workflow-sync endpoint for HubSpot workflow-driven property sync
- Per-endpoint Zuper API call counter with admin read endpoint; outbound call logging with source file
- Aggressive Zuper cron throttling (property-sync 2h → 6h, job-backfill hourly → 6h, sync-cache 30m → 4h)
- Customer survey portal redesign matched to photonbrothers.com brand palette
- Subdomain isolation, inline cancel, scroll fix, chatbot hidden, URL newline fix
- Service-to-service survey invite endpoint for Olivia
- Jinko manufacturer typo fixed; catalog limit raised to 2000

---

## 2026-04

### Admin Workflow Builder (Major)
- Visual workflow builder for admins to compose existing actions into automated sequences (Inngest runtime)
- Editor UI with drag-to-reorder canvas, visual canvas preview, and step reordering
- Triggers: MANUAL, HUBSPOT_PROPERTY_CHANGE, ZUPER_PROPERTY_CHANGE, CRON (dispatcher cron), CUSTOM_EVENT
- 10+ actions: send-email, ai-compose, update-hubspot-property, update-hubspot-contact-property, add-hubspot-note, create-hubspot-task, update-zuper-property, fetch-zuper-job, find-hubspot-contact, http-request, run-bom-pipeline, log-activity
- Control-flow: delay, stop-if, for-each loop, parallel
- Per-run detail page with step output drill-in; cross-workflow run history page
- Workflow versioning (snapshot on save + rollback), export/import JSON, dry-run mode
- Webhook fan-out for HubSpot and Zuper triggers; per-workflow rate limiting
- Failure alerts, Zuper property discovery, action-level idempotency for create-actions
- Analytics dashboard with template library
- Inngest auto-sync on deploy + manual resync button

### Jobs Proximity Map (Major)
- New `/dashboards/map` showing installs, service jobs, and crews on a single map
- Phase 2/3: Week/Backlog tab, tickets, inspection/survey markers, UX polish
- Project numbers in popups, D&R + roofing markers, shop filter, dispatcher office pin
- Morning briefing panel + nearby-job highlights
- Assignee filter; scheduled-today markers never cluster
- Call + add-note quick actions
- Per-kind count breakdown, completed jobs stripped, RTB-Blocked excluded from schedulable

### Multi-Role System + Sales/Marketing Suite (Major)
- Phase 1 multi-role access: User.roles[] array replacing single role column
- 6 new scoped suite roles (DESIGN, PERMIT, INTERCONNECT, SALES_MANAGER, SALES, MARKETING)
- Runtime-editable role definitions (routes, landing cards, suites)
- Super-admin break-glass safeguard
- New Sales & Marketing Suite + new Project Management Suite + new PE & Compliance Suite landing pages
- Accounting suite tightened to ADMIN / OWNER / ACCOUNTING; OPERATIONS narrowed
- Service user role scoped to Service Suite; SERVICE role added
- Last-page redirect after login
- Admin shell primitives: bulk action bar, form, kv grid, detail header, table, filter bar, detail drawer
- Exit affordances on admin shell (back-to-home link + UserMenu)
- Home page redesigned around suite landing cards

### Office Performance TV Dashboards (Major)
- All-locations overview page at `/office-performance/all` and 7-slide carousel across all locations
- 4-section TV carousel: surveys, installs, inspections, pipeline, all with CountUp + ProgressRing visual upgrades
- Per-surveyor turnaround, individual pass rates, animated bars, PM/designer/owner breakdowns
- Leaderboard with staggered entrance and metallic podium
- Per-person metrics, streaks, and achievement callouts
- TV-scale header with section color accents and pill navigation
- Directional slide+fade carousel transitions with AmbientBackground
- Live Zuper API metrics replacing cache-based compliance, with OOW usage % and side-by-side layout
- Combined SLO + Camarillo into single California dashboard

### Permit Hub + Interconnection Hub (Major)
- New `/dashboards/permit-hub` two-pane workspace for the permitting team
- `/dashboards/ic-hub` Interconnection Hub v1
- Shared inbox thread fetch on correspondence tab with per-inbox OAuth workaround for blocked DWD scope
- Resolved names, header quick-links, AHJ fallback
- Sticky action panel, grouped queue, multiselect location filter
- Aligned with daily-focus email; permit-lead filter; stacked filter row

### My Tasks Dashboard
- Personal HubSpot tasks dashboard with explicit HubSpot owner link per user
- Sort modes, deal-stage filter, mark complete
- Snooze, create, completed-this-week, bulk done
- Inline status + queue edit, shortcuts, URL state
- Typeahead lookups + New Task from deal panel
- Autofocus first row + admin-managed queue names

### Deal Detail + Timeline Overhaul
- 3-tab layout with collapsible site photo gallery (fixed Zuper URLs)
- Activity feed with note composer, communications feed for HubSpot engagements
- Composite cursor pagination for timeline; contact-associated emails included
- Zuper job notes, HubSpot tasks, Zuper status history, BOM, and schedule timeline fetchers
- Human-readable labels in sync changelog diffs
- HubSpot notes moved from Communications to Activity; service tasks + note attachments included
- Internal Deal link across scheduler family and remaining UI surfaces

### On-Call Electrician Rotations
- V1 weekly rotations with self-service swaps and merged Colorado pool
- Sun-Sat weeks; 6pm-10pm weekday / 8am-12pm weekend shifts
- Per-state Google Calendar (staged without invites, flipped on later)
- Aligned with Tracey's Apr 28 go-live policy
- Electrician self-service swap UI with PTO + swap UX
- Admin/executive Activity view for all swap + PTO requests
- Admin call logging + HR sheet export
- Emergency call log captured by on-call electricians

### IDR Meeting + Adders Catalog
- IDR Meeting start scoped to Colorado, California, or all
- Survey Zuper link, design approval status, tag fix
- Sales folder, PM task on sync, open-all links; needs-resurvey UI dropped
- Two-click confirm with recovery from accidental "End without syncing"
- AddersChecklist + PricingBreakdown with mismatch detection
- Adder fields synced to HubSpot on manual and auto-sync
- Governed Adder Catalog `/dashboards/adders` (Phase 1) with triage recommendation engine
- Rep-facing mobile triage UI + deal-detail embed
- OpenSolar sync scaffold behind kill switch

### Accounting Suite
- Payment Tracking dashboard + ACCOUNTING role
- Ready-to-invoice attention signals from project triggers
- HubSpot invoices attached to payment-tracking rows
- Split into Payment Tracking + Payment Action Queue pages
- Invoice-first bucketing + three new accounting pages
- "Not Invoiced" column on Payment Tracking row
- Preset date-window filter; invoice dots link to deal
- Filters restored, 5-section groupings; sales pipeline dropped

### Customer-Facing Estimator V2
- Phase 1 customer-facing solar estimator at `/estimator`
- All 5 quote-type flows (EV, Battery, Expansion, D&R, Solar)
- Ported pricing + production config from original estimator
- Slim HubSpot properties (14 → 3) + iframe embed mode
- Production Issues dashboard with Flag Project + inline unflag actions

### Solar Designer (Major)
- New `/dashboards/solar-designer` with PanelCanvas SVG renderer, MapAlignmentControls, satellite background
- Stringing tab with click-to-assign + auto-string, StringList sidebar with voltage validation badges
- Visualizer tab with shade animation, ShadeSlider day/time range inputs
- Equipment selection panel with catalog dropdowns and spec display
- File upload (DXF / JSON / CSV) with drag-and-drop and parse feedback
- Site conditions panel (temp, albedo, loss profile), system summary bar
- String-validation module with Voc/Vmp voltage checks; shade-association with AABB + rotated-rect lookup
- Upload route returns full radiancePoints[] array

### PM Flags + Accountability + EagleView TrueDesign
- Exception-based PM assignment system with HubSpot deal links + owner-id assignment fallback
- Live mode — page-load eval replaces daily cron
- PM Accountability dashboard + weekly digest (Phase 1)
- EagleView TrueDesign auto-pull pipeline
- Solar Surveyor renders EagleViewPanel when `?dealId=` URL param is set

### SOP Guide Phase 4
- WYSIWYG editor (TipTap) replacing raw HTML CodeMirror
- Submit-a-new-SOP feature with admin review queue
- Drafts tab with PM Guide rewrite + Pipeline Overview
- Auto-link `<code>/route</code>` mentions to actual app pages
- Tech Ops tab split into Design / Permitting / Interconnection
- Hub-mode visibility flipped to open by default

### Catalog + Zuper + Zoho Hardening
- Phased HubSpot manufacturer enum enforcement; auto-add unknown brands and notify TechOps
- Phase B operational: HubSpot enum + Zoho categories
- Zoho writes switched from group_name to category_id
- Sync Modal executions logged to ActivityLog with sync observability enums and watermark columns
- Spec-derived custom fields plumbed on Zuper product create with dimensions
- Product photo pushed to Zoho Inventory on approval
- Backfill script for Zoho item images from historical pushes
- Description + part_number propagation on Zoho item update
- IT-team activity-log export API, audit-sessions/anomaly-events/user-roster endpoints
- ScheduleEventLog captures Zuper reschedules and crew changes

### Compliance V2
- Per-service-task scoring with status bucket fixes (flag-gated)

---

## 2026-03

### Revenue Goal Tracker (Major)
- New revenue goal tracker with progress rings + thermometer bars hero variants
- Monthly breakdown chart with hit/miss indicators
- Canvas fireworks animation for monthly goal hits
- Admin config GET/PUT for revenue goal targets
- Cache keys, query keys, and SSE cascade for revenue goals
- Zuper-based recognition for Service and Roofing groups

### Project Pipeline Funnel (initial)
- New `/dashboards/funnel` with conversion arrows and monthly grouped bar chart
- Cohort table with conversion percentages
- Backlog callouts, DA pacing, cancelled revenue
- Multiselect locations, pacing revenue, stage distribution
- Drill-down deal lists for each backlog bucket
- Timeframe clarity, expanded options, pending sales change tracking
- Suite navigation links to Executive and D&E suites

### Sync Modal V2 (Sync-Relay)
- Complete rewrite with plan-based flow and auto-cascade
- Wide comparison table with per-cell source selection
- 10 new mapping edges; zoho part_number and unit now bidirectional
- Plan derivation engine with conflict detection and hash confirmation
- Snapshot builder and default intents
- Generator fields visible and toggleable
- selectionToIntents translation layer with smart defaults and dropdown filtering
- Stale detection on plan execution

### EOD Email System
- End-of-day summary email cron with morning/evening snapshot diff
- Milestone detection with property history enrichment
- HubSpot completed-task search for tracked leads
- Per-person task count and per-person change count
- HTML email builder with structured sections
- Restructured by person; trimmed names; fixed stage IDs
- Major signal-to-noise improvements for EOD email
- DealStatusSnapshot model added for morning/evening diff

### Inspection + Construction + Survey + DA Metrics
- Inspection metrics dashboard with drill-downs, action queues, and dual-source validation
- Location custom object + AHJ inspection properties added to HubSpot
- 11 inspection deal properties added to HubSpot client
- Construction metrics: CC→PTO replaced with CC→Inspection Passed; Zuper links on drill-down; All Locations summary card
- Site survey turnaround metrics dashboard
- Design Approval (DA) metrics dashboard

### Master Scheduler V2 (Service + D&R Overlays)
- Service and D&R toggle buttons on calendar toolbar
- Overlay events rendered in month/week/Gantt with distinct styling and read-only popover
- Fetch service & D&R jobs from Zuper and map to OverlayEvent
- Collapsible project sidebar with localStorage persistence
- localStorage-persisted toggles for service, D&R, and sidebar collapse
- Per-status revenue cards on construction scheduler; completed month/year stats and overdue revenue

### Pipeline Selector + Per-Pipeline Stats
- Pipeline selector with per-pipeline stage sorting
- Per-pipeline stat cards with clickable links and sticky table header
- Scheduler forecast ghost events
- Owner and PM filters applied across all pipelines
- Skeleton during pipeline fetch instead of false zero

### SKU → Product Rename + Zoho Warehouse SOs
- Phase 1: EquipmentSku renamed to InternalProduct
- Phase 2: user-facing SKU language renamed to Product
- Zoho warehouse-aware Sales Orders with SO API improvements
- Selective catalog sync with per-field direction controls
- Numeric range validation, vendor pair warning, inline validation errors in BasicsStep + DetailsStep
- Photo file size and type validation; stale zohoVendorId detection

### SOP Guide V4
- Centered search bar, renamed to SOP Guide v4.0
- Merged Workflows into Reference tab; tightened layout
- Merged Sales into Other Pipelines, Zuper into Operations
- Visual indicators for role-specific and admin-only tabs
- D&E workflows documented; sidebar section added; permitting summary fixed
- PB brand theme applied to database-driven SOP page
- Tab visibility — public tabs for all, PM Guide for select users
- Survey reassignment notifications sent to both surveyors

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
