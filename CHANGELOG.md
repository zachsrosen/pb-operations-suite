# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-07-21

### Operations Scorecard (Major)
- Living Operations Scorecard dashboard implementing Matt's ratified metrics package: gross/net definitions, same-year and eventual cancellation cohorts, time-metric exclusions, CC capacity model, two-pace run rates, Pueblo→Colorado Springs merge, FY/FY/YTD framing (#1500)
- Same-point year comparison, mean+median turnarounds, calendar-month trailing rate (#1501)
- Sale → DA approved and Sale → CC forecasting legs added to the funnel view (#1502)
- Trend coloring, prior-year revenue lost, sales-first charts, net vs total sales everywhere (#1503)
- Leads and consults rows at the top of the funnel (#1504)
- Projected full year, CO/CA rollups, Full-year wording, turnaround stat toggle (#1507)
- `first_consult_date` property + consult-driven sales forecast (#1510)
- Quarter-over-quarter tables and monthly funnel (#1514)
- YTD totals on monthly tables; split count/revenue trend colors (#1521)
- Interactive goal planner: sales target → expected DA/CC flow (#1525)
- Goal planner: TOTAL signed sales (not net) as input; net + total on both forward-pace columns (#1526, #1527)
- Conversion trend in capacity table (#1528)
- Goal planner uses mix-weighted per-office conversion (#1529)
- Reverse goal planner: CC goal → required funnel (#1531)
- Consistent total-basis sustain comparison + cache warmer (#1532)
- Number-vetting sweep: basis consistency + tested invariants (#1534)
- Guardrailed AI commentary section with verbatim unit-aware guardrail (#1536, #1538)
- "Why deals cancel" — reason breakdown by sold-year cohort (#1539)
- Per-section "how these numbers are calculated" explainers (#1517)

### Permit & Interconnection Hub (Major)
- Tabbed hub queues by group instead of one long list; deal stage shown in hub queues; roofing terminal stages excluded (#1468, #1470)
- Display HubSpot status labels instead of internal values (#1469)
- Drop in-flight revision and "Rejected" statuses from the Permit queue (design's work); add "Other" tabs mirroring across Permit and IC hubs (#1471, #1472, #1473, #1474)
- Map the as-built round trip to real action kinds in IC hub (#1475)
- Read emails in-app from the correspondence tab; deep-link threads to `#all` so archived mail resolves; collapse other projects' messages inside matched Gmail threads (#1494, #1495, #1498)
- Scope Hub correspondence to the project, not the shared utility/AHJ email; correct CA shared-inbox addresses (#1465, #1466)
- Link Xcel chatter emails via the IA-number crosswalk; include `xcel_ia_number` in IC/PTO correspondence identifiers; dual-application IA lists (tokenizer + merging loader) (#1487, #1493, #1496)
- Application # and Xcel IA # displayed on the Overview panel (#1499)
- Visible team-switch loading state + prefetch other teams; server-side cache of built queue with 120s budget for cold builds (#1490, #1492)
- Inspection section in the Permit view (#1516)
- UI polish: wrap the tab strip, tighten tabs to fit one row, stop tabs/lead filter from dragging the queue panel sideways (#1476, #1477, #1478, #1479)

### Approval Signals
- Approval signals detect issued/approved/granted/passed verdicts from shared-inbox evidence (#1505)
- Signal callout is suggestion-only — no automatic status change (#1506)
- Surface signal-only deals in the queue (#1512)
- Inspection signals only for deals with no `pto_status`; belong to the permit team; map `inspection_passed` verdicts under the permit team (#1511, #1513, #1515)
- Per-deal time budget so cron runs never 504 away progress (#1509)
- Rebuild to activate approval-signals env flags (#1508)

### SolarEdge Fleet Monitor (Major)
- Live SolarEdge fleet monitor with schema (SolarEdgeSite, SolarEdgeAlert, HubSpotPropertyCache back-relation), PROJ-number linkage extraction, sync job, and dashboard (#1461)
- Customer/deal links, open-ticket enrichment, table polish (#1463)
- Named alerts + alert-type filter sourced from export (#1464)

### PowerHub Fleet Monitor
- Fleet table info columns, voltage-based grid cell, Active Alerts toggle (#1423)
- Alert Type filter on fleet table (#1432)
- Show all alert chips per row, drop +N overflow (#1433)
- Link each alert chip to the site's live monitoring; Monitor link for sites with no active alerts (#1435, #1436)
- Dedicated Monitor column on every row; alerts back to plain chips (#1437; revert of Alerts-header link #1434 landed as #1439)
- Powerwall 3 counted as batteries, not gateways (#1449)
- Device-count backfill made idempotent (array-based) (#1450)

### Bot / Google Chat
- Per-rep daily worklist: their own deals, 4 sections (#1454)
- Scope sales reps to their own deals, block company-wide aggregates (#1451)
- Mirror every outbound bot message to the oversight space (#1452)
- `get_pe_docs` — bulk PE document-status lookup (action required / rejected) (#1447)
- Give full pbtechops.com URLs for app pages, not bare SOP paths (#1448)
- Raise google-chat webhook `maxDuration` 60s → 300s (heavy queries timed out) (#1446)
- Worklist delivery: deactivated owners route to manager; stop double-mirroring (#1455)
- Remember worklists it sends, and search before asking (#1523)

### Funnel & Deal Sync
- Blocked toggle + waiting-since/scheduled dates in drill-downs (#1428)
- Use Close Out Status for the Close Out stage + backlog (#1430)
- New Construction indicator + hide/show toggle (#1443)
- Stop `total:0` empty searches from blanking the pipeline (#1444)
- 15-min cron + visible "deals synced N ago" freshness badge (#1440)
- Schedule the cron, batch the writes, stabilize the diff, add a staleness alert (#1438)

### Scheduler & Worklists
- Re-enable PM survey invite: status badges, gated button, copyable link (#1459)
- Survey-invite button generates a copyable link, no email sent (#1460)
- Flag upcoming site surveys, not just overdue ones (#1535)

### Team Activity & On-call
- Weekly report-card email digest (#1427)
- Tasks/day + Property updates/day metrics (#1422)
- On-call Monday reminder emails for week-of and week-ahead shifts (#1530)

### RTB
- 'Released' reads `pm_rtb_approved_date`, not the flag (#1425)
- A re-blocked deal reads un-released until Release is pressed again (#1426)
- RTB-Blocked notes edit control always visible (#1431)

### Service & PE
- Measure time-in-stage from stage-entry date, not modified date (#1457)
- Stabilize `pe_doc_*_notes` ordering to stop duplicate rejection emails (#1453)

### Infrastructure & Misc
- Rename Colorado Springs office to Pueblo across app code (#1491)
- Auto-dulled Legacy sections on suite landing pages (#1520)
- Preconstruction-metrics: include completed deals in historical milestone counts (#1497)
- Middleware allowlist for `zuper-field-activity-sync` and `product-sync` crons (#1424)

### Bug Fixes
- HubSpot taxonomy field renamed to `cancellationReasonCategory` (main build broken) (#1540)
- Ops scorecard: rollup rows no longer box Colorado with thick borders (#1524)
- Ops scorecard: green trend color never rendered on final arrow values (#1522)
- Ops scorecard: phantom DA bulge in goal planner transition months (#1533)
- Ops scorecard: `export maxDuration=120` on the API route (#1537)

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
