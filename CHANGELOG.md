# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-06-19

### Participate Energy (Major)
- PE Hub dashboard (`/dashboards/pe`) with tabbed Deals / Docs / Analytics views — consolidates pe-deals, pe-docs, and pe-report into one surface
- PE Document Tracker: portal HTML + API sync with diffing, fresh-on-visit sync, manual Sync Now button, waived moot docs on done milestones
- PE Analytics dashboard: weekly Submissions, Approvals, Lifecycle, Ready-to-Submit, and Rejections views; segment-level drill-down on charts and totals strip; cohort reconciliation with Total Submitted
- Document Rework & Attribution tab with Doc Uploaders standalone card, day/week/month grain, By-Day chart, owner-override for attribution, Owner⇄Shared credit toggle
- Rejections-by-Document drill into open/resubmitted/approved with PE portal + Drive links
- By-Team view: grouped buckets (Rejected / Action Required / Not Uploaded), collapsible status sections, sub-group doc counts, deal-level PE Info Needed notes
- Milestone Payments view: IC/PC pipeline by stage→status, default to All/All, multi-select subgroup bubbles
- Short-pay correction in Deals & Payments — PE Revenue Collected now reflects actual dollars; superseded uploads drill-down on Doc Uploaders table
- PE Action Items feed with incremental sync + hourly cron; auto-resolve on doc approval; HubSpot + PE Portal links; grouped by deal
- PE API sync pushes doc statuses to HubSpot deal properties; NOT_UPLOADED rows for omitted docs; status overrides for portal/API drift
- Daily PE Doc digest email (4 actionable sections) and instant email on doc status changes; mirrored Google Chat digest
- Strict stamped-date event counts + Internally Rejected status; rename Approved into Fully and Partially Approved; Awaiting PTO segment; Approved — Waiting on Payment
- Address-based project matching + auto-stamp PE portal/project links on deals; CSV import to supplement scraper
- PE Photo Builder resolves by PROJ number or customer name; recurse into subfolders for turnover folder audit

