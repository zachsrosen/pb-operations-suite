# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-06-15

### PE Analytics & Document Tracker (Major)
- PE Hub at `/dashboards/pe` consolidates Deals, Docs, and Analytics tabs (pe-report retired behind admin)
- PE Analytics: weekly doc submissions/approvals, stacked outcome charts, Lifecycle view, Rejections cohort, Ready-Not-Submitted backlog, segment-level drill-downs, daily rejections, paid+rejected tracking
- Doc Uploaders view: Submissions / By Day / Approved $ tabs with day/week/month grain, distinct-deal counts, per-uploader approval/rejection drill, fractional vs owner credit toggle, admin owner-override
- "By Document" view: Missing + Open Rejections per doc, drill anywhere
- Uploads Explorer filters Doc Uploaders by document + uploader, clickable chart segments drill to that day's docs
- Short-pay correction recorded so PE Revenue Collected reflects actual dollars; wired into hub Deals & Payments tab
- Document Rework & Attribution tab; counts only real rejections (drops sync-noise)
- Collapsible groups across Sections, By-Team, and Deals views
- Per-view Copy / CSV export of Doc Tracker lists for sending to teams
- Manual "Sync now" button; waive moot docs on done milestones

### PE Photo Submission Tools
- Self-serve Photos-per-Policy builder (web tool) resolvable by PROJ number or customer name
- `final-permit` and `policy-photos` skills for PE photo submissions
- Policy-photos no longer over-filters — keeps all required shots, labels each page

### Tech Ops Bot (Major)
- Proactive daily digest DM'd to the owner; tailored per-room digests with custom intro/sections/content focus
- Scoped daily digests posted to team Google Chat rooms; matches room names with parenthetical suffix
- `?preview=1` renders digests without posting
- Real fleet schedule from ScheduleRecord (replaces calendar stub), filtered by deal `pb_location`
- New tools: `get_project_team`, `get_project_service` lookups
- Rotating "thinking" ack messages; assigns tasks to a named person with task-vs-process-request judgment
- Stops implying Zach is OOO; honest process-request email status; resolves idempotency keys

### D&E Funnel
- Status Funnel rendered as branch/tree
- Awaiting Site Survey bucket added; completed revisions dulled
- Panel styling matches Project Pipeline Funnel

### Bug Fixes
- Stuck-deals section filtered to active stages
- M2 docs gated to Close-Out+ deals (PTO owes M1 only)
- Phantom action-resolutions dropped from uploader stats; "Unknown" relabeled
- PE portal scraper webhook retired (was corrupting doc statuses)
- Cancelled projects excluded from uploader approval rates
- Moot docs excluded from Missing-by-Document
- `/api/cron/tech-ops-bot-digest` allowlisted through middleware

---

## 2026-05-31

### Tesla PowerHub Integration (Major)
- Tesla PowerHub API client with OAuth2 `client_credentials`, rate limiting, JWT token rotation
- Fleet monitoring dashboard with expandable site table, filter empty sites, search, sort by data
- Three-tier site-to-deal linkage with auto-link by geo-coordinates; backfill site addresses from linked deals
- Native Tesla PowerHub UI Extension card for HubSpot (plus compact sidebar) with v3 signature verification
- Push all Tesla device serials + models to Zuper Property/Job
- PowerHub alert scoring rolled into service priority queue
- Battery SoC derivation from energy-remaining when SoC signal missing
- Fly.io mTLS proxy (dfw region) with token response parsing
- Asset/telemetry/alert sync orchestration with batched cron handlers
- Full telemetry signal + alert metadata capture; cross-system Tesla portal URL linking (HubSpot + Zuper + Suite)

### Enphase Enlighten Integration
- Full parity with PowerHub: API client, crosslink, telemetry, asset sync, status monitoring
- Partner OAuth setup route for installer auth flow with DB-persisted refresh token

### Shop Health Dashboard (Major)
- Weekly Shop Health Dashboard launched with Service, D&R/Roofing, Customer Success, Preconstruction sections
- Customer Success: sentiment scoring, 5-star reviews, response-time drill-downs
- Revenue hero card and pipeline revenue detail; targets derived from revenue goals
- Drill-down tables to all count-based metrics; multiple bottleneck entries per shop per week
- Lightweight overview path (1 Project fetch, no tickets) + caching to prevent 429s
- Fail-open on Service/D&R fetches; cache closed tickets

