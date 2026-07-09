# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-06-23

Covers ~3.5 months since the last entry (1,489 PRs merged). Grouped by system.

### PE (Participate Energy) — Major Expansion
- PE File Preparation tool: AI-vision audit + PandaDoc auto-pull + prep dashboard
- Photos-per-Policy and Final Permit Photos self-serve builders (AI-verified PDF assembly)
- PE & Compliance Suite consolidating PE + compliance pages
- PE Analytics dashboard: funnel totals, weekly cohort charts, doc submission outcomes
- Cohort views — Lifecycle / Ready-to-Submit / Submissions / Approvals / Rejections / Milestone Progression
- Doc-level rejections by day, segment drill-down, aggregate drill from totals cards
- Doc Uploaders standalone card with payment ownership + By-Day chart
- Uploads Explorer — filter by document + uploader, drill anywhere
- "By Document" and "By Team" views with Missing + Open Rejections breakdown
- Owner/Fractional toggle for approved-$ attribution
- PE Submission Gap report, PE Pipeline Tracker, PE Document Tracker, PE Approved Vendor List
- PE Deals split into Pre-Construction vs Construction+, Awaiting PTO segment, Customer Paid column
- Tabbed PE Hub at `/dashboards/pe` (deals, docs, analytics)
- PE Raceway API sync replacing HTML portal scraper
- Two-way doc status sync with HubSpot deal properties
- Auto-stamp portal links via address-based project matching
- Doc version history + uploader attribution from PE API
- Auto-advance Rejected → Ready to Resubmit when rejection tasks done
- Populate `pe_doc_*_notes` from real reviewer comments; live-pull per-team M1 rejection notes
- Mark P.E. M1/M2 Documents checkboxes on rejection
- PE Action Items feed + incremental sync + hourly cron
- PE Action Tasks Cross-Reference MVP — Planset / Hardware / Sales Order analyzers
- Retired PE portal scraper webhook (corrupted doc statuses)
- Daily PE doc digest restructured into 4 actionable sections
- Instant email notifications on PE doc status changes
- Stop webhook retry storm regenerating duplicate tasks; loosen rejection-task matcher

### Tesla PowerHub Integration (Major, May 7)
- Tesla PowerHub fleet monitoring — OAuth2, mTLS proxy via Fly.io
- Live API alignment, batch telemetry/alert polls, group-level alert sync
- Site detail expand with HubSpot deal/property/contacts
- Native HubSpot UI Extension Tesla PowerHub card + sidebar card
- Push all Tesla device serials + models to Zuper Property/Job
- Cross-system Tesla portal URL linking (HubSpot + Zuper + Suite)
- Geo-coordinate matching via portal-imported lat/lng
- Clear stale alerts on sites that drop out of the poll

### Enphase Enlighten Integration (Major, May 21)
- Enphase Enlighten API integration at PowerHub parity
- OAuth2 auth code flow with DB-persisted token rotation
- Partner OAuth setup route for installer auth flow

### EagleView / TrueDesign Integration
- EagleView Imagery API integration with rollout runbook
- EagleView Orders dashboard with order details drawer + Report # link
- TrueDesign auto-pull pipeline (9 tasks) with full-order URL properties
- TrueDesign CAD/DXF pull foundation + webhook (flag-off)
- Order status stamping onto HubSpot deal/ticket
- PB location filter + deal links on orders list
- TrueDesign delivery failures self-healing
- Save shade as .zip + backfill late-arriving measurement files
- Reviewed webhook uses HubSpot v3 signature auth

### Atlas Map / Jobs Proximity (Major, Jun 19)
- Jobs proximity map Phase 1 — installs + service + crews
- Phase 2+3 — Week/Backlog, tickets, inspection/survey, UX polish
- Atlas embedded as a top-level destination
- Atlas map card surfaced in Operations, PM, and Service suites
- Dispatcher office pin + morning briefing + nearby highlights
- Assignee filter + scheduled-today markers never cluster

### Workflow Map (Major, Jun 22)
- Workflow Map — live HubSpot automation + SOP reference dashboard
- Zoomable flowchart view (pipelines → stages → workflows)
- Process view — plain-English end-to-end pipeline walkthrough, expandable per stage
- Curated vertical-swimlane Process view with parallel Design/Permitting tracks
- Resumable backfill + admin Build/Re-sync button

