# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-07-09

### Bottleneck Monitor (Major)
- New age/volume/flow engine that measures stage dwell time, WIP, and throughput to surface stuck projects
- v2 split of stalled vs. zombie deals with owner rollup and a real activity signal (not just last-modified)
- Bottlenecks tab added to the project pipeline funnel page for drill-down from stage totals
- Worklist page reorganized ops-first so operations owners see their queue at the top
- Digest polish: hyperlinked deals, team worklists, personal DMs, and preset filters

### Ops Slackbot (Major)
- Weekday personal-worklist cron with routing, resolver, conversations tab, and perf improvements
- Bot message audit log, personal deep-links, compliance rework, and worklist-first tab
- Force-provisions user DMs via Google Workspace domain-wide delegation so no one gets missed
- Captures user DM spaces for personal worklist delivery
- Real-time bot usage mirror to the tracking space
- New PE payments, revenue goals, and exact stage revenue tools
- Real week-by-week PE payment breakdown (replaces fabricated aggregates)
- PE deal filter on stage/status count tools
- Guardrail: bot never fabricates a breakdown from an aggregate
- Neutral metric commentary + "close-out" vs "closed" vocabulary fix
- `create_hubspot_task` tool docs updated to show the `assignee` param

### IDR Meeting Hub
- New Construction review type added to the meeting queue
- D&R / Service design review type added to the meeting queue
- Escalation photo attachments render inline in the hub
- Customer name now shows for Service and D&R deals in the queue (was blank)

### Scheduler & Survey Portal
- Double-book guard for surveys enforced at booking time (ops app + customer portal book/reschedule)
- Fix: double-book guard no longer falsely blocks surveys behind multi-day installs
- Customer survey invite is auto-closed when ops books the slot via the app
- Fix: blank crew `zuperUserUid` was matching every survey in the conflict scan
- Kill switch for customer-facing survey portal emails
- Scheduler / IDR / etc. "Deal" buttons now link to HubSpot instead of the internal deal page

### Admin Workflow Builder
- New `create-zuper-job` action with property-change webhook feed
- `create-zuper-job` now links the job to the deal's Zuper project
- Full Tray parity on `create-zuper-job` inputs
- Property webhook now accepts `propertyName` / `value` via query params
- Service-task entries enriched from the master record (previously partial)

### RTB / PE
- RTB-Blocked PM review gate (#919) — PMs must sign off before a deal leaves RTB-Blocked
- Milestones bucketed by document state on the PE Milestones tab
- PE Change Orders tracked as a conditional document
- Rejection notes trimmed to the current review cycle on both doc and team paths
- `NOT_REQUIRED` docs excluded from the doc-approval-rate denominator
- Ready-view stat cards now match their drill lists
- PE AVL dashboard opened to all roles

### On-Call Rotation
- Swaps allowed any distance out and can now cover a whole week block
- Swap picker collapsed to one row per week with the full date range
- Real emails for the PTO lifecycle (replaces notification stubs)
- Email notifications wired into the swap lifecycle

### Pipeline Funnel
- "Awaiting Interconnection Approval" card scoped to genuine IC waits
- "Interconnection Cleared" card reconciled with the underlying backlog

### Zuper Integration
- `job_timezone` stamped on job create/reschedule so California customers see Pacific times in notifications
- Stopped attaching the demo customer to newly created jobs

### Infrastructure & Security
- Weekly Neon preview-branch sweep cron to cap extra-branch cost
- Middleware no longer caches role-denial redirects (fixes stale 403s after role changes)
- Patched runtime dependency vulnerabilities

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
