# PB Operations Suite

Solar operations platform for Photon Brothers — HubSpot CRM, Zuper field service, Zoho Inventory, scheduling, BOM automation, service tickets, and real-time metrics across 5 Colorado + California locations.

## Tech Stack

- **Framework**: Next.js 16.1, React 19.2, TypeScript 5
- **Styling**: Tailwind v4 with CSS variable tokens
- **Database**: Prisma 7.3 on Neon Postgres
- **Auth**: next-auth v5 beta (Google OAuth, domain-restricted)
- **Data Fetching**: React Query v5 with SSE real-time invalidation
- **APIs**: HubSpot (CRM/deals/tickets), Zuper (field service jobs), Zoho Inventory (products/SOs), Google Calendar, Resend (email fallback), Google Workspace (primary email)
- **AI**: Anthropic Claude (BOM extraction from planset PDFs), OpenAI (anomaly detection, NL queries), Google Gemini (DA photo equipment assets)
- **Real-time**: Server-Sent Events via `/api/stream` + `useSSE` hook
- **Video**: Remotion for generated walkthrough content
- **Monitoring**: Sentry error tracking with DSN tunnel for ad-blocker bypass
- **Deploy**: Vercel with preview deployments

## Build & Run

```bash
npm run dev              # Local dev server (Next.js)
npm run build            # prisma generate && next build
npm run test             # Jest tests
npm run test:watch       # Jest in watch mode
npm run lint             # ESLint (flat config, core-web-vitals + typescript)
npm run preflight        # Pre-deploy checks
npm run preflight:prod   # Pre-deploy checks (production mode)
npm run db:migrate       # prisma migrate deploy
npm run email:preview    # React Email dev preview for email templates
npm run build:solar      # Build Solar Surveyor sub-app
npm run crew:deactivate  # Deactivate a crew member (interactive)
npm run remotion:studio  # Open Remotion studio for video editing
npm run remotion:render  # Render walkthrough video to out/
```

Requires `.env` — see `.env.example` for the full list. Critical vars:
- `DATABASE_URL` — Neon Postgres connection string
- `HUBSPOT_ACCESS_TOKEN` + `HUBSPOT_PORTAL_ID` — HubSpot private app
- `ZUPER_API_KEY` + `ZUPER_TEAM_UIDS` + `ZUPER_USER_UIDS` (JSON) — Zuper field service
- `ZOHO_INVENTORY_*` — Zoho Inventory (org ID, refresh token flow recommended)
- `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` — Google OAuth for login
- `NEXTAUTH_SECRET` + `AUTH_URL` — NextAuth session encryption
- `ANTHROPIC_API_KEY` — Claude for BOM extraction
- `ALLOWED_EMAIL_DOMAIN` — restricts login (default: `photonbrothers.com`)
- `API_SECRET_TOKEN` — machine-to-machine auth for BOM/product endpoints

## Project Structure

