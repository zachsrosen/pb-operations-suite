# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-07-06

### Participate Energy (PE) System (Major)
- Full PE hub at `/dashboards/pe` — tabbed layout combining Deals, Docs, Analytics, and Prep on a single page (retired the standalone `pe-report`)
- PE Analytics dashboard with weekly submissions/approvals/rejections charts, lifecycle vs milestone bases, cohort views, and click-through drill-downs on every segment
- PE Document Tracker with per-team buckets, editable per-doc blocker notes, "Not Required" status for conditional docs (BOM), superseded upload drill-down, and Copy/CSV export per view
- Doc Uploaders view — per-uploader approval/rejection outcomes, By-Day chart, Owner vs Shared credit toggle for fractional payment attribution
- Two-way PE ↔ HubSpot doc status sync — pushes `pe_doc_*` properties, mirrors reviewer notes, and stamps a Participate Energy status card on the HubSpot deal
- Live-pull per-team M1 rejection notes on rejection webhook, auto-advance Rejected → Ready to Resubmit when tasks complete, and auto-check P.E. M1/M2 Document checkboxes
- PE Timing dashboard — CC → payment, Submit → Pay, Construction Complete → payment, Inspection/PTO → Submit; nightly cron writes `(mean+median)/2` averages onto every PE deal for forecasting
- Advances Approved milestones to Paid from invoice paid-in-full date; self-heals payment splits so the KPI funnel stops undercounting
- Re-Rejected After Approval report + daily ANCHOR clawback alert (approved docs re-opened)
- PE Deals page — 5-way status filters, sortable multi-column table, Pre-Construction vs Construction+ split, Awaiting PTO segment, Customer Paid column, stage-distribution hero
- PE Prep landing page with deal queue and audit-history overlay; PE File Preparation pipeline (AI vision audit + PandaDoc auto-pull + prep dashboard)
- PE Cross-Reference — HardwareAnalyzer (PowerHub vs nameplate), SalesOrderAnalyzer, PlansetAnalyzer, InboxScanAnalyzer, auto-trigger after audit
- PE vision classifier with few-shot reference library and AVL cross-check; PE Approved Vendor List dashboard page
- PE Submission Gap report — CC-hit deals with incomplete M1/M2, deal-level PE Info Needed
- PE Raceway API sync (replaces HTML scraper); PE portal CSV import backup; PE portal scraper retired after status-corruption bug
- PE action items feed with incremental sync + hourly cron; PE Photo Builder (self-serve Photos-per-Policy + final-permit) resolvable by PROJ or customer name
- HubSpot Deal card for Participate Energy status; PE Doc Digest daily email restructured into 4 actionable sections with Drive folder links per deal

### HubSpot Property Custom Object (Major)
- New HubSpot Property custom object v1 anchors deals, tickets, contacts, and equipment rollups to a canonical address via SHA-256 `addressHash` dedup
- Property Hub full-page view at `/properties/[id]` with Equipment, Photos, Activity tabs; equipment summaries, revenue, and Zuper link in the header
- `<PropertyDrawer>` slide-in wired into Service Suite customer-360 and Deals detail; contact names + HubSpot link resolved instead of raw IDs
- `<PropertyLink>` + `<PropertyDrawerProvider>` for opening the drawer from nested components
- Zuper Property sync (write direction) — associates properties with customers, links Zuper projects to properties, safety checks against misassociation
- Inngest queue for property sync workflows; workflow-sync endpoint for HubSpot workflow-driven property upserts (replaced `PendingPropertyOverride` cron)
- Shovels API property enrichment — permit history, resident records, contractor lookups
- HubSpot workflow-sync route accepts API-Key auth; replaced Vercel 2h property-sync cron with 6h cadence