### Pipeline Tracker
- PE Pipeline Tracker and general Pipeline Tracker dashboards
- Construction/Inspection/Site Survey tabs with sortable columns and status filters
- Total revenue hero card, per-stage revenue in PE Pipeline hero cards
- Zuper job links + cross-links between PE Pipeline and Pipeline Tracker
- Inspection pass / PTO granted dates on PE Submission Gap

### PE Submission Gap & Sync
- PE Raceway API sync replaced HTML scraper — two-way doc-status sync with HubSpot deal properties
- Hourly cron, action items feed, address-based project matching, auto-stamp portal links
- PE Submission Gap: M1/M2/Complete tabs, strict per-stage buckets, document-level progress per deal
- API sync pushes doc statuses to HubSpot deal properties; writes NOT_UPLOADED rows for docs the API omits
- UPLOADED and UNDER_REVIEW merged into single "In Review" status
- Monthly Activity throughput dashboard

### Google Chat OOO Bot
- Google Chat OOO bot (later renamed Tech Ops bot) with HubSpot task creation, process-request filing
- Tool palette: count_deals_by_status, revenue rollups, milestone date-range queries, PE M1/M2 breakdowns
- Auth: multiple JWKS sources, multi-audience JWT acceptance, Google Workspace add-on envelope format, base64 service account key
- Post replies to main timeline; capture async post errors to DB
- Admin OOO bot escalations review dashboard with Apply-to-Playbook button

### PE Deals
- Split PE Deals card into Pre-Construction vs Construction+
- Awaiting PTO segment; pipeline bar split into stage buckets
- Customer Paid? column; multi-column sort; default sort by PE Total
- Exclude Cancelled; auto-rename Other → On Hold
- Submitted-total x/y count + under-review badge

### Scheduler
- Weekend visibility toggle (without stealing Monday); events render on weekend cells
- Weekend install scheduling design spec

### Bug Fixes
- Service/D&R duplicate Project pipeline fetch removed
- PE-scraper sync override NOT_UPLOADED → UPLOADED for unknown status with submitted date
- Daily focus morning snapshot saves before sending emails
- EOD summary tracks actual action items
- Roofing-scheduler inline JOB_CATEGORY UIDs (drop client→server import)
- Zuper API sweep skipped on DB-cache hits; `/jobs/by-category` cached (~97% call reduction)
- UPLOADED→UNDER_REVIEW convergence no longer logged as a change

---

## 2026-04-30

### Property Hub (Major)
- HubSpot Property custom object with full-page view at `/properties/[id]`
- Equipment, Photos, Activity tabs with HubSpot + Zuper external links per tab
- HubSpot line items in Equipment tab; Zuper job photos in Photos tab
- Contact names, deal names, ticket enum labels with links in PropertyDrawer
- Zuper Property sync (write direction) with customer association on create/update
- Address validation + safety checks to prevent Zuper property misassociation
- Shovels API enrichment: permits, residents, contractors
- Inngest queue for property sync workflows
- HubSpot workflow-sync endpoint accepts native webhook payload format
- ATTOM-sourced fields (yearBuilt, squareFootage, roofMaterial) stubbed pending integration

### Admin Workflow Builder (Major)
- Visual workflow builder shipped through 16 phases on Inngest runtime
- 10 actions: send-email, ai-compose, update-hubspot-property, update-hubspot-contact-property, add-hubspot-note, create-hubspot-task, update-zuper-property, run-bom-pipeline, log-activity, http-request, find-hubspot-contact, fetch-zuper-job
- Control-flow: delay, stop-if, parallel, for-each loop
- Triggers: MANUAL, HUBSPOT_PROPERTY_CHANGE, ZUPER_PROPERTY_CHANGE, CRON, CUSTOM_EVENT
- Per-run detail page with step output drill-in; cross-workflow run history; analytics dashboard
- Template library with Duplicate workflow button
- Dynamic select/multiselect option re-fetch with unified property options
- Failure alerts, dry-run mode, action-level idempotency, per-workflow rate limiting
- Workflow versioning (snapshot + rollback), export/import JSON, visual canvas preview, drag-to-reorder canvas
- Inngest auto-sync on deploy + manual resync button

