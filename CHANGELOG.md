# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-05-28

### Google Chat OOO Bot (Major)
- New Google Chat bot listens for "out of office" / "OOO" / "sick today" / "PTO" messages and posts a confirmation back to the channel
- Authenticates incoming Chat events via JWT with multi-JWKS fallback and multiple accepted audiences
- Accepts base64-encoded service account key for the Chat API and Google Workspace add-on envelope formats
- Async post-back via static `waitUntil` import with errors captured to DB for diagnostics
- Replies posted to the main timeline instead of nested threads
- SOP integration so the bot can answer common policy questions inline

### PE Doc Daily Digest (Major)
- New `/api/cron/pe-doc-digest` daily email restructured into 4 actionable sections (under-review, doc-status changes, payment changes, raceway changes)
- Per-deal Google Drive folder link rendered next to each row
- "Today's Changes" section dropped to keep the email scannable; final pass slimmed body to summary + tracker link
- Middleware allowlist added so the cron route bypasses auth

### Shop Health Dashboard (Major)
- New `/dashboards/shop-health` Weekly Shop Health view replacing prior office-performance slides
- Hero card derived from revenue goals (not crew capacity) and pipeline revenue detail
- Customer Success section with sentiment scoring, 5-star reviews, response-time rollups, contact-response metrics
- Preconstruction section adds throughput and cycle-time breakdowns
- Service + D&R/Roofing sections added with deal-level response rollups
- Drill-down tables on every count-based metric, plus sentiment, 5-star and response-time drill-ins
- Lightweight overview path uses 1 Project fetch (no tickets) to keep TTFB low; fails open on the new Service/D&R fetches

### Scheduler Weekend Visibility
- Weekend visibility toggle on the master scheduler
- Events on Saturday/Sunday cells no longer steal Monday's row

### Project Pipeline Funnel (Executive)
- New 9-stage Project Pipeline Funnel card on the Executive suite
- Survey Scheduled stage added; named timeframe presets + Monthly Activity table
- "Awaiting DA Send" column now shows the design approval status badge

### PE Deals Dashboard
- PE Deals card split into Pre-Construction vs Construction+ buckets
- Pipeline bar split into stage buckets, with separate "Awaiting PTO" segment
- Customer Paid? column added with smarter sort, multi-column sort, and default ordering by PE Total
- Cancelled deals excluded, "Other" stage auto-renamed to "On Hold"
- Under-Review badge added; x/y count switched to use submitted total

### Zuper Performance & Throttling
- Per-endpoint Zuper API call counter with admin read endpoint
- Explicit caller attribution for `[zuper-call]` logs (every outbound call records source file)
- Skip Zuper API sweep on DB-cache hits, cache `/jobs/by-category`
- Cron throttling: `zuper-property-sync` from /15min → /30min → /6h; `zuper-job-backfill` from hourly → /6h
- `useCalendarData` polling cadence slashed
- Lazy-import call counter so client bundles don't pull Prisma

### Tesla PowerHub + HubSpot Extensions
- Tesla PowerHub fleet monitoring with API client (JWT auth, rate limiting), sync orchestration (assets, telemetry, alerts), and crons
- Fleet monitoring dashboard with expandable site table, search, stats, empty-site filter
- Three-tier site-to-deal linkage (admin linkage manager) and auto-link to HubSpot properties
- Geo-coordinate matching via portal-imported lat/lng; cross-system Tesla portal URL linking (HubSpot + Zuper + Suite)
- Surface every Tesla device on site with part #/serial # and full telemetry summary
- PowerHub alert scoring rolled into service priority queue
- Native Tesla PowerHub UI Extension card in HubSpot + compact sidebar variant

### Enphase Enlighten Integration (Major)
- Full PowerHub-parity Enphase Enlighten integration (`lib/enphase-enlighten.ts`)
- OAuth2 auth-code flow with DB-persisted refresh token rotation and 8 req/sec token-bucket rate limiter
- Partner OAuth setup route (`grant_type=password`) for installer accounts with 10+ systems
- New DB models: `EnphaseSite`, `EnphaseTelemetrySnapshot`, `EnphaseTelemetryHistory` + 8 `enphase_*` columns on `HubSpotPropertyCache`
- Three crons: fleet discovery + auto-link (daily 9am), telemetry snapshots (every 15 min), micro health status check (every 30 min)
- HMAC-signed HubSpot card showing production, battery SoC, micro health, portal link
- Feature flags: `ENPHASE_ENABLED`, `ENPHASE_CROSSLINK_ENABLED`, `NEXT_PUBLIC_UI_ENPHASE_VIEWS_ENABLED`

