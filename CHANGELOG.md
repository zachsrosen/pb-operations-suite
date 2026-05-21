# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-05-21

### PE (Participate Energy) File Preparation & Compliance Hub (Major)
- AI vision-powered PE Prep audit: classifies photos and PandaDoc-pulled docs against M1/M2 milestone requirements, surfaces missing items per deal
- PE Document Tracker dashboard with portal HTML scraper that ingests PE doc statuses, change-diffs them between sync runs, and emits instant email alerts on status flips
- PE Pipeline Tracker with construction/inspection status columns, hero revenue, and split status filters
- PE Submission Gap report — finds CC-hit deals with incomplete M1/M2 submissions across strict stage buckets, surfaces inspection-pass and PTO-granted dates
- PE Action Items feed with hourly incremental sync, deal grouping, clickable HubSpot + PE Portal links, and auto-resolve on doc approval
- PE Cross-Reference analyzers: Planset (P10/P10B/P10C), Hardware (P1/P6 PowerHub vs nameplate), SalesOrder (P2-P5, P7-P9), and InboxScan to find PE docs in shared mailboxes
- Two-way PE document status sync with HubSpot deal properties (replaces PendingPropertyOverride cron with native HubSpot workflows)
- Per-doc M1 vs M2 sectioning, Approved/Partially Approved/Paid grouping, Project Complete tab, % of deal + waiver warnings
- New PE & Compliance suite consolidating PE pages with Zuper compliance scoring (per-service-task v2)
- PE Receivable scoped to approved milestones, Treasury static zip set replaces live ArcGIS EC lookup

### Tesla PowerHub Fleet Monitoring (Major)
- Full Tesla GridLogic API integration with OAuth2 client_credentials auth, JWT, rate limiting, batched asset/telemetry/alert sync via cron
- Fleet monitoring dashboard with expandable site table, search, sorting, empty-site filtering, and per-site telemetry (battery SoC, energy-remaining fallback, available-signals query)
- Auto-link Tesla sites to HubSpot properties via name, address backfill, and geo-coordinate matching from portal-imported lat/lng
- Site detail enrichment: HubSpot deal, contacts, system details, every Tesla device on site with part #/serial #, alert metadata, full telemetry
- PowerHub alert scoring contributes to service priority queue
- Native HubSpot UI Extension (sidebar card) showing Tesla device model numbers, serials, and one-click portal links across HubSpot + Zuper + Suite

### Property Hub & HubSpot Property Object (Major)
- HubSpot Property custom object v1: canonical address anchoring deals, tickets, contacts, equipment with rollups (system size, battery, open tickets, warranty)
- Full-page Property Hub at `/properties/[id]` with map, Equipment tab (HubSpot line items + Zuper assets), Activity tab with engagement metadata, Photos tab pulling from Zuper jobs, external HubSpot + Zuper links
- Property drawer enhancements: deal names not IDs, contact names with HubSpot links, equipment summaries, revenue, ticket enum labels resolved
- Zuper Property write-direction sync: customer associations on create/update, project-to-property linking, ticket-only property inclusion, address validation safeguards against misassociation
- Inngest queue for property sync workflows, daily reconcile cron removes stale links, unified timelines + sync validation
- Shovels API enrichment for permits, residents, contractors
- Workflow-sync endpoint for HubSpot workflow-driven property updates with API Key webhook auth

### IDR (Initial Design Review) Meeting Hub (Major)
- Full IDR Meeting Hub frontend with queue, detail panels, dialogs, and PandaDoc DA + plan doc links
- BOM Review & Line Item Editor inside IDR — edit equipment line items live during the design review meeting
- Re-review workflow: revision-reason sync, RE-REVIEW badge, auto-advance on sync, previous review notes shown for re-reviews
- Adders system: AddersChecklist + PricingBreakdown components, IDR roof-type auto-populate, tier adders, % of deal + 10% threshold warnings, waiver warnings, PandaDoc DA layout vs planset comparison
- Scoped meetings (Colorado, California, or all), accidental-meeting recovery, two-click "End without syncing", auto-completes HubSpot task on sync, PM task creation on sync
- Design/permit lead resolution via Owners API (no more raw IDs), survey Zuper link, escalation submitter shown in detail

### Admin Workflow Builder (Major)
- Visual workflow builder atop Inngest: editor UI + CRUD API, drag-to-reorder canvas, visual canvas preview, step output drill-in, cross-workflow run history
- Action palette across messaging, AI, HubSpot, Zuper, PB Ops, plus http-request, find-hubspot-contact, fetch-zuper-job, Duplicate workflow
- Control-flow: delay, stop-if, for-each loop, parallel branches
- Triggers: MANUAL, HUBSPOT_PROPERTY_CHANGE, ZUPER_PROPERTY_CHANGE, CRON, CUSTOM_EVENT (with emit helper), webhook fan-out
- Production safety: dry-run mode, per-workflow rate limiting, DB-checkpoint idempotency, action-level idempotency for create-actions, failure alerts, Inngest auto-sync on deploy
- Workflow versioning with snapshot-on-save + rollback, export/import workflow JSON, analytics dashboard, template library

