# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-06-30

### Participate Energy Hub & Analytics (Major)
- Unified PE dashboard at `/dashboards/pe` — tabbed hub (Deals & Payments, Documents, Analytics) replacing retired pe-report
- HubSpot Deal card for PE status with submitted/required counts and approved · under review · action required breakdown
- Shared "Sync now" across all PE tabs; "Last synced X ago" reflects last successful pull
- Address-based project matching with auto-stamped PE portal links on deals
- Retired the PE portal scraper webhook (was corrupting doc statuses); switched fully to API sync
- API sync writes NOT_UPLOADED rows for docs the API omits and pushes doc statuses to HubSpot deal properties
- Nightly cron writes avg submission-to-payment and CC-to-payment days as forecast legs; skips overnight (10pm–6am MT) and runs full (not incremental) every 30 min
- Fold residual Unknown payment $ into Layla for pre-Apr-30 nameless uploads; drop date gate for unattributed credit

### PE Analytics (Major)
- Weekly chart modes: Submissions, Approvals, Ready-to-Submit, Lifecycle, Rejections, Remittance, Expected-Paid, Milestones/Lifecycle split
- Day/Week/Month grain on all charts; Ready/Submitted lifecycle basis; resubmitted band; progress-fill style
- Cohort views for Rejections and Ready-to-Submit; ready-cohorts reconcile with Total Submitted
- Segment-level and bar drill-downs across all weekly charts; aggregate drill from totals cards
- Doc-status header cards, deal counts in totals strip, operational ready dates
- Doc-status cards scoped to milestone-relevant docs; exclude reverted status flips from submission counts
- "Expected (Submission)" forecast mode with milestone pills relocated to controls row
- Submit-to-Pay, CC-to-Pay (M1 & M2), Inspection/PTO-to-Submit timing cards
- Age submitted M2s from M1 approval (PE can't review M2 until M1 approved)
- Re-Rejected After Approval report; PE Timing stats ordered CC→pay first

### PE Doc Tracker & Uploaders
- Standalone Doc Uploaders card with payment-ownership mode (owner/fractional/last-submitter)
- Submissions / By Day / Approved $ / By Doc Type tabs with day/week/month grain, aligned tables, volume-scaled outcome bars
- Uploads Explorer — filter by document + uploader, drill anywhere; click chart segments to drill into that day's docs
- Drill-downs on rejected, superseded uploads, and awaiting-approval buckets (3-way split on Submitted card)
- Distinct-deal counts (Submissions + By Time); Uploads/Docs/Deals columns; in-review payments; approval rates exclude cancelled projects
- Milestone drill-down Copy/CSV export (per-view); Docs Copy/CSV export ignores category filter
- Bill of Materials tracked as its own M1 doc, conditionally required with "Not Required" status
- By-Team collapsed rows with all outstanding docs inline; deals + docs count on bucket chips; Rejected / Action Required / Not Uploaded groups
- Editable per-doc blocker notes → deal-level PE Info Needed; "Waiting on Information" reason on M1/M2
- Rejections-by-Document with open/resubmitted/approved drill-downs; count only real rejections (drop sync noise)
- Doc Tracker M2 docs gated to Close-Out+ deals; waive moot docs on done milestones
- Advance Approved milestones to Paid from invoice paid-in-full date (SystemConfig-gated)

### PE Rejection Workflow
- Auto-advance Rejected → Ready to Resubmit when rejection tasks done; loosened task-name matcher; onboarding + internal rejections included
- Live-pull per-team M1 rejection notes with must-pull-first + retry to prevent note-less status syncs
- Mark P.E. M1/M2 Documents checkboxes on rejection; grouped rejection notes with LJF-only Design mirror
- Per-team QC rejection notes from reviewer input; populate `pe_doc_*_notes` from PeActionItem
- Rejection webhook accepts `?token=` query param; stop webhook retry storm regenerating duplicate tasks
- Clear stale per-team notes so they can't re-fire team tasks
- Push doc statuses to HubSpot AFTER action items written (real blank-Notes cause)
- Exclude missing/action-required docs from overdue-with-PE aging by last-upload

### Project Pipeline Funnel (Major)
- Combined Pipeline Funnel + Monthly Activity into one tabbed page (Active Pipeline, Monthly Throughput)
- Cohorts tab (default = active snapshot); "All active deals" scope for live pipeline
- Conversion as compact arrows between milestones with conv/cancelled/pending, colored numbers, legend
- Milestone Progression cohort chart with weekly bins, PE-style sizing, Sales Closed start, click-to-drill, Lifecycle view extending to Closed Out
- Revenue Conversion by Cohort table; per-status revenue in Pipeline Backlog
- Interconnection Approved + Ready to Build milestone cards (monotonic count fixes 121% conversion)
- Ready-to-Build bucket + Awaiting-Interconnection with IC status; 3-way RTB split (interconnection / blocks / bench)
- Company-wide access; timeframe granularity; avg days-in-stage; PM/owner filters; URL state; by-location hero matrix
- Sales Funnel tab (sales-cohort funnel); D&E funnel with revision loops, Awaiting Site Survey/Design Upload/Design Review buckets, PE + On-Hold filters, branch/tree Status Funnel
- On Hold pulled into its own group with on-hold % in conversion arrows; Cancelled/On Hold as their own lifecycle segments
- Hide project-rejected toggle (mirrors on-hold); don't paint reopened deals as Cancelled
- RTB-Blocked reason falls back to Kat's / install notes; drop install notes from RTB-Blocked; "no reason given" when blank
- Cohort charts: finer lifecycle, drill-down detail, week/month toggle, segment drill, sort + copy; headline summary cards; label above each bar
- Ops Suite Project Pipeline Funnel card

### Incoming & Capacity
- Pipeline Incoming dedicated page → moved to funnel tab with revenue
- "Not here yet" stacked by where deals are; avg time per upstream step
- DA→RTB inflow forecast; Capacity & Backlog row (RTB bench + runway) on Incoming tab
- Daily-trend panel (event throughput + recorded backlog state)

### Workflow & Flow Map
- Workflow Map dashboard — live HubSpot automation + SOP reference (zoomable flowchart, pipelines → stages → workflows)
- Family-lane stage layout, name+status stage mapping, task edges, flowchart polish
- Process view — plain-English end-to-end pipeline walkthrough (expandable per stage)
- Curated vertical-swimlane Process view (Design intertwines, Permitting parallel); accurate Design process (parallel tracks → AND-gate → stamps branch)
- Resumable backfill, refresh maxDuration=300, admin Build/Re-sync button

### EagleView & TrueDesign
- EagleView orders page with default list, status filters, PB location filter, deal links, order details drawer
- "View in TrueDesign" link on EagleView panel; Report # links to EagleView TrueDesign
- Design Lead per order (resolved via owner map)
- TrueDesign CAD/DXF pull — OAuth foundation + webhook (flag-off)
- Stamp order status onto HubSpot deal/ticket (DB-backed toggle, env-or-SystemConfig)
- Save shade as .zip + backfill late-arriving measurement files; extract Drive folder ID from URL before delivery upload
- Reviewed webhook uses HubSpot v3 signature auth; TrueDesign delivery failures visible & self-healing
- Order by geocoded address, not stale stored coords; full-order URL properties on deals

### Scheduler
- Scheduler v2 Phase 1 — construction dispatch board (flag-gated, additive, SystemConfig-driven)
- No survey availability slots on PB holidays
- New Construction as its own tab between Ops Surveys and Pre-Sale
- Needs Revisit + New Construction surveys shown in three groups; revisits kept in Ops Surveys after status flips to Ready to Schedule
- Lenny Uematsu replaces Rolando for Colorado Springs field work
- DTC office filter no longer hides all survey availability
- Completed surveys & passed inspections no longer show as overdue
- Stale schedule date no longer hides Needs Revisit group

### Tech Ops Bot
- Renamed OOO bot to Tech Ops bot; process-request filing; admin escalations review dashboard
- HubSpot task creation with exact deal matching (resolves by customer name/address); tasks assigned to requester via shared resolver
- Never fabricate task creation; pass project ref to tool; echo deal name; assign to named person
- `get_project_status` returns project type + PE IC/PC payment amounts; `count_deals_by_status` for DA/design/permitting breakdowns
- `get_project_team` + `get_project_service` lookup tools; PE M1/M2 milestone status breakdowns
- Full-pipeline status coverage — construction, inspection, PTO; location filtering on deal tools; revenue rollups + milestone date-range queries
- Encode DA lifecycle phases (Review In Progress = pre-send); lead with waitingToBeSent for DA questions
- Corrections tab on Bot Escalations + Apply-to-playbook button; `log_correction` in-chat
- Proactive daily digest DM'd to owner; tailored per-room team Google Chat rooms; `?preview=1` renders without posting
- Real fleet schedule from ScheduleRecord (replaces calendar stub); filter by deal pb_location
- Morning sweep — proactive daily task & ticket digest
- Report true stage counts (data-integrity prompt rule); scope conversation history by space; rotating "thinking" ack

### PE Photo Tools
- Self-serve Photos-per-Policy builder (web tool)
- Resolve PE Photo Builder by PROJ number or customer name
- PE photo-submission skills (final-permit + policy-photos)
- Policy-photos keep all required shots, label each page (was over-filtering)

### Freshservice, Ops & Production
- Freshservice tickets created via API instead of email (email fallback); process-request tickets filed under non-agent requester
- Production Issues Service view (tickets + completed-project deals)
- Atlas map card surfaced in Operations, PM, Service suites; embedded as top-level destination
- PowerHub clears stale alerts on sites that drop out of the poll
- TSRF calculator estimates annual clipping hours
- IDR meeting — remove project from queue

### Cache & Infra
- Cross-instance shared cache + single-flight for projects/deals
- Stop transient empty fetches from blanking the pipeline page
- Auth-redirect cache fix; funnel page 504/blank hotfix (300s budget for full-fetch routes)
- SystemConfig-backed runtime config + TrueDesign public-client wiring
- Vishtik project ID/URL sync onto deals
- Directory identity links: User ↔ HubSpot owner / Zuper user / CrewMember
- Page Traffic analytics (admin) — views, dwell, dead-weight, per-user
- Centralized Claude model IDs, replaced retiring Sonnet 4, bumped to current models
- Paused 3 HubSpot-heavy crons during rate-limit outage; paused team-room daily digests
- On-call: Monday-start weeks + drop California Sunday coverage

### Bug Fixes
- Portal: hide PWA install prompt on survey portal + set tab title
- Move feedback + chat launchers into header chrome
- PE: readyOn uses "Ready to Submit" date then inspection/PTO (drop flaky status-history fallback)
- PE: pull rejection notes for new/changed docs only so fresh rejections never sync note-less
- PE: rename confusing "Milepts" column to "Milestones"
- PE: label today's bar; widen week/month By Time chart
- PE: drop phantom action-resolutions from uploader stats; relabel Unknown
- PE: exclude moot docs from Missing-by-Document; fold Doc Rework into an Analytics section
- Zuper reschedule lookup sorts jobs newest-first
- Chat tools: assert `filter_deals_by_stage` `total`, not stale `count`
- Cancelled deals no longer counted as reaching every funnel milestone
- Deal-reader Project mapping picks up blocked/on-hold fields; dedupe blocked/on-hold in deal-reader
- Merged UPLOADED and UNDER_REVIEW into single "In Review" status
- Relabel notes-only PE doc changes instead of "Uploaded → Uploaded"
- Don't treat "Synced from PE portal scraper" boilerplate as a note update
- Don't log UPLOADED→UNDER_REVIEW convergence as a change

---

## 2026-05-31

### Tesla PowerHub Integration (Major)
- Tesla PowerHub fleet monitoring integration with OAuth2 client_credentials auth via Fly.io proxy
- API client with JWT auth, token bucket rate limiting, unit tests
- Fleet monitoring dashboard with expandable site table, HubSpot deal/property/contact enrichment
- Three-tier site-to-deal linkage (exact match, address, name heuristics) with greedy 1:1 uniqueness
- Auto-link Tesla sites to HubSpot properties via address/geo-coordinate matching
- Cron jobs for asset sync, telemetry, and alert polling (batched for Vercel timeout)
- PowerHub alert scoring wired into service priority queue
- Group-level alert API with DIN mapping
- Filter empty sites, sort by data, search + fleet stats
- Native HubSpot UI Extension sidebar card showing production, battery SoC, portal link, Tesla device models
- Cross-system Tesla portal URL linking (HubSpot + Zuper + Suite)
- Full telemetry signals + alert metadata capture, battery SoC derived from energy-remaining fallback
- Surface every Tesla device on site with part #/serial # + push device models to Zuper Property/Job
- Backfill site addresses from linked HubSpot deals
- Migration for Tesla device model columns; upsert-based asset sync to prevent race conditions

### Enphase Enlighten Integration (Major)
- Full parity with PowerHub — OAuth2 auth code flow with DB-persisted refresh token rotation
- Partner OAuth setup route for installer credentials flow (bypasses redirect dance)
- Typed API wrappers (listSystems, getSystemSummary, telemetry) with 8 req/sec rate limiter
- New `EnphaseSite`, `EnphaseTelemetrySnapshot`, `EnphaseTelemetryHistory` models + 8 columns on `HubSpotPropertyCache`
- Cron jobs: fleet discovery (daily 9am), telemetry snapshots (15 min), status checks (30 min)
- HMAC-signed HubSpot card at `/api/hubspot-card/enphase/`

### PE File Prep & Cross-Ref (Major)
- PE File Preparation tool — AI vision audit, PandaDoc auto-pull, prep dashboard
- Deep PE verification for photos and documents with few-shot reference library + AVL cross-check
- Split PE audit into independent docs + photos pipelines with separate timeouts
- Batch photo triage — 1 API call replaces 36+; pre-upload photos + Anthropic file ID cache
- PandaDoc multi-template-id support, permissive fallback search, customer-name fallback
- Two-way PE document status sync with HubSpot deal properties
- PE Raceway API sync replacing HTML scraper; incremental sync + hourly cron
- PE Approved Vendor List dashboard page
- PE Prep landing page (deal queue + audit history overlay) with clickable PandaDoc links
- PE Cross-Reference MVP: PlansetAnalyzer (P10, P10B, P10C), HardwareAnalyzer (P1, P6), SalesOrderAnalyzer (P2-P5, P7-P9), InboxScanAnalyzer for shared mailboxes
- Auto-trigger cross-ref after PE audit completion
- PE portal CSV import to supplement scraper data
- Scaled vision concurrency 6→10 with per-call telemetry; Drive resilience (token cache, retry)
- Recursive Drive subfolder search for planset PDFs; widen AHJ permit search to Inspections + Permitting folders
- Fixed sender to `ict@participate.energy`; added openid+email scopes to shared inbox OAuth

### PE Document Tracking & Dashboards
- PE Document Tracker dashboard (`/dashboards/pe-docs`) with sortable columns and hero cards
- PE Deals dashboard: doc breakdown, IC/PC reconciliation bar, invoice audit, email sync
- PE Deals — pipeline bar split into stage buckets, Awaiting PTO segment, Customer Paid column, Pre-Construction vs Construction+ split
- PE Deals — multi-column sort, exclude Cancelled, auto-rename Other → On Hold, default sort by PE Total
- PE Submission Gap report — CC-hit deals with incomplete M1/M2, 4-tab split with dollar amounts, inspection pass / PTO granted dates
- PE Program Report dashboard for ownership visibility with per-project document checklist
- PE doc digest email — restructured into 4 actionable sections, Google Drive folder links per deal, slimmed to summary + tracker link
- Instant email notification on PE doc status changes
- Auto-resolve action items on doc approval; collapsible deal groups with clickable HubSpot + PE Portal links

### Pipeline Tracker & Project Funnel
- General Pipeline Tracker dashboard with Construction, Inspection, Site Survey tabs
- Per-type status filters, sortable status columns
- PE Pipeline Tracker with per-stage revenue hero cards, total revenue card, construction & inspection status columns
- Project Pipeline Funnel (9-stage sales-to-construction) in Executive suite with named timeframe presets, activity table, drill-down dates
- Staff assignment columns in pipeline funnel drill-downs
- Awaiting DA Send column now shows design approval status
- Zuper job links added to both pipeline trackers
- Paginated HubSpot search in pipeline tracker APIs

### Shop Health Dashboard (Major)
- Weekly Shop Health Dashboard with revenue hero, targets derived from OfficeGoal DB
- Customer Success section — sentiment scoring, 5-star reviews, response time
- Preconstruction section expanded with throughput and cycle times
- Service + D&R/Roofing sections
- Drill-down tables for all count-based metrics, sentiment, 5-star reviews
- Deal-level response rollups
- Multiple bottleneck entries per shop per week
- Perf: cached fetchAllProjects to prevent concurrent 429s; lightweight overview path; failed open on new fetches
- Renamed "Permits Approved" → "Permits Issued"

### Scheduler
- Sub-job breakdown view for construction cards; per-type sub-jobs (Solar / Battery / EV)
- SubJobScheduleModal with same/separate modes wired into master + construction schedulers
- Reschedule all sibling construction sub-jobs together (scoped to same deal, audit-logged, skips tentative siblings)
- Day view timed grid for surveys/inspections
- Weekend visibility toggle (fixed shifting events to Saturday)
- On-call electrician overlay on master schedule
- Show orphaned resurvey/re-inspection jobs; use deal's `pb_location` for orphaned job location
- Editable date picker on drag-drop reschedule confirmation
- Pre-sale survey rendering on calendar with dedup + click modal, purple card differentiation
- Dedup revised DAs to prevent false-positive DA drift
- Show Zuper job status in all scheduler modals
- Show assignees on all calendar event types; California combined-location group events
- Tentative vs live mode visually distinguished across all schedulers
- California survey lead time relaxed to 1 day for sales reps

### Crew & Office Performance
- Crew schedule dashboard — see where every crew member works each day
- `ZuperJobCache` data source integration; split comma-separated `assignedUser` into individual rows
- Weekly goals digest email — one per office, with two-tier base + stretch goals and gold progress bar
- Site Survey and PTO Granted goal lines on monthly goals
- California annual revenue target updated to $9M ($750K/month); combined California goals lowered to $750K / 15 reviews
- 5-star review goals lowered to 20 base / 25 stretch
- Office performance cards added to Operations Suite
- Service carousel slide on office performance dashboards
- Exclude weekends from office performance calendar
- Fixed office performance 504 death spiral with `maxDuration` + cache-warming cron

### Property Hub
- Full-page property view at `/properties/[id]` with map, stages, ID lookup, rollup fields
- Photos tab with Zuper job photos; HubSpot and Zuper external links per tab
- Property Hub header enriched with equipment summaries, revenue, Zuper link
- Extended rollup fields cached locally and exposed in PropertyDetail
- Activity tab enriched with engagement metadata
- Show deal names instead of IDs in drawer; show contact names + HubSpot link
- Fixed line items in Equipment tab; resolved ticket enum values to labels with links
- Zuper Property sync (write direction) — associate on create/update with safety checks
- Link Zuper projects to properties during sync; include ticket-only properties
- Filter customers with no UID when updating Zuper property
- Inngest queue for property sync workflows; workflow-sync endpoint for HubSpot workflow-driven sync
- Replaced `PendingPropertyOverride` cron with HubSpot workflow properties
- Fixed address-quality validation in `upsertPropertyFromGeocode`
- Verify address match for single-candidate property links

### IDR Meeting Hub & Design
- Design & Ops Meeting Hub added to Operations Suite
- IDR Meeting BOM Review & Line Item Editor
- IDR revision workflow — re-review toggle, auto-appear, revision reason sync, RE-REVIEW badge
- Escalation revisions trigger as-built design status; escalation submitter surfaced in detail panel
- Design/permit lead owner IDs resolved via Owners API (owner directory indexed by userId)
- Previous review notes for re-reviews + richer search results
- Stale numeric lead IDs resolved in completed snapshots
- IDR adders: HubSpot roof type auto-populate, adder amount property, % of deal + waiver warnings, tier adders, 10% threshold warning
- Compare planset layout against DA layout in design review
- AI design review no longer flags utility meters as production meters
- IDR sync completes HubSpot task
- Auto-advance uses HubSpot internal value for `design_status`

### BOM & Sales Orders
- Service BOM page (deals + tickets) with ticket-keyed snapshots
- Service BOM shows service deal BOMs; fixed ticket-context links and dealname cleanup
- Ticket SO falls back without custom field if Zoho lacks it
- BOM table: consolidated Catalogs column into product badge
- Sanitize filename before Claude Files API upload
- Subfolder-aware PDF listing in pipeline; full Drive scope for DWD token requests
- Zoho inventory retry on token refresh Access Denied

### Catalog & Product Sync
- Sync Health page: drift rollup across InternalProduct/HubSpot/Zuper/Zoho
- Cost Audit: cross-reference Zoho bills against item purchase rates; sales price, margin, cross-system link badges; bulk-sync costs to latest bill + suggested sales price
- Product sync uses canonical `writeCrossLinkIds` for all systems
- Catalog Zuper cross-link IDs written via `meta_data` not `custom_fields`
- Jinko manufacturer typo fixed; catalog limit raised to 2000

### Aircall & Communications
- Call analytics dashboard (Phase 1 + Phase 2 executive analytics)
- Per-user answer rate via ring tracking
- Analytics+ ringing-attempts CSV import for historical data
- On-Call Calls section from `OnCallCallLog`
- On-call form: roofing issue type, 3-way outcome, pool-filtered crew dropdown
- On-call follow-up auto-creates HubSpot service ticket
- Increased publish timeout for 6-month horizon
- Fixed on-call design-review AI fields; PTO + swap UX on-call
- Added Elliott Gunning to daily design rollup emails
- Comms: cap Gmail fetch + surface rate limit errors; reverted "HubSpot emails outside inbox"

### Google Chat OOO Bot
- New Google Chat OOO bot with SOP integration
- Support Google Workspace add-on envelope format
- Multiple JWKS sources for Google Chat JWT auth with multi-audience support
- Post replies to main timeline instead of thread
- Base64-encoded service account key support; async post errors captured to DB

### EagleView Integration
- EagleView Orders dashboard page with sandbox integration test page
- Production PlaceOrder request format; normalize PascalCase to camelCase response keys
- TDP (product 91) used instead of Inform Advanced in tests

### Shovels API
- Shovels API property enrichment — permits, residents, contractors
- Batch size increased to 75 with reduced delay

### Portal & Customer Survey
- Portal redesign matching photonbrothers.com brand palette
- Subdomain isolation, inline cancel, scroll fix, hide chatbot
- Service-to-service survey invite endpoint for Olivia
- Removed unrecognized phone number from footer

### TV Dashboard
- Rich deal list with Zuper status, PE flags, unified layout
- Stack deal lists above compliance block; completed deals, goals labels, inspections rename
- Readability + calendar week/day views

### Payment & Accounting
- Payment Timeline dashboard for Accounting suite with day/week/month toggle bar chart
- Payment timeline — missing payments due to null dates fixed
- PE Receivable scoped to approved milestones only
- PandaDoc: read approval dropdown (not `document.completed`); DA status drift detector as backup

### Zuper
- Per-endpoint API call counter + admin read endpoint
- API calls reduced ~97% via job list cache in lookup endpoint
- Skip API sweep on DB-cache hits; cache `/jobs/by-category`
- Throttled crons: property-sync 2h→6h, job-backfill hourly→6h, property-sync /15→/30, sync-cache 30m→4h
- Explicit caller attribution via `[zuper-call]` log with source file
- Per-sub-type drift evaluation + `install_status` rollup integrity check
- PM dashboard for Zuper↔HubSpot status drift
- Restored `custom_fields` for pre-sale jobs; fixed pre-sale job creation (omit `job_type`, fix customer name)
- Resolve status UID before updating job status
- Legacy sub-job badge renamed "ALL" → "CONST"
- Prevent cross-deal sub-job bleed on same-customer projects
- Preserve sub-category in `ZuperJobCache`; persist Zuper assignment metadata on confirm
- Explicit primary job status = Scheduled after reschedule
- Drift cron LOOKBACK_DAYS 90→14 to stay under 60s budget

### Production Issues & Suites
- Flag Project button and inline unflag action for production issues
- PE & Compliance Suite consolidating PE + compliance pages
- Admin testing suite added
- Breadcrumbs: 23 missing `SUITE_MAP` entries added

### Auth, Middleware & Infrastructure
- HubSpot workflow-sync made public route to bypass stored-secret mismatch
- Accept HubSpot webhook API Key auth header
- Allowlist `/api/cron/pe-doc-digest` in middleware
- Admin tickets: handle invalid `pageUrl` in ticket table render
- HubSpot card v3 sig verifier — sign with decoded URL query-param values
- Wrap product-comparison in Suspense for prod build
- Extract shop-health week utils to prevent client/server boundary violation
- `--skip-zuper` flag on backfill script to avoid API burst

### Bug Fixes & Minor
- Fixed completed Zuper jobs showing as overdue on scheduler
- Fixed payment volume chart bars invisible (`items-center` → `items-stretch`)
- Corrected email addresses for Nathan and Nick
- Read `pb_location` directly from service tickets
- Allow tentative install scheduling without assignee
- Batch Freshservice ticket fixes
- Removed `M1`/`M2` from PE tracker
- Removed broken PE scraper GCS cron (webhook is sole sync path)
- Daily focus saves morning snapshot before sending emails
- EOD summary morning items now tracks actual action items
- Approval rate only counts decided docs (excludes Under Review)

---

## 2026-04-30

### Solar Designer (Major)
- Ported V12 solar engine into new in-app designer at `/dashboards/solar-designer`
- Stage 1: core engine extraction — types, constants, V12 built-in catalog (8 panels, 9 inverters, 6 ESS), physics/consumption/production re-exports
- Stage 2: page shell with DashboardShell, equipment selection, site conditions, file upload panel with drag-and-drop, system summary bar
- Stage 3: Visualizer tab with satellite background + shade animation, Map Alignment controls, Stringing tab with click-to-assign + auto-string, voltage validation badges
- Stage 4: Production, Timeseries, and Inverters tabs with SVG charts, MPPT cards + reassignment + clipping detection
- Web Worker CoreRunner for analysis, stale-tracking on site/loss changes
- Client-side layout parsing (bypasses Vercel 4.5MB body limit via Blob upload), zip + folder upload, per-panel shade CSV support with format auto-detect
- Cross-inverter MPPT reassignment, shade enrichment bridge, timeseries kWh conversion

### IDR / Design & Ops Meeting Hub (Major)
- New IDR Meeting Hub in D&E suite: sessions, items, sync, readiness, notes, search
- Prep mode + live preview, skip / shit-show flag, region ordering, per-item detail with independent scroll
- Real-time collaboration with Redis presence, @mentions, HTML note formatting
- Adders checklist + pricing breakdown with mismatch detection, tier adders, 10% threshold warning
- Adder summary sync to HubSpot on manual + auto-sync; adder fields plumbed through prep, preview, skip/re-queue
- Meeting-hub sessions scoped to Colorado / California / all; sales folder, PM task on sync, open-all links
- Accidental-meeting recovery: dedupe, auto-join, end-without-sync, two-click confirm
- IDR Meeting Search History, SS note line, ops revision notes
- Shit Show Meeting Hub spun out as separate flow with IDR snapshot helpers, auto-snapshot on session create, decoupled queue
- Open access to all authenticated roles; survey Zuper link, design approval status, tag fix
- Photos full-width layout, standardized AC disconnect on TGN3322R

### Admin Workflow Builder (Major)
- Phase 1–16 of visual workflow builder on Inngest runtime
- Phase 1–2: backend scaffold + editor UI + CRUD API
- Phase 5: control-flow (delay, stop-if) + additional actions
- Fan-out webhooks for HubSpot + Zuper triggers, per-run detail page with step drill-in, step reordering, cross-workflow run history
- Palette expansions: send-email, ai-compose, http-request, find-hubspot-contact, fetch-zuper-job, update-hubspot-*, add-note, create-task, update-zuper-property, run-bom-pipeline, log-activity
- Templates library, workflow duplication, dry-run mode, dynamic option re-fetch, unified property options
- CRON trigger + dispatcher, CUSTOM_EVENT trigger + emit helper
- Best-effort idempotency via DB checkpoints, action-level idempotency for creates, per-workflow rate limiting
- Inngest auto-sync on deploy + manual resync, failure alerts, Zuper property discovery
- Phase 16: JSON export/import, workflow versioning + rollback, analytics dashboard, parallel + for-each control-flow, visual canvas preview, drag-to-reorder
- Ops runbook, Zuper webhook endpoint

### Office Performance TVs (Major)
- New `/dashboards/office-performance/[location]` carousel dashboards for TV displays
- OfficeGoal model for per-office monthly targets
- Data aggregation module, GET endpoint, location slug mapping
- Carousel container with rotation, pinning, keyboard nav
- 4 carousel section components: Pipeline, Surveys, Installs, Inspections with CountUp, ProgressRing, AnimatedBar, AmbientBackground
- Per-person metrics, streaks, achievement callouts, PM/designer/owner leaderboards, metallic podium
- TV-scale header with section color accents + pill navigation, directional slide+fade transitions
- All-locations overview at `/office-performance/all`, per-location carousel adds all-locations slide
- Goals & Pipeline carousel slides, Office Calendar carousel slide, 7-slide carousel on all-locations page
- Live Zuper API compliance metrics replace cache-based path; HubSpot properties for MTD counts, scheduled/assigned, first-pass rate
- California combined SLO + Camarillo dashboard, per-location and aggregate compliance grading with visible score breakdown, OOW usage %
- Statistical audit: turnaround cohorts, uid keying, bounded pass rate; compliance formula rework, remove Bayesian
- Cross-office crew attribution by deal location; 4th hero card, live "Updated" clock across dashboards

### Accounting Suite (Major)
- New Accounting suite + Payment Tracking dashboard + `ACCOUNTING` user role
- Payment Tracking split into Payment Tracking + Payment Action Queue pages
- HubSpot invoices attached to payment-tracking rows, matched to milestones by line item name (incl. PTO + PE)
- Ready-to-invoice attention signals from project triggers; ready-to-invoice, accounts-receivable, payment-data-mismatch dashboards
- Invoice-first bucketing, active-only filter + stage phase pill, preset date-window filter, invoice-dots linking to deal
- Outstanding = invoiced-but-unpaid only (uncapped %), stage labels + sortable columns + All PE Deals section
- PE-deals: split Approved into Fully/Partially Approved, add Approved—Waiting on Payment + Partially Paid + Project Complete sections, M1/M2 filters, Ready-to-Invoice hero cards
- Live ArcGIS EC lookup replaced with static Treasury zip set, show cents; PE portion of deal.amount fix

### Deal Detail + Timeline
- New `/deals/[id]` read-only deal detail page
- 3-tab layout with collapsible photos, site photo gallery via Zuper proxy
- Timeline aggregation with composite cursor pagination — Zuper status history, BOM, schedule, job notes, HubSpot tasks, engagements
- CommunicationsFeed + ActivityFeed + NoteComposer components, POST note with background HubSpot + Zuper sync
- Sync changelog with FIELD_LABELS map for human-readable diffs
- Contact-associated emails in Communications; HubSpot notes moved to Activity feed
- Deal Mirror sync engine for local Deal mirror table; on-demand HubSpot sync when deal not in mirror
- Internal Deal links across scheduler family + remaining UI surfaces
- HubSpot @mention markup stripping; render engagement HTML; auto-expand notes + boolean "Yes" sync fix
- Cross-source cursor overlap band, photo caching, show-all race fixes

### HubSpot Property Custom Object
- HubSpot Property custom object v1 with typeIds for deal/ticket associate
- AHJ/Utility memoization by (state, zip) to cut backfill HubSpot calls
- USER_DEFINED typeIds wired for association writes; drop AHJ/Utility HubSpot-side links

### Comms Dashboard
- Overhauled Comms dashboard to match unified-inbox-live reference
- Expandable message rows, inline actions, sender avatars, entity decoding, By Project view
- Auto-pagination up to 200 inbox messages
- Gmail identity verification during OAuth connect; fail-closed mailbox verification + runtime identity check
- Legacy token verification on first use via Gmail profile check; reject tokens when profile lacks emailAddress
- HubSpot emails outside inbox now included
- OAuth redirect URI derived from request headers

### Roles + Auth
- Phase 1: multi-role access + home-page redesign
- Phase 2: 6 scoped suite roles (DESIGN, PERMIT, INTERCONNECT, SERVICE, MARKETING, SALES_MANAGER) + Sales & Marketing suite
- Runtime-editable role definitions (routes, landing cards, suites) via `/admin/roles`
- Per-role capability overrides + per-user extra route grants
- Legacy `User.role` column dropped; `role` → `roles[]` migration across all callers, back-compat shim removed
- Super-admin break-glass safeguard with UI badge + drawer note, super-admin email withheld during impersonation
- Redirect to last page after login; SALES multi-role survey guard; requiresLocations gate removed

### Admin Shell
- Unified `/admin` landing consolidating `/suites/admin` with in-shell search
- AdminShell primitives batch 1: table, filter bar, detail drawer
- AdminShell primitives batch 2: bulk action bar, form, kv grid, detail header
- `/admin/activity`, `/admin/tickets`, `/admin/directory`, `/admin/audit`, `/admin/security`, `/admin/crew-availability`, `/admin/roles`, `/admin/users` migrated to primitives + drawer-based edit
- `/admin/users` consolidates 3 modals into tabbed drawer; SUPER badge on super-admin rows
- Back-to-home + UserMenu exit affordances in admin shell

### Adders Catalog + Pricing
- Phase 1 governed Adder Catalog behind kill switch
- `/dashboards/adders` catalog UI, DB-backed adder path (opt-in), OpenSolar sync scaffold
- Triage recommendation engine + `/api/triage/*` + rep-facing mobile triage UI + deal-detail embed
- Pricing calculator moved from Accounting to Sales & Marketing suite
- salesChangeAmount field replaces pricing calculator delta
- Adder costs shown inline in checklist (PricingBreakdown removed), adder rates shown when system size unknown
- IN PROGRESS flag on catalog + triage cards

### Site Estimator (Customer-Facing)
- Phase 1 customer-facing solar estimator v2
- Ported pricing + production config from original estimator
- All 5 quote-type flows (Solar, EV, Battery, Expansion, D&R)
- Slim HubSpot properties (14 → 3) + iframe embed mode, customer-facing page title, suppressed internal widgets
- Reliable Places autocomplete + cross-flow nav, NEXT_PUBLIC_GOOGLE_MAPS_API_KEY fallback, Continue-button race resolved via flushSync + hydrated gate

### On-Call Electrician Rotation
- V1 on-call electrician rotations with weekly rotation, self-service swap UI, merged Colorado pool
- Sun-Sat weeks with 6pm-10pm weekday / 8am-12pm weekend shifts
- Per-state Google Calendar staging, calendar.events scope, manual calendar creation
- Emergency call log captured by on-call electricians; admin call logging + HR sheet export
- Admin/executive Activity view — all swaps + PTO requests
- VIEWER role access, shared nav on all 3 pages
- Publish works on large pools + surfaces errors as JSON, data-driven "Schedule starts" message

### Catalog / Product Management
- Phase B: HubSpot manufacturer enum + Zoho categories operational
- Zoho writes switched from group_name to category_id (M3.1); spec-derived custom fields on Zuper product create (M3.4)
- Zoho item update propagates description + part_number; photo push to Zoho on approval
- Zuper spec custom fields written via meta_data (not custom_fields); dimensions on product create
- Phased HubSpot manufacturer enum enforcement; auto-add unknown brands to HubSpot manufacturer enum + notify TechOps
- Race-safe external-record create + link-back; cross-link writer extracted, wired from Sync Modal
- Sync observability enums + watermark columns; Sync Modal executions logged to ActivityLog
- Zoho item image backfill from historical pushes; Zoho orphan reconciliation (302 new InternalProducts + Zuper)
- Data hygiene: test product removal, casing, Generic rebrand, integrity audit + auto-fixable repairs
- Sales product request page (equipment + adders → OpenSolar) with cost estimates + deal lookup
- Photo upload works against private Blob store; force-dynamic + email-from-requester on request-product

### Permit Hub + IC Hub
- `/dashboards/permit-hub` two-pane workspace for permitting team
- Shared inbox thread fetch on correspondence tab; resolved names + header quick-links + AHJ fallback
- Inline action panel, permit-lead filter, sticky action panel, grouped queue, multiselect location
- Queue aligned with daily-focus email, action-panel overlap fix
- Per-inbox OAuth workaround for blocked DWD scope; broadened Gmail OR context search
- Interconnection Hub v1

### Scheduler + Maps
- Jobs proximity map Phase 1 (installs + service + crews)
- Phase 2+3: Week/Backlog, tickets, inspection/survey, UX polish
- Dispatcher office pin, morning briefing, nearby highlights, D&R + roofing markers, shop filter
- Assignee filter + scheduled-today markers never cluster; call + add-note quick actions
- Office pins at real street addresses; Zuper crew name resolution; RTB-Blocked excluded from schedulable
- Timezone-agnostic date comparison + per-kind count breakdown
- Group scheduler overlay filters; flag overdue/completed Zuper overlay jobs
- Site-survey scheduler per-office daily cap + crew schedule updates; narrow availability lanes by top location filter; CA cross-office block
- Persist Zuper assignment metadata on confirm; pending Zuper survey holds handled locally with slot fallback + downstream follow-up
- Scheduler day-cell availability filtered by project location; ScheduleEventLog captures Zuper reschedules + crew changes
- Multi-crew install emails collapsed into one send
- Scheduler clicked-event milestone status shown instead of deal stage

### Service Suite
- Split into sections and swapped Solar Designer for Solar Surveyor
- Service scheduler state toggles + ticket links + collapsible sales pipeline card
- Service scheduler deal/ticket detection, assignees, Scheduled Date column, week/day views, contact link
- Service Overview Deals/Tickets filter on priority queue
- Compliance v2: per-service-task scoring + status bucket fixes (flag-gated)
- Service-team sales pipeline card + last-communication preview
- Service SO anchored on PROJ-XXXX with pipeline prefix preserved
- Jessica meeting followups + scheduler colors + unassigned KPI + BOM design_status trigger + contact-day fix
- New `SERVICE` user role scoped to Service Suite

### SOP System (Phase 3+)
- WYSIWYG TipTap editor replaces raw HTML CodeMirror
- Auto-link `<code>/route</code>` mentions to actual app pages
- Split Tech Ops tab into Design / Permitting / Interconnection tabs
- Hub-mode visibility open by default
- Submit-a-new-SOP feature with admin review queue; Drafts tab with PM Guide rewrite + Pipeline Overview
- Role-gated SOP tabs and sections (stop info leaking to wrong teams)
- Batch SOPs: Catalog, Service, Scheduling, Forecast, AHJ & Utility, Executive, Accounting, Sales & Marketing, Suites overview, Action Queues, Submitting a New Product, meta "How to Use"
- Tools tab extensions: BOM, AI Design Review, Pricing, P&I Hubs, Surveyor, Schedule, Optimizer, Map, Workflow Builder, Property Drawer, Deal Detail, Equipment Backlog

### D&E Metrics + Design
- DA first-try split into customer vs design + rework attribution
- Needed Sales/Ops Changes on DA summary row
- Current DA Pipeline summary cards with click-through drill-down
- Not Yet Sent bucket + exclude already-approved from pipeline
- PM + Tech Ops API access to `/api/hubspot/da-rework-flags`; numeric dealId coerced to string
- Production Issues dashboard in Design suite

### PM Suite + PM Flags
- Project Management Suite landing page
- HubSpot deal links + owner-id assignment fallback + missing-PM seed
- Exception-based PM assignment system: null-safe booleans, aggressive thresholds, stage-id fix, compound-risk + shit-show rules
- Live mode — page-load eval replaces daily cron
- PM Accountability dashboard + weekly digest (Phase 1)
- PM queue reconciliation off page-load, milestone evaluation fix, accurate at read time

### My Tasks + Freshservice
- Personal HubSpot tasks dashboard at `/dashboards/my-tasks`
- Inline status + queue edit, keyboard shortcuts, URL state, count badge in Suspense-wrapped useSearchParams
- Snooze, create, completed-this-week, bulk done, sort modes, deal-stage filter
- Typeahead lookups + New Task from deal panel, mark complete, autofocus first row, admin-managed queue names
- HubSpot owner resolved via full-list match + `first.last@domain` alias fallback + name lookup fallback
- Freshservice `/dashboards/my-tickets` user-facing view; UserMenu badge + admin page for user's own tickets
- Tickets assigned to me (not filed by me); include Closed tickets + Closed filter chip; overdue not shown on Resolved/Closed
- Explicit HubSpot owner link per user

### EagleView + TrueDesign
- EagleView TrueDesign auto-pull pipeline (Tasks 1-9)
- `EagleViewPanel` rendered when `?dealId=` URL param set on solar-surveyor
- Deal-style HubSpot address field reads
- Rollout runbook shipped

### Enphase / Property / BOM
- BOM SO includes suggestedAdditions when building Zoho SO line items
- BOM: use TGN3322R as standard 60A disconnect, decouple from service-tap detection
- Inngest BOM workflow engine spike behind `INNGEST_BOM_ENABLED` flag

### Territory Map + EOD
- Territory Map dashboard for CO office boundary analysis in Executive suite
- Full-width zones with both boundary sets + labels, office star markers, AI analysis, bolder wider zones
- CSP allows Google Maps; standard Markers instead of AdvancedMarkerElement
- Stage IDs resolved to labels via shared active-stage config
- EOD email restructured by person, attribution to deal's role-property owner, Natasha added, Daniel removed
- Signal-to-noise improvements for EOD email
- Daily Focus PE M1/M2 sections for Layla's morning email

### IT / Audit
- Read-only activity-log export API for IT team
- Audit-sessions, anomaly-events, user-roster endpoints
- User attribution + feature-request option on feedback

### Funnel + Surveys
- Rolling-day cutoff replaces calendar-month
- Implied progression: approved implies sent implies surveyed
- Drill-down deal lists for each backlog bucket
- Survey completion rate excludes carryover from prior months

### Housekeeping + Fixes
- Renamed PB Operations Suite → PB Tech Ops Suite
- Auto-reload pages on new deployment
- Suites: Sales & Marketing simplified to 4 focused cards; Executive, Accounting, Operations role scoping tightened
- Home page stripped to suite cards only; SUITE_MAP reconciled with dashboards
- TSRF Peak Power Calculator in D&E + Service suites
- StatCard values shrink on md/lg so 5-up hero grids fit
- Adaptive pill density for fixed-height TV slides; office-calendar shows Roofing + Other Zuper jobs
- Bug report emails sent from the reporter; hubspot-engagements 4xx errors surfaced to Sentry
- HubSpot portal labels for design_status + layout_status
- PE turnover readiness skill with audit and assembly

---

## 2026-03-31

### Design Pipeline Funnel (Major)
- New Design Pipeline Funnel dashboard with conversion arrows, cohort table, and monthly grouped bar chart
- Backlog callouts, DA pacing (computed from actual approval dates), cancelled revenue tracking
- Multiselect locations, pacing revenue, stage distribution, drill-down deal lists per backlog bucket
- Timeframe clarity with expanded options and pending sales change tracking
- Implied-progression logic so approved implies sent implies surveyed; rolling-day cutoff replaces calendar-month
- Suite navigation links wired into Executive and D&E suites; canonical location handling and lookback fix

### EOD Summary Email (Major)
- New end-of-day summary email cron with milestone detection, HubSpot property history enrichment, and completed-task search
- Morning/evening `DealStatusSnapshot` diff with idempotency and reclaim-on-failed auto-retry
- Restructured by person with per-person task and status change counts, trimmed names, Natasha added / Daniel removed
- Attributes changes by who made them; stage ID fixes

### Cross-System Sync Relay (Major)
- Full SyncModal rewrite with plan-based flow, auto-cascade, per-cell source selection, and stale detection
- Snapshot builder, mapping table with normalizers/generators/transforms, plan derivation engine with conflict detection and hash
- POST /sync/plan endpoint, GET /sync extended with snapshots + defaultIntents, plan-hash confirmation tokens
- 10 new mapping edges; Zoho part_number and unit now bidirectional
- SyncModal polish: wide comparison table, value-based dropdowns, column separation, effective-internal values view
- Product search and linking for unlinked systems; generator rows converted to regular dropdown rows and toggleable
- Legacy sync API paths removed

### Service Suite Enrichment
- Shared enrichment layer plus Zuper cache sync (Vercel cron every 30 min)
- Daily focus email cron for P&I and Design leads
- Site survey readiness checker and FDR webhook; bearer-token auth on readiness webhooks
- Install photo review webhook for Inspection stage (direct call replaces self-referential fetch)
- Deferred items shipped; Zuper jobs-by-category API returns all assigned users
- Zuper Compliance page opened to Executive and Ops Manager
- Nick surveyor assignment and Camarillo construction crew list fixed

### Accounting Suite & PE Deals (Major)
- New Accounting Suite with PE Deals & Payments dashboard opened to all roles
- PE deals M1/M2 status dropdowns with HubSpot sync; PE payment properties sync to HubSpot on page load
- Compact PE deals table (truncated names, short locations/types, header/cell alignment)
- Pricing calculator page + energy-community API route; EC lookup switched from Census to Zippopotam.us and inlined
- PE deals filtered by Participate Energy tag instead of HAS_PROPERTY
- Deal amount now compared against full EPC price, not customer pay

### Pricing Calculator Deal Import
- Deal import search bar, comparison banner, auto-populate from HubSpot line items
- Combined code+label tokens for matching; query-length guard

### Master Scheduler
- Service & D&R job overlays on master schedule (Zuper-sourced) with distinct styling in month/week/Gantt
- Overlay detail state, color helpers, read-only popover with time window
- Collapsible project sidebar with localStorage persistence
- Service and D&R toggle buttons on calendar toolbar; localStorage-persisted toggles
- Per-status revenue cards, completed month/year stats, overdue revenue on construction scheduler
- Alias-aware location mapper for overlays; Camarillo survey slots no longer bleed SLO availability
- Construction scheduler month-view off-by-one day alignment fixed

### Catalog & Sync
- Approval sync bug fixes plus Zoho↔Zuper cross-link; response validation now fails loudly instead of silently ignoring
- Numeric field whitelist for type coercion; string-typed numbers coerced before Prisma Float writes
- Zuper preview field mapping corrected for `product_*` prefixed API response
- Selective sync with per-field direction controls
- Missing Zuper product categories auto-created; fallback map updated
- Vendor pull fails safely without companion `zohoVendorId`

### Zuper Status Comparison
- Fail-date cross-check between Zuper and HubSpot with dedicated columns
- HubSpot-ahead filtering, 1-day tolerance, timezone drift fix (UTC → Mountain)
- `external_id.hubspot_deal` used for Zuper job linking, project_number fallback when missing
- Zero-value stat cards hidden; superseded grouping fix; admin job endpoints added

### Metrics Dashboards
- Preconstruction metrics dashboard; execution/metrics table reshuffle
- Design Approval metrics dashboard with location filter, sortable columns, stage column
- Site survey turnaround metrics dashboard; unified stat cards with StatCard and location filtering
- Inspection metrics dashboard with drill-downs, action queues, and dual-source validation
- 11 inspection deal properties added to HubSpot client; Location custom object + AHJ inspection properties
- Construction metrics: RTB → Const Start, CC → Inspection Passed, drill-down, Zuper links, filter by construction complete date
- Polish pass on execution pages: StatCards, status pills, action table reorder

### DashboardShell Phase 2
- Suite accent header, PB badge nav, title border, mobile stacking
- Suite page visual polish Phase 1
- Hero MetricCards promoted to StatCards on executive and pi-metrics dashboards
- MetricCard tiers differentiated with href/null support; SummaryCard removed

### Revenue Goal Tracker (Major)
- New RevenueGoalTracker with progress-rings and thermometer-bar hero variants, monthly breakdown chart, canvas fireworks on goal hits
- Admin config GET/PUT for targets; GET /api/revenue-goals with caching and auto-seed
- Zuper-based recognition for Service and Roofing groups; widened search window for cross-year completions
- Pipeline and stage filters enforced on Zuper-linked deals; 1-indexed months, deduped HubSpot filter groups
- SuitePageShell gains `heroContent` prop; monthly bars scaled to actuals not targets
- Multi-select filter, approx labels, stacked bars, dropdown-clipping fix

### BOM Pipeline & Zoho SOs
- Warehouse-aware Sales Orders and SO API improvements
- CREATE_PO step gated to RTB trigger; manual retry preserves prior PO state; PO summary added to notification emails
- Preferred-vendor PO splitting — BOM items auto-split by Zoho vendor
- Service Catalog + SO Creation Phase 4; auto-populate SO slide-over from HubSpot line items
- SO creation now sets proper product names, uses Zoho-sourced totals, adds automated notes
- Zoho SO numbers use `SO-{projNumber}` format; HubSpot deal record ID included on SOs
- Contact-based customer resolution reused for service SOs; any product category allowed
- BOM pipeline webhook restored with route alias, dual auth, and health monitor; workflow/Tray payloads accepted
- Cross-system product pricing comparison endpoint; Zoho pricing quality audit endpoint (with `?format=csv`)
- BOM push to HubSpot with UI, migration, and role fixes
- BOM catalog matching helpers extracted; `parseBomTag` and `fetchLineItemsForDealStrict` helpers added

### Customer History v2
- Contact-based customer 360 lookup replaces address-based
- Multi-entity search + grouping, company contacts with address scoping, deal/ticket/Zuper association resolution
- Address-only detail lookup, Zuper job links, contact address search
- Detail endpoint self-resolving; customer address shown in slide-over header
- Deal-derived address precedence documented as known limitation

### Service Suite Phase 1+2
- Suite split, priority queue, tickets
- Pipeline-ordered stages + active-only toggle; dynamic pipeline stage resolution from HubSpot API
- Dynamic stages + multiselect filters on service pipeline
- Filters moved to header, score explanations, "coming soon" cards removed
- Ticket owner column and multiselect filters on service pages
- Owner filter scoped to owners present in ticket/queue data

### SOP Guide
- API access control, stale editing, mobile nav, editor a11y
- Tab visibility model: public tabs for all, PM Guide gated by name, TECH_OPS-only Tech Ops tab
- Visual indicators for role-specific and admin-only tabs; admin-only sections hidden for non-admins
- Sales merged into Other Pipelines; Zuper merged into Operations; Workflows merged into Reference
- Renamed to SOP Guide, centered search bar, PB brand theme applied, Pipeline Stage Flow overlap fixed
- D&E workflows documented; surveyor resolution fixed; VIEWER role test updated
- Emojis removed from HubSpot deal record diagrams

### Scheduling
- Pre-sale site visit Zuper flow; pre-sale HubSpot writes narrowed to schedule date only
- Forecast ghosts for all pre-construction stages
- Survey reassignment notifications sent to both surveyors
- Live Zuper email preferred over stale local CrewMember records
- Zuper last-name-only job matches now require address corroboration

### Forecast & Home
- Forecast schedule page with pipeline breakdown
- Home page shows skeleton during pipeline fetch instead of false zero
- Per-pipeline stat cards, clickable links, sticky table header
- Pipeline selector & per-pipeline stage sorting

### Product Catalog Rename
- Phase 1: `EquipmentSku` → `InternalProduct` model rename
- Phase 2: user-facing SKU → Product language
- Phase 3: `/api/inventory/skus` → `/api/inventory/products`
- Phase 4 physical DB rename plan drafted
- Catalog form validation: numeric ranges, inline errors on Basics/Details steps, photo file size/type validation, vendor pair warning
- Stale `zohoVendorId` detection with re-select hint

### Security & Infrastructure
- Role recovery endpoint now requires `ADMIN_RECOVERY_CODE`
- Non-auth secrets removed from token key fallback chain; private keys fully redacted in debug endpoint
- Priority override routes gated by role
- OWNER enum deserialization fix (460 Sentry events resolved); OWNER→EXECUTIVE rename with SALES_MANAGER migration
- Edge-runtime JWT role stuck at VIEWER fixed
- Suite card routes added for OPERATIONS and OPERATIONS_MANAGER; `/dashboards/construction` opened to same
- qc-metrics API access granted to roles with construction-metrics dashboard
- Refetch intervals tiered — 15 min for low-volatility dashboards
- Sales funnel memoized; deal-import optimized; equipment query safety cap with `hasMore` flag
- `SolarFeedback(status, createdAt)` index added
- ESLint extended with no-unused-vars and no-console; `noUnusedLocals` enabled (82 violations fixed)
- Core dependencies upgraded
- Pipeline-health cron alert skipped on weekends
- Planset size guard and Zoho token/cache refresh dedup

### Bug Fixes
- DTC location mapping corrected to Centennial
- Deals page: owner and PM filters applied on all pipelines
- Hard navigation for Master Schedule and scheduler cards
- KPI cards replaced with real metrics
- Solar Surveyor removed from SALES role; all roles granted access to deals page
- Zoho Inventory URL patterns corrected
- `renderToBuffer` type cast for Turbopack strict mode
- Neon adapter passed to PrismaClient in backfill script (Prisma 7 compat)
- `daysSinceStageMovement` floored instead of rounded
- Missing `locations.ts` restored for `access-scope.ts`

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