### Project Pipeline Funnel (Major, May 21 → Jun)
- 9-stage sales-to-construction Pipeline Funnel with on-hold + cancelled lifecycle segments
- Funnel hero cards, location matrix, Sales Funnel tab
- Active Pipeline + Monthly Throughput tabs
- Incoming tab — DA→RTB inflow forecast + Capacity & Backlog row (RTB bench + runway)
- Drill-down on Current Pipeline Position + blocked/on-hold reasons
- Sortable backlog columns + calendar-timeframe fix
- Surfaced on Operations suite

### Admin Workflow Builder (Major, Apr 22–23)
- Inngest-backed workflow builder with editor UI + CRUD API
- 10 actions (send-email, ai-compose, HubSpot/Zuper updates, run-bom-pipeline, etc.) + control flow
- Webhook fan-out for HubSpot + Zuper triggers
- CRON, CUSTOM_EVENT triggers + dispatcher cron + per-workflow rate limiting
- Workflow versioning (snapshot on save + rollback)
- Dry-run mode + failure alerts + action-level idempotency
- Export/import workflow JSON, parallel + for-each control-flow
- Visual canvas preview + drag-to-reorder
- Per-run detail page + cross-workflow run history + analytics dashboard
- Inngest auto-sync on deploy + manual resync
- `http-request` and `find-hubspot-contact` actions

### Property Object
- HubSpot Property custom object v1 — canonical address with rollups
- Property Hub full-page view at `/properties/[id]`
- Equipment summaries, revenue, Zuper link, Photos tab
- Zuper Property sync (write direction)
- Inngest queue for property sync workflows
- Workflow-sync endpoint for HubSpot workflow-driven property sync
- Shovels API property enrichment (permits, residents, contractors)
- Manual-create flow + verified address match for single-candidate links
- Contact names + HubSpot link surfaced in Property drawer

### Service Suite
- Service BOM page (deals + tickets) with ticket-keyed snapshots
- Service carousel slide on office performance dashboards
- Production Issues — Service view (tickets + completed-project deals)
- Service-team sales pipeline card + last-communication preview
- Customer History v2 — contact-based lookup
- Service ticket creation auto from on-call follow-ups
- Service Catalog + SO Creation Phase 4

### Scheduling
- Crew schedule dashboard — see where every crew member works each day
- Master scheduler service & D&R overlay with read-only popover
- Day view timed grid for surveys/inspections
- Construction job split: Solar / Battery / EV with sub-job breakdown
- Sub-job tentative scheduling and `syncToZuper` toggle
- Reschedule all sibling construction sub-jobs together
- Pre-sale site visit Zuper flow + show pre-sale survey cards on calendar
- On-call electrician overlay on master schedule
- Weekend visibility toggle + show events on weekend cells without stealing Monday
- Editable date picker on drag-drop reschedule
- Orphaned resurvey/re-inspection jobs surfaced
- Forecast ghosts for all pre-construction stages
- Per-office daily survey cap
- Tentative vs live mode visually obvious across schedulers
- Sub-jobs prevent cross-deal bleed on same-customer projects

### Office Performance & Shop Health
- Weekly Shop Health Dashboard
- All-locations overview at `/office-performance/all` with 7-slide TV carousel
- Drill-down deal lists + Zuper compliance
- Customer Success section with sentiment scoring + 5-star reviews
- Preconstruction section with throughput + cycle times
- Goals & Pipeline + Office Calendar carousel slides for per-location TVs
- Combined California dashboard (SLO + Camarillo)
- Revenue hero card + pipeline revenue detail
- Drill-downs for sentiment, 5-star reviews, response time
- Cache-warming cron to fix 504 death spiral

### Accounting Suite
- Payment Tracking + Payment Action Queue split
- Payment Timeline dashboard + payment volume bar chart
- Three new accounting pages — invoice-first bucketing
- Match invoices to milestones by line item name including PTO + PE
- Ready-to-Invoice attention signals from project triggers
- Active-only filter + stage phase pill
- Outstanding = invoiced-but-unpaid only (% uncapped)
- Preset date-window filter + invoice dots link to deal
- Cost Audit — cross-reference Zoho bills against item purchase rates

### Pricing Calculator & Adders Catalog
- Governed Adder Catalog Phase 1 (6 chunks)
- Triage recommendation engine + `/api/triage/*`
- Rep-facing mobile triage UI + deal-detail embed
- DB-backed adder path (opt-in)
- OpenSolar sync scaffold behind kill switch
- HubSpot roof type auto-populate, % of deal + waiver warnings
- IDR adders integration + adder amount property

