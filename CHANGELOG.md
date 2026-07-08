# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-07-03

### Participate Energy Suite (Major)
- New PE Analytics hub replacing the standalone report — Documents, Doc Uploaders, Analytics, Deals & Payments, Timing, and Approved Vendor List in a single dashboard
- PE File Preparation tool — AI vision audit of Zuper/Drive photos and PandaDoc auto-pull, with per-deal prep queue and audit history overlay
- PE Action Tasks Cross-Reference — PlansetAnalyzer, HardwareAnalyzer (PowerHub nameplate mismatch), SalesOrderAnalyzer, and InboxScanAnalyzer auto-run after audits
- PE Document Tracker — By-Team/By-Document/Uploader views with drill-downs, editable blocker notes, Copy/CSV exports, and daily snapshot trend history
- Doc Uploaders view — per-uploader submissions, approvals, rejections, superseded uploads, and Owner⇄Fractional payment-ownership toggle
- Two-way PE document status sync with HubSpot deal properties, plus instant email notifications on status changes
- PE Timing dashboard — Submit→Pay, CC→Pay, Inspection/PTO→Submit, and Remittance timing cards; nightly cron writes avg submission→payment days to all PE deals
- Re-Rejected After Approval report and daily ANCHOR clawback alert for approved docs re-opened
- Milestone Payments view with IC/PC pipeline breakdown, awaiting-approval bucket drill-downs, and Ready/Submitted lifecycle basis
- PE Photos per Policy self-serve builder (web tool) with PROJ/customer resolution and final-permit + policy-photos skills
- Bill of Materials tracked as a conditional M1 document (only when PE asks)
- Auto-advance Rejected → Ready to Resubmit when rejection tasks are done; live-pull per-team rejection notes
- PE Deals dashboard split by pre-construction vs construction+, Awaiting PTO segment, and Customer Paid? column
- HubSpot Deal card showing Participate Energy status; sync now button and "Last synced X ago" indicator across all tabs
- Retired the PE portal scraper webhook (was corrupting doc statuses); moved to API sync with pushed HubSpot deal properties
- Daily PE doc-change digest email restructured into 4 actionable sections, with Drive folder links per deal

### Solar Designer (Major)
- New in-house solar design tool at `/dashboards/solar-designer` — full V12 physics engine port with parity tests
- Equipment selection with catalog dropdowns (8 built-in panels, 9 inverters, 6 ESS) and site conditions panel (temp, albedo, loss profile)
- DXF/JSON/CSV layout upload with client-side parsing, Blob client upload to bypass Vercel body limit, folder + zip drag-and-drop
- Per-panel shade CSV support with format auto-detect and fidelity tagging
- Visualizer tab with satellite background, shade animation, and manual map alignment controls
- Stringing tab with click-to-assign, auto-string algorithm, and Voc/Vmp voltage validation badges
- Production, Timeseries, and Inverters tabs — SVG paired-bar production chart, day/week/month/year timeseries, MPPT reassignment with clipping event detection
- Web Worker runner with stale-tracking and worker lifecycle management

### Admin Workflow Builder (Major)
- Visual workflow builder at `/dashboards/admin/workflows` — Inngest-backed, gated on `ADMIN_WORKFLOWS_ENABLED`
- 12+ actions across HubSpot, Zuper, PB Ops, AI, and messaging; control-flow kinds for delay, stop-if, for-each, and parallel
- Trigger types: MANUAL, HUBSPOT_PROPERTY_CHANGE, ZUPER_PROPERTY_CHANGE, CRON, CUSTOM_EVENT
- Webhook fan-out from HubSpot deal-sync and Zuper webhooks to matching workflows
- Workflow versioning (snapshot on save + rollback), export/import JSON, drag-to-reorder canvas, visual canvas preview
- Per-workflow rate limiting, dry-run mode, best-effort idempotency via DB checkpoints, failure alerts
- Template library and analytics dashboard; Inngest auto-sync on deploy plus manual resync button

### Tesla PowerHub + Enphase Enlighten Monitoring (Major)
- Tesla PowerHub fleet monitoring integration — OAuth2 client_credentials auth via Fly proxy, JWT-authed API client with rate limiting
- Site table with alerts, telemetry, and full equipment summary; PowerHub alert scoring feeds the service priority queue
- Auto-link Tesla sites to HubSpot properties (geo-coord + address hash matching); cross-system portal URL linking to HubSpot, Zuper, and Suite
- Push all Tesla device serials and models to Zuper Property/Job custom fields
- Native HubSpot Deal UI Extension card showing production, battery SoC, and micro health with portal link
- Enphase Enlighten API integration at full PowerHub parity — Partner OAuth setup route for installer auth flow