### EagleView
- New EagleView Orders dashboard page
- TrueDesign auto-pull pipeline
- Sandbox integration test page for Go-Live proof

### Other
- Admin tickets table handles invalid `pageUrl` without crashing
- Portal footer no longer shows the unrecognized phone number
- `pe-scraper-sync` overrides NOT_UPLOADED → UPLOADED when status is unknown but submitted date is present
- Daily focus saves the morning snapshot before sending emails
- EOD summary "morning items resolved" now tracks actual action items
- `--skip-zuper` flag for the property backfill script to avoid burst
- Service-to-service survey invite endpoint for Olivia

---

## 2026-05-21

### PE File Preparation & Cross-Reference (Major)
- New PE File Preparation skill: AI vision audit, PandaDoc auto-pull, prep dashboard at `/dashboards/pe-prep`
- PE Prep landing page with deal queue + audit-history overlay
- PE audit splits into independent docs + photos pipelines with separate timeouts
- Deep PE verification for photos and documents; clickable PandaDoc links surfaced on prep page
- PE vision classifier with few-shot reference library and AVL cross-check
- PE Approved Vendor List dashboard
- PE Cross-Reference (PE Action Tasks Cross-Reference MVP):
  - `PlansetAnalyzer` (P10, P10B, P10C) reusing audit vision
  - `HardwareAnalyzer` (P1, P6) — PowerHub vs nameplate mismatch
  - `SalesOrderAnalyzer` (P2-P5, P7, P8, P9)
  - `InboxScanAnalyzer` finds PE docs in shared mailboxes
  - Auto-trigger after PE audit completion
- Two-way PE document status sync with HubSpot deal properties
- PE action items now use scraper source + new scraper sync endpoints
- PE Pipeline Tracker with stage hero cards, status filters per type, sortable columns, Site Survey/Construction/Inspection tabs, RE-REVIEW badge, revision workflow, total revenue + per-stage revenue cards
- Instant email notification on PE doc status changes
- PE Submission Gap report (CC-hit deals with incomplete M1/M2) with document-level progress, real deal stage and close date, inspection pass / PTO granted dates, Complete tab

### Property Hub (Major)
- Full-page Property view at `/properties/[id]`
- Property Hub header enriched with equipment summaries, revenue, Zuper link
- Photos tab pulling Zuper job photos
- HubSpot and Zuper external links across tabs
- Activity tab enriched with engagement metadata
- Contact names + HubSpot link in Property drawer
- Extended rollup fields cached locally and exposed in `PropertyDetail`
- Inngest queue for property sync workflows
- Zuper Property sync (write direction); associate Zuper properties with customer on create/update; link Zuper projects to properties during sync

### IDR (Initial Design Review) Meeting Hub
- Meeting prep queue with escalation + design review support, dense two-column layout
- Live preview mode and On Hold deals excluded from the queue
- Real-time collaboration, HTML note formatting, @mentions
- Reviewed marking, "Shit Show" flag, prep / live / skip mode distinction
- IDR sync completes HubSpot tasks + RE-REVIEW badge
- Survey Zuper link, design approval status, design revision toggle + auto-advance on sync
- PandaDoc DA link + plan docs
- BOM Review & Line Item Editor (`/idr-meeting`)
- Previous review notes for re-reviews + richer search results
- Escalation submitter shown in IDR detail panel
- Compare planset layout against DA layout in design review
- Escalation revisions trigger as-built design status

### Pipeline Tracker
- General Pipeline Tracker dashboard with Site Survey, Construction, Inspection tabs
- Status filters (split per type), sortable status columns
- Zuper job links on both pipeline trackers
- TV-dashboard rich deal list with Zuper status, PE flags, unified layout