### Customer-Facing Solar Estimator (Apr 21)
- Phase 1 customer-facing solar estimator v2
- All 5 quote-type flows (EV, Battery, Expansion, D&R)
- Slim HubSpot properties (14 → 3) + iframe embed mode
- Reliable Places autocomplete + cross-flow nav

### IDR / Design & Ops Meeting Hub
- Design & Ops Meeting Hub launch (formerly IDR Meeting Hub)
- Meeting prep queue with escalation + design review support
- Real-time collaboration, HTML note formatting, @mentions
- Live preview mode, exclude On Hold deals
- IDR Meeting Search History
- Sales folder, PM task on sync, open-all links
- Recovery from accidental "End without syncing" + two-click confirm
- Re-review toggle, auto-appear, revision reason sync
- Previous review notes for re-reviews + richer search results
- Compare planset layout against DA layout in design review
- Shit Show Meeting Hub
- BOM Review & Line Item Editor
- Scoped to Colorado, California, or all

### Permitting & Interconnection
- Permit Hub two-pane workspace for permitting team
- Interconnection Hub v1
- Pipeline Tracker dashboard with Construction / Inspection / Site Survey tabs
- Permit-lead filter, sticky action panel, grouped queue
- Shared inbox thread fetch on correspondence tab
- Per-inbox OAuth workaround for blocked DWD scope
- Resolved names + header quick-links + AHJ fallback

### Tech Ops Bot (Google Chat OOO Bot)
- Google Chat OOO bot launch, renamed internals to Tech Ops bot
- HubSpot task creation, `log_correction` for in-chat corrections
- Apply-to-playbook button for bot corrections
- Admin OOO bot escalations review dashboard
- Proactive daily digest DM'd to the owner; scoped per-room digests
- Morning sweep — proactive daily task & ticket digest
- `count_deals_by_status` / DA / design / permitting breakdowns
- Full-pipeline status coverage — construction, inspection, PTO
- PE M1 / M2 milestone status breakdowns
- Revenue rollups + milestone date-range queries
- `get_project_status` returns project type + PE IC/PC payment amounts
- `get_project_team` + `get_project_service` lookup tools
- Real fleet schedule from `ScheduleRecord`
- `?preview=1` renders digests without posting

### Aircall / Call Analytics
- Aircall call analytics dashboard Phase 1 + 2
- Per-user answer rate via ring tracking
- Analytics+ ringing-attempts CSV import
- On-Call Calls section from `OnCallCallLog`

### On-Call System
- V1 on-call electrician rotations
- Weekly rotation + self-service swaps + merged Colorado pool
- Per-state Google Calendar + Tracey's Apr 28 go-live policy
- Admin/executive Activity view — all swap + PTO requests
- Admin call logging and HR sheet export
- Sun-Sat weeks + 6pm-10pm weekday / 8am-12pm weekend shifts
- Monday-start weeks + drop California Sunday coverage
- Emergency call log captured by on-call electricians

### Deal Detail Page (Apr 13)
- Read-only deal record view
- 13 enhancements — site photo gallery, sync changelog, Zuper status history, BOM, schedule timeline
- HubSpot tasks + Zuper job notes in Activity timeline
- Resolve department/team owner IDs to names
- On-demand sync from HubSpot when deal not in mirror

### Catalog & Inventory
- Sync Health page — drift rollup across InternalProduct/HubSpot/Zuper/Zoho
- Sales product request page — equipment + adders → OpenSolar
- Push product photo to Zoho Inventory on approval + backfill from historical pushes
- Renamed EquipmentSku → InternalProduct (Phase 1); user-facing SKU → Product (Phase 2)
- Service Catalog + SO Creation Phase 4
- Warehouse-aware Sales Orders
- Preferred-vendor PO splitting — auto-split BOM items by Zoho vendor
- Selective catalog sync

### Comms Dashboard
- Overhauled Comms dashboard to match unified-inbox-live reference app
- HubSpot emails outside inbox (with cap + rate limit handling)
- Expandable message rows, inline actions, unified inbox patterns
- Auto-pagination, By Project view, Gmail fetch up to 200
- Three-pane layout with rate-limit guard

### Multi-Role Access System (Apr 17 → 22)
- Phase 1 — `user.roles[]` array
- Phase 2A/2B migration — drop legacy single-role column
- 6 scoped suite roles + Sales & Marketing suite
- Runtime-editable role definitions
- Per-role capability overrides + per-user extra route grants
- Read-only Role Inspector at `/admin/roles`
- ACCOUNTING + SERVICE roles added
- Super-admin break-glass safeguard with UI indicator