### EagleView + TrueDesign Auto-Pull (Major)
- EagleView TrueDesign auto-pull pipeline — orders placed on demand, CAD/DXF delivered to project's Drive folder
- EagleView Orders dashboard with default status filters, PB location filter, deal links, and Design Lead resolution
- Order details drawer with Report # links to TrueDesign; stamp order status onto HubSpot deal/ticket
- View in TrueDesign link on the EagleView panel; per-inbox OAuth workaround for blocked DWD scope

### Office Performance TVs (Major)
- TV-scale office performance dashboards with directional slide+fade carousel transitions, ambient background, and PB brand accents
- Animated components — CountUp numbers, SVG ProgressRing, AnimatedBar horizontal charts, staggered leaderboards with metallic podium
- Sections: Surveys (per-surveyor turnaround), Installs, Inspections (individual pass rates), Pipeline (PM/designer/owner breakdowns), Goals & Pipeline
- 4th hero card and Team Results slide replacing Pipeline Overview; per-person metrics with streaks and achievement callouts
- Combined SLO + Camarillo into single California dashboard; all-locations overview page with 7-slide carousel
- Live Zuper API compliance metrics replacing cache-based scoring; MTD counts from HubSpot properties

### Scheduler v2 Construction Dispatch Board
- Phase 1 construction dispatch board at `/dashboards/scheduler-v2`, flag-gated behind SystemConfig
- On-call electrician overlay on master schedule; service + D&R overlay toggles with distinct styling
- Sub-job scheduling — reschedule all sibling construction sub-jobs together, same/separate modes, deal-scoped cascade with audit logging
- Weekend visibility toggle; PB holidays hide survey availability; Needs Revisit + New Construction shown in 3 groups
- Day view timed grid for surveys/inspections; project sidebar collapsible with localStorage persistence
- Orphaned resurvey/re-inspection jobs now show in the master scheduler

### Team Activity Report
- Cross-system employee activity report at `/dashboards/admin/team-activity` (admin only) — pulls HubSpot, Google (Drive + Meet + Chat), Zuper field work, Aircall, PE, and PB Tech Ops as sources
- Day-level drill-down into raw event timeline with Copy button, deal name resolution, task names, and Aircall call detail
- Source toggle chips, ad-hoc "look up anyone" section, and 14-day default with per-person parallel pulls

### Tech Ops Bot + Google Chat Bots
- Claude AI Google Chat bot with 20+ tools: project status (with PE M1/M2 payments), revenue rollups, milestone date-range queries, deal counts by stage, task creation, corrections logging
- Full-pipeline status coverage — construction, inspection, PTO, design, DA, permitting
- Proactive daily digest DM'd to owner; scoped digests posted to team Google Chat rooms with tailored per-room content
- Bot Escalations Corrections tab with Apply-to-playbook button; admin OOO bot escalations review dashboard
- Google Chat OOO bot with SOP integration; morning sweep — proactive daily task & ticket digest for ops leaders
- Freshservice integration switched from email to API-based ticket creation with email fallback

### Aircall Call Analytics
- Executive call analytics dashboard (Phase 1 + 2) with per-user answer rate via ring tracking
- Analytics+ ringing-attempts CSV importer for historical data
- On-Call Calls section on call analytics powered by OnCallCallLog

### On-Call Electrician Rotations
- V1 on-call electrician rotations with weekly Sun-Sat schedule, 6pm-10pm weekday + 8am-12pm weekend shifts
- Electrician self-service swap UI and PTO requests; admin/executive Activity view for all requests
- Per-state Google Calendars staged without invites; emergency call log captured by on-call electricians
- Auto-create HubSpot service ticket on on-call follow-ups; HR sheet export and admin call logging

### Deal Detail Redesign
- 3-tab layout with collapsible photos, timeline, communications, and activity feeds
- Timeline aggregation across HubSpot notes, engagements, Zuper status history, Zuper job notes, HubSpot tasks, BOM, and schedule with composite cursor pagination
- CommunicationsFeed for HubSpot engagements; NoteComposer for internal deal notes with new DealNote model
- Site photo gallery via proxied Zuper URLs; deal detail sync changelog with human-readable field labels

### Property Hub
- Full-page property view at `/properties/[id]` with equipment summaries, revenue, and Zuper link in header
- Photos tab (Zuper job photos), Activity tab enriched with engagement metadata, Equipment tab pulling HubSpot line items
- HubSpot Property custom object v1 shipped; workflow-sync endpoint for HubSpot workflow-driven property upserts
- Inngest queue for property sync workflows replacing PendingPropertyOverride cron

