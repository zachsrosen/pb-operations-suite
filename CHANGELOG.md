# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-07-15

### SolarEdge Fleet Monitor (Major, New)
- Live SolarEdge fleet monitor: DB schema, sync job, and dashboard for SolarEdge sites at full parity with the Tesla PowerHub view
- Customer and deal links on each fleet row, open-ticket enrichment surfaced inline
- Named alerts + Alert Type filter driven by the SolarEdge export feed
- Table polish for readability and consistent column widths

### PowerHub Fleet Monitor
- Dedicated Monitor column on every row (alerts back to plain chips)
- Monitor link for sites with no active alerts and per-chip links to live monitoring
- Alert Type filter, "show all alert chips per row" (drop +N overflow), inline alert names, and open-ticket links on the fleet table
- Info columns and voltage-based grid cell added; Active Alerts toggle
- Fixed device-count backfill to be idempotent (array-based)
- Fixed Powerwall 3 categorized as gateway — now counted as battery
- Reverted premature Alerts-dashboard header link to PowerHub Fleet Monitor

### Sales Funnel
- New Construction indicator + hide/show toggle
- Blocked toggle with waiting-since / scheduled dates in drill-downs
- Close Out stage + backlog now use Close Out Status property
- Fixed `total:0` empty search from HubSpot blanking the pipeline view

### RTB (Ready to Build) Review Queue
- Ready to Build tab on the review queue with payment method, loan status, and earliest install availability columns
- Permitting Status column and fully sortable un-merged columns
- Condensed review queue from 17 → 11 columns
- Editable RTB-Blocked notes with clarified header (edit control always visible)
- Ready tab "Released" flag now reads `pm_rtb_approved_date`, not the transient flag
- Fixed re-blocked deals reading as un-released until Release is pressed again
- Fixed semicolon-separated project types stacking one per line

### Deal Sync
- 15-min cron for HubSpot deal sync + visible "deals synced N ago" freshness badge
- Batched writes, stabilized diff, and staleness alert when sync goes cold

### PE (Participate Energy)
- Stabilized `pe_doc_*_notes` ordering to stop duplicate rejection emails firing on every cron

### Permitting & Interconnection
- Corrected CA shared-inbox addresses (avoids bounced correspondence)
- Scoped Hub correspondence to the project, not the shared utility/AHJ email

### Scheduler
- Re-enabled PM survey invite with status badges, gated button, and copyable link (no email sent from the button)

### Service
- Time-in-stage now measured from stage-entry date, not deal modified date (fixes inflated ages when unrelated properties changed)

### AI Chat Bot (Google Chat)
- Per-rep daily worklist (their own deals, 4 sections: needs response, aging, at-risk, scheduled today)
- `get_pe_docs` tool — bulk PE document-status lookup (action required / rejected) across many deals in one call
- `get_deal` answers "why is PROJ-X in [any state]" from the real reason fields
- `query_projects.includeReason` — bulk state reasons in one call, no per-deal fan-out
- Scope sales reps to their own deals; block company-wide aggregates
- Mirror every outbound bot message to the oversight space for audit
- Fixed deactivated-owner worklist routing → manager (stops double-mirroring)
- Fixed cross-question list contamination, mid-list doubt, and truncation
- Full `pbtechops.com` URLs for app pages instead of bare SOP paths
- Raised Google Chat webhook `maxDuration` 60s → 300s (heavy queries were timing out)
- Prompt-cache the system prompt + tool schemas via toolRunner (measurable latency & cost win)

### Middleware
- Allowlisted `zuper-field-activity-sync` and `product-sync` crons (they were being blocked by session auth)

---

## 2026-03-15 → 2026-07-10 (Gap Summary)

The changelog went unmaintained for ~4 months. Roughly 2,000 commits landed across the period; below is the high-level shape of what shipped, organized by initiative. Individual PRs are traceable via `git log` on the numbers referenced below.