```
src/
├── app/
│   ├── api/                 # API route groups (run `ls src/app/api/` for current list)
│   │   ├── auth/            # NextAuth endpoints + verification codes
│   │   ├── deals/           # HubSpot deal search, streaming, bulk ops
│   │   ├── projects/        # Project CRUD and detail
│   │   ├── service/         # Service tickets, customers, priority queue, equipment
│   │   ├── bom/             # BOM extraction, save, push, SO creation
│   │   ├── catalog/         # Product catalog search, match, push, vendors, dedup
│   │   ├── inventory/       # Product sync, merge, backfill (HubSpot/Zuper)
│   │   ├── hubspot/         # HubSpot QC metrics, custom objects
│   │   ├── zuper/           # Job assignment, availability, revenue, linkage
│   │   ├── forecasting/     # Forecast accuracy, baselines, timeline
│   │   ├── compliance/      # Compliance email digests
│   │   ├── admin/           # User management, activity logs, SOP, security
│   │   ├── ai/              # Anomaly detection, natural language queries
│   │   ├── chat/            # Claude AI chat interface
│   │   ├── solar/           # Solar Surveyor project CRUD, revisions, weather
│   │   ├── sop/             # SOP content management
│   │   ├── reviews/         # Design and project reviews
│   │   ├── webhooks/        # HubSpot design-complete and design-review webhooks
│   │   ├── portal/          # Customer survey portal (token-validated, no session)
│   │   ├── stream/          # SSE endpoint for real-time data
│   │   ├── cron/            # Audit digest, audit retention cleanup
│   │   └── health/          # Health check
│   ├── dashboards/          # Dashboard pages (see Dashboard Directory below)
│   ├── suites/              # 8 role-gated suite landing pages
│   │   ├── admin/           # Admin suite
│   │   ├── operations/      # Operations suite
│   │   ├── design-engineering/
│   │   ├── permitting-interconnection/
│   │   ├── service/         # Service suite
│   │   ├── dnr-roofing/     # D&R + Roofing suite
│   │   ├── intelligence/    # BI suite
│   │   └── executive/       # Executive suite
│   ├── sop/                 # SOP viewer/editor app
│   └── globals.css          # Theme CSS variables + animations
├── components/
│   ├── DashboardShell.tsx   # Wraps most dashboard pages (mobile opts out)
│   ├── SuitePageShell.tsx   # Wraps suite landing pages
│   ├── GlobalSearch.tsx     # Cmd+K global search dialog
│   ├── UserMenu.tsx         # User profile + role display
│   ├── ChatWidget.tsx       # Claude AI chat interface
│   ├── BomHistoryDrawer.tsx # BOM version history sidebar
│   ├── BomPdfDocument.tsx   # BOM PDF export (react-pdf)
│   ├── ReviewActions.tsx    # Design review action buttons
│   ├── BugReportButton.tsx  # Bug report form
│   ├── ImpersonationBanner.tsx # Admin role impersonation banner
│   ├── ErrorBoundary.tsx    # React error boundary
│   ├── ui/                  # Reusable UI primitives
│   │   ├── MetricCard.tsx   # StatCard, MiniStat, MetricCard, SummaryCard
│   │   ├── MultiSelectFilter.tsx # Multi-select dropdown filter
│   │   ├── MonthlyBarChart.tsx   # Revenue bar chart
│   │   ├── CapacityHeatmap.tsx   # Crew capacity grid
│   │   ├── ConfirmDialog.tsx     # Confirmation modal
│   │   ├── NLSearchBar.tsx       # Natural language search
│   │   ├── Skeleton.tsx          # Loading skeleton
│   │   └── LiveIndicator.tsx     # SSE connection status
│   ├── catalog/             # Product catalog wizard components
│   │   ├── BasicsStep.tsx   # Brand/model/category entry
│   │   ├── DetailsStep.tsx  # Category-specific spec fields
│   │   ├── ReviewStep.tsx   # Review before submit
│   │   ├── SyncModal.tsx    # HubSpot/Zuper sync dialog
│   │   ├── VendorPicker.tsx # Vendor selection
│   │   ├── DedupPanel.tsx   # Duplicate product resolution
│   │   └── DatasheetImport.tsx # PDF datasheet extraction
│   ├── scheduler/           # Scheduling UI components
│   ├── solar/               # Solar Surveyor components
│   └── sop/                 # SOP editor components
├── contexts/
│   ├── ThemeContext.tsx      # Dark/light mode (html.dark class)
│   └── ToastContext.tsx      # Toast notification state
├── hooks/
│   ├── useSSE.ts            # Real-time SSE with exponential backoff
│   ├── useActivityTracking.ts # Audit trail logging
│   ├── useProgressiveDeals.ts # Progressive deal loading
│   ├── useExecutiveData.ts  # Executive dashboard data
│   ├── useProjectData.ts    # Project data fetching
│   ├── useFavorites.ts      # User favorites
│   └── useBaselineTable.ts  # Forecast baseline data
├── lib/                     # Business logic modules (see Major Systems below)
├── emails/                  # React Email templates
│   ├── SchedulingNotification.tsx
│   ├── SurveyInviteEmail.tsx
│   ├── SurveyConfirmationEmail.tsx
│   ├── ReassignmentNotification.tsx
│   ├── AvailabilityConflict.tsx
│   ├── ProductUpdate.tsx
│   ├── BugReport.tsx
│   └── VerificationCode.tsx
└── __tests__/               # Test files
prisma/schema.prisma          # Models and enums (count: `rg '^model ' prisma/schema.prisma | wc -l`)
```