### Project Pipeline Funnel + Monthly Activity
- New 9-stage sales-to-construction Project Pipeline Funnel dashboard with hero cards, close-out activity, and staff assignment drill-downs
- Combined with Monthly Activity throughput into a tabbed page; per-status revenue in Pipeline Backlog
- Design Pipeline Funnel (`/dashboards/funnel`) with backlog callouts, DA pacing, monthly grouped bar chart, and cohort conversion table
- Interconnection shown as a parallel workstream (throughput columns + IC status in backlog)
- "Hide project-rejected" and "Hide on-hold" toggles; PM Rejection Reason surfaced on rejected drill-downs

### Adders Catalog + Triage
- Governed Adder Catalog dashboard with 4-tier structure — moved to Sales & Marketing suite with IN PROGRESS flag
- Triage recommendation engine (`/api/triage/*`) with rep-facing mobile triage UI and deal-detail embed
- OpenSolar sync scaffold behind kill switch

### Permit Hub + IC Hub
- Permit Hub two-pane workspace for permitting team at `/dashboards/permit-hub` — resolved names, quick-links, AHJ fallback, sticky action panel
- Correspondence tab pulls shared inbox thread fetch via Gmail; broadened OR-context search
- Interconnection Hub v1 (`/dashboards/ic-hub`)

### Sync Relay
- Plan-based catalog sync with auto-cascade and conflict detection
- POST /sync/plan endpoint with plan-hash confirmation token; SyncModal rewritten with plan-based flow
- Effective state overlay engine with stale detection and derivation testing

### Solar Estimator v2
- Customer-facing solar estimator v2 with 5 quote-type flows (Solar, EV, Battery, Expansion, D&R)
- Iframe embed mode with slim 3-property HubSpot payload (down from 14); reliable Places autocomplete
- Ported pricing + production config from legacy estimator

### Shop Health + Team KPIs
- New Shop Health dashboard with Preconstruction, Customer Success, Service, and D&R/Roofing sections
- Revenue hero card and pipeline revenue detail; targets derived from revenue goals instead of crew capacity
- Sentiment scoring, 5-star reviews, response time drill-downs; bottleneck entries per shop per week

### Catalog Sync Hardening
- HubSpot manufacturer enum enforcement (phased); auto-add unknown brands to enum + notify TechOps
- Zoho writes switched from `group_name` to `category_id` (M3.1); category_id-based routing
- Cross-link IDs written via `meta_data` on all Zuper paths (not `custom_fields`)
- 311-row Zoho orphan reconciliation — 302 new InternalProducts pushed to Zuper
- Sync observability enums, watermark columns, and ActivityLog integration
- Zoho item images backfilled from historical pushes; product photo push to Zoho on approval

### Accounting Suite
- New Payment Tracking dashboard + Payment Action Queue split at `/dashboards/payment-tracking` and `/dashboards/payment-action-queue`
- Invoice-first bucketing with 5-section groupings; 3 new accounting pages with preset date-window filters
- Attach HubSpot invoices to payment-tracking rows; ACCOUNTING role scoped
- Ready-to-invoice attention signals from project triggers; PTO milestone gated to non-PE

### PM Accountability + PM Flags
- PM Accountability dashboard with weekly digest (Phase 1) at `/dashboards/project-management`
- Exception-based PM assignment flag system with compound-risk and shit-show rules — live mode replaces daily cron
- Shit Show Meeting Hub for problem projects with auto-snapshot on session create and IDR helper reuse

### SOP Guide
- WYSIWYG TipTap editor replacing raw HTML CodeMirror; auto-link `<code>/route</code>` mentions to app pages
- Role-gated tabs and sections — Executive, Accounting, Sales & Marketing, Design, Permitting, Interconnection tabs
- Batch new SOPs across Catalog, Service, Scheduling, Forecast, AHJ & Utility, PE, Property Hub, and Tools
- Suites tab with per-suite SOPs; Action Queues tab; submit-a-new-SOP feature with admin review queue
- Drafts tab with PM Guide rewrite and Pipeline Overview; hub-mode open by default

### My Tasks + My Tickets
- Personal HubSpot tasks dashboard with inline status/queue edit, keyboard shortcuts, URL state, and typeahead lookups
- Snooze, create from deal panel, completed-this-week view, and bulk done; admin-managed queue names
- User-facing Freshservice tickets page (`/dashboards/my-tickets`) with tickets assigned to me and Closed filter