### Aircall Call Analytics
- Executive call analytics dashboard (Phase 1 + Phase 2)
- Per-user answer rate via ring tracking
- Analytics+ ringing-attempts CSV import for historical data
- On-Call Calls section sourced from `OnCallCallLog`

### Office Performance & Operations
- Office performance cards on the Operations suite
- SLO + Camarillo combined into a single California dashboard
- Service carousel slide added to office performance dashboards
- Crew Schedule dashboard — see where every crew member works each day
- PM Accountability dashboard + weekly digest (Phase 1)
- PM Flags exception-based PM assignment system, live mode (page-load eval replaces daily cron), owner-id assignment fallback + missing-PM seed
- Project Management Suite landing page
- Zuper Drift PM dashboard for Zuper↔HubSpot status drift, per-sub-type evaluation, `install_status` rollup integrity check

### Scheduling
- Sub-job breakdown view for construction cards
- Reschedule all sibling construction sub-jobs together (with `skipSiblingCascade` API option)
- `SubJobScheduleModal` (same/separate modes) wired into master + construction schedulers
- Day view timed grid for surveys/inspections
- On-call electrician overlay on master schedule
- Show Zuper job status in all scheduler modals
- Pre-sale survey cards on the calendar
- Forecast ghosts for all pre-construction stages
- Per-status revenue cards + completed month/year stats on construction scheduler
- Flag overdue/completed Zuper overlay jobs

### Accounting & Payments
- Payment Tracking dashboard + ACCOUNTING role (Phase 1)
- Split into Payment Tracking + Payment Action Queue pages
- HubSpot invoices attached to payment-tracking rows
- "Not Invoiced" column, preset date-window filter, invoice dots link to deal
- Ready-to-invoice attention signals from project triggers
- Payment Timeline dashboard for Accounting suite with day/week/month bar chart
- PandaDoc DA status drift detector as backup for HubSpot connector

### Other
- Two-tier base + stretch goals with gold progress bar
- Site Survey + PTO Granted goal lines on monthly goals
- Production Issues dashboard with Flag Project button + inline unflag

---

## 2026-04-25

### Admin Workflow Builder (Major)
- Visual workflow builder backend scaffold + editor UI + CRUD API (Phases 1-2)
- Inngest-backed `admin-workflow-executor` walks definition steps; control-flow kinds (`delay`, `stop-if`) handled specially
- Initial action palette: `send-email`, `ai-compose`, `update-hubspot-property`, `update-hubspot-contact-property`, `add-hubspot-note`, `create-hubspot-task`, `update-zuper-property`, `run-bom-pipeline`, `log-activity`, `delay`, `stop-if`
- Added: 4 actions + template library, then control-flow + 2 more actions (Phase 5), then 3 more + 2 templates (Phase 8), then `http-request` + `find-hubspot-contact` (Phase 10), then `fetch-zuper-job` + Duplicate workflow
- CRON trigger type + dispatcher cron (Phase 11)
- Select/multiselect dropdowns with dynamic options (Phase 12); dynamic option re-fetch + unified property options (Phase 13)
- Webhook fan-out for HubSpot + Zuper triggers
- Per-run detail page with step output drill-in; cross-workflow run history page; step reordering
- Template library with "Start from template" cloning
- Feature flags: `ADMIN_WORKFLOWS_ENABLED`, `ADMIN_WORKFLOWS_FANOUT_ENABLED`

### Adders & Triage (Major)
- Governed Adder Catalog Phase 1 (foundation) + `/dashboards/adders` catalog UI
- Triage recommendation engine + `/api/triage/*` and rep-facing mobile triage UI + deal-detail embed
- OpenSolar sync scaffold behind kill switch
- Surfaced `/dashboards/adders` on admin landing

### My Tasks (Personal HubSpot Tasks)
- Personal HubSpot tasks dashboard
- Mark complete, sort modes, deal-stage filter
- Snooze, create, completed-this-week, bulk done
- Inline status + queue edit, shortcuts, URL state
- Typeahead lookups + New Task from deal panel
- Explicit HubSpot owner link per user
- Autofocus first row + admin-managed queue names