### Tesla PowerHub Integration (Major)
- Tesla PowerHub fleet monitoring at PB parity — API client with JWT auth + OAuth2 `client_credentials`, rate limiting, Fly.io `dfw` proxy for mTLS-blocked regions
- Three-tier site-to-deal linkage (address hash → geo → manual), auto-link Tesla sites to HubSpot properties, admin linkage manager UI
- Cron handlers for asset sync, telemetry, and alerts; batched to stay under Vercel function timeouts
- Fleet dashboard with expandable site table, HubSpot deal/property/contacts and system details on expand
- PowerHub alert scoring folded into service priority queue; SystemHealth embed on service pages
- Push every Tesla device serial + model to Zuper Property/Job; native Tesla PowerHub UI Extension card in HubSpot + compact sidebar variant
- Cross-system portal URL linking (HubSpot + Zuper + Suite); primary site selection prefers sites with equipment
- Capture every telemetry signal + alert metadata; clear stale alerts on sites that drop out of poll

### Enphase Enlighten Integration
- Enphase Enlighten API integration at PowerHub parity (fleet discovery, telemetry, status crons, HubSpot card)
- Partner OAuth setup route (`grant_type=password`) for Enlighten installer credentials — avoids per-homeowner authorization dance
- DB-persisted refresh token rotation on `SystemConfig`; token bucket rate limiter (8 req/sec)
- `EnphaseSite`, `EnphaseTelemetrySnapshot`, `EnphaseTelemetryHistory` models + 8 `enphase_*` columns on `HubSpotPropertyCache`
- Crosslink cascade (resolvePrimarySite → HubSpot property → Zuper dirty flag); HMAC-signed HubSpot card

### Solar Designer (Major)
- New `/dashboards/solar-designer` — full 4-stage in-house solar production simulator ported from V12 engine
- Stage 1: V12-faithful physics, consumption, production; built-in equipment catalog (8 panels, 9 inverters, 6 ESS); Core runner + Web Worker
- Stage 2: page shell with reducer, upload API for DXF/JSON/CSV layout files, equipment selection panel, site conditions panel
- Stage 3: Visualizer tab with shade animation + satellite background; Stringing tab with click-to-assign, auto-string, and Voc/Vmp voltage validation
- Stage 4: Production tab (summary cards + panel table), Timeseries tab (day/week/month/year), Inverters tab (MPPT cards, reassignment, clipping detection)
- Blob client upload bypasses Vercel 4.5 MB body limit; per-panel shade CSV parser (`shading_A_IPXXXX.csv`) with format auto-detect
- Zip + folder drag-and-drop upload; incremental uploads merge instead of resetting; manual MPPT layout preserved across analysis re-runs

### Admin Workflow Builder (Major)
- Visual workflow builder at `/dashboards/admin/workflows` — Inngest-executed automation composed from a registered action palette
- 16-phase rollout: editor UI + CRUD API, webhook fan-out (HubSpot + Zuper), per-run detail page with step output drill-in, cross-workflow run history
- 10 actions + 2 control-flow kinds — send-email, ai-compose, HubSpot property/contact/note/task updates, Zuper property update, run-bom-pipeline, log-activity, delay, stop-if
- CRON trigger type + dispatcher cron; CUSTOM_EVENT trigger with emit helper; HTTP-request action; find-hubspot-contact and fetch-zuper-job
- Workflow versioning (snapshot on save + rollback), dry-run mode, action-level idempotency for create-actions, best-effort DB checkpoints
- Per-workflow rate limiting, failure alerts, Inngest auto-sync on deploy + manual resync button, parallel + for-each control-flow, drag-to-reorder canvas
- Analytics dashboard, export/import workflow JSON, template library with clone-from-template starter
- Zuper property discovery for trigger config; dynamic option re-fetch + unified property options; select/multiselect dropdowns