### Admin Console Overhaul (Apr 18 → 20)
- Unified AdminShell + `/admin` landing + in-shell search
- Consolidate `/suites/admin` into `/admin`
- Admin primitives — table, filter bar, detail drawer, bulk action bar, form
- `/admin/users`, `/roles`, `/activity`, `/audit`, `/security`, `/tickets`, `/directory`, `/crew-availability` migrated to shell
- Admin testing suite

### My Tasks & Freshservice (Apr 20)
- Personal HubSpot tasks dashboard
- Inline status + queue edit, shortcuts, URL state
- Snooze, create, completed-this-week, bulk done
- Typeahead lookups + New Task from deal panel
- Autofocus first row + admin-managed queue names
- Freshservice user-facing `/dashboards/my-tickets`
- Admin Freshservice page + UserMenu badge for user's own tickets
- Freshservice ticket creation via API instead of email

### PM Accountability
- PM Accountability dashboard + weekly digest Phase 1
- Exception-based PM assignment system
- Live mode — page-load eval replaces daily cron
- Project Management Suite landing page
- HubSpot deal links + owner-id assignment fallback
- Replace `PendingPropertyOverride` cron with HubSpot workflow properties

### Solar Surveyor / Solar Designer
- Solar Designer Stage 1-4 design specs + implementations
- Per-panel shade CSVs (`shading_A_IPXXXX.csv`)
- Folder upload and folder drag-and-drop
- Bulk shade CSVs collapsed into single summary line
- Cross-inverter MPPT reassignment
- EagleViewPanel rendered when `?dealId=` URL param is set

### TSRF Peak Power Calculator
- TSRF Peak Power Calculator in D&E + Service suites
- Annual clipping hours estimate

### Revenue & Forecasting
- Revenue Goal Tracker with stacked monthly bars + multi-select filter
- Office goals — two-tier base + stretch with gold progress bar
- Site Survey + PTO Granted goal lines
- California annual revenue target updated to $9M ($750K/month)
- Weekly goals digest email — one per office
- TV dashboard rich deal list with Zuper status, PE flags, unified layout

### Design & Inspection Metrics
- Inspection metrics dashboard with drill-downs + action queues
- DA Metrics dashboard with Current DA Pipeline summary cards
- Split DA first-try into customer vs design + rework attribution
- D&E Funnel with revision loops
- D&E Funnel — Awaiting Site Survey, Design Upload, Design Review buckets
- D&E Funnel — render Status Funnel as a branch/tree

### SOP System
- Submit-a-new-SOP feature with admin review queue
- TipTap WYSIWYG editor replaces raw HTML CodeMirror
- Auto-link `/route` mentions to actual app pages
- Hub-mode visibility flip — open by default
- Role-gated SOP tabs + sections
- Split Tech Ops tab into Design / Permitting / Interconnection
- Drafts tab with PM Guide rewrite + Pipeline Overview
- Batch SOPs — Catalog, Service, Scheduling, Forecast, AHJ & Utility, Submitting a New Product

### Infrastructure & Performance
- Inngest workflow engine spike behind `INNGEST_BOM_ENABLED` flag
- Cross-instance shared cache + single-flight for projects/deals
- Zuper API calls reduced ~97% by caching job list in lookup endpoint
- Per-endpoint Zuper API call counter + admin read endpoint
- Pause 3 HubSpot-heavy crons to relieve rate-limit outage
- SystemConfig-backed runtime config + TrueDesign public-client wiring
- Centralize Claude model IDs, replace retiring Sonnet 4
- Page Traffic analytics (admin) — views, dwell, dead-weight, per-user
- Auto-reload pages on new deployment
- `ScheduleEventLog` — capture Zuper reschedules and crew changes
- Live clock replaces static "Updated" timestamp on all dashboards
- Centralized cron throttling (Zuper property-sync, job-backfill cut to /6h)

### Notable Fixes & Polish
- Brand rename: PB Operations Suite → PB Tech Ops Suite
- Cancelled deals no longer counted as having reached every funnel milestone
- Reschedule lookup sorts jobs newest-first
- Vishtik project ID + URL sync onto deals
- Daily focus email cron for P&I and Design leads
- Site survey readiness checker and FDR webhook
- Install photo review webhook for Inspection stage
- AI design review no longer flags utility meters as production meters
- Drift detector — PandaDoc DA status as backup for HubSpot connector
- Zuper-drift PM dashboard for HubSpot status drift
- Crew schedule shows assignees without a `CrewMember` record
- Move feedback + chat launchers into the header chrome
- Service deal BOMs in Service BOM history page

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