### Multi-Role Access + Home Redesign
- Phase 1 multi-role access — 6 new scoped suite roles (DESIGN, PERMIT, INTERCONNECT, INTELLIGENCE, ROOFING, etc.), Sales & Marketing suite
- Home page redesign — curated dashboard stack replaced with suite cards only
- Runtime-editable role definitions (routes, landing cards, suites) with super-admin break-glass safeguard
- Per-role capability overrides, per-user extra route grants, and read-only Role Inspector at `/admin/roles`
- Unified `/admin` landing with in-shell search consolidating `/suites/admin`; AdminShell wraps all admin pages
- `User.role` single-role column dropped in favor of `roles[]` array

### Territory Map + Atlas
- Territory Map dashboard for CO office boundary analysis with full-width zones, both boundary sets with labels, and AI analysis
- Atlas map embedded as top-level destination at `/dashboards/atlas`; card surfaced in Operations, PM, and Service suites

### Flow Map / Workflow Map
- Live HubSpot automation + SOP reference dashboard combining Workflow Map (zoomable flowchart of pipelines → stages → workflows) and Process view
- Curated vertical-swimlane Process view with Design intertwines, Permitting parallel tracks, and plain-English per-stage walkthrough
- Resumable backfill with admin Build/Re-sync button

### EOD Summary Email
- End-of-day summary emails per person with morning/evening deal-status snapshot diffs
- Per-person change count and task count; broadened HubSpot queries for milestone detection
- Attribute automation-driven changes to deal's role-property owner

### Revenue Goal Tracker
- Executive suite revenue tracker with hero variants — thermometer bars and progress rings, canvas fireworks on monthly hits
- Zuper-based recognition for Service and Roofing groups; per-status revenue cards, straight-line pacing
- Two-tier base + stretch goals with gold progress bar; Site Survey and PTO Granted goal lines
- Weekly per-office goals digest email

### IDR Meeting Hub
- BOM Review & Line Item Editor for IDR meetings
- Previous review notes for re-reviews with richer search results and design/permit lead resolution via Owners API
- Recovery from accidental "End without syncing" with two-click confirm; start meeting scoped to CO, CA, or all
- Adders checklist with pricing mismatch detection integrated into ProjectDetail

### Design Approval Metrics + Drift
- Design Approval metrics dashboard with location filter and sortable pipeline tables
- DA status drift detector as backup for HubSpot connector via PandaDoc; reads approval dropdown, not `document.completed`
- Design Pipeline Funnel with DA pacing computed from actual approval dates

### Bug Fixes
- Middleware allowlists for `/api/cron/pe-doc-digest`, `/api/cron/tech-ops-bot-digest`, and workflow-sync public route
- Zuper API load cut ~97% by caching job list in lookup endpoint; per-endpoint API call counter; property-sync cron 2h→6h and job-backfill hourly→6h
- Portal — subdomain isolation, brand palette matched to photonbrothers.com, PWA install prompt hidden on survey portal
- Scheduler — completed surveys/passed inspections no longer show overdue; Rolando → Lenny for all Colorado Springs field work; DTC office filter no longer hides all availability
- Pending Zuper survey holds now handled locally with slot fallback (5 fix chain)
- PowerHub site row click crash (devices is object not array), asset sync unique-constraint races via upsert, primary site prefers sites with equipment
- HubSpot QC — surface 4xx engagement errors to Sentry instead of swallowing; index owner directory by userId for design/permit lead resolution
- Auth — resolve edge-runtime JWT role stuck at VIEWER; SERVICE role scoped to Service Suite; redirect to last page after login
- BOM — subfolder-aware PDF listing in pipeline; filename sanitized before Claude Files API upload; ticket SO falls back without custom field if Zoho lacks it
- Property sync validates address quality in `upsertPropertyFromGeocode`; explicit USER_DEFINED typeIds for deal/ticket associate; ATTOM AHJ/Utility HubSpot-side links dropped
- Comms — reject Gmail tokens when profile returns no emailAddress; verify Gmail identity matches PB user during OAuth connect
- Adders — Prisma import paths corrected to `@/generated/prisma/{enums,client}` to unbreak prod build
- Deal-reader Project contract updated for new PE milestone fields and customer-sentiment fields
- PandaDoc — multi-template-id support, permissive strategy 3+4 search, name-only fallback when template discovery fails
- Property Hub — ticket enum values resolved to labels, duplicate deals field removed from PropertyDetail interface
- 3 HubSpot-heavy crons paused during rate-limit outage; office-performance 504 death spiral fixed with maxDuration + cache warming cron
- Brand rename — "PB Operations Suite" → "PB Tech Ops Suite" across the app

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