### Shop Health & Office Performance Dashboards
- Weekly Shop Health Dashboard with revenue hero card, pipeline revenue detail, Preconstruction throughput + cycle times, Customer Success sentiment scoring with 5-star reviews, contact response metrics
- OfficeGoal DB targets replace static REVENUE_GROUPS; two-tier base + stretch goals with gold progress bar; weekly per-office goals digest email
- Office performance dashboards: 7-slide carousel on all-locations TV page, combined California (SLO + Camarillo), Service carousel slide, cache-first fetching, cache-warming cron to prevent 504s
- Live Zuper API compliance metrics replace cache-based scoring; Bayesian removed, visible score breakdown; deal drill-down lists per stage; first-pass rate fixes; surveys and inspections sections with per-employee turnaround
- Weekly goals digest email — one per office, zero-delta hidden on first run

### Pipeline Trackers
- New general Pipeline Tracker dashboard with Site Survey, Construction, and Inspection tabs
- PE Pipeline Tracker dashboard with total revenue hero, construction/inspection status columns, status filters, sortable columns, Zuper job links, cross-links to PE doc tracker

### Scheduler & Sub-Job Scheduling
- SubJobScheduleModal with same/separate modes, project context, Zuper integration; sub-job breakdown view on construction cards; individual sub-job Zuper links in modals
- Sibling cascade reschedule: same-deal scoping, Zuper API fallback for sibling lookup, tentative-siblings skipped, audit logging
- Pre-sale site visit Zuper flow: purple cards on calendar, click modals, dedup, deal-derived location for orphaned jobs
- Day-view timed grid for surveys/inspections, crew schedule dashboard splitting comma-separated assignees, tentative vs live mode visually obvious across all schedulers
- Editable date picker on drag-drop reschedule confirmation, orphaned re-survey/re-inspection jobs surfaced in master scheduler, completed Zuper jobs no longer show as overdue
- ScheduleEventLog captures Zuper reschedules and crew changes

### On-Call Electrician System
- Weekly on-call rotation with self-service swap UI, PTO requests, merged Colorado pool, per-state Google Calendars, Sun-Sat weeks with 6pm-10pm weekday / 8am-12pm weekend shifts
- On-call electrician overlay on master schedule with overdue/completed flags
- Emergency call log (roofing issue type, 3-way outcome, pool-filtered crew dropdown) with auto-create HubSpot service ticket follow-up
- Admin call logging + HR sheet export, executive Activity view of swap + PTO requests

### Catalog, BOM, & Cost Audit
- Adder Catalog Phase 1-6: governed adders, /dashboards/adders UI, triage recommendation engine, OpenSolar sync scaffold, DB-backed adder path in pricing calc
- Cost Audit: cross-references Zoho bills against item purchase rates, surfaces sales price/margin/cross-system link badges, bulk-syncs costs to latest bill with suggested sales price
- Catalog Phase B hygiene: HubSpot manufacturer enum enforcement with auto-add + TechOps notify, Zoho category_id writes (replaces group_name), test product cleanup, Generic rebrand
- Sync Health page rolls up drift across InternalProduct/HubSpot/Zuper/Zoho; sync observability enums and watermark columns; ActivityLog entries for Sync Modal executions; Zoho item images pushed on approval
- 302-row Zoho orphan reconciliation backfill (new InternalProducts + Zuper); integrity audit + auto-fixable repairs
- Service BOM page (deals + tickets) with ticket-keyed snapshots; ticket SO falls back without custom field when Zoho lacks it
- Inngest workflow engine spike for BOM pipeline behind INNGEST_BOM_ENABLED flag

### Customer-Facing Estimator
- New solar estimator v2 with 5 quote-type flows (PV, EV, Battery, Expansion, D&R), customer-facing branding, iframe embed mode, slim 3-property HubSpot footprint
- Reliable Places autocomplete, cross-flow nav, ported pricing + production config from original estimator

### Permitting & Interconnection
- Permit Hub v1 (`/dashboards/permit-hub`): two-pane workspace with grouped queue, multiselect location, AHJ fallback, shared-inbox thread fetch on correspondence tab, per-inbox OAuth workaround for blocked DWD scope
- Interconnection Hub v1
- Bulk spreadsheet update script for AHJ/Utility custom objects

### Service & Support
- Freshservice ticket integration: assigned-to-me view, admin page, UserMenu badge, Closed tickets + filter chip, name-lookup email fallback, batch fixes for 4 prior tickets
- Jobs Proximity Map (Phase 1-3): installs + service + crews, Week/Backlog views, tickets, inspection/survey, call + add-note quick actions, assignee filter, real office street addresses
- Service Suite split into sections, deal/ticket filter on priority queue, scheduler state toggles, ticket links, collapsible sales pipeline card