## Major Systems

### 1. HubSpot CRM Integration (`lib/hubspot.ts`, `lib/hubspot-tickets.ts`)

Primary data source for deals, contacts, companies, and tickets. All API calls use `searchWithRetry()` with exponential backoff on 429 rate limits.

- **Deals**: Search, batch-read properties, association resolution (contacts, companies, line items)
- **Tickets**: Service pipeline tickets with stage map caching (5-min TTL), timeline (notes + emails)
- **Contacts**: Batch-read, association resolution to deals/tickets/companies
- **Line Items**: BOM-managed line items with lock-based concurrency control
- **Webhooks**: Design-complete and design-review triggers at `/api/webhooks/`
- **Custom Objects**: QC metrics, custom HubSpot object management

**Data normalization**: Raw deals (`RawProject`, camelCase from HubSpot) → `TransformedProject` (snake_case) via `lib/transforms.ts`.

**Pipeline IDs** (env vars):
- `HUBSPOT_PIPELINE_SALES` — Sales pipeline (default)
- `HUBSPOT_PIPELINE_PROJECT` — Project pipeline (6900017)
- `HUBSPOT_PIPELINE_DNR` — D&R pipeline (21997330)
- `HUBSPOT_PIPELINE_SERVICE` — Service pipeline (23928924)
- `HUBSPOT_PIPELINE_ROOFING` — Roofing pipeline (765928545)

### 2. BOM Pipeline (`lib/bom-*.ts`)

Automated deal-to-Sales-Order pipeline: extracts equipment from planset PDFs, matches to product catalog, pushes line items to HubSpot, creates Zoho Sales Orders.

**Four-stage pipeline:**

```
Stage 1: BOM Extraction (bom-extract.ts)
  └─ Claude vision reads planset PDF → BomItem[] (category, brand, model, qty)

Stage 2: Snapshot & Catalog Match (bom-snapshot.ts, bom-catalog-match.ts)
  ├─ Auto-increment version, post-process items
  ├─ Search Zoho Inventory by brand/model
  ├─ Match or create InternalProduct records
  └─ Queue PendingCatalogPush for unmatched items (90-day TTL)

Stage 3: HubSpot Line Items Push (bom-hubspot-line-items.ts)
  ├─ Acquire PENDING lock per deal (prevents concurrent pushes)
  ├─ Create line items from matched InternalProduct → HubSpot Product
  ├─ Delete prior BOM-managed items on success
  └─ Log result in BomHubSpotPushLog

Stage 4: Sales Order Creation (bom-so-create.ts, bom-so-post-process.ts)
  ├─ Post-process items (batch, bundle, suggest additions)
  ├─ Resolve Zoho customer from HubSpot company
  └─ Create draft Sales Order in Zoho Inventory
```

**Key gotchas:**
- Pipeline lock uses partial unique index: `(dealId) WHERE status='PENDING'`, stale after 5 min
- BOM items use `BomItem` type: category, brand, model, description, qty, unitSpec, unitLabel, flags
- `bom-post-process.ts` handles category-specific rules (racking per-module, electrical BOS bundling)
- `bom-pipeline.ts` orchestrates all stages with `BomPipelineRun` tracking in DB

**API routes** (`/api/bom/`): extract, save, push-to-hubspot, create-so, zoho-so, zoho-customers, zoho-vendors, linked-products, history, feedback, notify, pipeline-retry, upload, upload-token, export-pdf, resolve-customer, drive-files, chunk

### 3. Service Suite (`lib/hubspot-tickets.ts`, `lib/service-priority.ts`, `lib/customer-resolver.ts`)

Service operations: ticket management, priority queue scoring, and customer 360-view lookup.