### Admin Shell & Roles
- Unified `AdminShell` + `/admin` landing + in-shell search (Phase 1 IA)
- Consolidated `/suites/admin` into `/admin` — one admin landing
- Primitives batches 1+2: table, filter bar, detail drawer, bulk action bar, form, kv grid, detail header
- Exit affordances — back-to-home link + UserMenu
- Read-only Role Inspector at `/admin/roles`
- Per-role capability overrides (Option B); per-user extra route grants (Option D)
- Runtime-editable role definitions (routes, landing cards, suites)
- Super-admin break-glass safeguard + UI indicator (badge in UserMenu, drawer note, badge on user rows)
- Phase 1 roles: 6 scoped suite roles + Sales & Marketing suite

### Solar Estimator v2 (Customer-Facing)
- Phase 1 customer-facing solar estimator
- All 5 quote-type flows (Solar, EV, Battery, Expansion, D&R)
- Ported pricing + production config from original estimator
- Slim HubSpot properties (14 → 3) + iframe embed mode

### On-Call Electricians
- V1 on-call electrician rotations
- Aligned with Tracey's Apr 28 go-live policy + per-state Google Calendar
- Stage Google Calendar without invites; flip on later
- Sun-Sat weeks + 6pm-10pm weekday / 8am-12pm weekend shifts
- Weekly rotation + self-service swaps + merged Colorado pool
- Electrician self-service swap UI; admin/executive Activity view (all swaps + PTO requests)
- Emergency call log captured by on-call electricians
- Admin call logging and HR sheet export

### Catalog Sync Modal (Rewrite)
- Selective sync with per-field direction controls
- Plan-based execute path with stale detection + planHash confirmation
- `useSyncCascade` hook for auto-cascade logic
- `POST /sync/plan` endpoint and `GET /sync` extended with snapshots, mappings, defaultIntents
- Plan derivation engine with conflict detection and hash; plan execution engine with effective state overlay
- Snapshot builder + default intents; mapping table with normalizers, generators, transforms
- 10 new mapping edges, bidirectional Zoho `part_number` and `unit`
- Wide comparison table with per-cell source selection
- Phased HubSpot manufacturer enum enforcement
- Auto-add unknown brands to HubSpot manufacturer enum + notify TechOps
- Switch Zoho writes from `group_name` to `category_id`; spec-derived custom fields on Zuper product create; product dimensions on create
- HubSpot manufacturer enum + Zoho categories operational
- `ActivityLog` instrumentation for Sync Modal executions (Tasks 1.3/1.4)
- Catalog activity-log helpers + sync observability enums and watermark columns

### Property Object (Custom HubSpot Object) — v1
- HubSpot Property custom object v1 (`HubSpotPropertyCache` + link tables)
- Workflow-sync endpoint for HubSpot workflow-driven property sync
- One property per normalized address; dedup via `addressHash` + Google `placeId`
- See CLAUDE.md §10 for the full architecture

### Deal Detail Timeline
- Zuper job notes + HubSpot tasks added to timeline
- Zuper status history, BOM, and schedule timeline fetchers
- Internal Deal link added alongside HubSpot/Zuper links across scheduler family and remaining UI surfaces
- Communications tab now includes contact-associated emails; HubSpot notes moved from Communications to Activity; HubSpot tasks + Zuper service tasks + note attachments shown in Activity
- Human-readable labels in sync changelog diffs; FIELD_LABELS map exported from section registry

### D&E Metrics
- Current DA Pipeline summary cards + click-through drill-down
- Not Yet Sent bucket added; already-approved excluded from pipeline
- DA first-try split into customer vs design + rework attribution
- Needed Sales/Ops Changes added to DA summary row

### SOP
- Submit-a-new-SOP feature with admin review queue
- WYSIWYG editor replacing raw HTML CodeMirror (TipTap)
- Drafts tab with PM Guide rewrite + Pipeline Overview
- Tech Ops tab split into Design / Permitting / Interconnection
- Hub-mode visibility flip — open by default
- Auto-link `<code>/route</code>` mentions to actual app pages

### Tools
- TSRF Peak Power Calculator in D&E + Service suites

### Service & Auth
- SERVICE user role scoped to Service Suite
- Service Suite split into sections; Solar Designer swapped for Solar Surveyor
- Service overview: Deals/Tickets filter on priority queue
- Service Scheduler: deal/ticket detection, assignees, Scheduled Date, week/day views
- Service-team sales pipeline card + last-communication preview
- Multi-role access (Phase 1) + home-page redesign; redirect to last page after login
- Send bug report emails from the reporter

