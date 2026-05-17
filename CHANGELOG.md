# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-05-17

Covers ~1,400 commits / ~560 features shipped between 2026-03-15 and 2026-05-17. Grouped by theme; PR numbers in parentheses where applicable.

### Design & Ops Meeting Hub (Major)
- New IDR (Internal Design Review) meeting hub at `/dashboards/idr-meeting` — queue, detail panel, prep mode, end-session flow, search history (#155, #161)
- Schema: `IdrMeetingSession`, `IdrMeetingItem`, `IdrEscalationQueue` with snapshot, badge, sync, and readiness logic
- Prep mode with escalation + design-review support, DA status actions, dense two-column layout
- Live preview, On Hold exclusion, real-time collaboration with @mentions and HTML note formatting
- Revision workflow: re-review toggle, auto-appear, revision-reason sync; escalation revisions trigger as-built design status (#630, #665)
- Sync on end-of-meeting: completes HubSpot task, drops PM task, surfaces RE-REVIEW badge, opens sales folder (#632, #353)
- Adders integration: `AddersChecklist`, `PricingBreakdown` with mismatch detection, line-item widening, HubSpot summary sync
- Recovery from accidental "End without syncing" plus two-click confirm (#367)
- PandaDoc DA link + plan docs surfaced inline (#601); meeting scoped by Colorado / California / all (#344)
- Shit Show Meeting Hub spun out as a separate flow (#429)

### PE Program (Major)
- PE Submission Gap report at `/dashboards/pe-submission-gap` — CC-hit deals with incomplete M1/M2, 4-tab split (M1/M2/Both/Complete), dollar amounts, date columns (#686, #693, #695, #698, #699)
- PE Document Tracker dashboard at `/dashboards/pe-docs` with sortable columns, inline status editing, document breakdown per deal, actual customer payment status from HubSpot invoices (#581, #586, #589, #609, #611)
- PE Program Report dashboard for ownership visibility (#578); per-project document checklist + filters (#580)
- PE Pipeline Tracker dashboard with per-stage revenue hero cards, construction/inspection status columns, IDR re-review integration (#629, #631, #634)
- PE Raceway API sync replacing the HTML scraper (#660); PE portal CSV import to supplement scraper data (#596)
- PE action items feed grouped by deal with HubSpot + PE Portal links, hourly cron, auto-resolve on doc approval (#664, #667, #668)
- PE File Preparation tool — AI vision audit, PandaDoc auto-pull, prep dashboard with few-shot reference library and AVL cross-check (#701, #702, #703)
- PE Deals dashboard: traceable IC/PC breakdown, Partially Paid section, Approved/Waiting on Payment split (#610, c4a2d99a, 2d1d4905)
- PE turnover readiness skill with audit + assembly (ea63ad6e)

### Property Hub (Major)
- HubSpot Property custom-object v1 with sync, drawer, and full-page view at `/properties/[id]` (#166, #681)
- Workflow-sync endpoint accepts native HubSpot webhook payloads (#544, #679)
- Inngest queue for property sync workflows (#675)
- Zuper Property write-direction sync with customer association on create/update and project-to-property linking (#709)
- Shovels API enrichment — permits, residents, contractors, increased cron batch size (#700)
- Drawer: contact names, HubSpot link, deal names, address-match verification for single-candidate links (#671, #682, #687)
- Property Hub UX: map, stages, ID lookup, rollup fields (#684); recursion into subfolders for PE turnover audits (2565e188)

### Admin Workflow Builder (Major)
- Full workflow engine at `/admin/workflows` — backend scaffold, editor UI, CRUD API (#317, #321)
- Action library: 4 actions + templates → 3 more + cron cleanup → http-request + find-hubspot-contact → fetch-zuper-job + Duplicate (#323, #335, #336, #337)
- Control flow: parallel, for-each, idempotency checkpoints, dry-run, failure alerts (#326, #348, #349, #350, #357, #360, #362)
- Triggers: webhook fan-out for HubSpot/Zuper, CRON dispatcher, CUSTOM_EVENT (#325, #338, #356)
- Versioning with snapshot-on-save + rollback, analytics dashboard, visual canvas preview, drag-to-reorder, JSON export/import (#354, #358, #359, #361, #363)
- Per-workflow rate limiting, Inngest auto-sync on deploy + manual resync (#351, 1181473f)
- Per-run detail page, step reordering, cross-workflow run history (#328, #329)
- Operations runbook + comprehensive session rollup (#330, #332, #339, #352, #364)

### Office Performance & TV Dashboards (Major)
- New office-performance dashboard with per-location and all-locations views, 7-slide carousel, ambient backgrounds (#150, #153)
- Visual upgrades: CountUp, ProgressRing, AnimatedBar, AmbientBackground, directional slide+fade transitions (0ee83d29 → 38c98ad4)
- Sections: leaderboard, pipeline (bars + PM/designer/owner breakdowns), surveys, installs, inspections — each with section color accents and pill navigation
- Goals & Pipeline carousel slides (#147), Office Calendar slide (#150), Service slide (#680), all-locations slide (#149-equivalent)
- Two-tier base + stretch goals with gold progress bar (#574); Site Survey + PTO Granted goal lines (#571); California lowered 5-star review goal (#640)
- Compliance tightened, OOW usage %, side-by-side layout; live Zuper API metrics replace cache-based (#10184cef, #7166c8f0)
- Deal drill-down lists + Zuper compliance per office (#145)
- Cache-first fetching cut dashboard load time (#525)
- TV dashboard: rich deal list with Zuper status, PE flags, unified layout, completed deals stack, calendar week/day views (#643, #644, #651, #639)
- Live "Updated" clock replaces static timestamp on all dashboards (eb081abb)

### Schedulers
- SubJobScheduleModal with same/separate modes — wired into master + construction schedulers (6746dcff → c73e8153)
- Reschedule all sibling construction sub-jobs together (#530); skipSiblingCascade API option
- Show Zuper job status in all scheduler modals (#519); flag overdue/completed overlay jobs (#439)
- Day-view timed grid for surveys/inspections (#516); on-call electrician overlay on master schedule (#511)
- Sub-job breakdown view for construction cards (#518); cross-deal sub-job bleed prevented on same-customer projects (#673)
- Tentative vs live mode now visually distinct across all schedulers (#672); tentative install scheduling without assignee (#656)
- Site survey: per-office daily cap (#146), relaxed 1-day lead time for California reps (#659), CA-availability revisions (#261), reassignment notifies both surveyors
- Service scheduler: deal/ticket detection, assignees, scheduled date, week/day views, contact link (#180, #181, #184)
- Forecast ghost events for all pre-construction stages (#98); pre-sale site-visit Zuper flow (#96)
- Service + D&R toggle on calendar toolbar, collapsible sidebar with localStorage persistence
- Per-status revenue cards on construction scheduler; completed month/year stats with overdue revenue

### Solar Designer Stage 3 + Stage 4 (Major)
- Stage 3: shade slider, address geocoding, panel canvas SVG, map alignment, visualizer with shade animation + satellite background, StringingTab with click-to-assign + auto-string, StringList sidebar with voltage validation
- Stage 4: Production / Timeseries / Inverters tabs, RunAnalysisButton with Web Worker lifecycle, MPPT cards + reassignment + clipping detection
- Engine: V12-faithful physics, consumption, production; built-in 8-panel/9-inverter/6-ESS catalog; DXF/JSON parser, CSV shade parser
- Core runner bridges CoreSolarDesignerInput to engine; auto-string with voltage validation; mismatch + loss calc; clipping event detection
- File upload: drag-and-drop, folder upload, zip upload, per-panel shade CSVs
- EagleViewPanel renders when `?dealId=` URL param is set (#406); TrueDesign auto-pull pipeline (#404)

### Tesla PowerHub Fleet Monitoring (Major)
- New fleet monitoring dashboard at admin level with expandable site table, search, stats, sort by data (#538, #553)
- API client with JWT auth, rate limiting, OAuth2 client_credentials, three-tier site-to-deal linkage with tests
- Sync orchestration: assets, telemetry, alerts; cron handlers for each (#88d0703a, #7cb0f314)
- Admin linkage manager, SystemHealth embed, auto-link Tesla sites to HubSpot properties (#560, a28c4ddf, 3bb4de55)
- PowerHub alert scoring fed into service priority queue (#33351450)
- Crash fix: devices is object not array (#558); upsert for asset sync prevents unique-constraint races (#559)

### Pipeline Tracker Dashboards
- General Pipeline Tracker + per-tab Construction/Inspection/Site Survey (#635, #636, #637)
- Per-type filters, sortable status columns, Zuper job links, PE-Pipeline cross-links (#647, #648, #649, #650, #652, #655)
- Paginated HubSpot search across pipeline-tracker APIs (#638)
- Descriptions updated to include site survey (#641); Contact column removed (#636)

### Aircall + On-Call
- Aircall call analytics dashboards Phase 1 + 2 — per-user answer rate via ring tracking, Analytics+ ringing-attempts CSV import for historical data (#501, #502, #503, #505)
- On-Call section from `OnCallCallLog` table (#507)
- On-call electrician rotations v1: weekly Sun-Sat shifts, 6pm-10pm weekday / 8am-12pm weekend (#217, #409)
- Self-service swap UI + admin/executive activity view of swaps + PTO (#308, #313)
- Merged Colorado pool, per-state Google Calendar staging (no invites until go-live) (#307, #441, #442)
- Emergency call log captured by electricians + admin call logging + HR sheet export (#459, #463)

### Accounting Suite (Major)
- Accounting Suite landing page with PE Deals & Payments dashboard (#129); ACCOUNTING role (#262)
- Payment Tracking dashboard with HubSpot-invoice attachment, attention signals from project triggers, preset date filters, ready-to-invoice signals (#263, #276, #279, #304)
- Split into Payment Tracking + Payment Action Queue pages (#293); 5-section groupings restored (#291)
- Payment Timeline dashboard with volume bar chart and day/week/month toggle (#613, #615)
- Invoice-first bucketing + three new accounting pages (#366); 'Not Invoiced' column on Payment Tracking row (#303)
- PE Deals refresh: hero cards with Ready to Invoice + collected/outstanding subtitles; reorder Paid > M2 > M1 > All, compact table layout (#296, a9889a30)
- Tightened to ADMIN/EXEC/ACCOUNTING + narrow OPERATIONS access (#299)

### Adders + Pricing
- Phase 1 governed Adder Catalog at `/dashboards/adders` (#315, #322, #324)
- Triage recommendation engine + `/api/triage/*` + rep-facing mobile triage UI + deal-detail embed (#327, #331)
- OpenSolar sync scaffold behind kill switch (#334)
- Customer-facing solar estimator v2 — all 5 quote-type flows (EV, Battery, Expansion, D&R) (#264, #274, #278, #284)
- Estimator slimmed HubSpot properties 14 → 3, added iframe embed mode (#278)
- TSRF Peak Power Calculator added to D&E + Service suites (#312); pricing calculator deal import + compare (11a67604, 0bbfd1ee)
- DB-backed adder path + latent bug fixes in pricing-calc (#333)
- Pricing Calculator moved from Accounting to Sales & Marketing (#300)

### Admin / Roles / Auth (Major)
- Unified AdminShell + `/admin` landing with in-shell search (#213, #214); consolidate `/suites/admin` into `/admin`
- Per-role capability overrides + per-user extra route grants (#209, #211)
- Runtime-editable role definitions: routes, landing cards, suites (#234)
- Super-admin break-glass safeguard with UI indicator (badge in UserMenu, drawer note) (#240, #243, #246)
- Read-only Role Inspector at `/admin/roles` (#207)
- Phase 1: 6 scoped suite roles + Sales & Marketing suite (#288); ACCOUNTING + SERVICE roles added (#262, #185)
- Multi-role access + home-page redesign (#189); redirect to last page after login (#176)
- Admin primitives: table, filter bar, detail drawer, bulk action bar, form, KV grid, detail header (#215, #216)
- Admin pages refactored to primitives: activity, audit, security, tickets, directory, crew-availability, roles, users (#219, #221, #222, #223, #224, #227)
- Brand rename: PB Operations Suite → PB Tech Ops Suite (#287)
- Edge-runtime JWT role-stuck-at-VIEWER fix (e9d78dd6); ADMIN_RECOVERY_CODE required for role recovery (e53501b1)
- Security hardening: redact private-key values, remove non-auth secrets from token key fallback chain (1119d75c, 7d25018d)

### My Tasks + Tickets
- Personal HubSpot tasks dashboard with snooze, create, completed-this-week, bulk done (#230, #245, #250)
- Inline status + queue edit, shortcuts, URL state, typeahead lookups, New Task from deal panel (#252, #254)
- Autofocus first row, admin-managed queue names (#258)
- Explicit HubSpot owner link per user (#242)
- Freshservice: admin page + UserMenu badge for tickets (#233); user-facing `/dashboards/my-tickets` (#257)
- Bug reports sent from the reporter's address (#177)

### Deal Detail + Timeline
- Read-only deal detail page (#155); 3-tab layout + collapsible photos (cc73f311)
- Communications, Activity, ProductionFeed panels with HubSpot engagements + tasks, Zuper status history + notes, BOM, schedule timeline
- POST `/api/deals/[dealId]/notes` with background HubSpot + Zuper sync; GET `/timeline` with composite cursor pagination
- 13 additional enhancements (9ef0f010); site photo gallery + fixed Zuper URLs; HubSpot tasks moved into Activity
- DealActivityPanel, CommunicationsFeed, ActivityFeed (with pagination), NoteComposer, TimelineEventRow
- Sync changelog shows human-readable labels (40e65c25)
- Internal Deal link added across scheduler family + remaining UI surfaces (#173, #174, #175)
- HubSpot Property "portal labels" for design_status + layout_status (#265)
- Deal Mirror sync engine + Comms Dashboard + cross-system Product Sync (#148)
- Contact-associated emails included in Communications (#179)

### Sync Modal Rewrite (sync-relay)
- Wide comparison table with per-cell source selection (#bd5e4be8, #ed335a98)
- selectionToIntents translation layer with smart defaults and dropdown filtering (#9a694ca6)
- Plan-based execute path with stale detection + planHash confirmation token (#28122f37, #ebcccf44, #45bf2c6f)
- Plan derivation engine with conflict detection + hash; plan execution engine with effective state overlay
- 10 new mapping edges; bidirectional Zoho part_number + unit (#45fc4bd3)
- useSyncCascade hook for auto-cascade logic (#3f26bdce)
- Generator fields now visible + toggleable in SyncModal (#bc08f035)

### Metrics & Funnel Dashboards
- Inspection metrics dashboard with dual-source validation + drill-downs (#24325410 series)
- Construction metrics: drill-down with Zuper links, replace CC→PTO with CC→Inspection Passed (#2cd5770e, #eb6801da, #86439df5)
- DA metrics + Site Survey turnaround metrics + Preconstruction metrics (#472db82c, #f518babf, #126)
- Funnel dashboard at `/dashboards/funnel` — bars with conversion arrows, monthly grouped bar, cohort table, backlog callouts, DA pacing, cancelled revenue, multiselect locations + pacing revenue, drill-down deal lists (8b93694e → a17b3597)
- Weekly Shop Health Dashboard (#706)
- Compliance v2: per-service-task scoring + status-bucket fixes, flag-gated (#369)
- Zuper-drift PM dashboard with per-sub-type evaluation + install-status rollup integrity check (#621, #622)
- DA Drift detector moved from admin → Project Management suite (#603)

### Maps & Permits
- Jobs proximity map Phase 1+2+3 — installs, service, crews; Week/Backlog, tickets, inspection/survey, UX polish (#365, #368)
- Map quick actions: call + add-note; assignee filter; scheduled-today markers never cluster (#376, #394)
- Dispatcher office pin + morning briefing + nearby highlights (#373)
- Project numbers, richer info, D&R + roofing markers, shop filter (#371)
- Permit Hub: `/dashboards/permit-hub` two-pane workspace, resolved names + header quick-links + AHJ fallback, shared inbox thread fetch (#374, #389, #390, #400)
- Interconnection Hub v1 (#392)
- Territory Map dashboard for CO office boundary analysis with bolder boundaries, AI analysis, office location stars (730cd778, 2bc188f5, 525f4fd1)

### Catalog & Sync Observability (Major)
- Phased HubSpot manufacturer-enum enforcement (Task 2.4), Zoho category_id writes, Phase B operational (HubSpot enum + Zoho categories) (#6e5ba164, #7d2e3d9a, #174e94b7)
- Sync observability enums + watermark columns; logCatalogSync wired into push approval; Sync Modal executions logged to ActivityLog (#fa750da2, #a591397e, #b6ffe694)
- Auto-add unknown brands to HubSpot manufacturer enum + notify TechOps (#f201d485)
- Race-safe external-record create + link-back; generalize category-conditional mapping; cross-link writer extracted (#db10d297, #91ce55ae, #07b57cdb)
- Zoho orphan reconciliation: 302 new InternalProducts + Zuper (#0c7926f1); integrity audit + auto-fixable repairs (#b26b7e06)
- Zuper M3.4: spec-derived custom fields on product create; dimensions on product create (#0f354c88, #dc942dd7)
- Backfill Zoho item images from historical pushes (#398)
- Catalog validation + admin section cleanup (#83); selective sync with per-field direction controls (#bd5e4be8)
- Client-side photo size/type validation + inline validation errors in DetailsStep / CategoryFields / BasicsStep (#5bee63d9, #20c430fb, #a28559ba)
- Numeric range validation + vendor pair warning; stale `zohoVendorId` detection with re-select hint (#f145567b, #fcfd2525)

### Service Suite & BOM
- Service Suite Phase 1 + 2 — suite split, priority queue, tickets (#97)
- Service Catalog + SO Creation (Phase 4) (#107); auto-populate SO slide-over from HubSpot deal line items (#5191a76f)
- Warehouse-aware Sales Orders + SO API improvements (#109); HubSpot deal record ID included on Zoho Sales Orders (#106)
- BOM push to HubSpot with UI, migration, and role fixes (#104)
- Preferred-vendor PO splitting — auto-split BOM items by Zoho vendor (#596e5485)
- Service BOM history shows service-deal BOMs (#676)
- Service-team sales pipeline card + last-communication preview (#171); deals/tickets filter on priority queue (#183)
- Service Suite split into sections; Solar Designer ↔ Solar Surveyor swap (#186)
- Cross-system product pricing comparison endpoint (#dde46ea8) + Zoho pricing-quality audit (#282988b8)

### Revenue Tracking
- RevenueGoalTracker with progress rings + thermometer bar hero variants + canvas fireworks animation on monthly goal hits (db6f5fad → d25f655e)
- Admin GET/PUT for goal targets; Zuper-based recognition for Service + Roofing groups (7503308a, d9773044)
- Monthly breakdown chart with hit/miss indicators + improved visibility (a1301bf0, dd2e2557)
- Total revenue hero card on PE Pipeline Tracker (#633); per-stage revenue on PE Pipeline hero cards (#634)
- PE Submission Gap shows dollar amounts on each tab (#695)

### EOD + Daily Focus
- End-of-day summary email: snapshot/diff, HubSpot completed-task search, milestone detection with property history, idempotent orchestration (dcf12740 → 8ecca5ba)
- Per-person change + task count in EOD email; attribute changes by who made them; Layla's morning email gets M1/M2 sections (b24e156b, e9f16f29, eed48db6)
- Daily focus email cron for P&I and Design leads (ce8edfb8)
- Site survey readiness checker + FDR webhook (971a797e)

### SOP Guide (continued)
- WYSIWYG TipTap editor replaces raw HTML CodeMirror (#425)
- Split Tech Ops tab into Design / Permitting / Interconnection (#424)
- Auto-link `<code>/route</code>` mentions to actual app pages (#426)
- Drafts tab with PM Guide rewrite + Pipeline Overview (#434)
- Submit-a-new-SOP feature with admin review queue (#435)
- Hub-mode visibility flip — open by default (#437)
- Tab batches: Catalog, Service, Scheduling, Forecast, AHJ & Utility, Submitting a New Product, Suites, Tools (BOM + AI Design Review), Pricing/P&I/Surveyor/Schedule/Optimizer/Map, Action Queues + Workflow Builder + Property Drawer + Deal Detail + Equipment Backlog, Executive + Accounting + Sales & Marketing role-gated, "How to Use the SOP Guide" meta-SOP (#414, #415, #416, #417, #418, #422, #423)
- Centered search bar, rename to "SOP Guide", role-specific visibility, public/admin badges, PB brand theming, merged Workflows into Reference, merged Sales into Other Pipelines (fbf735dd → 6c6d14c6)

### PM Suite
- PM Accountability dashboard + weekly digest Phase 1 (#440)
- Exception-based PM assignment system (#448); live mode — page-load eval replaces daily cron (#454)
- HubSpot deal links + owner-id assignment fallback + missing-PM seed (#457)
- Project Management Suite landing page (#456); criteria spec for HubSpot workflow build (#450)

### IT + Audit
- Audit-sessions, anomaly-events, user-roster endpoints (#402)
- Read-only activity-log export API for IT team (#298)

### Customer History
- New dashboard with search + slide-over detail at `/dashboards/customers` (7f044fe3 series)
- Multi-entity search + grouping; company contacts with address scoping; deal/ticket/Zuper association resolution
- Customer search + detail API endpoints with normalizeAddress + deriveDisplayName helpers

### Performance & Reliability
- Forecast schedule page with pipeline breakdown (#103)
- Photo triage: 1 API call replaces 36+; pre-upload + Anthropic file ID caching eliminates redundant work (#715, #712)
- PE doc classification race condition fix + parallel pre-work (#717)
- Shop-health week utils extracted to prevent client/server boundary violation (#708)
- Office-performance dashboard load time cut via cache-first fetching (#525)
- Shovels cron batch size up to 75 with reduced delay (0edbae20)
- PowerHub telemetry/alert sync skips shell sites, larger batches (f0002539)

### Bug Fixes (notable)
- PandaDoc name-only search fallback when template discovery fails (#718, #714)
- Filter customers with no UID when updating Zuper property (e76edc95); safety checks prevent Zuper property misassociation
- PE audit: cache vision results, block proposal misclassification, UI fixes, classifier accuracy, deal links (#710, #711)
- PE audit GDrive access via user OAuth token; correct cookie name passed to getToken (#705, #707)
- Cookie OAuth redirect URI derived from request headers (#151)
- Restore BOM pipeline webhook — route alias, dual auth, health monitor (562a42d8)
- Comms: verify Gmail identity matches PB user during OAuth connect (9e517c37)
- AI design review no longer flags utility meters as production meters (#645)
- Auto-reload pages on new deployment (#154)
- Bug-report emails sent from the reporter (#177)
- Removed unused / dead code: `forceOverwrite`, `installAgeMonths`, extended rollup fields, duplicate fields, `closedTicketsCount`, document-level display on PE Submission Gap (multiple)

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