**Ticket System** (`hubspot-tickets.ts`):
- Fetches all open tickets from HubSpot service pipeline
- Resolves ticket → deal associations for location derivation
- Location fallback chain: ticket → deal → pb_location, else ticket → company → city/state
- Stage map cached with 5-min TTL
- Detail view includes timeline (notes + emails via HubSpot search API)

**Priority Queue** (`service-priority.ts`):
- Scores service deals + tickets on 0–100 scale
- Tiers: Critical (75–100), High (50–74), Medium (25–49), Low (0–24)
- Scoring factors:
  - Warranty expiry: up to 40 pts (expired +30, ≤7 days +40, ≤30 days +15)
  - Last contact recency: up to 35 pts (>7 days +35, >3 days +25, >1 day +5)
  - Stage duration: up to 20 pts (>7 days stuck +20, >3 days +10)
  - Deal value: up to 10 pts (>$10k +10, >$5k +5)
  - Stage-specific urgency: up to 5 pts (Inspection, Invoicing = urgent)
- Manual overrides via `ServicePriorityOverride` DB table
- Cache key: `service:priority-queue`, cascades from `deals:service*` and `service-tickets*`

**Customer History** (`customer-resolver.ts`):
- Contact-based search: queries HubSpot contacts by name/email/phone/address + companies
- Detail resolution: batch-read contact → deals, tickets, jobs (Zuper) associations
- Zuper jobs resolved via deal-linked cache OR name/address heuristic fallback
- Max 25 results returned, deduplicated

**API routes** (`/api/service/`): tickets, customers, priority-queue, equipment

### 4. Product Catalog (`lib/catalog-*.ts`, `components/catalog/`)

Product specification management with multi-system sync (HubSpot Products, Zuper Custom Fields, Zoho Inventory).

**8 equipment categories** with category-specific spec fields (`catalog-fields.ts`):
1. **MODULE** — wattage, efficiency, cell type, Voc/Isc/Vmp/Imp, temp coefficients
2. **INVERTER** — AC output, max DC input, phase, MPPT channels, type
3. **BATTERY** — capacity (kWh), usable capacity, power, chemistry, efficiency
4. **BATTERY_EXPANSION** — pass-through (no extra fields)
5. **EV_CHARGER** — power (kW), connector type, amperage, voltage, level
6. **RACKING** — mount type, material, tilt range, wind/snow ratings
7. **ELECTRICAL_BOS** — component type, gauge, voltage rating
8. **MONITORING** — device type, connectivity, compatible inverters

**Catalog wizard** (`components/catalog/`): StartModeStep → BasicsStep → DetailsStep → ReviewStep. Supports clone-from-existing and datasheet PDF import.

**Sync pipeline** (`catalog-sync.ts`): InternalProduct → HubSpot Product (properties mapped via `hubspotProperty` field definitions) + Zoho Inventory item creation/update.

**Deduplication** (`catalog-dedupe.ts`): Groups products by canonical brand+model, presents merge candidates via `DedupPanel`.

### 5. Zoho Inventory Integration (`lib/zoho-inventory.ts`)

Product and sales order management. OAuth2 refresh token flow (recommended over static tokens).

- **Search**: List items by name, SKU, description, status
- **Create/Update**: Inventory items with category mapping to Zoho `group_name`
- **Sales Orders**: Created from BOM pipeline with customer/vendor resolution
- **Stock**: Per-location stock levels (warehouses mapped to PB locations)

**Token refresh**: Uses `ZOHO_INVENTORY_REFRESH_TOKEN` + client ID/secret. Auto-refreshes expired tokens.

### 6. Scheduling System (`lib/scheduling-*.ts`, `lib/google-calendar.ts`)

Multi-type scheduling: surveys, installations, inspections, roofing, D&R, service.

- **Calendar sync**: Google Calendar API integration for shared install/survey calendars per location
- **Scheduling policy** (`scheduling-policy.ts`): Sales role can only schedule surveys 2+ days out
- **Travel time** (`travel-time.ts`): Google Maps Distance Matrix for survey slot warnings
- **Crew management**: `CrewMember`, `CrewAvailability`, `AvailabilityOverride` models
- **Schedule optimizer** (`schedule-optimizer.ts`): Crew capacity planning and optimization