### Shit Show Meeting Hub
- New Shit Show Meeting Hub

### Freshservice
- `/dashboards/my-tickets` user-facing page
- Admin page + UserMenu badge for user's own tickets

---

## 2026-04-06

### Solar Designer (Major)
- New `/dashboards/solar-designer` Stage 1-3 implementation
- V12-faithful physics, consumption, production re-exported as the engine core
- Built-in equipment catalog (8 panels, 9 inverters, 6 ESS)
- DXF/JSON layout parser + CSV shade parser with fidelity tagging
- Auto-string algorithm with voltage validation; string-validation module with Voc/Vmp checks
- Shade-association module with AABB + rotated-rect lookup
- Mismatch module (Model B + loss calc); clipping event detection extracted from V12 dispatch
- Timeseries aggregation (day/week/month/year views)
- Web Worker entry point for `CoreRunner` (AC 5)
- Page shell with `DashboardShell`, tab bar, and state reducer
- Equipment selection panel with catalog dropdowns and spec display
- Site conditions panel (temp, albedo, loss profile)
- File upload panel with drag-and-drop and parse feedback
- System summary bar (panel count, system size, equipment)
- ShadeSlider with day/time range inputs
- AddressInput with geocode dispatch
- `PanelCanvas` stateless SVG renderer
- Upload API route for DXF/JSON/CSV; returns full `radiancePoints[]` array
- Route, permissions, and navigation entries registered

### EagleView + EOD
- EagleView panel rendered in Solar Surveyor when `?dealId=` URL param is set
- EOD email: major signal-to-noise improvements; attribute changes by who made them; added Natasha, removed Daniel; per-person change count + task count
- EOD orchestration with idempotency, snapshot diff, task query; milestone detection with property history enrichment
- HubSpot completed-task search for tracked leads
- HTML email builder for EOD; cron route handler
- Save morning snapshot after daily focus emails
- `DealStatusSnapshot` model for morning/evening diff

### Territory Map
- New Territory Map dashboard for CO office boundary analysis with AI analysis
- Office location star markers + labels
- Full-width zones, both boundary sets with labels

### Funnel / Customer / Service
- New `/dashboards/funnel` deal funnel with timeframe filters, suite navigation links to Executive and D&E suites
- Monthly grouped bar chart, cohort table with conversion percentages
- Backlog callouts, DA pacing, cancelled revenue, drill-down deal lists for each backlog bucket
- Multiselect locations, pacing revenue, stage distribution, expanded options
- Pending sales change tracking
- Customer History dashboard (`/dashboards/customer-history`) with search + slide-over detail
- `searchCustomers` orchestrator + `parseGroupKey` validator
- Customer search Phase 1 — multi-entity search + grouping
- Customer expansion Phase 2 — company contacts with address scoping
- Customer detail Phase 3 — deal/ticket/Zuper association resolution
- Service Suite Phase 1+2 — suite split, priority queue, tickets

### Meeting Hub (renamed Design & Ops)
- IDR Meeting Hub: business logic (snapshot, badge, sync, search), API routes (sessions, items, sync, readiness, notes, search), schema (session, item, note models)
- Frontend: page shell, queue, detail, forms, dialogs
- Query keys + cache mapping
- Registered in HubSpot props, DashboardShell, D&E suite
- Route access for 6 roles
- Renamed to Design & Ops Meeting Hub with line items, full names, UI polish
- End Session button + sync error diagnostics
- Site Survey Readiness Checker + FDR webhook

### Revenue Goal Tracker
- Main `RevenueGoalTracker` container component
- Variant A (progress rings) + Variant B (thermometer bars) hero components
- Monthly breakdown chart with hit/miss indicators
- Canvas fireworks animation for monthly goal hits
- `RevenueGoal` model + `REVENUE_GOAL_UPDATED` activity type
- Revenue groups config, goals logic, tests
- Admin config GET/PUT for revenue goal targets
- `GET /api/revenue-goals` with caching and auto-seed
- `heroContent` prop added to `SuitePageShell`
- Zuper-based recognition for Service and Roofing groups

