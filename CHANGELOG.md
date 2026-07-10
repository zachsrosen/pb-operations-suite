# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-07-07

Covers ~4 months (~1,984 commits) since the 2026-03-14 entry. Organized by system.

### Solar Designer (Major — new)
- New in-app solar array designer at `/dashboards/solar-designer` with V12-faithful physics engine (built-in catalog: 8 panels, 9 inverters, 6 ESS)
- Stage 1–4 buildout: types + Core runner (Web Worker), DXF/JSON/CSV layout parsers, per-panel shade CSV + zip/folder upload with client-side parse (bypasses Vercel 4.5MB body limit via Blob)
- Visualizer tab with satellite background + shade animation, StringingTab with click-to-assign and auto-string (Voc/Vmp validation), InvertersTab with MPPT cards + reassignment + clipping detection
- TimeseriesTab (day/week/month/year toggle) and ProductionTab with summary cards, paired-bar chart, and panel table
- MapAlignmentControls for satellite positioning; ShadeSlider for day/time range
- EagleView panel auto-renders when `?dealId=` is set (deep-link from Solar Surveyor)

### Tesla PowerHub Integration (Major — new)
- Full fleet monitoring dashboard with expandable site table, search, and stats
- API client with JWT auth, rate limiting, and mTLS-then-OAuth2 client_credentials evolution
- Three-tier site-to-deal linkage (portal-imported lat/lng, address auto-link, manual override) with greedy 1:1 uniqueness
- Cron handlers for asset sync (batched), telemetry, and alerts; shell-site skip + increased batch sizes
- Live per-site expand shows HubSpot deal, property, contacts, and system details; full telemetry + equipment summary; captures every Tesla device serial/model + alert metadata
- Cross-system portal URL linking (HubSpot + Zuper + Suite); pushes all Tesla device serials + models to Zuper Property/Job
- PowerHub alert scoring folded into service priority queue
- Battery SoC derived from energy-remaining when SoC signal is missing

### Enphase Enlighten Integration (Major — new)
- Enphase Enlighten API integration at full PowerHub parity (fleet discovery, telemetry, status monitoring)
- Partner OAuth setup route for installer auth flow (grant_type=password) + developer authorization_code fallback
- Refresh token rotation persisted to SystemConfig DB row (not env var); Fly.io proxy support
- Address-hash auto-linking to Properties; HubSpot deal card with production, battery SoC, micro health, portal link
- Cron jobs for daily asset discovery, 15-min telemetry snapshots, and 30-min status transitions