**Location-specific calendars** (env vars): `GOOGLE_INSTALL_CALENDAR_DTC_ID`, `GOOGLE_INSTALL_CALENDAR_WESTY_ID`, `GOOGLE_INSTALL_CALENDAR_COSP_ID`, `GOOGLE_INSTALL_CALENDAR_CA_ID`, `GOOGLE_INSTALL_CALENDAR_CAMARILLO_ID`

### 7. Forecast System (`lib/forecasting.ts`, `lib/forecast-ghosts.ts`)

Revenue forecasting with pipeline visualization.

- **Forecast ghosts** (`forecast-ghosts.ts`): Creates phantom events for pre-construction projects without scheduled dates. Filters to survey/rtb/blocked/design/permitting stages, excludes already-scheduled projects.
- **Stage normalization**: Maps raw HubSpot stage names → survey, rtb, blocked, design, permitting, construction, inspection
- **Dashboard pages**: forecast-timeline, forecast-schedule (pipeline breakdown), forecast-accuracy

### 8. SOP System (`app/sop/`, `lib/sop-access.ts`)

Standard operating procedures viewer/editor with role-gated access.

- **Access control** (edge-compatible, `sop-access.ts`):
  - Public tabs: hubspot, ops, ref
  - PM Guide: gated by first name match
  - Tech Ops tab: TECH_OPS role only
  - Admin-only sections: ref-user-roles, ref-system
- **Data model**: `SopTab` → `SopSection` → `SopRevision` with `SopSuggestion` for user feedback
- **Editor**: Rich text with sanitization (`sop-sanitize.ts`)

### 9. Audit & Compliance System (`lib/compliance-*.ts`, `lib/db.ts`)

Activity tracking and compliance monitoring.

- **Activity logging**: 50+ `ActivityType` enums (LOGIN, SURVEY_SCHEDULED, ZUPER_JOB_CREATED, etc.)
- **Audit sessions**: `AuditSession` model with client type tracking (BROWSER, CLAUDE_CODE, CODEX, API_CLIENT)
- **Anomaly detection**: `AuditAnomalyEvent` with risk levels (LOW, MEDIUM, HIGH, CRITICAL)
- **Compliance digest**: Scheduled email reports via `/api/cron/`
- **Zuper compliance**: Cross-reference job status tracking

### 10. HubSpot Property Object (`lib/property-*.ts`, webhooks, cron, `/api/properties/`)

Custom HubSpot Property object that anchors deals, tickets, contacts, and equipment rollups to a canonical address. One property per normalized address; enforces dedup via `addressHash` (SHA-256 of `street+unit+city+state+zip`) and optional `googlePlaceId`.

**Data flow:**
```
Contact address change (HubSpot webhook)
  └─ geocode → resolve-geo-links (PB shop, AHJ, utility)
  └─ upsertPropertyFromGeocode → HubSpotPropertyCache row
  └─ associate deals/tickets/contacts via PropertyDealLink / PropertyTicketLink / PropertyContactLink
  └─ compute rollups (systemSizeKwDc, hasBattery, openTicketsCount, warranty dates)
```

**Components:**
- **Cache**: `HubSpotPropertyCache` (full mirror of HubSpot Property object) + three link tables with ownership labels (Current Owner / Previous Owner / Authorized Contact).
- **Sync** (`property-sync.ts`): `onContactAddressChange` is the entry point for all property creation/association. `upsertPropertyFromGeocode` is a reusable helper for manual-create flow.
- **Reconcile cron** (`/api/cron/property-reconcile`, daily 9am): nightly drift repair — re-fetches any property touched in last 24h and corrects cache divergence. Watermark-driven; safe to re-run.
- **Backfill script** (`scripts/backfill-properties.ts`): resumable 4-phase backfill (contacts → deals → tickets → rollups) with DB-tracked `PropertyBackfillRun` progress and stale-lock takeover.
- **Webhooks** (`/api/webhooks/hubspot/property/`): handles `contact.propertyChange` for address fields with DB-backed idempotency. `PROPERTY_SYNC_ENABLED=false` short-circuits to 200.