### Construction / DA / Survey / Inspection Metrics
- Construction Metrics: drill-down, clearer labels, replace CC→PTO with CC→Inspection Passed, Zuper links on drill-down + All Locations summary
- Design Approval Metrics dashboard
- Site Survey Turnaround Metrics dashboard
- Inspection Metrics dashboard with API route (dual-source validation), drill-downs and action queues, route permissions, page directory, ops suite card, cache keys + SSE invalidation mappings, Location custom object + AHJ inspection properties, 11 inspection deal properties on HubSpot client

### Pricing & Accounting
- Accounting Suite with PE Deals & Payments dashboard
- PE Deals M1/M2 status dropdowns with HubSpot sync
- Compact PE deals table — truncated names, short locations/types, tighter layout
- Show Project Complete deals with pending PE payments
- Approved split into Fully and Partially Approved; "Approved — Waiting on Payment" section
- Pricing calculator deal import & compare; comparison banner; auto-populate from deal
- `deal-import` API endpoint with search and import modes

### Scheduler
- Service and D&R toggle buttons on calendar toolbar
- Fetch service & D&R jobs from Zuper, merge as overlay events into displayEvents
- Overlay detail state, color helpers, read-only popover
- Render overlay events in month/week/Gantt with distinct styling
- Collapsible project sidebar with localStorage persistence
- localStorage-persisted toggles for service, D&R, and sidebar collapse
- `OverlayEvent` type, `DisplayEvent` union, type guard
- `matchLineItemToEquipment()` + `LOCATION_SCHEME` helpers

### Forecast / Pipeline
- Forecast schedule page with pipeline breakdown
- Pipeline selector + per-pipeline stage sorting
- Per-pipeline stat cards, clickable links, sticky table header
- Scheduler forecast ghost events for all pre-construction stages

### BOM & Catalog
- BOM push to HubSpot with UI, migration, and role fixes
- Service Catalog + SO Creation (Phase 4)
- Auto-populate SO slide-over from HubSpot deal line items
- Preferred-vendor PO splitting — auto-split BOM items by Zoho vendor
- Catalog validation + admin section cleanup
- Catalog inline validation in BasicsStep / DetailsStep / CategoryFields
- Numeric range validation, vendor pair warning, min/max ranges on `FieldDef`
- Client-side photo file size and type validation
- Detect stale `zohoVendorId` and show re-select hint

### Service & Customer Suite
- Pipeline-ordered stages + active-only toggle on service page
- Dynamic pipeline stage resolution from HubSpot API
- Multiselect filters + ticket owner for service pages
- Dynamic stages + multiselect filters on service pipeline
- Zoho pricing quality audit endpoint
- Cross-system product pricing comparison endpoint
- `?format=csv` query param for browser-friendly CSV download

### Zoho
- Warehouse-aware Sales Orders and SO API improvements
- PO summary in pipeline notification emails
- CREATE_PO step gated to RTB trigger + manual retry with prior PO state
- Include HubSpot deal record ID on Zoho Sales Orders

### SOP
- SOP Guide renamed (bump v4.0), centered search bar
- Sales merged into Other Pipelines; Zuper merged into Operations; Workflows merged into Reference tab
- Tab visibility: public tabs for all, PM Guide for select users; visual indicators for role-specific and admin-only tabs
- D&E workflows documented; surveyor resolution fix
- PB brand theme applied to database-driven SOP page

### EOD / Daily Focus Emails
- Daily focus email cron for P&I and Design leads
- Zuper cache sync as Vercel cron (every 30 min)
- Service Suite enrichment — shared enrichment layer + Zuper cache sync

### Auth & Permissions
- Phase 1 multi-role access + home-page redesign
- Multi-role array migration (legacy `role` column pending DB drop)
- ACCOUNTING user role migration
- Survey reassignment notifications sent to both surveyors
- Executive and Ops Manager granted access to Zuper Compliance page

### Scheduling
- Pre-sale site visit Zuper flow
- Relaxed survey lead time to 1 day for California sales reps
- Revised CA site-survey availability + cross-office block

### Solar Surveyor
- Stage 3 state fields and 9 new actions on the reducer
- `UIStringConfig`, `MapAlignment`, expanded types

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
