# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-04-24

### Admin Workflow Builder (Major)
Visual no-code automation from Phase 5 through Phase 16 — runtime on Inngest, editor at `/dashboards/admin/workflows`.

- **Triggers**: `MANUAL`, `HUBSPOT_PROPERTY_CHANGE`, `ZUPER_PROPERTY_CHANGE`, `CRON` (scheduled), `CUSTOM_EVENT` (emit helper). Webhook fan-out for HubSpot (piggybacked on `deal-sync`) and Zuper (`/api/webhooks/zuper/admin-workflows`)
- **Actions palette**: `send-email`, `ai-compose`, `update-hubspot-property`, `update-hubspot-contact-property`, `add-hubspot-note`, `create-hubspot-task`, `find-hubspot-contact`, `update-zuper-property`, `fetch-zuper-job`, `http-request`, `run-bom-pipeline`, `log-activity`
- **Control flow**: `delay`, `stop-if`, `parallel`, `for-each` loops
- **Editor UX**: visual canvas preview, drag-to-reorder steps, select/multiselect dropdowns with dynamic option re-fetch, unified property options, export/import workflow JSON
- **Operational**: versioning (snapshot on save + rollback), analytics dashboard, per-run detail page with step output drill-in, cross-workflow run history, dry-run mode, failure alerts, per-workflow rate limiting, best-effort idempotency via DB checkpoints, action-level idempotency for create-actions
- **Platform**: Inngest auto-sync on deploy + manual resync button, dispatcher cron for CRON triggers, cron cleanup for stale runs, Zuper property discovery helper
- Feature flags: `ADMIN_WORKFLOWS_ENABLED` (editor + API + manual), `ADMIN_WORKFLOWS_FANOUT_ENABLED` (webhook → workflow)
- Docs: CLAUDE.md system entry, ops runbook, Phase 13 / 15 / 16 state + closeout reports

### Pricing & Adders (Major)
Phase 1 Chunks 3–6 of the pricing & adder governance overhaul.

- **Triage engine** (`/api/triage/*`): pure-function recommendation engine with predicate evaluator. Splits adders into `autoApply` (via `appliesTo`) vs. triage-driven (via `triggerLogic` against answers). Returns shop-resolved pricing with signed amounts
- **TriageRun** CRUD with owner-or-admin PATCH, submitted runs are terminal. Submit writes `pb_triage_adders` JSON + `pb_triage_submitted_at` to the deal (Phase 1 interim — no HubSpot product mirror yet)
- **Rep-facing mobile UI** at `/triage`: deal lookup → per-question stepper with localStorage draft, debounced server sync, photo capture (compressed to 1600px/JPEG 0.8 via canvas), review screen with per-row reasons for unchecked recommendations, shop-prompt fallback when deal has no `pb_location`
- **Pricing calculator** DB-backed adder path (opt-in via `CalcOptions.resolvedAdders`). `CalcInput.customFixedAdder` (scalar) → `customAdders[]` with backward-compat alias. Three latent bugs fixed: non-PE percentage adders dropped by type filter; `peEnergyCommunnity` typo → `peEnergyCommunity`; empty `DC_QUALIFYING_MODULE_BRANDS` flagged
- **OpenSolar sync scaffold** behind `ADDER_SYNC_ENABLED=false` kill switch. Client abstraction, `AdderSyncRun` telemetry, manual trigger + nightly 10am UTC cron, `SyncStatusBadge` with 30s poll. Real endpoints deferred until Pre-Phase Discovery fills 6 blocking questions
- Cards moved to Sales & Marketing suite with IN PROGRESS flag

### Jobs Proximity Map (Major)
New `/dashboards/map` — unified map of scheduled/unscheduled jobs for dispatcher reassignment decisions.

- **Phase 1**: installs + service + crews, Today mode, scheduled vs ready-to-schedule marker styles (filled circle vs. hollow ring), `MapLegend` with live counts, `DetailPanel` slide-out
- **Phase 2–3**: Week / Backlog modes, service tickets, inspection + survey markers. Uses `getScheduledJobsForDateRange` over mode-scoped date range, fail-open on Zuper errors
- **Rich detail**: uses canonical `project_number` (not deal object ID), system size, crew, PM, AHJ, utility, shop; D&R + roofing markers; shop filter
- **Phase 4A (Dispatcher office)**: cyan 🏢 office pin with radius circle at the five known PB shops. Auto-detects from `User.allowedLocations[0]`. Morning briefing banner shows N ready-to-schedule jobs within X mi + 6 nearest, clickable to open detail