### IDR Meeting Hub (Major)
- IDR Meeting Hub: Sales folder, PM task on sync, open-all links
- BOM Review & Line Item Editor inside IDR meeting
- Compare planset layout against DA layout in design review
- Revision workflow: re-review toggle, auto-appear, revision reason sync, RE-REVIEW badge
- Escalation revisions trigger as-built design status
- 10% threshold warning, tier adders, ops revision notes, SS note line
- IDR adders: roof type auto-populate, adder amount property, % of deal + waiver warnings
- AI design review no longer flags utility meters as production meters
- Recovery from accidental "End without syncing" + two-click confirm
- Open access to all authenticated roles

### Accounting Suite
- Payment Tracking dashboard + ACCOUNTING role
- Payment Tracking + Payment Action Queue page split
- HubSpot invoices attached to payment-tracking rows
- Invoices matched to milestones by line item name (incl PTO + PE)
- Payment Timeline dashboard; payment volume bar chart with day/week/month toggle
- Cost Audit: bulk-sync costs to latest bill + suggested sales price, sales price, margin, cross-system link badges
- Pricing calculator: `salesChangeAmount` field replaces delta
- PE pays a portion of `deal.amount` (not additional revenue); PTO milestone non-PE only

### On-Call Electrician Rotation
- V1 on-call electrician rotations with weekly cadence + self-service swaps
- Admin/executive Activity view for all swap + PTO requests
- Sun-Sat weeks, 6pm-10pm weekday / 8am-12pm weekend shifts
- Emergency call log; admin call logging and HR sheet export
- Auto-create HubSpot service ticket on follow-up
- Per-state Google Calendar staged for later flip-on
- On-call electrician overlay on master schedule

### Permit Hub & Interconnection Hub
- Permit Hub: two-pane workspace at `/dashboards/permit-hub`
- Shared inbox thread fetch on correspondence tab; sticky action panel; grouped queue
- Per-inbox OAuth workaround for blocked DWD scope
- Interconnection Hub v1 rendered as parallel workstream

### Customer Estimator v2
- Phase 1: customer-facing solar estimator v2 with 5 quote-type flows (EV, Battery, Expansion, D&R, Solar)
- Reliable Places autocomplete + cross-flow navigation
- Iframe embed mode; slim HubSpot properties (14 → 3)

### Adders
- Phase 1: governed Adder Catalog
- `/dashboards/adders` catalog UI; triage recommendation engine
- Rep-facing mobile triage UI + deal-detail embed
- OpenSolar sync scaffold behind kill switch
- Sales product request page (equipment + adders → OpenSolar)

### EagleView TrueDesign Integration
- TrueDesign auto-pull pipeline
- Production PlaceOrder request format; sandbox integration test page
- EagleView Orders dashboard page
- EagleViewPanel renders when `?dealId=` URL param is set in Solar Surveyor

### Office Performance & TV Carousels
- All-locations overview page at `/office-performance/all`
- 7-slide carousel on all-locations TV page; per-location carousel with all-locations slide
- Goals & Pipeline, Service, Office Calendar carousel slides
- Directional slide+fade transitions with ambient background
- Combine SLO + Camarillo into single California dashboard
- CountUp + ProgressRing for Surveys / Inspections / Installs sections
- Cache-first fetching to cut dashboard load time

### Multi-Role Migration
- Phase 1 multi-role access + home-page redesign
- Part 2A: migrate `role` → `roles` across all callers
- Part 2B: delete shim, remove back-compat
- Read-only Role Inspector at `/admin/roles`; runtime-editable role definitions
- Super-admin break-glass safeguard; withhold super-admin email during impersonation
- OWNER → EXECUTIVE rename + SALES_MANAGER added
- 6 scoped suite roles + Sales & Marketing suite (Phase 1)
- ACCOUNTING role; SERVICE role scoped to Service Suite
- Per-role capability overrides

### Aircall Call Analytics
- Aircall call analytics dashboard (Phase 1)
- Per-user answer rate via ring tracking
- Import Analytics+ ringing-attempts CSV for historical data
- Executive call analytics dashboard (Phase 2)
- On-Call Calls section from OnCallCallLog

### Jobs Map
- Jobs proximity map (installs + service + crews)
- Week/Backlog, tickets, inspection/survey, D&R + roofing markers
- Dispatcher office pin + morning briefing + nearby highlights
- Assignee filter + scheduled-today markers never cluster
- Call + add-note quick actions

---

## 2026-03-31