### Accounting
- Payment Tracking + Payment Action Queue split, invoice-first bucketing, payment volume bar chart (day/week/month toggle), Payment Timeline dashboard, 'Not Invoiced' column, preset date-window filter
- New ACCOUNTING role with tightened Accounting suite (ADMIN/EXEC/ACCOUNTING only)
- Ready-to-invoice attention signals from project triggers; PE pays a portion of deal.amount not additional revenue; outstanding = invoiced-but-unpaid only

### PM Accountability & Risk
- PM Accountability dashboard + weekly digest (Phase 1)
- PM Flags exception-based assignment system: live page-load evaluation replaces daily cron, HubSpot deal links, owner-id assignment fallback, missing-PM seed, kill switch
- Shit Show Meeting Hub for at-risk projects with IDR snapshot helpers, auto-snapshot on session create, refresh button
- Production Issues: Flag Project button + inline unflag action
- PandaDoc DA status drift detector as backup for HubSpot connector; DA-drift dedupe per deal to prevent false positives on revised DAs

### Aircall & Call Analytics
- Aircall executive call analytics dashboard (Phase 1-2), per-user answer rate via ring tracking, Analytics+ ringing-attempts CSV import for historical data
- On-Call Calls section in call analytics from OnCallCallLog

### Roles & Access
- Multi-role access (Phase 1): `User.roles[]` array, 6 new scoped suite roles (DESIGN, PERMIT, INTERCONNECT, MARKETING, SALES_MANAGER, ACCOUNTING)
- Runtime-editable role definitions (routes, landing cards, suites), per-role capability overrides
- Super-admin break-glass safeguard, super-admin email withheld during impersonation
- Read-only Role Inspector at `/admin/roles`, role-gated SOP tabs and sections
- Dropped legacy `User.role` column (Option E); SERVICE role scoped to Service Suite

### SOP Guide v4
- WYSIWYG TipTap editor replaces raw HTML CodeMirror; auto-link `/route` mentions to actual app pages
- Drafts tab with PM Guide rewrite + Pipeline Overview aligned to 8 deal stages
- Submit-a-new-SOP feature with admin review queue
- Tech Ops tab split into Design / Permitting / Interconnection
- New SOP tabs: Suites, Action Queues, Tools (BOM + AI Design Review + Catalog + Service + Pricing + P&I Hubs + Surveyor + Schedule + Optimizer + Map), Executive + Accounting + Sales & Marketing (role-gated)
- Hub-mode visibility flip — open by default; meta-SOP "How to Use the SOP Guide"

### Deal Detail & Timeline
- Zuper status history, BOM, and schedule timeline fetchers
- HubSpot tasks in Activity, Zuper service tasks + note attachments, contact-associated emails in Communications
- Human-readable labels in sync changelog diffs, HubSpot @mention markup stripped from engagement HTML

### Daily Focus / EOD Email
- EOD restructured by person with per-person change + task counts, milestone detection with property history enrichment, reclaim-on-failed idempotency
- Daily Focus PE M1/M2 sections for morning email; major signal-to-noise improvements

### Solar Designer (V12)
- Full V12 with built-in equipment catalog (8 panels, 9 inverters, 6 ESS), AddressInput with geocode dispatch, PanelCanvas SVG renderer, VisualizerTab with shade animation + satellite background, MapAlignmentControls, ShadeSlider, StringingTab with click-to-assign + auto-string, StringList sidebar with voltage validation badges, string-validation module (Voc/Vmp checks), shade-association module (AABB + rotated-rect lookup)

### EagleView TrueDesign
- TrueDesign auto-pull pipeline (Tasks 1-9), sandbox integration test page, PascalCase → camelCase normalization

### TV Dashboard
- Rich deal list with Zuper status, PE flags, unified layout
- Calendar week/day views, completed deals, goals labels, inspections renamed, readability fixes

### Inventory & Sync
- Renamed `EquipmentSku → InternalProduct` (Phase 1+2), `/api/inventory/skus → /products` (Phase 3)
- Catalog validation: numeric range, inline errors, photo file size/type, vendor pair warning

### Infrastructure & Bug Fixes
- Replace PendingPropertyOverride cron with native HubSpot workflow properties
- Customer History v2 — contact-based lookup orchestrator with multi-entity search + grouping, Zuper jobs resolved via deal-linked cache or address heuristic
- HubSpot webhook API Key auth header support; HubSpot card v3 signature verification with URL-decoded query-param values
- React 19 lint fixes across sync-relay and JSX conditionals; Prisma 7 Neon adapter in backfill script
- Sentry: OWNER enum deserialization error (460 events) fixed, HubSpot engagement 4xx errors surfaced instead of swallowed
- Zuper drift cron lookback dropped 90→14 days to stay under 60s budget; ZUPER_RECONCILE_ENABLED flag
- Catalog photo upload works against private Blob store; route auth fixes (PM + Tech Ops API access to da-rework-flags)
- Login redirect to last page; first.last@domain fallback when login email is an alias

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