### Master Scheduler & Construction Dispatch Board
- Scheduler v2 Phase 1 — flag-gated construction dispatch board additive to existing scheduler; runtime gate via `SystemConfig` (Vercel env cap workaround)
- Overlay events — merged service + D&R Zuper jobs into `displayEvents` with distinct styling; overlay detail state, color helpers, read-only popover
- On-call electrician overlay on master schedule; day view timed grid for surveys/inspections
- Sub-job scheduling — `SubJobScheduleModal` with same/separate modes, wired into master + construction schedulers; sibling cascade reschedule using Zuper `customer_uid`
- Ops Surveys / New Construction / Pre-Sale as three tabs with Needs Revisit grouping; PB holidays block survey availability slots
- Pre-sale survey cards on calendar (dedup + click modal); orphaned resurvey/re-inspection jobs surface in sidebar
- Weekend visibility toggle without stealing Monday; forecast ghost events extended to all pre-construction stages
- `ScheduleEventLog` captures Zuper reschedules and crew changes; editable date picker on drag-drop reschedule confirmation

### Design & Operations Meeting Hub (IDR)
- Full IDR Meeting Hub — session/item/note schema, API routes for sessions/items/sync/readiness/notes/search, page shell with queue/detail/forms
- Meeting prep queue with escalation + design review support, DA status actions, dense two-column layout, live preview mode
- Real-time collaboration, HTML note formatting, @mentions, End Session button, sync error diagnostics
- BOM Review & Line Item Editor; PandaDoc DA link + plan docs; design revision toggle + auto-advance on sync; RE-REVIEW badge
- AddersChecklist + PricingBreakdown components with mismatch detection; adder summary syncs to HubSpot on manual + auto-sync
- Start Meeting scoped to Colorado / California / all; sales folder, PM task on sync, open-all links; two-click confirm on End without syncing
- Previous review notes for re-reviews + richer search results; design/permit lead owner IDs resolved via Owners API
- IDR photos full-width layout; standardize AC disconnect to TGN3322R; clearer AC disconnect + production meter labels in utility codes
- Shit Show Meeting Hub — separate session flow with auto-snapshot, always-on add button, IDR snapshot helpers for owners/statuses/equipment

### Office Performance TV Dashboards
- Full carousel dashboard at `/dashboards/office-performance/[location]` — rotation, pinning, keyboard nav
- 7-slide carousel: Leaderboard, Pipeline, Surveys, Installs, Inspections, Team Results, Goals & Pipeline (added later), Office Calendar, Service
- Visual components: `CountUp` animated numbers, `ProgressRing` SVG, `AnimatedBar`, `AmbientBackground` with floating gradient orbs, metallic leaderboard podium
- All-locations overview page at `/office-performance/all`; SLO + Camarillo combined into single California dashboard
- `OfficeGoal` model + per-office monthly targets; live Zuper API compliance metrics (replaced cache-based); crew breakdown reconciled with top-line
- 4th hero card per section, per-person metrics, streaks, achievement callouts; PM/designer/owner leaderboards on pipeline data
- Directional slide+fade carousel transitions with ambient background; TV-scale header with pill navigation

### Weekly Shop Health Dashboard
- New `/dashboards/shop-health` — weekly metrics per shop with hero revenue card, Preconstruction throughput/cycle times, Customer Success (sentiment + 5-star reviews)
- Drill-down tables on all count-based metrics, Customer Success metrics, sentiment/5-star/response time
- Service + D&R/Roofing sections; targets derived from `OfficeGoal` DB targets instead of `REVENUE_GROUPS`
- Deal-level response rollups + review drill-down fix; multiple bottleneck entries per shop per week
- Lightweight overview path (1 Project fetch, no tickets), closed-ticket cache, fail-open on new fetches to prevent thundering-herd 429s

### Project Pipeline Funnel & Cohort Analysis
- Project Pipeline Funnel (9-stage sales-to-construction) at Executive suite — hero cards, monthly grouped bar chart, cohort table with conversion percentages
- Monthly Activity table, named timeframe presets, staff assignment columns on drill-downs, Survey Scheduled stage
- Milestone Progression cohort chart — Sales Closed start, Lifecycle view, weekly bins, click-to-drill-down, Closed Out endpoint
- Add Ready-to-Build milestone bucket + flag Project Rejected reason; 3-way RTB split (interconnection / blocks / bench); daily-trend panel
- Design & Engineering funnel with revision loops; Awaiting Site Survey bucket; dull completed revisions
- Sales Funnel tab (sales-cohort funnel) alongside Project funnel; RTB-Blocked + Pending Sales Change flagged with reasons