### Sub-Job Scheduling
- SubJobScheduleModal with same/separate modes wired into master + construction schedulers
- Cascade reschedule of sibling construction sub-jobs with audit logging
- Sub-job breakdown view for construction cards
- Construction job split: Solar / Battery / EV
- Show individual sub-job Zuper links in schedule modal
- Tentative vs live mode visually obvious across all schedulers

### Service Suite Enrichment
- Shared enrichment layer + Zuper cache sync
- Pipeline-ordered stages + active-only toggle
- Dynamic stages + multiselect filters
- Service-team sales pipeline card + last-communication preview
- Service Suite priority queue: Deals/Tickets filter, PowerHub alert scoring
- Service deal BOMs in Service BOM history page
- `pb_location` read directly from service tickets

### BOM Pipeline & Catalog
- BOM push to HubSpot with UI, migration, role fixes
- Service Catalog + SO Creation (Phase 4): any product category, contact-based customer resolution
- Service BOM page (deals + tickets) with ticket-keyed snapshots
- Use TGN3322R as standard 60A disconnect, decouple from service-tap detection
- Sanitize filename before Claude Files API upload
- Subfolder-aware PDF listing in pipeline
- Preferred-vendor PO splitting — auto-split BOM items by Zoho vendor
- Include HubSpot deal record ID on Zoho Sales Orders

### Catalog Validation & Sync
- Numeric range validation, vendor pair warning, inline errors in BasicsStep + DetailsStep + CategoryFields
- Photo file size/type validation; stale `zohoVendorId` detection with re-select hint
- Selective sync with per-field direction controls
- Race-safe external-record create + link-back
- Catalog cross-link writer extracted to shared helper
- Sync observability enums and watermark columns
- Catalog delete functionality; auto-commit custom brand on blur/click-outside
- Push product photo to Zoho Inventory on approval
- Integrity audit + auto-fixable repairs; 311-row Zoho orphan reconciliation
- Sync Health page: drift rollup across InternalProduct/HubSpot/Zuper/Zoho
- Auto-add unknown brands to HubSpot manufacturer enum + notify TechOps

### Inspections Metrics
- Dashboard page with drill-downs and action queues
- API route with dual-source validation
- 11 inspection deal properties added to HubSpot client
- Location custom object + AHJ inspection properties
- Filtered to only show Inspection-stage projects

### Master Scheduler
- Service & D&R overlay on master schedule with toggle buttons; localStorage-persisted
- Render overlay events in month/week/Gantt with distinct styling
- Alias-aware location mapper for overlays + time window in popover
- Collapsible project sidebar with localStorage persistence
- Forecast ghost events for all pre-construction stages
- Off-by-one day alignment fix in construction scheduler month view

### Crew Schedule
- Crew schedule dashboard — see where every crew member works each day
- Split comma-separated `assignedUser` into individual rows
- Show assignees without a CrewMember record
- ScheduleEventLog captures Zuper reschedules and crew changes
- Multi-crew install emails collapsed into one send

### SOP
- Tools tab (BOM + AI Design Review), Service extras
- Suites tab — overview + per-suite SOPs
- Action Queues tab + Tools extensions (Workflow Builder, Property Drawer, Deal Detail)
- Role-gated SOP tabs and sections
- Split Tech Ops tab into Design / Permitting / Interconnection
- Executive + Accounting + Sales & Marketing tabs (role-gated)
- WYSIWYG TipTap editor replaces raw HTML CodeMirror
- Submit-a-new-SOP feature with admin review queue

### Bug Fixes
- Coerce numeric `dealId` to string in da-rework-flags
- HubSpot owner directory indexed by `userId` for design/permit lead resolution
- HubSpot internal value used for `design_status` auto-advance
- Resolve "Invalid confirmation token" on selective sync
- Whitelist numeric fields for type coercion in catalog sync
- Skip pipeline-health cron alert on weekends
- Exclude cancelled/complete deals from IDR queue
- Bypass empty `HubSpotProjectCache` for Zuper location filtering

### Security & Auth
- `ADMIN_RECOVERY_CODE` required for role recovery endpoint
- Remove non-auth secrets from token key fallback chain
- Fully redact private key values in debug endpoint
- Gmail identity verification during connect; fail-closed mailbox verification
- `API_SECRET_TOKEN` auth on PowerHub import-locations route

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