**UI surfaces** (gated on `NEXT_PUBLIC_UI_PROPERTY_VIEWS_ENABLED`):
- `<PropertyDrawer>` — slide-in detail view with equipment summary, owners, deals, tickets.
- `<PropertyLink>` — clickable address wrapper; requires structured `AddressParts` (no string parsing).
- `<PropertyDrawerProvider>` — context for opening the drawer from nested components.
- Wired on: Service Suite customer-360 (Properties section above Deals/Tickets/Jobs), Deals detail panel address row. Follow-ups tracked in `docs/superpowers/followups/` for ticket detail and scheduler pages.

**API routes** (`/api/properties/`): `[id]` (drawer detail), `resolve` (POST address → propertyId or null), `by-contact/[contactId]`, `manual-create` (admin-only).

**Feature flags:**
- `PROPERTY_SYNC_ENABLED` — webhook + cron + backfill kill switch. Cache tables sit empty until on.
- `NEXT_PUBLIC_UI_PROPERTY_VIEWS_ENABLED` — UI surfaces kill switch. Independent from sync flag.

Note: ATTOM-sourced fields (yearBuilt, squareFootage, roofMaterial, etc.) are null until ATTOM integration ships (follow-up spec). Current implementation populates only HubSpot-derivable + Google-geocoded fields.

### 11. Suite Navigation (`lib/suite-nav.ts`)

8 departmental suites with role-based visibility:

Suite switcher visibility (from `suite-nav.ts`):

| Suite | Roles in Switcher |
|-------|------------------|
| Operations | ADMIN, OWNER, PM, OPS_MGR, OPS, TECH_OPS |
| Design & Engineering | ADMIN, OWNER, PM, TECH_OPS |
| Permitting & Interconnection | ADMIN, OWNER, PM, TECH_OPS |
| Service | ADMIN, OWNER, PM, OPS_MGR, OPS |
| D&R + Roofing | ADMIN, OWNER, PM, OPS_MGR, OPS |
| Intelligence | ADMIN, OWNER, PM, OPS_MGR |
| Executive | ADMIN, OWNER |
| Admin | ADMIN only |

**Note**: `roles.ts` grants PM and OPS_MGR direct route access to executive dashboards, but `suite-nav.ts` hides Executive from the suite switcher for those roles. Direct URL access works; the switcher doesn't show it.

Each suite uses `<SuitePageShell roles={user.roles}>` and links to its relevant dashboard pages.

## Key Patterns

### Dashboard Pages

Most dashboards wrap content in `<DashboardShell>` (exceptions: mobile uses a full-bleed layout):
```tsx
<DashboardShell
  title="Page Name"
  accentColor="orange"  // orange|green|red|blue|purple|emerald|cyan|yellow
  lastUpdated={data?.lastUpdated}
  exportData={{ data: rows, filename: "export.csv" }}
  fullWidth={true}      // optional, uses viewport instead of max-w-7xl
>
```

### Theme System

CSS variables in `globals.css` — **no runtime CSS injection**.

| Token | Usage |
|-------|-------|
| `bg-background` | Page background |
| `bg-surface` | Card/panel backgrounds |
| `bg-surface-2` | Nested/secondary surfaces |
| `bg-surface-elevated` | Modals, popovers |
| `text-foreground` | Primary text |
| `text-muted` | Secondary/label text |
| `border-t-border` | Borders and dividers |
| `shadow-card` | Standard card shadow |

Dark mode: `html.dark` class with radial gradient + SVG noise texture atmosphere on `body::before/::after`.

Keep `text-white` on colored buttons (orange, cyan, etc.). Remaining `bg-zinc-*` are intentional status colors.

### Metric Cards

Use components from `src/components/ui/MetricCard.tsx`:
- **StatCard**: Large accent gradient, for hero metrics
- **MiniStat**: Compact centered, for summary rows
- **MetricCard**: Flexible with border accent, for detail grids
- **SummaryCard**: Minimal, for simple key-value display

All use `key={String(value)}` + `animate-value-flash` for value-change animation.

### Real-time Data

```tsx
const { connected } = useSSE(() => refetchData(), {
  url: "/api/stream",
  cacheKeyFilter: "projects",
});
```