### Design Pipeline Funnel & DA Metrics
- Full Design Pipeline Funnel at `/dashboards/funnel` — buildFunnelData aggregation, funnel bars with conversion arrows, backlog callouts, DA pacing, cancelled revenue
- Per-status revenue in Pipeline Backlog; hide-project-rejected + hide-on-hold toggles; scope Awaiting Interconnection Approval to genuine IC waits
- DE Metrics: Current DA Pipeline summary cards with Not Yet Sent bucket, DA first-try split into customer vs design rework attribution, Needed Sales/Ops Changes
- Click-through drill-down on Current DA Pipeline cards; implied progression (approved → sent → surveyed)

### Accounting Suite & Payment Tracking
- New Accounting Suite (`SALES_MANAGER`, `ACCOUNTING`, `ADMIN`, `OWNER` access) with PE Deals & Payments dashboard
- Payment Tracking dashboard + `ACCOUNTING` role; split into Payment Tracking + Payment Action Queue pages; invoice-first bucketing
- Attach HubSpot invoices to payment-tracking rows, match invoices to milestones by line item name (incl. PTO + PE)
- Ready-to-invoice attention signals from project triggers; ready-to-invoice, payment-data-mismatch admin-only dashboards
- Payment Timeline dashboard for Accounting suite; payment volume bar chart with day/week/month toggle
- Two-tier base + stretch goals with gold progress bar; weekly goals digest email (one per office); revenue goal admin config

### On-Call Electrician Rotations
- V1 on-call electrician rotations — Sun-Sat weeks, 6pm-10pm weekday / 8am-12pm weekend shifts
- Weekly rotation + self-service electrician swap UI + merged Colorado pool; per-state Google Calendar staging without invites; `calendar.events` scope
- Admin/executive Activity view — all swap + PTO requests; admin call logging with HR sheet export
- Emergency call log captured by on-call electricians (relocated to Ops suite, open access); prefill dispatch timestamps

### Deal Detail Page
- New `/dashboards/deals/[dealId]` read-only deal record view — 3-tab layout with collapsible photos gallery from Zuper notes
- Unified timeline: Zuper job notes, Zuper status history, HubSpot tasks, engagements, schedule timeline, BOM
- Section registry with `FIELD_LABELS` map for human-readable sync changelog diffs; auto-expand notes; boolean sync for "Yes" values
- On-demand HubSpot sync when deal not in mirror; site photo gallery proxied through Zuper photos
- Internal Deal link across scheduler family + all remaining UI surfaces

### Deal Mirror Sync Engine + Sync Relay
- Deal Mirror sync engine — plan-based flow with auto-cascade, plan-hash confirmation, `SyncModal` rewrite
- Plan derivation engine with conflict detection and hash; execution engine with effective state overlay
- Mapping table with normalizers, generators, transforms; snapshot builder + default intents
- POST `/sync/plan` endpoint; GET `/sync` extended with snapshots, mappings, defaultIntents

### PM Accountability & Flags
- PM Accountability dashboard + weekly digest (Phase 1) at `/dashboards/pm-tracker`
- PM Flags — exception-based PM assignment system with kill switch, aggressive thresholds, compound-risk + shit-show rules
- Live mode: page-load evaluation replaces daily cron; HubSpot deal links + owner-id assignment fallback + missing-PM seed

### Comms Dashboard & Gmail
- Comms Dashboard with redesigned inbox — sender avatars, entity decoding, expandable message rows, unified inbox patterns
- Gmail OAuth: verify identity matches PB user, fail-closed mailbox verification, runtime identity check on OAuth connect
- Include HubSpot emails outside the inbox; cap Gmail fetch and surface rate-limit errors

