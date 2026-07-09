# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-06-15

### PE File Preparation & Analytics (Major)
- New PE & Compliance Suite consolidating PE prep, doc tracking, and compliance dashboards
- PE Analytics dashboard with weekly funnel views (Lifecycle, Submissions, Approvals, Rejections, Ready cohorts)
- Submissions/approvals/rejections charts bucketed by accounting + `pe_m*_paid_date` properties
- Aggregate drill-down from totals cards, segment-level drill on weekly charts, bar drill-downs to deal lists
- PE Doc Uploaders dashboard with submissions/by-time/by-doc-type views, day/week/month grain, distinct-deal counts
- Per-uploader approval/rejection outcomes, owner vs shared credit toggle (fractional by version), admin owner-override
- Short-pay tracking so PE Revenue Collected reflects actual dollars; wired into Deals & Payments tab
- Rejections-by-Document drill (open/resubmitted/approved), clickable rejections with open/resolved drill
- "By Document" view on Docs page surfacing Missing + Open Rejections per doc, exported per view (Copy/CSV)
- Address-based project matching + auto-stamp PE portal links into HubSpot deals
- Doc version history + uploader attribution pulled from PE API
- API sync writes NOT_UPLOADED rows for omitted docs, pushes statuses to HubSpot deal properties, fresh-on-visit sync
- Manual "Sync now" button + waive moot docs on done milestones; M2 docs gated to Close-Out+ (PTO owes M1 only)
- Single PE dashboard hub (retired separate pe-report); collapse-by-default groups across Sections, By-Team, Deals

### Project Pipeline Funnel & D&E Funnel (Major)
- Project Pipeline Funnel tabbed dashboard: Active Pipeline + Monthly Throughput cohort views
- Funnel hero cards (12-stage), conversion as arrows between milestones with conv/cancelled/pending splits
- All-active-deals snapshot mode, cohort tables with conversion %, location matrix, days-in-stage
- Bottlenecks tab, Sales Funnel tab (sales-cohort funnel), Revenue Conversion by Cohort table
- Drill-downs on Current Pipeline Position + blocked/on-hold reasons; surface deals cancelled at each gate
- Per-pipeline stat cards with PM/owner filters, trend vs prior, URL state, by-location hero matrix
- Status breakdown, clickable connectors, sortable backlog columns, % conversions, calendar-timeframe fix
- D&E funnel with revision loops; Awaiting Site Survey/Design Upload/Design Review buckets matching Project Funnel styling
- On Hold pulled into its own group with on-hold % split of pending; RTB-Blocked + Pending Sales Change flags
- Interconnection rendered as a parallel workstream with throughput columns and backlog IC status

### Tech Ops Bot (Major)
- Renamed from OOO bot — full assistant bot with process-request filing
- HubSpot task creation via bot, resolved by deal customer name or address
- Tools: count_deals_by_status (DA/design/permitting), revenue rollups, milestone date-range queries, location filtering
- Encoded DA lifecycle phases (Review In Progress = pre-send), full-pipeline status coverage (construction/inspection/PTO)
- PE M1/M2 milestone status breakdowns, log_correction tool to capture in-chat corrections
- Admin Bot Escalations review dashboard + Corrections tab with Apply-to-playbook button
- Data-integrity prompt rule; never fabricate task creation; exact deal matching; lead with `waitingToBeSent` on DA questions
- Scope conversation history by space (not thread), assign created tasks to the requester via shared resolver

### PE Doc Tracking & Sync
- Mirror digest email with actionable sections + Drive links per deal; 4-section restructure
- Merge UPLOADED + UNDER_REVIEW into a single "In Review" status; relabel notes-only changes
- Daily activity throughput dashboard + Monthly Activity throughput dashboard
- Drop Today's Changes from digest; ignore PE scraper boilerplate notes

### Shop Health
- Service + D&R/Roofing sections; lightweight overview path (1 Project fetch, no tickets)
- Fail-open on new Service/D&R fetches; stop duplicate Project pipeline fetch; cache closed tickets