Exponential backoff: 1s → 2s → 4s → 8s → 16s, capped at 30s. Max 10 retries.

### Caching Strategy

- **React Query**: Client-side data caching with configurable stale times
- **Server cache** (`lib/cache.ts`): In-memory TTL cache for expensive API responses
- **Query keys** (`lib/query-keys.ts`): Centralized key factory for cache invalidation
- **Cache cascade**: Service priority queue listens to upstream `deals:service*` and `service-tickets*` invalidations with 500ms debounce to prevent thundering herd

### API Error Handling

HubSpot, Zuper, and Zoho clients all use rate-limit retry with exponential backoff:
- 429 rate limit: exponential backoff + retry
- 403/404: immediate failure
- Network errors: exponential backoff
- See `searchWithRetry()` in `hubspot.ts`

### Middleware (`src/middleware.ts`)

Handles:
- **Authentication**: NextAuth session validation
- **Security headers**: CSP, X-Frame-Options, HSTS, Permissions-Policy
- **Role-based routing**: 11-role system with impersonation support
- **Public routes**: deployment webhooks, portal, cron, health check
- **Machine token auth**: `API_SECRET_TOKEN` header for BOM/product endpoints
- **Maintenance mode**: Global redirect capability
- **Request ID**: Correlation ID across logs and Sentry

### User Roles

11 roles defined in Prisma schema (`User.roles: UserRole[]` — multi-role, Phase 2 complete). Legacy roles auto-normalize:
- `MANAGER` → `PROJECT_MANAGER`
- `DESIGNER` → `TECH_OPS`
- `PERMITTING` → `TECH_OPS`

| Role | Scope |
|------|-------|
| ADMIN | All routes, user management, system config |
| OWNER | All routes except admin |
| PROJECT_MANAGER | Full ops/D&E/P&I/intelligence/service/D&R (executive via direct URL, not in suite switcher) |
| OPERATIONS_MANAGER | Ops/service/D&R + intelligence (executive via direct URL, not in suite switcher) |
| OPERATIONS | Ops/service/D&R only |
| TECH_OPS | D&E/P&I/ops only |
| SALES | Sales scheduler + survey availability |
| VIEWER | Minimal dashboard/API access (new user default) |

Permission booleans override role defaults: `canScheduleSurveys`, `canScheduleInstalls`, `canScheduleInspections`, `canSyncZuper`, `canManageUsers`, `canManageAvailability`, `canEditDesign`, `canEditPermitting`, `canViewAllLocations`.

Admin impersonation: `pb_effective_roles` (JSON array) + `pb_is_impersonating` cookies, admin-only. The legacy `pb_effective_role` single-role cookie has been removed (Part 2B). The `User.role` single-role column is pending migration drop — see HUMAN ACTION REQUIRED in this doc.

**Role data model**: All code reads `user.roles[]` (the multi-role array). The legacy `User.role` column still exists in the DB schema pending a migration that must be run manually. Do NOT run `prisma migrate deploy` automatically.

## Zuper Integration

- Zuper API only allows setting `assigned_to` at job CREATION time, not updates
- Custom fields differ between GET (array of objects) and POST (flat object) formats
- Status is in `current_job_status`, not `status` field
- Job categories have separate status workflows
- Team UIDs and User UIDs configured via environment variables (JSON)
- Zuper catalog (`lib/zuper-catalog.ts`) syncs product specs to Zuper custom fields
- Job cache: `ZuperJobCache` Prisma model for fast lookups by deal ID

## Email System

Dual-provider with automatic failover:
1. **Primary**: Google Workspace (service account + domain-wide delegation via `GOOGLE_WORKSPACE_EMAIL_ENABLED`)
2. **Fallback**: Resend (`RESEND_API_KEY`)

8 React Email templates in `src/emails/`. Preview with `npm run email:preview`.

Optional BCC on scheduling notifications via `SCHEDULING_NOTIFICATION_BCC` env var.

## Dashboard Directory

Pages organized by department (full list: `find src/app/dashboards -name page.tsx`):

