# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-05-29

### Solar Designer (Major)
- New `/dashboards/solar-designer` — full V12-faithful in-app solar design tool ported from the legacy standalone engine
- Stage 1: Core engine extraction — V12-faithful physics, consumption, production, mismatch (Model B), and built-in equipment catalog (8 panels, 9 inverters, 6 ESS)
- Stage 1 modules: DXF/JSON layout parser, CSV shade parser with fidelity tagging, auto-string algorithm with voltage validation, clipping event detection, timeseries aggregation (day/week/month/year)
- Stage 2: Page shell with DashboardShell + tab bar + state reducer, equipment selection panel with catalog dropdowns, site conditions panel (temp, albedo, loss profile), file upload with drag-and-drop, system summary bar
- Stage 3: Visualizer + Stringing — PanelCanvas SVG renderer with satellite background, MapAlignmentControls, ShadeSlider with day/time range, AddressInput with geocode, click-to-assign + auto-string, StringList sidebar with voltage validation badges
- Stage 4: Production + Timeseries + Inverters tabs — paired bar ProductionChart, TimeseriesChart (area/bar) with period toggle + date navigator, MPPT cards with cross-inverter reassignment and clipping detection
- Web Worker runner so analysis doesn't block the UI; stale-tracking on site/loss/inverter changes
- Folder upload + drag-and-drop, zip upload, per-panel shade CSV support (`shading_A_IPXXXX.csv`), client-side layout parsing, Blob client upload to bypass Vercel 4.5MB body limit
- Dynamic breadcrumb that follows referring suite (Service Suite swapped Solar Surveyor for Solar Designer)
- 13 design + plan docs across Stages 1–4 driving the implementation

### Admin Workflow Builder (Major)
- New visual workflow builder at `/dashboards/admin/workflows` — admins compose actions into automated sequences on top of an Inngest runtime
- Phase 1: backend scaffold — `AdminWorkflow` model, definition JSON, trigger config, executor function, action registry pattern
- Phase 2: editor UI + CRUD API with form-driven step config and Zod inputs schema
- 10 published actions across messaging, AI, HubSpot, Zuper, PB Ops categories — send-email, ai-compose, update-hubspot-property, update-hubspot-contact-property, add-hubspot-note, create-hubspot-task, update-zuper-property, run-bom-pipeline, log-activity, http-request, find-hubspot-contact, fetch-zuper-job
- Control-flow kinds: delay, stop-if, parallel, for-each
- Triggers: MANUAL, HUBSPOT_PROPERTY_CHANGE, ZUPER_PROPERTY_CHANGE, CRON, CUSTOM_EVENT — each with a `match()` function driving webhook fan-out
- Phase 13–16 polish: dynamic option re-fetch + unified property options, select/multiselect dropdowns with dynamic options, per-workflow rate limiting, dry-run mode, failure alerts, best-effort idempotency via DB checkpoints, workflow versioning (snapshot on save + rollback), analytics dashboard, visual canvas preview, drag-to-reorder, export/import workflow JSON
- Template library with code-defined starter workflows admins can clone
- Inngest auto-sync on deploy + manual resync button
- Per-run detail page with step output drill-in; cross-workflow run history page

### Tesla PowerHub Integration (Major)
- New fleet monitoring integration — discovery, telemetry, alerts, and crosslink at full parity with the planned Enphase work
- PowerHub API client with JWT auth (later switched to OAuth2 client_credentials), rate limiting, mTLS Fly.io proxy for static egress
- Three-tier site-to-deal linkage (system-level deal ID, address-hash auto-link, manual override) with greedy 1:1 uniqueness scoring
- Cron handlers for asset sync, telemetry, and alerts; batched to dodge Vercel function timeouts
- Fleet monitoring dashboard with expandable site table; HubSpot + property + contacts + system details on site expand; search + stats
- SiteDetail enrichment with HubSpot deal, property, and battery SoC derivation when SoC signal is missing
- Tesla device denorm columns (part_number + model + serial) pushed into `HubSpotPropertyCache`
- Native HubSpot UI Extension card (`hubspot-extensions/`) with HMAC v3 signature verification and a compact sidebar variant
- Cross-system Tesla portal URL linking across HubSpot, Zuper, and the Suite
- PowerHub alert scoring fed into the Service Priority Queue
- Geo-coordinate matching via portal-imported lat/lng; auto-link of Tesla sites to HubSpot properties