### EagleView TrueDesign
- TrueDesign auto-pull pipeline (Tasks 1-9) — sandbox integration test page for Go-Live proof, production PlaceOrder request format
- CAD/DXF pull with OAuth foundation + webhook (flag-off); reviewed webhook uses HubSpot v3 signature auth
- EagleView Orders dashboard page with default orders list, PB location filter, status filters, deal links, Design Lead resolution
- TrueDesign + full-order URL properties stamped on HubSpot deal/ticket; DB-backed toggle for HubSpot stamping
- Save shade as `.zip` + backfill late-arriving measurement files; order by geocoded address not stale stored coords

### Team Activity Report
- Cross-system employee activity report at `/dashboards/team-activity` — 6 sources (HubSpot, Google, PB Tech Ops, Zuper, Aircall, Participate Energy)
- Drill down into a day's raw event timeline; source toggle chips; ad-hoc "look up anyone" section
- Parallelize per-person HubSpot/Google pulls (14-day default); Google source expanded to Drive + Meet + Chat
- Aircall call detail in drilldown; PB Tech Ops descriptions; SystemConfig DB flag gate + Google reports admin

### Workflow Map & Flow Map
- Workflow Map dashboard — live HubSpot automation + SOP reference; zoomable flowchart view (pipelines → stages → workflows)
- Flow Map curated vertical-swimlane Process view (Design intertwines, Permitting parallel); plain-English end-to-end walkthrough per stage
- Accurate Design process (parallel tracks → AND-gate → stamps branch); family-lane stage layout; write-only status mapping
- Resumable backfill, refresh `maxDuration=300`, admin Build/Re-sync button

### Google Chat OOO Bot + Tech Ops Bot
- Google Chat OOO bot — accepts multiple JWT audiences, tries multiple JWKS sources, supports Google Workspace add-on envelope format
- Base64-encoded service account key support in Chat API; async post errors captured to DB with detailed error surfacing
- Tech Ops Bot — HubSpot task creation with exact deal matching, echo deal name, scope conversation history by space not thread
- Resolve task deal by customer name or address; never fabricate task creation; assign to requester via shared resolver
- Proactive daily digest DM'd to the owner; real fleet schedule from `ScheduleRecord`; `get_project_team` + `get_project_service` lookup tools
- Tailored per-room digests posted to team Google Chat rooms; `?preview=1` renders digests without posting
- `log_correction` — capture in-chat corrections for review; Apply-to-playbook button on Corrections tab; Bot Escalations admin dashboard

### Solar Estimator v2 (Customer-Facing)
- New `/estimator` — customer-facing solar quote flow with all 5 quote-type flows (Solar, EV, Battery, Expansion, D&R)
- Ported pricing + production config from original estimator; slimmed HubSpot properties (14 → 3) + iframe embed mode
- Reliable Places autocomplete with fallback to `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`; Continue works from typed address if `place_changed` misses

### My Tasks & My Tickets
- Personal HubSpot tasks dashboard at `/dashboards/my-tasks` — sort modes, deal-stage filter, mark complete, bulk done, snooze, keyboard shortcuts
- Typeahead lookups + New Task from deal panel; inline status + queue edit; admin-managed queue names; New-Task creation
- Freshservice user-facing `/dashboards/my-tickets` — tickets assigned to me, name lookup fallback when email doesn't match; Closed filter chip
- Freshservice ticket creation via API instead of email (email fallback)

### Interconnection & Permitting Hubs
- Interconnection Hub v1 at `/dashboards/interconnection`
- Permit Hub — sticky action panel + grouped queue + multiselect location; shared inbox thread fetch on correspondence tab; per-inbox OAuth workaround for blocked DWD scope
- Resolved names + header quick-links + AHJ fallback; inline action panel; permit-lead filter; broadened Gmail search to OR context clauses
- Pipeline Tracker dashboard — Site Survey/Construction/Inspection tabs, per-type status filters, sortable status columns, PE Pipeline crosslink
- PE Pipeline Tracker with construction & inspection status columns, total revenue hero, per-stage revenue

### Map & Dispatch
- Jobs proximity map at `/dashboards/map` — installs + service + crews (Phase 1); Week/Backlog, tickets, inspection/survey (Phase 2+3)
- Dispatcher office pin + morning briefing + nearby highlights; project numbers, D&R + roofing markers, shop filter
- Assignee filter + scheduled-today markers never cluster; call + add-note quick actions; territory-map assignments