**Sales & Deals**: deals, sales, pending-approval, pipeline
**Operations & Scheduling**: scheduler, construction-scheduler, inspection-scheduler, site-survey-scheduler, roofing-scheduler, dnr-scheduler, service-scheduler, construction
**Design & Engineering**: design, design-engineering, de-overview, de-metrics, design-revisions, pe, utility-design-requirements
**Permitting & Interconnection**: permitting, interconnection, permitting-interconnection, pi-overview, pi-metrics, pi-action-queue, pi-ic-action-queue, pi-ic-revisions, pi-permit-action-queue, pi-permit-revisions, pi-revisions, pi-timeline
**Service**: service, service-overview, service-tickets, service-customers, service-backlog, service-scheduler
**D&R + Roofing**: dnr, roofing
**Inventory & BOM**: catalog, catalog/new, catalog/review, catalog/edit/[id], inventory, submit-product, bom, bom/history, equipment-backlog, product-comparison
**Forecasting**: forecast-timeline, forecast-schedule, forecast-accuracy
**Executive & BI**: executive, executive-calendar, command-center, capacity, optimizer, pipeline, clipping-analytics, incentives, ai, revenue, qc
**Project Management**: project-management, reviews/[dealId], timeline, plan-review, at-risk, alerts
**Compliance**: ahj-requirements, ahj-tracker, zuper-compliance, zuper-status-comparison, utility-tracker, inspections
**Solar Surveyor**: solar-surveyor, site-survey
**Other**: locations, mobile

## Database Schema Highlights

Prisma models organized by domain:

- **User/Auth**: User, ActivityLog, AuditSession, AuditAnomalyEvent, SystemConfig, IdempotencyKey
- **Scheduling**: BookedSlot, CrewMember, CrewAvailability, AvailabilityOverride, ScheduleRecord, RateLimit
- **Product Catalog**: CatalogProduct, InternalProduct, VendorLookup, ModuleSpec, InverterSpec, BatterySpec, EvChargerSpec, MountingHardwareSpec, ElectricalHardwareSpec, RelayDeviceSpec, InventoryStock, StockTransaction
- **BOM Pipeline**: BomToolFeedback, ProjectBomSnapshot, PendingCatalogPush, BomHubSpotPushLog, BomPipelineRun, CatalogMatchGroup
- **Service**: ServicePriorityOverride, ChatMessage
- **Caches**: HubSpotProjectCache, ZuperJobCache
- **Property Object**: HubSpotPropertyCache, PropertyDealLink, PropertyTicketLink, PropertyContactLink, PropertyCompanyLink, PropertySyncWatermark, PropertyBackfillRun
- **Reviews**: ProjectReview, DesignReviewFeedback
- **SOP**: SopTab, SopSection, SopRevision, SopSuggestion
- **Solar Surveyor**: SolarProject, SolarProjectRevision, SolarFeedback, SolarProjectShare, SolarPendingState, SolarWeatherCache, SolarShadeCache, SolarCustomEquipment
- **Workflows**: SurveyInvite, RoadmapItem, ZohoDedupRun, OutboxEvent, HubSpotSyncRun, BugReport

## Conventions

- Use `DashboardShell` for new dashboard pages (unless full-bleed layout is needed, like mobile)
- Use `SuitePageShell` for suite landing pages
- Use theme tokens (`bg-surface`, `text-foreground`, etc.) — never hardcode colors
- Use `stagger-grid` CSS class for animated grid entry
- Use `MultiSelectFilter` for filterable lists (not custom dropdowns)
- Keep `.env` files out of commits — secrets managed via Vercel env vars
- ESLint flat config: `eslint-config-next/core-web-vitals` + `typescript`
- Prisma output goes to `src/generated/prisma`
- React Query keys centralized in `lib/query-keys.ts`
- All HubSpot/Zuper/Zoho API calls must use rate-limit retry wrappers
- BOM pipeline operations must acquire lock before mutating line items
- Service priority scores recalculate on upstream cache invalidation
- Email templates use React Email — preview with `npm run email:preview`
- Catalog field definitions in `lib/catalog-fields.ts` drive form rendering AND external system property mapping