### HubSpot Property Custom Object (Major — new)
- Property custom object v1 anchoring deals/tickets/contacts/equipment rollups to a canonical address (System #10 in CLAUDE.md)
- Address dedup via SHA-256 addressHash + optional googlePlaceId
- HubSpotPropertyCache mirror + PropertyDealLink/TicketLink/ContactLink with ownership labels
- Contact address-change webhook → geocode → PB shop / AHJ / utility resolution → property upsert → association fan-out
- Nightly reconcile cron re-fetches watermarked properties for drift repair
- Resumable 4-phase backfill script with DB-tracked progress
- `<PropertyDrawer>` slide-in with equipment summary, owners, deals, tickets; wired on Service customer-360 and Deal detail address row
- Workflow-sync endpoint for HubSpot workflow-driven property sync; explicit USER_DEFINED typeIds for deal/ticket associations
- Memoized AHJ/Utility by (state, zip) to cut backfill HubSpot calls

### Admin Workflow Builder (Major — new)
- Visual workflow builder composing existing + new actions into automated sequences on Inngest runtime (System #11 in CLAUDE.md)
- Phase 1–16 buildout: editor UI + CRUD API, control-flow (delay, stop-if, parallel, for-each), 10 actions + templates
- HubSpot + Zuper property-change webhook fan-out; CRON + CUSTOM_EVENT trigger types
- Per-workflow rate limiting, DB-checkpoint idempotency, dry-run mode, failure alerts, versioning with snapshot + rollback
- Analytics dashboard, per-run detail page with step output drill-in, cross-workflow run history, export/import workflow JSON
- Visual canvas preview + drag-to-reorder; select/multiselect dropdowns with dynamic options
- New actions: send-email, ai-compose, HubSpot property/contact/note/task, Zuper property, run-bom-pipeline, log-activity, http-request, find-hubspot-contact, fetch-zuper-job, create-zuper-job (with Tray parity and deal-project linkage)
- Inngest auto-sync on deploy + manual resync button
- Service-task entries enriched from the master record

### Participate Energy (PE) — Major expansion
- **PE Analytics**: milestone/lifecycle split, remittance + expected-paid charts, Ready/Submitted lifecycle basis, Day/Week/Month grain on all charts, Resubmitted band
- **PE Timing**: Submit → Pay card, Construction Complete → payment (M1 & M2), Inspection/PTO → Submit, cron-maintained CC→pay avg (third forecast leg), CC→pay first ordering, hidden Remittance timing
- **Milestones tab**: bucket by document state; drill into each awaiting-approval bucket with Copy/CSV export
- **Documents tab**: By-Team bucket filter, collapsible status sections, per-doc blocker notes, doc-count chips, three-way group (Rejected / Action Required / Not Uploaded); By-Document view showing Missing + Open Rejections per doc; Bill of Materials tracked as conditional M1 doc
- **Doc Uploaders**: rejected drill-down, Uploads/Docs/Deals columns, in-review payments; Owner⇄Shared credit toggle (fractional by version); "Last submitter" payment-ownership mode; per-uploader outcomes; drill into a day's uploads; short-pay recorded so PE Revenue Collected reflects actual dollars
- **Uploaders Explorer**: filter by document + uploader with drill-down anywhere
- **Rejections**: live-pulled per-team M1 rejection notes on rejection; mark M1/M2 checkboxes on rejection; grouped rejection notes + LJF-only Design mirror; loose rejection-task matcher; auto-advance Rejected → Ready to Resubmit when tasks done; auto-advance onboarding + internal rejections; Re-Rejected After Approval report (doc-level re-approvals)
- **Payment $**: credit pre-tracking / pre-Apr-30 nameless uploads to Layla; drop date gate; drill-down on Doc Uploaders payment $ view; self-heal PE payment splits so KPI funnel doesn't undercount
- **Sync**: manual "Sync now" button + waived moot docs; strict stamped-date event counts; internally rejected status; API sync writes NOT_UPLOADED rows for docs the API omits; API sync pushes doc statuses to HubSpot deal properties (AFTER action items to avoid blank-notes race); daily ANCHOR clawback alert for approved docs re-opened; PE portal scraper retired (was corrupting doc statuses); PE doc sync now full every 30 min
- **PE Photo Builder**: self-serve Photos-per-Policy builder (web tool); resolve by PROJ number or customer name; PE photo-submission skills (final-permit + policy-photos)
- **HubSpot Deal Card**: Participate Energy status card; two-way PE document status sync
- **Address-based project matching** + auto-stamp portal links
- **PE Approved Vendor List** dashboard page

### PE Deals (Payment Tracking hub)
- Split PE Deals card into Pre-Construction vs Construction+; multi-column sort; pipeline stage grouping with stage distribution hero
- Awaiting PTO segment, Customer Paid? column, exclude Cancelled + auto-rename Other → On Hold
- Approved split into Fully vs Partially Approved; Approved — Waiting on Payment section; Partially Paid section
- Static Treasury zip set replaces live ArcGIS EC lookup (shows cents)

### Team Activity Report (new)
- Cross-system employee activity report + admin page — 6 sources (HubSpot, Google Drive+Meet+Chat, Zuper, Aircall, PB Tech Ops, Participate Energy)
- Ad-hoc "look up anyone" section; source toggle chips; scoped row-expand state per table; deal name resolution in drilldown
- Rich drilldown: Zuper + task names, Aircall call detail, PB Tech Ops descriptions, Copy button
- Parallelized per-person HubSpot/Google pulls; 14-day default; corrected roster identities

### PE Command Center Bot ("Tech Ops Bot")
- Proactive daily digest DM'd to the owner; per-room daily digests to team Google Chat rooms with tailored intros/sections/focus
- `?preview=1` renders digests without posting
- Data tools: get_project_status (project type + PE IC/PC payment amounts), get_project_team, get_project_service, count_deals_by_status, revenue rollups + milestone date-range queries, location filtering on deal tools
- PE M1/M2 milestone status breakdowns; full-pipeline coverage (construction, inspection, PTO); DA lifecycle phases (Review In Progress = pre-send)
- Task-vs-process-request judgment; assigns tasks to a named person; process-request tickets filed under a non-agent requester
- `log_correction` captures in-chat corrections for review; Corrections tab on Bot Escalations with Apply-to-playbook button
- Fleet schedule from ScheduleRecord (real, not calendar stub); filters by deal pb_location
- Rotating "thinking" ack; stopped implying Zach is out of office

### Ooo Bot (Google Chat)
- Multi-JWKS Google Chat JWT auth with multiple audiences; base64-encoded service account key support
- Google Workspace add-on envelope format; async post errors captured to DB; replies to main timeline (not thread)
- Static waitUntil + async diagnostics

### Scheduler
- **Scheduler v2 (Phase 1)**: construction dispatch board, flag-gated + additive; SystemConfig flag (Vercel env cap workaround); force-dynamic
- Sub-job scheduling: SubJobScheduleModal (same/separate modes) wired into master + construction schedulers; cascade reschedule to sibling construction jobs (scoped to same deal, audit-logged, tentative siblings skipped)
- On-call electrician overlay on master schedule; day view timed grid for surveys/inspections; sub-job breakdown view for construction cards
- Pre-sale survey cards on calendar (deduped, click modal, purple styling)
- New Construction tab between Ops Surveys and Pre-Sale; Needs Revisit group; keep revisits in Ops Surveys after status flips
- No survey availability slots on PB holidays; Zuper API fallback for sibling lookup + status update
- Overlay events: service + D&R jobs from Zuper mapped to OverlayEvent; render in month/week/Gantt; localStorage-persisted toggles
- Weekend visibility toggle; forecast ghosts for all pre-construction stages
- Collapsible project sidebar with localStorage persistence; alias-aware location mapper with time window in popover
- Per-status revenue cards on construction scheduler; completed/overdue revenue stats
- CA site-survey availability revised + cross-office block; day-cell availability filtered by project location
- Colorado Springs: Lenny Uematsu replaces Rolando; DTC office filter no longer hides all survey availability
- Completed surveys & passed inspections no longer show as overdue

### Office Performance / TV Dashboards (Major expansion)
- New all-locations overview at `/office-performance/all` + all-locations slide in per-location carousel
- 7-slide TV carousel: pipeline (animated bars + PM/designer/owner breakdowns), surveys, installs, inspections, Team Results, per-person metrics with streaks/achievements
- California dashboard combines SLO + Camarillo
- Visual components: CountUp, ProgressRing (SVG), AnimatedBar, AmbientBackground with floating gradient orbs
- TV-scale header with section color accents + pill navigation; directional slide+fade transitions
- Leaderboard visual upgrade with staggered entrance + metallic podium
- Live Zuper API metrics replace cache-based compliance; deal drill-down lists; per-employee compliance; OOW usage %
- Statistical audit: turnaround cohorts, uid keying, bounded pass rate
- Cache-first fetching cuts dashboard load time; sequential per-location fallback

### Funnel Dashboard (new)
- New funnel dashboard with backlog callouts, DA pacing, cancelled revenue, monthly grouped bar chart, cohort table with conversion %
- Timeframe + implied-progression logic (approved implies sent implies surveyed); rolling-day cutoff
- Per-status revenue in the Pipeline Backlog; drill-down deal lists per backlog bucket
- Hide project-rejected toggle (mirrors on-hold); PM Rejection Reason for project-rejected notes
- Reopened deals no longer painted as Cancelled
- Interconnection Cleared card reconciled with the backlog; Awaiting Interconnection Approval scoped to genuine IC waits
- Suite navigation links to Executive and D&E suites

### EagleView + TrueDesign Integration
- TrueDesign auto-pull pipeline (Tasks 1–9): OAuth foundation + webhook (flag-off) + sandbox integration test page
- Order-status stamping onto HubSpot deal/ticket (DB-backed toggle for env-or-SystemConfig)
- EagleView Orders dashboard page: default orders list, status filters, PB location filter, deal links, order details drawer, Design Lead resolved via owner map
- Report # links to EagleView TrueDesign; "View in TrueDesign" link on EagleView panel
- Shade files saved as .zip; late-arriving measurement files backfilled; TrueDesign orders by geocoded address
- Reviewed webhook uses HubSpot v3 signature auth; delivery failures visible + self-healing
- PascalCase API response keys normalized to camelCase

### Shop Health Dashboard (new)
- New Shop Health with Revenue, Preconstruction (throughput + cycle times, Permits Issued rename), Customer Success (sentiment scoring, 5-star reviews, contact response metrics)
- Drill-down tables on all count-based metrics + Customer Success metrics; multi-entry weekly bottleneck
- Targets derived from OfficeGoal DB (replaces REVENUE_GROUPS + CREWS_CONFIG hardcoding)
- Perf: lightweight overview path (1 Project fetch, no tickets); cache closed tickets; activeOnly fetch prevents API timeout; cache fetchAllProjects to prevent 429s

### IDR Meeting Live Mode
- IDR Meeting scoped by Colorado / California / all
- Recovery from accidental "End without syncing" with two-click confirm and dedupe/auto-join
- Sales folder deep-link, PM task on sync, open-all links
- Previous review notes for re-reviews + richer search results
- BOM Review & Line Item Editor
- Survey Zuper link, design approval status, tag fix; Design/Permit lead names resolved
- Remove-from-queue action
- AddersChecklist + PricingBreakdown with mismatch detection; adder fields wired through prep/preview/skip/re-queue paths; adder summary sync to HubSpot
- AC disconnect & production meter labels clarified in utility codes
- Fixes: typing lag, boolean defaults, escalation re-queue, auto-sync, HubSpot notes

### On-Call Rotations (new)
- V1 on-call electrician rotations with weekly Sun–Sat, 6pm–10pm weekday / 8am–12pm weekend shifts
- Self-service swap UI with per-electrician access; whole-week swap blocks; swaps allowed any distance out
- Admin/executive Activity view — all swap + PTO requests
- Emergency call log captured by on-call electricians + HR sheet export
- Per-state Google Calendar staging without invites; calendar.events scope
- Real email notifications for the PTO lifecycle + swap lifecycle (replaces notification stubs)
- Publish works on large pools + surfaces errors as JSON
- Data-driven "Schedule starts" message from pool.startDate

### Deal Detail Page (Major expansion)
- 13 enhancements: 3-tab layout + collapsible photos, site photo gallery, Zuper photo proxy, Zuper URLs fixed, HubSpot link, dept leads resolved to names
- On-demand HubSpot sync when deal not in mirror; inline formatStaleness
- Zuper status history, BOM, and schedule timeline fetchers; Zuper job notes + HubSpot tasks in timeline
- Engagement HTML rendering with @mention markup stripped; sync changelog shows human-readable labels
- Auto-expand notes + boolean sync for "Yes" values fixed

### Catalog + Sync Relay
- **Sync Relay**: rewrite of SyncModal with plan-based flow and auto-cascade; useSyncCascade hook; plan derivation with conflict detection + hash; plan execution engine with effective state overlay; snapshot builder + default intents; mapping table with normalizers, generators, transforms; extended GET /sync with snapshots + mappings; POST /sync/plan; plan-hash confirmation tokens; stale detection
- **Catalog Sync**: HubSpot manufacturer enum enforcement (Phase B operational); auto-add unknown brands to HubSpot enum + notify TechOps; Zoho writes switched from group_name to category_id
- Zuper cross-link IDs written via meta_data instead of custom_fields; race-safe external-record create + link-back
- Sync observability enums + watermark columns; ActivityLog for Sync Modal executions; logCatalogSync wired into executeCatalogPushApproval
- Zuper spec-derived custom fields on product create; dimensions on product create
- Product photo pushed to Zoho Inventory on approval
- Selective sync with per-field direction controls; inline validation; numeric range validation; vendor pair warning
- Client-side photo file size/type validation; stale zohoVendorId detection with re-select hint

### SOP System
- WYSIWYG editor (TipTap) replaces raw HTML CodeMirror
- Submit-a-new-SOP feature with admin review queue
- Drafts tab with PM Guide rewrite + Pipeline Overview
- Auto-link `<code>/route</code>` mentions to actual app pages
- Split Tech Ops tab into Design / Permitting / Interconnection
- Role-gated SOP tabs and sections (stopped info leaking to wrong teams)
- Hub-mode visibility flip (open by default)
- v3.2 → v4.0 progression: centered search, brand theme, tab visibility, PM Guide gating, role-specific/admin-only indicators
- D&E workflows section + surveyor resolution fix

### Accounting Suite (new)
- New ACCOUNTING role + Payment Tracking dashboard with invoice-first bucketing
- Split into Payment Tracking + Payment Action Queue pages; invoice dots link to deal; preset date-window filter
- Attach HubSpot invoices to payment-tracking rows; match invoices to milestones by line item name (incl PTO + PE)
- Ready-to-invoice attention signals from project triggers; 'Not Invoiced' column
- Outstanding = invoiced-but-unpaid only; sortable columns; All PE Deals section; stage phase pill; active-only filter
- PE fixes: PE pays a portion of deal.amount (not additional revenue); PTO milestone is non-PE only; % collected at 0 when paid
- Three new accounting pages (invoice-first bucketing rollout)

### EOD Summary (new)
- New EOD (End of Day) summary email with morning/evening snapshot diff for milestone changes
- DealStatusSnapshot model; HubSpot completed-task search for tracked leads; property history enrichment
- HTML email builder; cron route handler; reclaim-on-failed idempotency for auto-retry
- Signal-to-noise improvements: attribute changes by who made them, per-person change/task counts, per-person owner attribution for automation
- Morning-items-resolved tracks actual action items

### My Tasks
- Personal HubSpot tasks dashboard with owner link per user
- Inline status + queue edit, keyboard shortcuts, URL state, autofocus first row
- Snooze, create, completed-this-week, bulk done
- Mark complete, sort modes, deal-stage filter
- Admin-managed queue names; New Task from deal panel; typeahead lookups
- HubSpot owner resolved via full-list match; fallback to first.last@domain when login email is an alias

### PM Tracker + PM Suite (new)
- PM Accountability dashboard + weekly digest (Phase 1)
- Exception-based PM assignment system with live page-load eval (replaces daily cron)
- HubSpot deal links + owner-id assignment fallback + missing-PM seed
- Project Management Suite landing page

### Aircall Analytics (new)
- Call analytics dashboard (Phase 1); executive call analytics (Phase 2)
- Per-user answer rate via ring tracking; Analytics+ ringing-attempts CSV import for historical data

### Admin & Permissions
- Workflow builder backend scaffold (Phase 1)
- Consolidate `/suites/admin` into `/admin` — one admin landing
- Unified AdminShell + `/admin` landing + in-shell search (phase 1 IA)
- Per-user extra route grants (Option D); per-role capability overrides (Option B); read-only Role Inspector at `/admin/roles`
- SUPER badge on super-admin user rows
- ACCOUNTING user role migration

### Permit + IC Hubs (new)
- Permit Hub two-pane workspace with resolved names, header quick-links, AHJ fallback, shared inbox thread fetch
- Per-inbox OAuth workaround for blocked DWD scope
- Interconnection Hub v1

### Portal (Customer Survey)
- Redesigned customer survey portal; subdomain isolation; brand color; inline cancel; scroll fix
- Chatbot hidden; URL newline fix; PWA install prompt hidden on survey portal
- Service-to-service survey invite endpoint for Olivia
- Brand palette matched to photonbrothers.com

### Territory Map (new)
- Territory Map dashboard for CO office boundary analysis

### Miscellaneous
- TSRF Peak Power Calculator in D&E + Service suites
- Design Suite Production Issues dashboard
- Site Survey turnaround metrics dashboard
- Inspection metrics dashboard with drill-downs, action queues, dual-source validation, Location custom object + AHJ inspection properties, 11 inspection deal properties
- Construction metrics: Zuper links, CC→Inspection Passed metric
- Photos: show all photos in deals + IDR meetings
- HubSpot Card: Tesla device model numbers alongside serials
- PandaDoc: DA status drift detector as backup for HubSpot connector
- DealNote model for internal deal notes
- Home page adds Sales & Marketing + PE & Compliance suite cards; breadcrumbs fixes for 23 missing SUITE_MAP entries

### Perf & Reliability
- Zuper: ~97% API call reduction by caching job list in lookup endpoint; explicit caller attribution for `[zuper-call]` log; per-endpoint API call counter + admin read endpoint; skip API sweep on DB-cache hits; cache `/jobs/by-category`
- Team Activity: parallelized per-person HubSpot/Google pulls
- Property: memoize AHJ/Utility by (state, zip) to cut backfill HubSpot calls
- PowerHub: skip shell sites in telemetry/alert sync; batch asset/telemetry/alert sync to avoid function timeout

### Bug Fixes (highlights)
- Zuper: stamp `job_timezone` so CA customers get Pacific-time notifications
- Zoho: propagate description + part_number on item update; correct URL patterns
- Sync-relay: token validation before DB fetch; React 19 lint compliance
- Portal: hide PWA install prompt on survey portal + set tab title
- Nav: reconcile SUITE_MAP with dashboards; accept `/admin` as parent
- Home: skeleton during pipeline fetch instead of false zero

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