### Roles, Auth & Admin Shell
- Phase 1 multi-role access + home-page redesign — `User.roles[]` array replaces single `User.role`
- Multi-role migration: `role → roles` across all callers (Part 2A), shim deletion (Part 2B), `User.role` column drop (Option E)
- Unified `AdminShell` + `/admin` landing + in-shell search (phase 1 IA); consolidated `/suites/admin` into `/admin`
- Runtime-editable role definitions (routes, landing cards, suites); per-role capability overrides (Option B); per-user extra route grants (Option D)
- Super-admin break-glass safeguard; SUPER badge on super-admin user rows; readonly Role Inspector at `/admin/roles`
- Redirect to last page after login; new `SERVICE`, `SALES_MANAGER`, `ACCOUNTING` roles; withhold super-admin email during impersonation

### Product Catalog Hardening
- Selective sync with per-field direction controls; sync Modal executions logged to `ActivityLog`; sync observability enums + watermark columns
- Auto-add unknown brands to HubSpot manufacturer enum + notify TechOps; phased HubSpot manufacturer enum enforcement
- Zoho orphan reconciliation — 302 new `InternalProduct` rows + Zuper links; 311-row Zoho orphan CSV; integrity audit + auto-fixable repairs
- Zoho writes switched from `group_name` to `category_id`; spec-derived Zuper custom fields via `meta_data` (not `custom_fields`); dimensions passed on product create
- Race-safe external-record create + link-back; product photo pushes to Zoho Inventory on approval
- Numeric range validation, vendor-pair warning, inline validation errors in Basics/Details/CategoryFields steps

### BOM & Sales Orders
- BOM push to HubSpot with UI + migration + role fixes; auto-populate SO slide-over from HubSpot deal line items
- Preferred-vendor PO splitting — auto-split BOM items by Zoho vendor; PO summary in pipeline notification emails
- Zoho pricing quality audit endpoint; cross-system product pricing comparison endpoint; include HubSpot deal record ID on Zoho Sales Orders
- CREATE_PO step gated to RTB trigger with manual retry using prior PO state; accept workflow/Tray payloads and fetch stage when missing

### Service Suite
- Service Suite Phase 1+2 — suite split, priority queue, tickets; deferred items completed
- Customer History dashboard with slide-over detail — multi-entity search + grouping, deal/ticket/Zuper association resolution
- Service scheduler — deal/ticket detection, assignees, Scheduled Date, week/day views, contact link
- Service-team sales pipeline card + last-communication preview; Deals/Tickets filter on priority queue

### Adder System
- Governed Adder Catalog (Phase 1) at `/dashboards/adders` — foundation, catalog UI, triage recommendation engine + `/api/triage/*`
- OpenSolar sync scaffold behind kill switch; Adders moved to Sales & Marketing suite with IN PROGRESS flag
- IDR HubSpot roof type auto-populate, adder amount property, % of deal + waiver warnings

### Aircall Analytics
- Call analytics dashboard (Phase 1 + Phase 2 executive view)
- Per-user answer rate via ring tracking; import Analytics+ ringing-attempts CSV for historical data

### SOP Guide
- WYSIWYG editor — replaces raw HTML CodeMirror with TipTap; auto-link `<code>/route</code>` mentions to actual app pages
- Submit-a-new-SOP feature with admin review queue; Drafts tab with PM Guide rewrite + Pipeline Overview
- Tech Ops tab split into Design / Permitting / Interconnection; role-gated tabs and sections
- Executive + Accounting + Sales & Marketing tabs (role-gated); Suites tab + per-suite SOPs; Meta-SOP
- Action Queues tab + Tools extensions (Workflow Builder, Property Drawer, Deal Detail, Equipment Backlog); Catalog, Service, Scheduling, Forecast, AHJ & Utility batch