### Page Traffic & Identity
- Page Traffic analytics dashboard (admin) — views, dwell, dead-weight, per-user
- Directory identity links: User ↔ HubSpot owner / Zuper user / CrewMember
- Centralize Claude model IDs, replace retiring Sonnet 4, bump to current models

### On-Call
- Monday-start weeks; drop California Sunday coverage

### Bug Fixes
- Vercel missed merge webhook re-trigger for production deploy
- Funnel page 504/blank — give full-fetch routes the 300s budget
- Funnel filter 504, reconcile Sales Closed, conv/cancel rates, Deal Owner column
- Cached Project reader missing blocked/on-hold reason fields
- Funnel: cancelled deals counted as having reached every milestone

---

## 2026-05-29

### PE File Preparation (Major)
- PE File Preparation — AI vision audit, PandaDoc auto-pull, prep dashboard
- PE Prep landing page (deal queue + audit history overlay), filter by deal stage not portal status
- PE audit splits into docs + photos pipelines with independent timeouts
- PE Approved Vendor List dashboard page; few-shot reference library + AVL cross-check in vision classifier
- PE Submission Gap report — CC-hit deals with incomplete M1/M2 (M1 includes Close Out, 4-tab split with dollar amounts)
- Deep PE verification for photos and documents; auto-trigger cross-ref after PE audit completion
- PE Cross-Reference MVP: PlansetAnalyzer (P10/P10B/P10C), HardwareAnalyzer (P1/P6), SalesOrderAnalyzer (P2-P5/P7/P8/P9), InboxScanAnalyzer
- Two-way PE document status sync with HubSpot deal properties; switch action items to scraper source
- Performance: batch photo triage (1 API call replaces 36+), pre-upload photos + cache Anthropic file IDs, vision concurrency 6→10
- PandaDoc per-template search strategies, multi-template-id support, customer-name fallback
- PE Raceway API sync replacing HTML scraper; incremental sync + hourly cron; PE portal CSV import
- Instant email notification on PE doc status changes; show time since last update on PE Doc Update email