### Project Pipeline Funnel (Major)
- New 9-stage Project Pipeline Funnel (sales-to-construction) dashboard with milestone inference from deal pipeline stage
- Active Pipeline + Monthly Throughput tabs; Sales Funnel cohort view; Bottlenecks tab; cohorts/activity time-based vs. live snapshot
- Conversion arrows between milestones with conv/cancelled/pending; %-conversions, days-in-stage, location matrix
- Incoming tab: DA→RTB inflow forecast, avg time for upstream deals to arrive per step, "Not here yet" stacked by current stage, revenue rollups
- Capacity & Backlog row (RTB bench + runway) on Active Pipeline / Incoming
- RTB-Blocked + Pending Sales Change flags with reason fallbacks (Kat's notes, sales-change reason, "no reason given"); LATE flag fix; backlog aging
- On Hold dedicated group + on-hold % split of pending; Participate Energy + On-Hold filters
- Monthly Activity throughput dashboard; PM/owner filters, trend vs prior, URL state, by-location hero matrix; sortable backlog columns
- Data Quality panel for missing reasons; cancelled-at-each-gate; staff assignment columns on drill-downs; named timeframe presets
- D&E funnel: status funnel + by-deal-stage breakdown; Awaiting Site Survey / Awaiting Design Upload / Design Review buckets; PE + On-Hold filters
- Ops suite gets a Project Pipeline Funnel card; Executive suite gets the same

### Property Hub & HubSpot Property Object (Major)
- HubSpot Property custom object v1: cache mirror, deal/ticket/contact/company link tables, ownership labels
- Full-page Property view at `/properties/[id]` with Equipment, Owners, Deals, Tickets sections; contact names + HubSpot link; line items in Equipment tab
- Activity tab enriched with engagement metadata; ticket enum values resolved to labels
- Inngest queue for property sync workflows; replace PendingPropertyOverride cron with HubSpot workflow properties
- Property cache map/stages/ID lookup + rollup field fixes; correct association type IDs

### Shop Health Dashboard (Major)
- New Shop Health dashboard with Customer Success (sentiment scoring + 5-star reviews), Preconstruction throughput/cycle times, Service, and D&R/Roofing sections
- Revenue hero card and pipeline revenue detail; drill-downs for sentiment, 5-star reviews, response time, and all count-based metrics
- Switch to deal-level response rollups + fix review drill-down; OfficeGoal DB targets instead of hardcoded REVENUE_GROUPS
- Contact response metrics wired into Customer Success; multiple bottleneck entries per shop per week

### EagleView Integration
- EagleView Orders dashboard page with order details drawer
- Stamp order status onto HubSpot deal/ticket; DB-backed toggle for HubSpot stamping (env-or-SystemConfig)
- TrueDesign delivery failures now visible & self-healing; Report # links to EagleView TrueDesign
- Production PlaceOrder request format; auto-pull enabled

### PowerHub (Tesla) & Enphase Enlighten Integration
- Enphase Enlighten API integration at full PowerHub parity (#824); Partner OAuth setup route for installer auth flow
- All Tesla device serials + models pushed to Zuper Property/Job; geo-coordinate matching via portal-imported lat/lng
- Every Tesla telemetry signal + alert metadata captured; full telemetry + equipment summary on monitoring page
- Battery SoC derived from energy-remaining when SoC signal is missing
- HubSpot UI Extension: native Tesla PowerHub sidebar card with device serials + model numbers
- HubSpot Card v3 signature verifier rewrite (sign with decoded URL values); HMAC diagnostic infrastructure
- Stale alerts cleared on sites that drop out of the poll; primary site selection prefers sites with equipment

### Deal Detail Enrichment & Timeline (Major)
- Deal Activity Timeline & Notes: composite cursor pagination, ActivityFeed with note composer, CommunicationsFeed for engagements
- New timeline sources: Zuper status history, Zuper job notes, HubSpot tasks, BOM, schedule
- 3-tab layout with collapsible photos; FIELD_LABELS map exported for sync changelog diffs
- POST /api/deals/[dealId]/notes with background HubSpot + Zuper sync; DealNote model
- Render HubSpot engagement HTML; strip @mention markup; auto-expand notes; boolean sync for "Yes" values
- Renamed Layout → Design Approved; cross-source cursor includes overlap band

### IDR Meeting
- BOM Review & Line Item Editor
- AddersChecklist + PricingBreakdown components with mismatch detection
- Adder fields synced to HubSpot on manual and auto-sync; widen lineItemsQuery type to include sku/price/amount
- Design revision toggle + auto-advance on sync; revision workflow with re-review toggle, auto-appear, revision reason sync
- IDR sync completes HubSpot task + RE-REVIEW badge; design escalation revisions trigger as-built design status
- Compare planset layout against DA layout in design review
- IDR Meeting Search History (#161); IDR photos full-width layout + standardize AC disconnect to TGN3322R
- Remove a project from the IDR queue; show escalation submitter in detail panel

### Tech Ops Bot (Google Chat)
- Google Chat OOO bot → renamed to Tech Ops bot; multi-JWKS source JWT auth; Google Workspace add-on envelope format
- Async post errors captured to DB; detailed Chat API error diagnostics
- HubSpot task creation; resolve task deal by customer name or address; exact deal matching
- log_correction tool: capture in-chat corrections for review; admin Corrections tab on escalations
- Apply-to-playbook button for bot corrections; admin OOO/escalations review dashboard
- get_project_status returns project type + PE IC/PC payment amounts
- DA lifecycle phases encoded; count_deals_by_status (DA/design/permitting breakdowns); PE M1/M2 milestone status breakdowns
- Full-pipeline status coverage — construction, inspection, PTO; revenue rollups + milestone date-range queries; location filtering
- Conversation history scoped by space, not thread; process-request filing; never fabricate task creation
- Morning sweep — proactive daily task & ticket digest (#1081)
- Pause team-room daily digests; file process-request tickets under a non-agent requester

### Freshservice & Production Issues
- Create Freshservice tickets via API instead of email (with email fallback)
- Production Issues Service view (tickets + completed-project deals)
- Batch Freshservice ticket fixes (#535, #563, #624, #633)

### Pipeline Tracker
- PE Pipeline Tracker dashboard with construction & inspection status columns, per-stage revenue hero cards
- General Pipeline Tracker dashboard (#635); Site Survey + Construction/Inspection tabs
- Sortable status columns, split status filter into per-type filters; total revenue hero card
- Zuper job links on both pipeline trackers; HubSpot search pagination

### Scheduling & Calendars
- Pre-sale survey cards rendered on calendar; pre-sale slot matching fixes; purple cards for pre-sale only
- Editable date picker on drag-drop reschedule confirmation; orphaned resurvey/re-inspection jobs in master scheduler
- Weekend visibility toggle on scheduler; weekend cells no longer shift events to Saturday
- Tentative install scheduling without assignee; tentative-vs-live mode visually obvious
- Completed surveys, passed inspections, completed Zuper jobs no longer show as overdue
- California sales reps: relaxed survey lead time to 1 day
- Sub-job tentative records confirmed; sub-job links in master scheduler; legacy "ALL" badge renamed to "CONST"
- Cross-deal sub-job bleed fix; pb_location read directly from service tickets
- Office calendar shows Roofing + Other Zuper jobs on TV dashboards; site survey scheduler narrowed by top location filter

### Customer Survey Portal
- Subdomain isolation, brand palette to match photonbrothers.com, inline cancel, scroll fix, chatbot hidden, URL newline fix
- Service-to-service survey invite endpoint (Olivia integration)
- Brand redesign; removed unrecognized phone number from footer

### TSRF Calculator
- Annual clipping hours estimate

### TV Dashboards
- Rich deal list with Zuper status, PE flags, unified layout
- Stacked deal lists above compliance block; completed deals, goals labels, inspections rename; readability + calendar week/day views
- Service carousel slide added to office performance dashboards

### Zuper Integration
- Zuper drift cron: per-sub-type evaluation + install_status rollup integrity check; PM dashboard for Zuper↔HubSpot status drift
- LOOKBACK_DAYS dropped from 90→14 to stay under 60s budget
- Per-endpoint API call counter + admin read endpoint; explicit caller attribution
- ~97% API call reduction by caching job list in lookup endpoint
- Cron throttling: property-sync 2h→6h, job-backfill hourly→6h, sync-cache 30m→4h, property-sync 15m→30m
- Pre-sale job creation: omit job_type, fix customer name, restore custom_fields; diagnostic logging
- Catalog cross-link IDs written via meta_data, not custom_fields

### BOM & Catalog
- Service deal BOMs now appear in Service BOM history page
- TGN3322R standard 60A disconnect (decouple from service-tap detection)
- Jinko manufacturer typo fix; catalog limit raised to 2000
- AI design review no longer flags utility meters as production meters

### Accounting
- Payment Timeline dashboard for Accounting suite; payment volume bar chart with day/week/month toggle
- PE Deals split into Pre-Construction vs Construction+; Partially Paid section; Customer Paid? column; multi-column sort; Awaiting PTO segment
- Auto-rename Other → On Hold; exclude Cancelled deals
- PE Deals doc breakdown + invoice audit + email sync; inline document breakdown on row click

### Bug Fixes & Infrastructure
- Centralize Claude model IDs, replace retiring Sonnet 4, bump to current models
- Page Traffic analytics (admin) — views, dwell, dead-weight, per-user
- Directory identity links: User ↔ HubSpot owner / Zuper user / CrewMember
- Goals digest: weekly email per office; hide zero-delta when no prior snapshot
- Move feedback + chat launchers into the header chrome
- Workflow-sync accepts HubSpot native webhook payload format
- 5-star review goals lowered to 20 base / 25 stretch company-wide
- On-call: Monday-start weeks + drop California Sunday coverage
- Bulk spreadsheet update script for AHJ/Utility custom objects (#449)
- Shop-health overview: lightweight path (1 Project fetch, no tickets), fail-open on new Service/D&R fetches
- AHJ-tracker bulk update script; Nathan and Nick email correction; tpo@ added to shared inbox connections

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