### Enphase Enlighten Integration (Major)
- Full Enphase API integration at PowerHub parity (#824) — OAuth2 authorization code grant with refresh token rotation in `SystemConfig`
- Token-bucket rate limiter (8 req/sec), typed wrappers for systems/summary/devices/telemetry
- Optional Fly.io proxy via `ENPHASE_PROXY_URL`
- Cron jobs: daily fleet discovery + device refresh + address-hash auto-linking, 15-min production/consumption/battery snapshots, 30-min micro health status checks
- HubSpot card route `/api/hubspot-card/enphase/` showing production, battery SoC, micro health, portal link
- Partner OAuth setup route (`password` grant for installers with 10+ systems) and developer authorization-code flow
- 8 `enphase_*` columns added to `HubSpotPropertyCache`

### Property Hub (Major)
- HubSpot custom Property object — one property per normalized address, anchoring deals, tickets, contacts, equipment, and rollups
- `HubSpotPropertyCache` full mirror + `PropertyDealLink`/`PropertyTicketLink`/`PropertyContactLink` with ownership labels (Current Owner / Previous Owner / Authorized Contact)
- `onContactAddressChange` entry point, `upsertPropertyFromGeocode` helper, geocoding + AHJ/utility resolution
- Daily reconcile cron (drift repair via 24h watermark) and resumable 4-phase backfill (`PropertyBackfillRun`) for contacts → deals → tickets → rollups
- Inngest queue replaces the previous PendingPropertyOverride cron path
- Webhook handler at `/api/webhooks/hubspot/property/` with DB-backed idempotency and `PROPERTY_SYNC_ENABLED` kill switch
- `PropertyDrawer` slide-in detail view, `PropertyLink` clickable address wrapper, `PropertyDrawerProvider` context
- Wired into Service Suite customer-360 and Deal Detail address row
- Full-page Property Hub view at `/properties/[id]` with map, stages, ID lookup, rollup fields, equipment summaries, revenue, Zuper link, Photos tab (Zuper job photos), HubSpot + Zuper external links per tab
- Shovels API enrichment (permits, residents, contractors) on properties
- Workflow-sync endpoint for HubSpot workflow-driven property sync (replacing the pending-override cron path)
- Zuper Property sync (write direction) — associate Zuper properties with customer on create/update; project-to-property linking during sync

### PE (Participate Energy) Suite (Major)
- Multi-phase rollout of PE-focused tooling for the accounting + ops teams
- Dedicated PE & Compliance Suite consolidating PE + compliance pages
- PE Deals dashboard with hero card refresh — Ready to Invoice, collected/outstanding subtitles, x/y count switched to submitted total + under-review badge
- Group deals by pipeline stage + stage distribution in hero; split into Pre-Construction vs Construction+ cards; Awaiting PTO segment; multi-column sort + smarter Customer Paid sort; exclude Cancelled; auto-rename Other → On Hold; Customer Paid? column
- PE Document Tracker dashboard (`/dashboards/pe-docs`) with sortable columns, doc breakdown per row, payment status, Under Review hero
- PE Program Report — ownership visibility, per-project document checklist, document statuses by milestone with stage breakdown
- PE Submission Gap report — CC-hit deals with incomplete M1/M2, 4-tab split with dollar amounts and date columns, inspection pass / PTO granted dates, M1 includes Close Out + Complete tab
- PE Pipeline Tracker — per-stage revenue hero cards, construction & inspection status columns, RE-REVIEW toggle, revision workflow with auto-appear and reason sync
- General Pipeline Tracker dashboard with Construction/Inspection/Site Survey tabs, per-type status filters, sortable status columns, Zuper job links
- PE scraper sync — parses PE portal HTML reports into `PeDocumentReview`; incremental sync + hourly cron; flat single-table parser
- PE Raceway API sync replaces the HTML scraper; CSV import to supplement scraper data; webhook becomes sole sync path
- PE Approved Vendor List dashboard
- PE File Preparation — AI vision audit, PandaDoc auto-pull, prep landing page, deal queue + audit history overlay
- PE audit splits into docs + photos pipelines with independent timeouts; deep verification, vision classifier with few-shot reference library + AVL cross-check
- PE Cross-Reference (PE-CrossRef) MVP — HardwareAnalyzer (P1/P6 PowerHub vs nameplate), PlansetAnalyzer (P10/P10B/P10C), SalesOrderAnalyzer (P2–P5, P7–P9), InboxScanAnalyzer for shared mailboxes
- PE Action Items feed grouped by deal with clickable HubSpot + PE Portal links, collapsible deal groups, auto-resolve on doc approval
- Two-way PE document status sync with HubSpot deal properties; instant email notification on status changes
- PE Doc Digest restructured into 4 actionable sections + Google Drive folder link per deal + mirror digest email
- PE Prep surfaces all Zuper photos on the detail page; PandaDoc multi-template-id support; PandaDoc name-only fallback
- Customer payment status from HubSpot invoices; invoice attachment, line-item matching (incl. PTO + PE)

### Office Performance (Major)
- New `/dashboards/office-performance` TV-scale dashboards — one per location plus an all-locations overview at `/office-performance/all`
- `OfficeGoal` model for per-office monthly targets (base + stretch) with admin UI; California target set to $9M/$750K monthly
- Carousel container with rotation, pinning, keyboard nav; 7-slide format with Goals & Pipeline + Office Calendar slides
- Visual upgrades: CountUp, ProgressRing, AnimatedBar, AmbientBackground (floating gradient orbs); section color accents; metallic podium leaderboard
- Pipeline + surveys + installs + inspections sections, each with employee breakdowns and per-person streak/achievement callouts
- Compliance v2 — per-service-task scoring + status bucket fixes, visible score breakdown, removed Bayesian, OOW usage % visible side-by-side
- Cache-warming cron + `maxDuration` bump kills the 504 death spiral; per-location caches read first
- All-locations overview slide and Service slide added to the carousel; weekend days excluded from calendars
- Combined California dashboard (SLO + Camarillo merged into one)
- Static "Updated" timestamp replaced with a live clock on all dashboards
- 4th hero card per section, broader completed-deals fetch (inspections/surveys this year), removed avg build time
- Live Zuper API compliance metrics replace cache-based path; per-employee compliance, first-pass rate fixes
- HubSpot dates used directly for MTD counts + crew breakdown; deal stage filtered to ops stages
- Zuper 4-pass lookup for assigned users in deal rows; Zuper cache join keys repaired; Team Results crew attribution restored
- Statistical audit — turnaround cohorts, UID keying, bounded pass rate

### Shop Health (Major)
- New Weekly Shop Health Dashboard (#706) — per-shop weekly snapshot with bottleneck tracking
- Customer Success section with sentiment scoring + 5-star reviews; contact response metrics; sentiment + response time drill-downs
- Preconstruction section expanded with throughput + cycle times; Permits Approved renamed to Permits Issued; multi-bottleneck entries per shop per week
- Drill-down tables on all count-based metrics; per-metric review tables
- Revenue hero card + pipeline revenue detail; targets derived from `OfficeGoal` instead of `REVENUE_GROUPS`/CREWS_CONFIG capacity
- Service + D&R/Roofing sections (#855); deal-level response rollups + fixed review drill-down
- Performance polish: lightweight overview path (1 Project fetch, no tickets), closed-ticket cache, fail-open on Service/D&R fetches, dedup Project pipeline fetch

### Scheduler & Schedulers
- Master scheduler service & D&R overlay — Zuper service + D&R/roofing jobs rendered in month/week/Gantt with distinct styling and detail popovers
- Persistent localStorage toggles for service, D&R, sidebar collapse
- On-call electrician overlay layer on master schedule
- Pre-sale survey cards rendered on calendar with click modal; dedupe; project context in SubJobScheduleModal
- Construction job split — Solar / Battery / EV sub-jobs with independent scheduling, same/separate modes, sub-job breakdown view; legacy parent job hidden when typed sub-jobs exist
- Reschedule all sibling construction sub-jobs together with audit logging; tentative siblings skipped
- Editable date picker in drag-drop reschedule confirmation
- Orphaned resurvey/re-inspection jobs surfaced; orphaned jobs use deal's `pb_location`
- Weekend visibility toggle without shifting events to Saturday
- Day-view timed grid for surveys/inspections; tentative vs live mode made visually obvious across all schedulers
- Crew schedule dashboard — see where every crew member works each day; comma-separated `assignedUser` split into individual rows; assignees without `CrewMember` record displayed
- Master scheduler revenue cards, per-status revenue, completed month/year stats, overdue revenue

### IDR / Design & Ops Meeting Hub (Major)
- New `/dashboards/idr-meeting` Design & Ops Meeting Hub (formerly IDR Meeting Hub) — session, item, note models with HubSpot sync
- Meeting prep queue with escalation + design review support, DA status actions, dense two-column layout, live preview mode
- AddersChecklist + PricingBreakdown integrated into ProjectDetail with mismatch detection; adder fields wired through prep, preview, and skip/re-queue paths
- Adder summary sync to HubSpot on manual and auto-sync
- Real-time collaboration, HTML note formatting, @mentions, presence
- HubSpot tier adders, 10% threshold warnings, SS note line, ops revision notes
- Search history; previous review notes for re-reviews
- IDR sync completes HubSpot tasks + RE-REVIEW badge; revision workflow toggle with auto-appear and reason sync
- Escalation revisions trigger as-built design status
- Sales folder, PM task on sync, open-all links; recovery from accidental "End without syncing"; two-click confirm
- BOM Review & Line Item Editor (#805) inside IDR
- Start meeting scoped to Colorado, California, or all
- Compare planset layout against DA layout in design review

### Permitting & Interconnection Hub (Major)
- New Permit Hub at `/dashboards/permit-hub` — two-pane workspace for the permitting team
- Sticky action panel + grouped queue + multiselect location filter; inline action panel + permit-lead filter
- Shared inbox thread fetch on correspondence tab; per-inbox OAuth workaround for blocked DWD scope
- Queue aligned with daily-focus email; resolved names + header quick-links + AHJ fallback
- Broadened Gmail search (OR context clauses)
- New Interconnection Hub v1 (#392)

### Service Suite & BOM
- Service BOM page (deals + tickets) with ticket-keyed snapshots
- Service Catalog + SO Creation (Phase 4) — auto-populate SO slide-over from HubSpot deal line items
- Service overview: filters in header, score explanations; pipeline-ordered stages + active-only toggle
- Multiselect filters + ticket owner; dynamic stages from HubSpot API
- Service tickets owner filter scoped to owners present in queue
- Zuper status drift PM dashboard — per-sub-type evaluation + install_status rollup integrity check
- Sync Health page (#497) — drift rollup across InternalProduct/HubSpot/Zuper/Zoho

### Catalog & Sync Relay (Major)
- Cross-System Sync Relay rewrite — plan-based execute path with stale detection, planHash confirmation, useSyncCascade hook
- SyncModal rewrite with wide comparison table, per-cell source selection, value-flow visibility, generator opt-out toggles
- 10 new mapping edges; zoho `part_number` and `unit` made bidirectional
- Selective sync with per-field direction controls
- HubSpot manufacturer enum enforcement with phased rollout (auto-add unknown brands + notify Tech Ops)
- Zoho writes switch from `group_name` to `category_id`; Zuper writes spec custom fields via `meta_data`
- Phase B data hygiene — test products, casing cleanup, Generic rebrand; integrity audit + auto-fixable repairs; 311-row Zoho orphan reconciliation
- Race-safe external-record create + link-back; cross-link writer extracted to shared helper; cross-link IDs written from Sync Modal
- Product photo pushed to Zoho Inventory on approval; description + part_number propagated on item update
- Sales product request page (equipment + adders → OpenSolar) with cost estimates + deal lookup
- Adder Catalog (Phase 1) — governed adder catalog with rep-facing mobile triage UI + deal-detail embed, triage recommendation engine, OpenSolar sync scaffold behind kill switch
- Cost Audit — sales price, margin, cross-system link badges; bulk-sync costs to latest bill + suggested sales price; cross-reference Zoho bills against item purchase rates
- Preferred-vendor PO splitting — auto-split BOM items by Zoho vendor; warehouse-aware Sales Orders

### Comms Dashboard (Major)
- Overhauled Comms dashboard to match the unified-inbox-live reference app
- Expandable message rows, inline actions, unified inbox patterns; sender avatars, entity decoding, visual hierarchy
- Auto-pagination for inbox messages (up to 200), By Project view
- OAuth redirect URI derived from request headers; Gmail identity verification on connect; fail-closed mailbox verification + runtime identity check
- HubSpot emails outside inbox initially included, then reverted; rate-limit errors surfaced

### Deal Detail Page (Major)
- New read-only deal record view (`/deals/[dealId]`) with on-demand sync from HubSpot when not in mirror
- DealActivityPanel + CommunicationsFeed + ActivityFeed with pagination and note composer; TimelineEventRow for all event types
- Composite cursor pagination across timeline sources; cursor ID domain + photo caching + show-all race fixes
- DealNote model for internal notes; POST notes with background HubSpot + Zuper sync
- Zuper status history, BOM, schedule timeline fetchers; Zuper job notes + HubSpot tasks in Activity
- Site photo gallery, Zuper photo proxy with unique attachment UIDs, photos from Zuper notes + service task form submissions
- Department lead owner-ID resolution to names; on-demand sync from HubSpot when deal not in mirror
- 3-tab layout + collapsible photos; full-width IDR photos
- Sync changelog with human-readable labels; HubSpot @mention markup stripped; engagement HTML rendered

### Revenue Goal Tracker (Major)
- New RevenueGoalTracker added to executive suite via `SuitePageShell.heroContent`
- `RevenueGoal` model + admin config GET/PUT + GET `/api/revenue-goals` with caching and auto-seed
- Variant A (progress rings) + Variant B (thermometer bars) hero components
- Monthly breakdown chart with hit/miss indicators; canvas fireworks animation for monthly goal hits
- Zuper-based recognition for Service and Roofing groups; pipeline + stage filters on Zuper-linked deals; gated groups stay at $0
- Two-tier base + stretch goals with gold progress bar; Site Survey + PTO Granted goal lines on monthly goals
- Stacked monthly bars, multi-select location filter, scale against actuals not targets

### Pipeline Funnels
- New Project Pipeline Funnel — 9-stage sales-to-construction view added to Executive suite
- Survey Scheduled stage + hero card cleanup; staff assignment columns on drill-downs; Monthly Activity table; close-out activity
- Named timeframe presets; drill-down dates; activity table
- Design Pipeline Funnel — buildFunnelData aggregation with tests, funnel bars with conversion arrows, monthly grouped bar chart, cohort table with conversion percentages, suite nav links to Executive and D&E
- Backlog callouts, DA pacing, cancelled revenue, pacing revenue, stage distribution, drill-down deal lists per backlog bucket
- Implied progression (approved implies sent implies surveyed); rolling-day cutoff instead of calendar month
- Awaiting DA Send column shows design approval status

### My Tasks (Major)
- New personal HubSpot tasks dashboard at `/dashboards/my-tasks`
- Mark complete, sort modes, deal-stage filter, snooze, create from deal panel, completed-this-week, bulk done
- Inline status + queue edit, keyboard shortcuts, URL state, count badge
- Typeahead lookups, autofocus first row, admin-managed queue names
- HubSpot owner resolution via full-list match, fallback to first.last@domain when login email is an alias
- `useSearchParams` wrapped in Suspense; explicit HubSpot owner link per user

### On-Call Electrician System (Major)
- V1 on-call electrician rotations (#217) with weekly rotation, self-service swaps, merged Colorado pool
- Sun–Sat weeks + 6–10pm weekday / 8am–12pm weekend shifts
- Per-state Google Calendar; calendar.events scope; manual calendar creation; staged calendar without invites
- Emergency call log captured by on-call electricians; admin/executive Activity view with all swaps + PTO requests
- Call log moved to main page, relocated to Ops suite, opened to all roles
- HR sheet export; admin call logging; auto-create HubSpot service ticket from on-call follow-up
- 3-way outcome + pool-filtered crew dropdown; data-driven `Schedule starts` message from `pool.startDate`
- Publish works on large pools and surfaces errors as JSON
- On-Call Calls section in call-analytics fed from `OnCallCallLog`

### Aircall / Call Analytics
- Executive call analytics dashboard Phase 1 + Phase 2 — per-user answer rate via ring tracking
- Aircall Analytics+ ringing-attempts CSV import for historical data

### Accounting Suite (Major)
- New Accounting Suite (#129) — PE Deals & Payments dashboard
- Payment Tracking dashboard + dedicated `ACCOUNTING` role; HubSpot invoice attachment to payment-tracking rows; invoice-first bucketing
- Split into Payment Tracking + Payment Action Queue pages; restored filters + 5-section groupings; preset date-window filter + invoice dots link to deal
- Ready to Invoice attention signals from project triggers; Not Invoiced column on Payment Tracking row
- Payment Timeline dashboard with day/week/month toggle bar chart
- Active-only filter + stage phase pill; sortable columns; All PE Deals section
- Pricing Calculator moved from Accounting to Sales & Marketing
- Pricing Calculator deal import + comparison banner + auto-populate
- Sales & Marketing suite simplified to 4 focused cards

### EOD Daily Summary
- New EOD summary email feature — milestone detection with property history enrichment, snapshot save/load/diff, HTML email builder, cron route, idempotency with reclaim-on-failed
- Per-person change count and per-person task count
- Restructured by person, fixed stage IDs, trimmed names; signal-to-noise improvements
- Morning snapshot saved before sending emails; resolved items track actual action items
- Tracked Natasha; removed Daniel; attribute changes by who made them

### Daily Focus Email
- Daily focus email cron for P&I and Design leads
- PE M1/M2 sections for Layla's morning email

### Map Dashboard
- Jobs proximity map (Phase 1) — installs + service + crews
- Phase 2+3 — Week/Backlog, tickets, inspection/survey, UX polish
- Project numbers, richer info, D&R + roofing markers, shop filter
- Dispatcher office pin + morning briefing + nearby highlights
- Call + add-note quick actions; assignee filter + scheduled-today markers never cluster
- Office pins at real street addresses; timezone-agnostic date comparison; per-kind count breakdown

### Territory Map
- New Territory Map dashboard for CO office boundary analysis
- Office location star markers + labels; show both boundary sets; bolder boundaries; AI analysis
- Standard Markers (not AdvancedMarkerElement); CSP allow for Google Maps; mapId + legend positioning

### TV Dashboards & Office Calendar
- Office Calendar carousel slide added to per-location TVs
- 7-slide carousel on all-locations TV page
- TV dashboard rich deal list with Zuper status, PE flags, unified layout; calendar week/day views; readability fixes
- Roofing and Other Zuper jobs displayed on TV dashboards
- Adaptive pill density for fixed-height TV slides

### EagleView Integration
- TrueDesign auto-pull pipeline (Tasks 1-9) (#404)
- EagleView Orders dashboard page; sandbox integration test page for Go-Live proof
- Production PlaceOrder request format; PascalCase API response normalized to camelCase
- TDP (product 91) instead of Inform Advanced

### Customer Estimator
- Customer-facing solar estimator v2 (Phase 1)
- All 5 quote-type flows (EV, Battery, Expansion, D&R)
- Pricing + production config ported from original estimator
- Reliable Places autocomplete + cross-flow nav; iframe embed mode; HubSpot properties slimmed 14 → 3
- Continue works from typed address even if `place_changed` misses; race resolved via `flushSync` + hydrated gate

### Freshservice Integration
- User-facing `/dashboards/my-tickets`
- Admin page + UserMenu badge for user's own tickets
- Closed tickets included + Closed filter chip
- Tickets assigned-to-me (not filed-by-me); name-lookup fallback when email doesn't match

### Inspection Metrics
- New `/dashboards/inspection-metrics` dashboard with drill-downs and action queues
- Dual-source validation API route; 11 inspection deal properties added to HubSpot client; AHJ inspection properties added to Location custom object
- Cache keys + SSE invalidation mappings

### Construction & Preconstruction Metrics
- New construction metrics dashboard with drill-down, in-construction table, RTB → Const Start / RTB → Schedule Date labels
- CC → Inspection Passed (replacing CC → PTO)
- Filter by construction complete date; Zuper links on drill-down
- Preconstruction metrics dashboard (#126)

### Survey & DA Metrics
- Site Survey turnaround metrics dashboard
- Design Approval metrics dashboard with location filter, sortable columns, stage column
- Survey metrics StatCards unified; location filtering; Zuper links + date classification fixes
- DA metrics consolidated; approval queue restructured
- DA pipeline: Current DA Pipeline summary cards, Not Yet Sent bucket, click-through drill-down
- DA first-try split into customer vs design + rework attribution; Needed Sales/Ops Changes row added

### PandaDoc / DA Drift Detection
- DA status drift detector as backup for HubSpot connector
- Reads approval dropdown, not document.completed status
- De-duplicated per deal so revised DAs don't create false positives
- Moved from admin to Project Management suite

### PM Flags & PM Accountability
- Exception-based PM assignment system (#448) — kill switch, scope, assign-by-PM
- Live mode — page-load eval replaces daily cron
- HubSpot deal links + owner-id assignment fallback + missing-PM seed
- Production Issues dashboard added to Design suite; Flag Project button + inline unflag
- PM Accountability dashboard + weekly digest (Phase 1) (#440)
- Aggressive thresholds, stage-id fix, compound-risk + shit-show rules

### Shit Show Meeting Hub
- New Shit Show Meeting Hub (#429) with IDR snapshot helpers for owners + statuses + equipment
- Auto-snapshot on session create, always-on add button, refresh button; queue decoupled from active session

### Roles & Auth
- Phase 1 — multi-role access + home-page redesign (#189)
- Phase 2A — migrate `role` → `roles` across all callers; Phase 2B — drop legacy shim; Option E — drop `User.role` column
- 6 scoped suite roles + Sales & Marketing suite; Accounting suite tightened to ADMIN/EXEC/ACCOUNTING; SERVICE role scoped to Service Suite
- Per-role capability overrides (Option B); read-only Role Inspector at `/admin/roles`; per-user extra route grants (Option D); runtime-editable role definitions (routes, landing cards, suites)
- Super-admin break-glass safeguard with UI badge in UserMenu + drawer note; withhold super-admin email during impersonation; zach@ and zach.rosen@ aliases covered
- OWNER → EXECUTIVE rename + SALES_MANAGER migration
- Multi-role SALES survey guard; `requiresLocations` gate killed
- Redirect to last page after login

### Admin Suite Refactor
- Unified AdminShell + `/admin` landing + in-shell search (Phase 1 IA)
- `/suites/admin` consolidated into `/admin` — one admin landing
- Primitives batch 1 (table, filter bar, detail drawer) + batch 2 (bulk action bar, form, kv grid, detail header)
- Anchor rewrites: `/admin/activity`, `/admin/audit`, `/admin/security`, `/admin/tickets`, `/admin/directory`, `/admin/crew-availability`, `/admin/users`, `/admin/roles`
- `/admin/users` consolidates 3 modals into tabbed drawer
- Admin shell exit affordances — back-to-home link + UserMenu

### SOP Guide (Major)
- Phase 4: WYSIWYG editor (TipTap) replaces raw HTML CodeMirror
- Auto-link `<code>/route</code>` mentions to actual app pages
- Tech Ops tab split into Design / Permitting / Interconnection
- New tabs: Executive + Accounting + Sales & Marketing (role-gated); Suites tab with per-suite SOPs; Tools tab (BOM + AI Design Review) + Service extras; Pricing, P&I Hubs, Surveyor, Schedule, Optimizer, Map; Action Queues tab + Workflow Builder + Property Drawer + Deal Detail + Equipment Backlog; meta-SOP "How to Use the SOP Guide"
- Batch SOPs — Catalog, Service, Scheduling, Forecast, AHJ & Utility
- "Submitting a New Product" SOP for ops tab
- Submit-a-new-SOP feature with admin review queue; Drafts tab with PM Guide rewrite + Pipeline Overview
- Hub-mode visibility flip — open by default
- Role-gated SOP tabs and sections so info doesn't leak to wrong teams
- v3.2 → v4.0 rebrand to SOP Guide with PB brand theme

### Site Survey Scheduler
- Per-office daily survey cap + crew schedule updates
- CA site-survey availability revised + cross-office block
- Survey lead time relaxed to 1 day for California sales reps
- Camarillo survey slots stopped bleeding SLO availability; SLO + Camarillo combined into single California view

### Property Detail Polish
- HubSpot Property custom object v1 (#166)
- USER_DEFINED `typeIds` wired for deal/ticket associate; AHJ/Utility HubSpot-side links dropped (DB-side only)
- AHJ/Utility memoized by (state, zip) to cut backfill HubSpot calls
- Address-quality validation in `upsertPropertyFromGeocode`; single-candidate property link address verification
- Deal names instead of IDs in property drawer; contact names + HubSpot link

### Pricing Calculator
- Replace pricing calculator delta with user-entered `salesChangeAmount` field
- Adder costs shown inline in checklist (PricingBreakdown removed)
- Adder rates shown when system size is unknown
- HubSpot roof type auto-populate, adder amount property, % of deal + waiver warnings
- DB-backed adder path (opt-in)

### Zuper Throttling & Performance (Major)
- Explicit caller attribution for `[zuper-call]` log; per-endpoint API call counter + admin read endpoint
- ~97% reduction in Zuper API calls via cached job list in lookup endpoint; cache `/jobs/by-category`; skip API sweep on DB-cache hits
- Cron throttling: zuper-property-sync 15min → 30min → 6h; zuper-job-backfill hourly → 6h; sync-cache 30m → 4h
- `useCalendarData` polling slashed
- `roofing-scheduler` inline `JOB_CATEGORY` UIDs to drop client→server import; lazy-import call counter so client bundles don't pull Prisma
- Backfill script `--skip-zuper` flag to avoid Zuper API burst

### Office Performance (perf bucket)
- 24 `feat(office-perf)` + 14 `fix(office-perf)` commits beyond the major feature work above
- Cache-first fetching cuts dashboard load time
- Per-location caches read first; uncached fetched sequentially
- Goals & Pipeline carousel slides; tier refetch intervals (15 min for low-volatility dashboards)
- ESLint extended with no-unused-vars and no-console rules; `noUnusedLocals` enabled (82 violations fixed)

### BOM Pipeline
- Spike: Inngest workflow engine behind `INNGEST_BOM_ENABLED` flag
- BOM push to HubSpot with UI, migration, and role fixes (#104)
- Forecast Schedule page with pipeline breakdown (#103)
- Bom-catalog-match helpers extracted; `parseBomTag` for BOM line item ownership; `fetchLineItemsForDealStrict` throws on API failure
- Suggested additions included when building Zoho SO line items
- Filename sanitized before Claude Files API upload; subfolder-aware PDF listing
- Standard 60A disconnect set to TGN3322R; decoupled from service-tap detection
- Ticket SO falls back without custom field if Zoho lacks it
- Zoho Inventory retries token refresh on Access Denied

### Suites & Navigation
- Suite landing pages: Service Suite split into sections, swapped Solar Designer for Solar Surveyor
- Sales & Marketing suite created; Pricing Calculator moved there; 4 focused cards
- PM Suite landing page; Project Management + Equipment Backlog cards dropped
- PE & Compliance Suite; Design & Ops Meeting Hub added to Operations Suite
- 23 missing `SUITE_MAP` entries added; stale overrides removed
- Office Performance cards added to Operations Suite
- TSRF Peak Power Calculator added to D&E + Service suites
- 7-slide carousel on all-locations TV page; office Calendar carousel slide on per-location TVs

### Dashboard Polish
- Suite page visual polish (Phase 1)
- DashboardShell suite accent header, PB badge nav, title border, mobile stacking
- 3-tier MetricCard refactor with `href`/null support; SummaryCard removed
- Hero MetricCards promoted to StatCards on executive and pi-metrics dashboards
- Auto-reload pages on new deployment
- Bug report emails sent from the reporter

### Webhooks & Cron
- Site survey readiness checker + FDR webhook with bearer token auth + workflow payload support
- Install photo review webhook for Inspection stage
- HubSpot deal-sync webhook accepts native HubSpot payload format
- Pipeline-health cron skipped on weekends
- Schedule Event Log — capture Zuper reschedules and crew changes
- `PendingPropertyOverride` cron replaced with HubSpot workflow properties

### Brand Rename
- PB Operations Suite renamed to PB Tech Ops Suite

### Google Chat OOO Bot
- New Google Chat OOO bot (#864) — Google Workspace add-on envelope format, multiple JWKS sources for JWT auth, multiple JWT audiences, static `waitUntil` import, base64-encoded service account key support, replies posted to main timeline

### IT / Audit
- IT endpoints: audit-sessions, anomaly-events, user-roster (#402)
- Read-only activity-log export API for IT team (#298)
- `getActivityTypes` returns all enum values

### Notable Bug Fixes
- OWNER enum deserialization error fixed (460 Sentry events)
- Crew schedule: Centennial DTC mapping fix; preserve sub-category in `ZuperJobCache`; Zuper status UID resolved before update
- Scheduler: completed Zuper jobs no longer show as overdue; flag overdue/completed Zuper overlay jobs; assignees shown on all calendar event types
- IDR Meeting: open access to all authenticated roles; accidental-meeting recovery — dedupe, auto-join, end-without-sync
- DA-Rework-Flags: PM + Tech Ops API access granted; numeric `dealId` coerced to string
- Office Performance: stage bar 0-count, `scheduledThisWeek`, first-pass rate, per-employee compliance, activeOnly fallback to avoid rate limits and timeouts
- Catalog: photo upload works against private Blob store; auto-commit custom brand on blur/click-outside; numeric fields whitelisted for type coercion; stale `zohoVendorId` detected with re-select hint
- Cache: auth-gated product-request pages excluded from CDN cache
- Multi-crew install emails collapsed into one send
- Edge-runtime JWT role no longer stuck at VIEWER
- Bug reports: missing `type?` added to `SendBugReportEmailParams`
- Compliance: cross-office crew attributed by deal location, not team
- Address pinning: Sam Paro survey slots updated; office pins at real street addresses
- Zuper: explicitly sets primary job status to Scheduled after reschedule; lookup false positive — last-name-only matches require address corroboration; live email preferred over stale local `CrewMember`
- Auth: super-admin break-glass; role recovery requires `ADMIN_RECOVERY_CODE`; private key values fully redacted in debug endpoint; non-auth secrets removed from token key fallback chain
- HubSpot deal-sync webhook: HubSpot API Key auth header accepted; workflow-sync made a public route to bypass HubSpot stored-secret mismatch
- Service overview counts and Zuper sync auth corrected
- Off-by-one day alignment in construction scheduler month view
- React-pdf `renderToBuffer` type cast for Turbopack strict mode
- Sentry: HubSpot 4xx errors surfaced (no longer swallowed)
- Comms: tokens rejected when Gmail profile returns no `emailAddress`; legacy tokens verified on first use; Gmail identity matches PB user during OAuth connect

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