### Service Suite — Jessica Meeting Followups
- **Scheduler colors**: status-driven tile fill (New blue, Scheduled cyan, In Progress purple, Completed emerald, Cancelled zinc, Overdue red) with a 4px left-edge stripe for category. Applied across month/week/day-untimed/day-timed/sidebar/modal
- **Unassigned Tickets KPI** on service overview: yellow when > 0, green at zero. Click toggles drill-through to priority queue filtered by `__unassigned__`. KPI grid bumped to 5-up
- **New `/dashboards/service-unscheduled`**: Zuper jobs awaiting a scheduled date, with age tiers (red/orange/amber), category/status/state/search filters, CSV export
- **Contact recency fix**: `resolveLastContact()` now picks freshest signal across HubSpot Engagements (manual calls/notes/meetings), Zuper job activity (MAX scheduledStart + completedDate, capped to past), and legacy fields. Fixes "no contact in 70 days" warnings on customers we talked to yesterday. `daysBetween` off-by-one + NaN guard
- **BOM design_status trigger**: new `DESIGN_STATUS_CONFIG` env var mirrors `PIPELINE_STAGE_CONFIG` for service deals that don't go through dealstage transitions. Same HubSpot webhook → Inngest path
- `service-unscheduled` ageDays fix — pull from `rawData.created_at`, not `lastSyncedAt` (which updates every sync)

### IDR Meeting
- **Scoped starts**: three-way split Start CO / Start CA / All. Bucket filters HubSpot deals and queued escalations by `pb_location`; dedupe checks region overlap so CO ↔ CA meetings don't trap each other
- **Recovery from accidental end**: new POST `/api/idr-meeting/sessions/[id]/sync-unsynced` re-runs sync for any item where `hubspotSyncStatus !== SYNCED`, including on COMPLETED sessions. Per-item sync endpoint no longer rejects completed sessions
- **Two-click confirm** on "End without syncing"
- Sales folder, PM task on sync, open-all links; dropped needs-resurvey UI
- `syncItemToHubSpot()` helper extracted to `lib/idr-meeting.ts`, reused across three endpoints

### Accounting
- **Invoice-first bucketing** in payment-tracking: `effectivePaidStatus` helper trusts the attached invoice record over the deal-property status. PE deals where the CC invoice is actually paid no longer lead with "Post-install, CC not paid" in the Payment Action Queue
- Three new accounting pages
- `computeBucket` rules + ladder rewritten to use effective statuses

### Compliance V2 (flag-gated)
- Per-service-task scoring behind `COMPLIANCE_V2_ENABLED`: attributes credit per Zuper service task (PV Install, Electrical Install, Loose Ends) rather than per parent job, so PV crew isn't penalized for battery/electrical delays on the same job
- Credit set = union of `service_task.assigned_to[]` + form submission `created_by` with 1/N fractional attribution
- Status bucket coverage: added Return Visit Required, Loose Ends Remaining, Completed - AV, On My Way variants; excluded stale Ready To Forecast

### BOM Pipeline
- `bom-so-create` now merges `items + suggestedAdditions` when building Zoho SO line items. Post-processor Rule 5 auto-adds (Powerwall expansion harness/wall-mount kit, snow dogs, T-bolt bonding, critter guards) were landing in the snapshot but missing from the generated SO. Caught on PROJ-9681

### Bug Fixes
- Scheduling: multi-crew install emails collapsed into one send (was duplicating per assignee)
- UI: `StatCard` values shrink on md/lg so 5-up hero grids fit
- Admin Workflows: coerce `propertyValuesIn` string → array in trigger config
- Adders seed: `PE_DISCOUNT_30` row had 21 columns, not 22
- Webhook route: CodeQL `js/tainted-format-string` fix — pass `propName` as `console.warn` data arg with `%s` substitution

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