### PE (Participate Energy) Suite — largest initiative (~116 commits)
- End-to-end PE submission workflow, analytics, and forecasting:
  - PE Pipeline Tracker, PE & Compliance Suite landing, PE Approved Vendor List
  - PE Analytics: Milestone Payments view (IC/PC pipeline by stage/status), Doc Uploaders table with payment-ownership modes, Re-Rejected After Approval report, drill-downs on awaiting-approval buckets
  - PE Timing: Submit → Pay, Construction Complete → Payment, Inspection/PTO → Submit; nightly cron writes avg submission→payment days to deals
  - Milestones / Lifecycle split, Resubmitted band, Day/Week/Month toggles across charts
  - "Expected (Submission)" forecast mode; forecast legs maintained as (mean+median)/2
- Document handling: strict stamped-date event counts, Internally Rejected status, Bill of Materials as a conditionally-required M1 doc, "Not Required" status, superseded uploads drill-down
- HubSpot Deal card for PE status (submitted/required with approved · under review · action required breakdown)
- Auto-advance: Rejected → Ready to Resubmit when rejection tasks are done, onboarding auto-advance, loosened rejection-task matcher (rename-safe)
- Live-pull per-team M1 rejection notes; internal-rejection notes captured from reviewer input
- Approved → Paid advancement driven by invoice paid-in-full date
- Sync button on all PE tabs and "Last synced X ago" indicator

### Tesla PowerHub Fleet Monitor (~62 commits)
- Full monitoring dashboard for the Tesla-Powerwall fleet with alerts, device counts, voltage, and open-ticket cross-reference
- Foundation for the SolarEdge and Enphase parity work

### Enphase Enlighten Integration (Major)
- OAuth2 authorization code + Partner installer flows, refresh token rotation via `SystemConfig`
- Fleet discovery, telemetry (15-min), status-check crons; address-hash auto-linking to Property object
- HubSpot Extension card mirroring PowerHub
- Feature-flagged: `ENPHASE_ENABLED`, `ENPHASE_CROSSLINK_ENABLED`, `NEXT_PUBLIC_UI_ENPHASE_VIEWS_ENABLED`

### Admin Workflow Builder (Major)
- Visual builder that composes existing + new actions into automated sequences on the Inngest runtime
- 10 actions + 2 control-flow kinds (delay, stop-if); template library
- Triggers: `MANUAL`, `HUBSPOT_PROPERTY_CHANGE`, `ZUPER_PROPERTY_CHANGE`
- Template expressions for `{{trigger.X}}` and `{{previous.stepId.field}}`
- Runs history, per-run detail, cross-workflow history
- Feature-flagged: `ADMIN_WORKFLOWS_ENABLED`, `ADMIN_WORKFLOWS_FANOUT_ENABLED`

### HubSpot Property Object (Major)
- Canonical address object anchoring deals, tickets, contacts, and equipment rollups
- `HubSpotPropertyCache` + link tables with ownership labels (Current / Previous / Authorized Contact)
- Address-change webhook → geocode → resolve-geo-links → upsert → association
- Daily reconcile cron, resumable 4-phase backfill script with DB-tracked progress
- UI: `<PropertyDrawer>`, `<PropertyLink>`, `<PropertyDrawerProvider>`; wired on Service Suite Customer 360 + Deals detail
- Feature-flagged: `PROPERTY_SYNC_ENABLED`, `NEXT_PUBLIC_UI_PROPERTY_VIEWS_ENABLED`

### Solar Designer (Major, ~41 commits)
- Multi-stage in-app design tool with reducer-driven state, UI strings, map alignment, and 9 new dispatch actions
- Equipment selection reset on new file upload; extensive documentation coverage

### Google Chat AI Bot (~56 commits)
- Google Chat bot with tool-use loop (`toolRunner`) over PB Ops data
- Tools: `get_deal`, `get_project_status`, `query_projects`, `get_pe_docs`, EOD digests, per-rep worklists
- OOO bot, tech-ops bot, on-call routing, morning sweep digest