### Tesla PowerHub Integration (Major)
- Tesla PowerHub fleet monitoring integration with live API alignment
- PowerHub API client with OAuth2 client_credentials auth (no mTLS), JWT auth, rate limiting, Fly proxy in dfw region
- Three-tier site-to-deal linkage with auto-link, geo-coordinate matching via portal-imported lat/lng
- Asset/telemetry/alert sync orchestration with batch sizes tuned to avoid Vercel timeouts
- PowerHub alert scoring fed into service priority queue
- Site detail enriched with HubSpot deal, property, contacts, system details, every Tesla device on site (part #/serial #)
- Full telemetry + equipment summary; derive battery SoC from energy-remaining when SoC signal missing
- Cross-system Tesla portal URL linking (HubSpot + Zuper + Suite); native Tesla PowerHub HubSpot UI Extension card
- Push all Tesla device serials + models to Zuper Property/Job; compact Tesla PowerHub HubSpot sidebar card
- Admin linkage manager, SystemHealth embed, three cron handlers (asset sync / telemetry / alerts)

### Enphase Enlighten Integration (Major)
- Enphase Enlighten API integration at PowerHub parity
- Partner OAuth setup route for installer auth flow
- See CLAUDE.md System 12 for architecture: OAuth2 refresh token rotation, telemetry/asset/status crons, HubSpot card

### Project Pipeline Funnel (Major)
- New Project Pipeline Funnel (9-stage sales-to-construction) on Executive suite
- Monthly Activity table, named timeframe presets, close out + activity table + drill-down dates
- Staff assignment columns to drill-downs; survey scheduled stage; hero card layout cleanup
- Awaiting DA Send column shows design approval status

### Property Hub & Shop Health
- Weekly Shop Health Dashboard with bottleneck entries (multiple per shop per week)
- Drill-down tables to all count-based metrics, Customer Success metrics, sentiment/5-star/response time
- Wire contact response metrics into Customer Success; rename Permits Approved → Permits Issued
- Customer Success section with sentiment scoring and 5-star reviews; revenue hero card + pipeline revenue detail
- Property Hub — full-page property view at `/properties/[id]`, map/stages/ID lookup/rollup fields
- Property Hub header with equipment summaries, revenue, Zuper link; Photos tab with Zuper job photos
- Zuper Property sync (write direction); link Zuper projects to properties during sync
- Inngest queue for property sync workflows; workflow-sync endpoint for HubSpot workflow-driven property sync
- HubSpot Property line items in Equipment tab; contact names + HubSpot link in Property drawer

### PE Deals & Pipeline Tracker
- PE Deals: multi-column sort, Cust Paid sort, Awaiting PTO segment, Customer Paid? column
- Split PE Deals card into Pre-Construction vs Construction+; pipeline bar into stage buckets
- General Pipeline Tracker dashboard + Site Survey/Construction/Inspection tabs
- Per-stage revenue in PE Pipeline hero cards; construction & inspection status columns on PE Tracker
- TV dashboard: rich deal list with Zuper status, PE flags, unified layout

### IDR / Design Approval
- IDR revision workflow — re-review toggle, auto-appear, revision reason sync, RE-REVIEW badge
- IDR sync completes HubSpot task + IDR Meeting design revision toggle with auto-advance on sync
- Compare planset layout against DA layout in design review
- Previous review notes for re-reviews + richer search results; resolve design/permit lead names
- BOM Review & Line Item Editor in IDR Meeting Hub

### Scheduler
- Sub-job tentative scheduling and `syncToZuper` toggle; tentative vs live mode visually obvious across schedulers
- Show orphaned resurvey/re-inspection jobs in master scheduler; editable date picker on drag-drop reschedule
- Pre-sale survey cards rendered on calendar with dedup + click modal
- Weekend visibility toggle without stealing Monday; default scheduler Zuper sync to tentative mode
- Crew schedule dashboard — see where every crew member works each day
- Two-tier base + stretch goals with gold progress bar

### Google Chat OOO Bot
- Google Chat OOO bot — handle Workspace add-on envelope format, multiple JWKS sources for JWT auth
- Async error capture to DB + detailed Chat API errors; post replies to main timeline

### EagleView Integration
- EagleView Orders dashboard page; sandbox integration test page for Go-Live proof
- TrueDesign auto-pull pipeline (Tasks 1-9); production PlaceOrder request format

### Zuper Performance
- Reduce Zuper API calls ~97% by caching job list in lookup endpoint
- Per-endpoint API call counter + admin read endpoint; explicit caller attribution in `[zuper-call]` log
- Throttle Zuper crons (property-sync /15min→/30min→/6h, job-backfill hourly→every 6h, sync-cache 30m→4h)
- Cache `/jobs/by-category`, skip API sweep on DB-cache hits

### On-Call & Aircall
- Aircall executive call analytics dashboard (Phase 1+2); per-user answer rate via ring tracking
- Import Analytics+ ringing-attempts CSV for historical data
- On-call auto-create HubSpot service ticket on follow-up; emergency call log

### Customer Portal & Brand
- Customer survey portal redesign — brand palette to match photonbrothers.com, subdomain isolation, inline cancel
- Service-to-service survey invite endpoint

### Bug Fixes
- Fix completed Zuper jobs showing as overdue on scheduler
- Fix Jinko manufacturer typo, raise catalog limit to 2000
- HubSpot card v3 sig — sign with URL+body candidates via `@hubspot/api-client` Signature.isValid
- PE scraper PROJ number matching + ghost filtering; rewrite parser for flat single-table HTML
- Disable then re-enable project-to-property linking in Zuper sync (safety checks added)

---

## 2026-04-30

### Admin Workflow Builder (Major)
- Visual workflow builder with editor UI + CRUD API (Phase 2)
- Inngest-backed executor walking `definition.steps` with control-flow, delays, stop-if
- 10 actions + 2 control-flow kinds: send-email, ai-compose, update-hubspot-property, update-hubspot-contact-property, add-hubspot-note, create-hubspot-task, update-zuper-property, run-bom-pipeline, log-activity, http-request, find-hubspot-contact, fetch-zuper-job
- Triggers: MANUAL, HUBSPOT_PROPERTY_CHANGE, ZUPER_PROPERTY_CHANGE, CRON, CUSTOM_EVENT
- Per-run detail page with step output drill-in; step reordering + cross-workflow run history
- Workflow versioning (snapshot on save + rollback), per-workflow rate limiting, dry-run mode
- Failure alerts, action-level idempotency for create-actions, parallel + for-each control-flow
- Export/import workflow JSON, drag-to-reorder on canvas, visual canvas preview
- Template library + duplicate workflow + analytics dashboard
- Webhook fan-out for HubSpot + Zuper triggers; Inngest auto-sync on deploy + manual resync button
- Dynamic option re-fetch + unified property options (select/multiselect dropdowns)

### IDR Meeting Hub (Major)
- IDR Meeting Hub frontend — page shell, queue, detail, forms, dialogs
- IDR Meeting API routes — sessions, items, sync, readiness, notes, search
- Real-time collaboration, HTML note formatting, @mentions, Redis presence
- Meeting prep queue with escalation + design review support; DA status actions; dense two-column layout
- Rename to Design & Ops Meeting Hub, line items, full names, UI polish
- Adders Checklist + Pricing Breakdown integration; sync adder summary to HubSpot on manual + auto-sync
- Adder fields through prep, preview, skip/re-queue paths; widen `lineItemsQuery` to include sku/price/amount
- Tier adders, 10% threshold warning, SS note line, ops revision notes
- Survey Zuper link, design approval status, tag fix
- Recovery from accidental "End without syncing" + two-click confirm; open access to all authenticated roles
- IDR meeting search history; start meeting scoped to Colorado, California, or all
- Sales folder, PM task on sync, open-all links; previous review notes for re-reviews
- Standardize AC disconnect to TGN3322R; full-width photos layout
- HubSpot roof type auto-populate, adder amount property, % of deal + waiver warnings
- Replace static "Updated" timestamp with live clock on all dashboards

### Solar Designer (Major)
- Solar Designer multi-stage design tool (Core Engine → Visualizer/Stringing → Production/Timeseries/Inverters)
- V12 built-in equipment catalog (8 panels, 9 inverters, 6 ESS), DXF/JSON layout parser, CSV shade parser
- Auto-string algorithm with voltage validation, clipping event detection, timeseries aggregation
- Web Worker entry point, mismatch module, V12 parity tests
- Visualizer with shade animation + satellite background, MapAlignmentControls, PanelCanvas SVG renderer
- StringingTab with click-to-assign + auto-string; StringList sidebar with voltage validation badges
- ProductionTab with summary cards + paired bar chart; TimeseriesTab with period toggle + date navigator
- InvertersTab with MPPT cards + reassignment + clipping
- Per-panel shade CSVs (`shading_A_IPXXXX.csv`) with format auto-detect; zip + folder upload
- Vercel 4.5MB body limit bypass via Blob client upload; client-side layout parsing
- EagleViewPanel renders when `?dealId=` URL param is set

### Office Performance (Major)
- TV-scale Office Performance carousel — pipeline / surveys / installs / inspections sections
- ProgressRing, CountUp, AnimatedBar, AmbientBackground components
- PM/designer/owner leaderboards with staggered entrance and metallic podium
- Per-person metrics, streaks, achievement callouts; deal drill-down lists
- 7-slide carousel on all-locations TV; Goals & Pipeline carousel slides; per-location all-locations slide
- Office Calendar carousel slide; Service carousel slide; replace Pipeline Overview with Team Results slide
- Live Zuper API metrics for compliance (replacing cache-based); OOW usage %, side-by-side layout
- OfficeGoal model for per-office monthly targets; cache-first fetching to cut load time
- Statistical audit — turnaround cohorts, uid keying, bounded pass rate
- Combine SLO + Camarillo into single California dashboard; cache warming cron to fix 504 death spiral

### Deal Detail / Activity Timeline
- Deal Detail page — read-only deal record view with 3-tab layout + collapsible photos
- Deal Activity Timeline & Notes with composite cursor pagination across HubSpot, Zuper, BOM, schedule
- `POST /api/deals/[dealId]/notes` with background HubSpot + Zuper sync; NoteComposer with @mentions
- DealNote model; CommunicationsFeed for HubSpot engagements; ActivityFeed with pagination
- Site photo gallery + Zuper photo proxy; Zuper status history + BOM + schedule timeline fetchers
- Human-readable labels in sync changelog diffs; strip HubSpot @mention markup from engagement HTML
- HubSpot tasks + Zuper job notes in Activity; on-demand sync from HubSpot when deal not in mirror
- Internal Deal link across scheduler family, HubSpot/Zuper link surfaces; auto-reload pages on new deployment

### HubSpot Property Custom Object (Major)
- HubSpot Property custom object v1 — see CLAUDE.md System 10 for architecture
- Geocode → resolve-geo-links (PB shop, AHJ, utility) → `upsertPropertyFromGeocode` pipeline
- `HubSpotPropertyCache` + PropertyDealLink/PropertyTicketLink/PropertyContactLink with ownership labels
- Memoize AHJ/Utility by (state, zip) to cut backfill HubSpot calls
- Explicit USER_DEFINED typeIds for deal/ticket associate; drop AHJ/Utility HubSpot-side links
- Verify address match for single-candidate property links; remove stale deal/ticket links during reconcile
- Replace PendingPropertyOverride cron with HubSpot workflow properties

### Multi-Role Access (Major)
- Phase 1 multi-role access + home-page redesign — `user.roles[]` across all callers (Part 2A/2B)
- Drop `User.role` column (Option E); per-role capability overrides (Option B); per-user extra route grants (Option D)
- Read-only Role Inspector at `/admin/roles`; runtime-editable role definitions (routes, landing cards, suites)
- 6 scoped suite roles + Sales & Marketing suite (Phase 1)
- Super-admin break-glass safeguard with UserMenu badge; ACCOUNTING role; SERVICE role scoped to Service Suite
- Unified AdminShell + `/admin` landing + in-shell search; consolidate `/suites/admin` into `/admin`
- Admin primitives — table, filter bar, detail drawer, bulk action bar, form, kv grid, detail header
- `/admin/roles`, `/admin/crew-availability`, `/admin/audit`, `/admin/security`, `/admin/tickets`, `/admin/directory`, `/admin/activity` refactored

### Accounting Suite
- Accounting Suite with PE Deals & Payments dashboard; ACCOUNTING user role
- Payment Tracking dashboard; Payment Action Queue page; ready-to-invoice attention signals
- Invoice-first bucketing + 3 new accounting pages; attach HubSpot invoices to payment-tracking rows
- Match invoices to milestones by line item name (incl PTO + PE); active-only filter + stage phase pill
- Sortable columns, All PE Deals section, stage labels, simplified payment-tracking layout
- Per-stage revenue, hero cards (Ready to Invoice + collected/outstanding subtitles)
- Pricing Calculator moved to Sales & Marketing suite

### Sales & Marketing Suite
- Customer-facing solar estimator v2 with all 5 quote-type flows (EV, Battery, Expansion, D&R)
- Slim HubSpot properties (14 → 3) + iframe embed mode; reliable Places autocomplete; pricing + production config
- Sales product request page (equipment + adders → OpenSolar) with cost estimates + deal lookup
- Move Pricing Calculator from Accounting to Sales & Marketing suite

### EagleView Imagery
- EagleView Imagery API integration — TrueDesign auto-pull pipeline (Tasks 1-9)
- Read deal-style HubSpot address fields; rollout runbook

### Map & Territory
- Jobs proximity map Phase 1 (installs + service + crews); Phase 2+3 — Week/Backlog, tickets, inspection/survey
- Dispatcher office pin + morning briefing + nearby highlights; assignee filter; per-kind count breakdown
- Add-note + call quick actions; resolve Zuper crew names; exclude RTB-Blocked from schedulable
- Territory Map dashboard for CO office boundary analysis

### Permit & Interconnection Hubs
- Interconnection Hub v1; Permit Hub `/dashboards/permit-hub` two-pane workspace
- Shared inbox thread fetch on correspondence tab; resolved names + header quick-links + AHJ fallback
- Sticky action panel + grouped queue + multiselect location; permit-lead filter
- Per-inbox OAuth workaround for blocked DWD scope

### Comms Dashboard
- Comms Dashboard overhaul to match unified-inbox-live reference app
- Sender avatars, entity decoding, expandable message rows, inline actions
- Auto-pagination of inbox messages (200 limit); By Project view; HubSpot emails outside inbox

### On-Call
- V1 on-call electrician rotations; weekly rotation + self-service swaps + merged Colorado pool
- Sun-Sat weeks + 6pm-10pm weekday / 8am-12pm weekend shifts; per-state Google Calendar
- Emergency call log captured by on-call electricians; admin call logging + HR sheet export
- Admin/executive Activity view — all swap + PTO requests

### Sub-Job & Construction Splits
- Construction job split: Solar / Battery / EV; sub-job breakdown view for construction cards
- Sub-job scheduler bypasses tentative mode; show individual sub-job Zuper links in schedule modal
- Reschedule all sibling construction sub-jobs together with audit logging; tentative siblings skipped
- Zuper API fallback for sibling lookup + status update; explicitly set primary job status to Scheduled

### PM Accountability & Tasks
- PM Accountability dashboard + weekly digest (Phase 1); exception-based PM assignment system
- PM queue accurate at read time (off page load); milestone evaluation fix
- Personal HubSpot tasks dashboard with snooze, create, completed-this-week, bulk done
- `/admin/users` consolidates 3 modals into tabbed drawer; SUPER badge on super-admin user rows

### Shit Show Meeting Hub
- Shit Show Meeting Hub — auto-snapshot on session create, always-on add button
- Use IDR snapshot helpers for owners + statuses + equipment; decouple queue from active session

### Service & Production Issues
- Production Issues dashboard with Flag Project + inline unflag actions
- Service team sales pipeline card + last-communication preview; service-team filter
- Service-overview Deals/Tickets filter on priority queue

### Catalog Hardening
- Phase B operational — HubSpot manufacturer enum + Zoho categories; switch Zoho writes from `group_name` to `category_id`
- Spec-derived Zuper custom fields on product create; pass dimensions on product create
- Race-safe external-record create + link-back; write cross-link IDs from Sync Modal
- Phased HubSpot manufacturer enum enforcement; auto-add unknown brands + notify TechOps
- 302 new InternalProducts + Zuper from Zoho orphan reconciliation
- Phase B data hygiene — test products, casing, Generic rebrand; auto-fixable repairs
- Sync observability enums + watermark columns; log Sync Modal executions to ActivityLog
- Cost Audit: cross-reference Zoho bills, sales price + margin + cross-system link badges
- Sync Health page: drift rollup across InternalProduct/HubSpot/Zuper/Zoho
- Push product photo to Zoho Inventory on approval

### TSRF & Tools
- TSRF Peak Power Calculator in D&E + Service suites; Production Issues dashboard
- ScheduleEventLog — capture Zuper reschedules and crew changes

### Misc
- Auto-reload pages on new deployment; rename PB Operations Suite to PB Tech Ops Suite
- Inngest spike behind `INNGEST_BOM_ENABLED` flag (later powers Admin Workflows)
- `bom-so-create`: ticket SO falls back without custom field if Zoho lacks it

### Bug Fixes
- React hooks ordering in IDR ProjectDetail
- Comms: include HubSpot emails outside inbox reverted
- Estimator: Continue button enables; fall back to `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` for Places
- Catalog photo upload works against private Blob store
- On-call: publish works on large pools + surfaces errors as JSON
- Solar Surveyor: dynamic breadcrumb based on referring suite
- HubSpot engagements: surface 4xx errors to Sentry instead of swallowing

---

## 2026-03-31

### Service Suite & Customer History (Major)
- Service Suite Phase 1+2 — suite split, priority queue, tickets
- Customer History v2 — contact-based lookup; multi-entity search + grouping
- Customer detail Phase 3 — deal/ticket/Zuper association resolution
- Customer expansion Phase 2 — company contacts with address scoping
- Slide-over detail with deal/ticket/Zuper job lists; address-only detail lookup + Zuper job links
- Service Catalog + SO Creation (Phase 4); Zoho SO with HubSpot deal record ID + `SO-` prefix
- Service-team sales pipeline card + last-communication preview; multiselect filters + ticket owner
- Service suite enrichment — shared enrichment layer + Zuper cache sync; Zuper cache sync as 30-min Vercel cron
- Service-overview Deals/Tickets filter on priority queue; deal/ticket detection on service scheduler

### Revenue Goal Tracker (Major)
- Variant A progress rings + Variant B thermometer bars hero components
- Monthly breakdown chart with hit/miss indicators; canvas fireworks animation for monthly goal hits
- RevenueGoal model + REVENUE_GOAL_UPDATED activity type; admin config GET/PUT for targets
- Zuper-based recognition for Service and Roofing groups; cross-year completion window
- Gated groups stay at $0, straight-line pace, bounded HubSpot queries
- Stacked monthly bars, multi-select filter, approx labels

### Cross-System Sync Relay (Major)
- SyncModal rewrite with wide comparison table and per-cell source selection
- Plan-based execute path with stale detection; planHash confirmation token
- Mapping table with normalizers, generators, transforms; 10 new mapping edges
- `useSyncCascade` hook for auto-cascade logic; effective state overlay
- Snapshot builder + default intents; conflict detection and hash
- Selective sync with per-field direction controls

### Office Performance Foundations
- Office performance data aggregation module; per-location route + cache keys
- OfficeGoal model + 4 carousel section components; carousel rotation, pinning, keyboard nav
- All-locations overview page at `/office-performance/all`
- Office performance dashboard registered for PM + Ops Mgr roles

### EOD Summary (Major)
- EOD summary cron — morning/evening snapshot diff for tracked HubSpot leads
- HTML email builder; milestone detection with property history enrichment
- HubSpot completed-task search; idempotency with reclaim-on-failed retries
- Per-person change count + task count; attribute automation changes to deal's role-property owner
- Restructure EOD email by person; signal-to-noise improvements

### Funnel Backlog Dashboard
- Sales-to-DA funnel dashboard with monthly grouped bar chart and cohort table
- Funnel bars with conversion arrows; backlog callouts, DA pacing, cancelled revenue
- Drill-down deal lists for each backlog bucket; pending sales change tracking
- Multiselect locations, pacing revenue, stage distribution
- Switch from calendar-month to rolling-day cutoff; implied progression so approved implies sent implies surveyed

### Construction / Inspection / Survey Metrics
- Construction metrics + DA metrics + Inspection metrics + Survey metrics dashboards
- Drill-down, clearer labels; rename RTB→Booked to RTB→Schedule Date, RTB → Const Start
- Filter by construction complete date; recalculate turnaround; in-construction table
- Replace CC→PTO with CC→Inspection Passed; All Locations summary card
- DA performance metrics — first-try (customer vs design) + rework attribution
- Current DA Pipeline summary cards with Not Yet Sent bucket; click-through drill-down
- Preconstruction metrics dashboard; survey metrics unified with StatCard + location filtering

### Walkthrough Video & SOP Guide
- Walkthrough video design (Remotion)
- SOP Guide phase: API access control, stale editing, mobile nav, editor a11y
- Center search bar, rename to SOP Guide, bump to v4.0
- Tab visibility — public tabs for all, PM Guide for select users; admin-only sections hidden
- D&E workflows sidebar section; corrected handoffs; new construction; shelved unreviewed sections

### Catalog / Inventory
- Rename EquipmentSku → InternalProduct (Phase 1+2+3) across schema, code, UI
- `/api/inventory/skus` renamed to `/api/inventory/products` (Phase 3)
- Numeric range validation, inline errors per step, photo file size/type validation
- Vendor pair warning + stale `zohoVendorId` detection with re-select hint
- Catalog form validation + admin section cleanup
- SyncModal generator rows → regular dropdown rows; auto-commit custom brand on blur

### Zoho Sales Orders
- Warehouse-aware Sales Orders and SO API improvements
- Preferred-vendor PO splitting — auto-split BOM items by Zoho vendor
- Dynamic pipeline stage resolution from HubSpot API
- Cross-system product pricing comparison endpoint + Zoho pricing quality audit
- SO creation — proper product names, Zoho-sourced totals, automated notes
- Auto-populate SO slide-over from HubSpot deal line items; shared contact-based customer resolution
- Gate CREATE_PO step to RTB trigger + manual retry with prior PO state
- PO summary in pipeline notification emails

### Zuper Status Comparison
- Improved accuracy + filters; superseded grouping; timezone drift fix (UTC → Mountain)
- HubSpot-ahead filtering, fail-date check, admin job endpoints
- 1-day tolerance to date comparison; `project_number` lookup fallback
- Resolve Nick surveyor assignment and Camarillo construction crew list

### Pricing Calculator & Deal Import
- Deal import search bar, comparison banner, auto-populate to pricing calculator
- `/api/deal-import` endpoint with search and import modes; LOCATION_SCHEME helpers

### Scheduling
- Pre-sale site visit Zuper flow; narrow pre-sale HubSpot writes to schedule date only
- Forecast ghosts for all pre-construction stages
- Service & D&R overlay on master schedule (month/week/Gantt with distinct styling)
- Per-status revenue cards on construction scheduler; collapsible project sidebar with localStorage
- Per-office daily survey cap; Camarillo survey slots no longer bleed SLO availability
- Survey reassignment notifications to both surveyors (old + new)
- BOM push to HubSpot with UI, migration, and role fixes; forecast schedule page with pipeline breakdown
- Install photo review webhook for Inspection stage; site survey readiness checker + FDR webhook
- Daily focus email cron for P&I and Design leads; PE M1/M2 sections for Layla's morning email

### Metric Cards & DashboardShell
- 3-tier MetricCard differentiation; href/null support; remove SummaryCard
- DashboardShell chrome — suite accent header, PB badge nav, title border, mobile stacking
- Hero MetricCards promoted to StatCards on executive + pi-metrics dashboards

### OWNER → EXECUTIVE Migration
- Rename OWNER → EXECUTIVE in role permissions + add SALES_MANAGER
- Fix OWNER enum deserialization error (460 Sentry events)

### Security & Quality
- `ADMIN_RECOVERY_CODE` required for role recovery endpoint
- Remove non-auth secrets from token key fallback chain; redact private key values in debug endpoint
- ESLint `no-unused-vars` + `no-console`; enable `noUnusedLocals`, fix 82 violations
- Tier refetch intervals — 15 min for low-volatility dashboards
- Memoize sales funnel, extract relativeTime, optimize deal-import

### Polish & Renames
- Polish execution pages: StatCards, status pills, action table reorder
- Reshuffle execution/metrics tables; rename execution dashboards
- Suite page visual polish (Phase 1)
- Consolidate DA metrics, restructure approval queue, reorganize ops suite

### Bug Fixes
- Edge-runtime JWT role stuck at VIEWER
- Survey completion rate excludes carryover from prior months
- Compliance: attribute cross-office crew by deal location, not team
- Crew breakdown reconciliation with top-line totals on office performance
- Hard navigation for scheduler cards (was client-side and breaking)
- Floor `daysSinceStageMovement` instead of rounding
- Catalog selective sync "Invalid confirmation token" error
- Vendor pull fails without companion `zohoVendorId`
- pipeline-health cron alert skipped on weekends
- Prefer live Zuper email over stale local CrewMember records
- Hide zero-value stat cards in status comparison dashboard

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