### Customer Portal & Portal Auth
- Customer survey portal redesigned with photonbrothers.com brand palette; subdomain isolation, inline cancel, scroll fix
- Service-to-service survey invite endpoint for Olivia; hide chatbot on portal; fix URL newline
- Hide PWA install prompt on survey portal; set tab title

### EOD Summary Email
- End-of-day summary email — `DealStatusSnapshot` morning/evening diff, milestone detection with property history enrichment
- HubSpot completed-task search for tracked leads; per-person change count and task count
- Restructured by person; attribute automation changes to deal's role-property owner; reclaim-on-failed idempotency

### Daily Focus Email
- Daily focus email cron for P&I and Design leads; save morning snapshot before sending emails
- Morning items resolved now tracks actual action items

### Revenue Goal Tracker
- `RevenueGoal` model + Revenue Groups config + `REVENUE_GOAL_UPDATED` activity type
- Variant A (progress rings) + Variant B (thermometer bars) hero components; canvas fireworks animation for monthly goal hits
- Monthly breakdown chart with hit/miss indicators; Zuper-based recognition for Service and Roofing groups
- Straight-line pace, bounded HubSpot queries, gated groups stay at $0 until switched on

### Zuper API Performance
- Reduced Zuper API calls ~97% by caching job list in lookup endpoint; skip API sweep on DB-cache hits + cache `/jobs/by-category`
- Per-endpoint API call counter + admin read endpoint; explicit caller attribution for `[zuper-call]` log
- Sync-cache cron from every 30m to every 4h; property-sync from 2h to 6h; job-backfill from hourly to 6h; property-sync from /15min to /30min
- Reschedule lookup sorts jobs newest-first; skip `custom_fields` for pre-sale job creation; restore `custom_fields` after pre-sale fix

### Inspection Metrics
- Inspection metrics dashboard with drill-downs and action queues; `Location` custom object + 11 AHJ inspection properties on HubSpot
- Dual-source validation API route; cache keys + SSE invalidation mappings

### PandaDoc Integration
- PandaDoc name-only search fallback when template discovery fails; per-strategy logging (strategies 3+4); customer-name fallback when metadata misses
- Multi-template-id support + scale strategy 3; DA status drift detector as backup for HubSpot connector
- Read approval dropdown, not `document.completed` status

### Infrastructure & Performance
- `SystemConfig`-backed runtime config + TrueDesign public-client wiring; feature flags flipped without redeploy
- Auto-reload pages on new deployment; live clock replaces static "Updated" timestamp on all dashboards
- Deal-mirror table used for project enrichment (post-migration); Inngest queue infrastructure for property sync
- Rate-limit throttling across HubSpot/Zuper crons; cache invalidation cascade with 500ms debounce
- Codebase improvements — security, performance, DX (#136); `no-unused-vars` + `no-console` ESLint rules; `noUnusedLocals` on with 82 violations fixed
- Refetch intervals tiered — 15 min for low-volatility dashboards; equipment query safety cap with `hasMore` flag
- Legacy `EquipmentSku → InternalProduct` rename (Phase 1 + 2 language + Phase 3 API + Phase 4 DB column plan)
- Cache: stop transient empty fetches from blanking the pipeline page

### Bug Fixes & Hardening
- HubSpot Card v3 signature verification — sign with decoded URL values, exhaustive URL+body candidate sweep, `@hubspot/api-client` `Signature.isValid`
- HubSpot Extensions: `Button href` prop instead of `window.open`; OAuth scope fix
- Middleware: accept HubSpot webhook API-Key auth header; allowlist `/api/cron/eod-summary`, `/api/cron/pe-doc-digest`, `/api/cron/tech-ops-bot-digest`
- Security: `ADMIN_RECOVERY_CODE` required for role recovery endpoint; non-auth secrets removed from token key fallback chain; private key fully redacted in debug endpoint
- Fix `appCache.get` returns wrapper (payment-tracking real bug); Jinko manufacturer typo; catalog limit raised to 2000
- pdf-parse compatibility, showWhen conditional field clears, Prisma 7 Neon adapter passthrough

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