### Scheduler v2 + Scheduler enhancements (~53 commits)
- Scheduler v2: Phase 1 construction dispatch board (flag-gated)
- New Construction as its own scheduler tab; Needs Revisit + New Construction grouped views
- Weekend visibility toggle; no survey availability slots on PB holidays
- Zuper reschedule lookup sorts newest-first

### Roles System — Multi-Role Phase 1+
- 6 scoped suite roles added (DESIGN, PERMIT, INTERCONNECT, MARKETING, SALES_MANAGER, SALES, ACCOUNTING, SERVICE)
- Multi-role Phase 1 shipped: `User.roles[]` array replaces `User.role` in all code paths (DB column still pending manual drop)
- Sales & Marketing suite, PE & Compliance suite, and Accounting suite added
- Admin impersonation switched from `pb_effective_role` single-role cookie to `pb_effective_roles` JSON array

### Office Performance Dashboards (~38 commits)
- New office-performance suite of dashboards + carousel slides
- Service carousel slide, performance rollups per team

### Funnel / Pipeline (~29 commits)
- Sales Funnel dashboard; Pipeline Backlog with per-status revenue
- Hide project-rejected toggle; Blocked and On Hold toggles; named timeframe presets
- Monthly Activity table; Survey Scheduled stage

### EagleView / TrueDesign Integration
- EagleView Orders dashboard + status filters, deal links, PB location filter, order details drawer, Design Lead on each order
- HubSpot deal/ticket stamping (DB-backed toggle)
- TrueDesign CAD/DXF pull: OAuth foundation + webhook (flag-off)
- "View in TrueDesign" link on the EagleView panel

### Adder Catalog + Estimator
- Governed Adder Catalog (Chunk 1: foundation)
- Customer-facing solar estimator v2 (Phase 1) + all 5 quote-type flows (Solar, EV, Battery, Expansion, D&R)

### Ready-to-Build Queue (~10 commits)
- New RTB Review Queue with sortable columns, editable notes, and Ready/Blocked tabs
- Payment method, loan status, earliest install availability, permitting status

### Team Activity (~16 commits)
- Team Activity dashboard with Tasks/day and Property updates/day
- Weekly report-card email digest

### End-of-Day (EOD) Email (~15 commits)
- Signal-to-noise overhaul of EOD email
- Per-team digests, actionable prompts, and reduced noise

### On-Call System
- On-call routing, escalation, and admin controls

### Workflow / Flow Map
- Live HubSpot automation + SOP reference dashboard
- Zoomable flowchart view (pipelines → stages → workflows)
- Curated vertical-swimlane Process view; family-lane stage layout
- Admin Build/Re-sync button, resumable backfill (300s maxDuration)

### FreshService Integration
- Ticket creation via API instead of email (with email fallback)
- User-facing `/dashboards/my-tickets`

### Shop Health / Customer Success (~19 commits)
- Sentiment scoring, 5-star reviews, response time drill-downs
- Revenue hero card and pipeline revenue detail

### Deal Detail (~26 commits)
- Zuper job notes and HubSpot tasks in timeline
- Zuper status history, BOM, and schedule timeline fetchers
- Internal Deal links across scheduler family, HubSpot/Zuper external link parity

### IDR Meeting Hub
- New Construction review type
- Remove-project-from-queue action
- IDR meeting processor tie-in

### My Tasks / Task System
- Typeahead lookups, "New Task from deal panel"
- Cross-team task visibility

### Aircall / Comms
- Aircall integration surfacing on deal panels
- Communications event stream

### Vishtik Design Integration
- `vishtik_project_id` and `vishtik_project_url` synced onto deals
- Vishtik project close-out workflow

### Atlas Map
- Atlas map card surfaced on Operations, PM, and Service suites
- Atlas embedded as a top-level destination

### Cache Layer
- Cross-instance shared cache + single-flight for projects/deals endpoints

### Infrastructure
- Auto-reload pages on new deployment (broadcasts + client bump)
- Cross-instance cache, single-flight resolution, and SSE hardening
- SystemConfig-backed runtime config

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
