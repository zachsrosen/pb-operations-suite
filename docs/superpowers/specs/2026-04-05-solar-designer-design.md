# Solar Designer — Design Spec

## Overview

Replace the standalone Solar Surveyor V12 HTML tool and the partially-built native Solar Surveyor in PB Ops with a single, unified **Solar Designer** tool. Built natively in React inside the PB Operations Suite, accessible from any suite (Service, Design & Engineering, etc.). Uses Jacob Campbell's V12 calculation engine as the source of truth, ported to typed TypeScript modules.

**Problem:** The service team needs to diagnose production issues on existing installs (flagged at 180 days / 1 year). The design team needs to analyze stringing, shading, and clipping pre-construction. Both need to compare results against the production guarantee. Currently the tool exists only as a local HTML file on Jacob's machine, with manual DXF/JSON/CSV file uploads. The service team has no access to the design data.

**Solution:** One tool for both teams. Auto-fetches roof geometry and shade data via EagleView API, pulls production guarantee from HubSpot deals, and provides the full analysis suite (visualizer, stringing, production, timeseries, inverters, battery, AI, scenarios) to all users.

## Architecture

### Engine

- **Source of truth:** Jacob's V12 HTML calculation engine
- **Location:** `src/lib/solar/v12-engine/`
- **Modules to extract from V12:**
  - `production.ts` — per-panel production calculation (independent + string-level + EagleView models)
  - `stringing.ts` — string builder logic, auto-string algorithm, voltage validation
  - `mismatch.ts` — string mismatch loss calculation
  - `clipping.ts` — inverter clipping detection, severity classification, event logging
  - `dispatch.ts` — battery dispatch simulation (self-consumption, TOU, export-first modes)
  - `timeseries.ts` — 30-minute interval production timeseries generation
  - `ai-analysis.ts` — design score calculation, issue detection, recommendations
  - `scenarios.ts` — scenario save/load/compare, delta calculations, export
  - `equipment.ts` — equipment catalog (panels, inverters, ESS, optimizers)
  - `consumption.ts` — home consumption profile (annual, monthly CSV, zip-based climate)
  - `physics.ts` — irradiance, temperature derating, bifacial gain, system derate
- **Existing engine overlap:** `src/lib/solar/engine/` already has partial V12 ports. Mapping:

  | Existing module | V12 equivalent | Action |
  |-----------------|---------------|--------|
  | `engine/model-a.ts` | `APP.process()` independent panel calc | Evaluate — may reuse if output matches V12 |
  | `engine/model-b.ts` | `APP.process()` string-level calc | Evaluate — may reuse if output matches V12 |
  | `engine/dispatch.ts` | `APP.runEnergyDispatch()` | Header says "Ported from V12 app.js:1409-1676" — likely reusable |
  | `engine/physics.ts` | V12 irradiance/temp derating | Evaluate — compare formulas |
  | `engine/consumption.ts` | V12 home consumption profile | Evaluate |
  | `engine/runner.ts` | `APP.process()` orchestrator | Replace with V12-faithful orchestrator |
  | `engine/weather.ts` | V12 weather lookup | Evaluate |
  | `engine/architecture.ts` | V12 string/micro/optimizer dispatch | Evaluate |
  | (none) | V12 AI analysis / design score | New — extract from V12 |
  | (none) | V12 scenario comparison | New — extract from V12 |
  | (none) | V12 clipping event log | New — extract from V12 |

  **Strategy:** Before extracting each module fresh from V12, compare the existing engine module's output to V12's for the same inputs. If they match, reuse and re-type. If they diverge, re-port from V12. This avoids redundant work while keeping V12 as the source of truth.

- **Web Worker:** The engine runs in a Web Worker to keep the UI responsive during 8760-hour simulations. Reuse the existing worker protocol (`WorkerProgressMessage`, `WorkerResultMessage` from `src/lib/solar/types.ts`).

### Engine Interface Contracts

Top-level orchestrator (replaces `runner.ts`):
```typescript
interface SolarDesignerInput {
  panels: PanelGeometry[];        // from DXF/JSON/EagleView
  shadeData: ShadeTimeseries;     // per-point, 30-min intervals, 365 days
  strings: StringConfig[];        // panel assignments per string
  inverters: InverterConfig[];    // inverter assignments with MPPT channels
  equipment: EquipmentSelection;  // panel, inverter, ESS, optimizer keys
  siteConditions: SiteConditions; // temps, albedo, clipping threshold, export limit
  consumption?: ConsumptionConfig;
  batteryConfig?: BatteryConfig;
  lossProfile: LossProfile;
}

interface SolarDesignerResult {
  // Per-panel
  panelStats: PanelStat[];        // irradiance, TSRF, independent kWh, EV SAV
  // System totals
  production: { independentAnnual: number; stringLevelAnnual: number; eagleViewAnnual: number; };
  mismatchLossPct: number;
  clippingLossPct: number;
  clippingEvents: ClippingEvent[];
  // Timeseries (30-min intervals)
  independentTimeseries: Float64Array[];  // per-string
  stringTimeseries: Float64Array[];       // per-string
  // Energy balance
  energyBalance: EnergyBalance;
  // AI
  designScore: number;            // 0-100
  issues: DesignIssue[];
  recommendations: string[];
}
```

Detailed type definitions for sub-interfaces will be defined during Stage 1 implementation.

### UI

- **Page:** `/dashboards/solar-designer`
- **Components:** `src/components/solar-designer/`
- **Shell:** `DashboardShell` with suite theme tokens
- **Tabs (matching V12):**
  1. Visualizer — SVG panel renderer with shade simulation (day/time/rotation sliders)
  2. Stringing — click-to-assign string builder with color coding
  3. Production — per-panel table (TSRF, independent kWh, string kWh, mismatch, EV SAV, status)
  4. 30-Min Series — timeseries charts with Model A/B/C overlays, battery SoC
  5. Inverters — per-inverter cards with MPPT channels, clipping analysis, DC/AC charts
  6. Battery — dispatch simulation, energy balance, grid independence, annual savings
  7. AI Analysis — design score (0-100), issue detection, recommendations
  8. Scenarios — save/load/compare configurations, side-by-side metrics table

### Data Sources

| Source | Data | Integration |
|--------|------|-------------|
| EagleView API | Roof geometry, panel positions, shade data, TSRF, SAV | New — requires developer account setup |
| HubSpot API | Production guarantee, installed equipment, system size, deal context | Existing — add deal search + guarantee field read |
| NREL TMY API | 8760-hour GHI + ambient temp | Existing — `SolarWeatherCache` |
| Google Solar API | Fallback shade data (roof segments, sunshine quantiles) | Existing — `SolarShadeCache` |
| Manual upload | DXF, JSON layout, shade CSVs | Existing V12 flow — fallback when APIs unavailable |

### Data Storage

- **Projects:** `SolarProject` + `SolarProjectRevision` (existing Prisma models)
- **Deal linking:** Add `hubspotDealId: String?` field to `SolarProject`
- **EagleView cache:** New `EagleViewCache` model:
  ```
  model EagleViewCache {
    id         String   @id @default(cuid())
    addressKey String   @unique  // normalized address hash
    reportData Json              // full EagleView API response
    fetchedAt  DateTime @default(now())
  }
  ```
  TTL: 90 days (roof geometry doesn't change often)
- **Equipment:** `SolarCustomEquipment` (existing) + built-in catalog from V12

### API Routes

Grouped by the stage that introduces them:

| Stage | Route | Purpose |
|-------|-------|---------|
| 2 | `POST /api/solar-designer/projects` | Create project |
| 2 | `GET /api/solar-designer/projects` | List projects (paginated, searchable) |
| 2 | `GET /api/solar-designer/projects/[id]` | Get project + latest revision |
| 2 | `PUT /api/solar-designer/projects/[id]` | Update project metadata |
| 2 | `POST /api/solar-designer/projects/[id]/revisions` | Save revision (auto-increment) |
| 2 | `POST /api/solar-designer/upload` | Upload DXF/JSON/CSV files, return parsed layout |
| 5 | `POST /api/solar-designer/projects/[id]/scenarios` | Save scenario snapshot |
| 5 | `GET /api/solar-designer/projects/[id]/scenarios` | List scenarios for project |
| 5 | `POST /api/solar-designer/export` | Export PDF/CSV/JSON report |
| 6 | `GET /api/solar-designer/hubspot/search` | Search deals by name/address/deal ID |
| 6 | `GET /api/solar-designer/hubspot/deal/[dealId]` | Get deal details + production guarantee + equipment |
| 6 | `POST /api/solar-designer/projects/[id]/link-deal` | Link project to HubSpot deal |
| 7 | `POST /api/solar-designer/eagleview/fetch` | Fetch roof geometry + shade data by address |
| 7 | `GET /api/solar-designer/eagleview/cache/[addressKey]` | Check cache for existing EagleView data |

Existing routes reused as-is: `/api/solar/weather` (NREL TMY), `/api/solar/shade` (Google Solar API fallback), `/api/solar/equipment` (custom equipment CRUD).

### Schema Changes

**Stage 2** — Add to existing `SolarProject` model:
```prisma
hubspotDealId String?   // linked HubSpot deal for guarantee comparison
```

**Stage 7** — New model:
```prisma
model EagleViewCache {
  id         String   @id @default(cuid())
  addressKey String   @unique  // normalized address hash
  reportData Json              // full EagleView API response
  fetchedAt  DateTime @default(now())
}
```

Migration runs with `prisma migrate deploy` in the stage that introduces the change. The `hubspotDealId` field is nullable and non-breaking, so Stage 2 migration is safe to run against production with zero downtime.

### Role Permissions & Access

- **Route**: `/dashboards/solar-designer`
- **Allowed roles**: ADMIN, OWNER, PROJECT_MANAGER, OPERATIONS_MANAGER, OPERATIONS, TECH_OPS
- **Files to update**:
  - `src/lib/role-permissions.ts` — add route to allowed lists for above roles
  - `src/lib/suite-nav.ts` — add entry under Service Suite and Design & Engineering Suite
  - `src/lib/page-directory.ts` — register page metadata
  - `src/components/DashboardShell.tsx` — no changes needed (uses existing pattern)
- **No suite-specific feature gating** — identical tool for all roles

### Navigation

- Accessible from **Service Suite**, **Design & Engineering Suite**, and direct URL
- Entry point: search bar (customer name, address, or deal ID)
- Project browser for saved projects
- No suite-specific feature gating — same tool for everyone

## Build Stages

### Stage 1: Engine Extraction
Extract V12's core math into `src/lib/solar/v12-engine/` as typed TS modules. Unit tests validating output matches V12 for known inputs. No UI — just the math layer.

**Deliverable:** All V12 calculation functions ported and tested.

**Acceptance criteria:**
1. Each V12 module (`production`, `stringing`, `mismatch`, `clipping`, `dispatch`, `timeseries`, `ai-analysis`, `scenarios`, `equipment`, `consumption`, `physics`) exists as a typed TS file
2. Unit tests for each module pass with known V12 input/output pairs (Jacob's test data)
3. Independent panel production (Model A) matches V12 output within 0.1% for the test project
4. String-level production (Model B) matches V12 output within 0.1% for the test project
5. Engine runs in a Web Worker without blocking the main thread

### Stage 2: Core UI Shell
New page at `/dashboards/solar-designer`. Search bar, project browser, tab layout matching V12's 8 tabs, equipment selection panel, site conditions panel, manual file upload (DXF/JSON/CSV). Uses suite theme tokens and `DashboardShell`. Prisma migration adds `hubspotDealId` to `SolarProject`.

**Deliverable:** Working shell with file upload → panel count displayed.

**Acceptance criteria:**
1. Page loads at `/dashboards/solar-designer` wrapped in `DashboardShell`
2. DXF, JSON, and CSV file upload parses and displays panel count
3. Equipment selection panel shows panels and inverters from catalog
4. Site conditions panel (temps, albedo, losses) renders with editable defaults
5. Tab bar shows all 8 tabs (content placeholder for unbuilt tabs)

### Stage 3: Visualizer + Stringing
SVG panel renderer with shade simulation (day/time slider). Manual string builder (click panels to assign). Auto-string. String electrical validation. String list with color coding.

**Deliverable:** Can upload files, see panels, build strings, validate voltage limits.

**Acceptance criteria:**
1. SVG renderer draws panels at correct positions from uploaded layout
2. Day/time slider animates shade across panels
3. Click-to-assign string builder works: create string, assign panels, remove panels
4. Auto-string produces valid strings within inverter voltage limits
5. Invalid strings (over/under voltage) show warning with specific violation

### Stage 4: Analysis Engine Integration
Wire engine to UI. Production table, system summary card (triple model), 30-minute timeseries charts, inverter view with clipping detection.

**Deliverable:** Full analysis runs and displays results across Production, Timeseries, and Inverter tabs.

**Acceptance criteria:**
1. Production table shows per-panel: TSRF, independent kWh, string kWh, mismatch %, EV SAV, status
2. System summary shows independent, string-level, and EagleView annual totals
3. 30-minute timeseries chart renders with Model A/B/C overlays
4. Inverter cards show MPPT channels, DC/AC ratio, clipping events
5. Progress indicator visible during engine computation (Web Worker messages)

### Stage 5: Scenarios + AI + Battery
Save/load/compare scenarios. Scenario comparison table with best-value highlighting. AI analysis recommendations (design score, issues, suggestions). Battery dispatch simulation. Export (PDF, CSV, JSON).

**Deliverable:** All 8 tabs fully functional with file-based data input.

**Acceptance criteria:**
1. Save scenario captures current stringing + equipment + site conditions
2. Compare view shows side-by-side metrics with best-value highlighting
3. AI tab shows design score (0-100), detected issues, and actionable recommendations
4. Battery tab runs dispatch simulation with self-consumption, TOU, and export-first modes
5. Export generates PDF report, CSV data, and JSON project file

### Stage 6: HubSpot Integration
Search deals by name/address/deal ID. Pull production guarantee from deal properties. Production guarantee comparison panel — modeled vs guaranteed, threshold decision support. Link projects to deals. Pull installed equipment from deal line items.

**Production guarantee comparison:**
- Display: modeled annual kWh vs guaranteed annual kWh (from deal property)
- Delta: absolute (kWh) and relative (%) difference
- Threshold bands: Green (modeled ≥ guaranteed), Yellow (modeled within 5% below), Red (modeled > 5% below)
- Service team decision support: if Red, flag as potential warranty claim; if Yellow, recommend further investigation
- Design team use: validate that design meets guarantee before construction

**Deliverable:** Can search a deal, auto-populate equipment, and compare analysis to production guarantee.

**Acceptance criteria:**
1. Deal search returns results by customer name, address, or deal ID
2. Selecting a deal auto-populates equipment from line items
3. Production guarantee value pulled from deal property and displayed
4. Comparison panel shows modeled vs guaranteed with color-coded threshold
5. Project linked to deal via `hubspotDealId` field

### Stage 7: EagleView API Integration
Set up EagleView developer account + API credentials. API client for ordering/retrieving measurements. Auto-fetch roof geometry, shade data, TSRF/SAV by address. `EagleViewCache` table with TTL. Fallback chain: EagleView → Google Solar API → manual upload.

**EagleView error handling and fallback:**
- **Cache hit (< 90 days):** Use cached data, show "Last fetched: [date]" badge
- **API success:** Cache response, proceed with data
- **API timeout / rate limit:** Show warning banner, auto-fall through to Google Solar API
- **API error (4xx/5xx):** Show error message with "Try Google Solar API" and "Upload manually" buttons
- **Google Solar API fallback:** Reduced fidelity (roof segments + sunshine quantiles, no per-point shade timeseries). Show "Reduced fidelity — Google Solar data" badge so user knows
- **All APIs fail:** Manual upload flow (DXF/JSON/CSV) with clear instructions
- **Cost guard:** If EagleView charges per-report, add confirmation dialog before API call: "This will order a new EagleView report for [address]. Continue?"

**Deliverable:** Open a project by address → roof and shade data auto-populate without file upload.

**Acceptance criteria:**
1. Enter address → EagleView data loads automatically (or from cache)
2. Cache serves data for repeat lookups within 90-day TTL
3. Fallback to Google Solar API works when EagleView fails
4. Manual upload remains available as last-resort fallback
5. Data source badge visible so user knows which source is active

### Stage 8: Navigation + Access
Add Solar Designer to Service Suite and D&E Suite nav. Feedback/notes section within the tool for cross-team handoff (service → design). Remove old Solar Surveyor nav entries.

**Deliverable:** Accessible from all relevant suites with notes/feedback flow.

**Acceptance criteria:**
1. Solar Designer appears in Service Suite and D&E Suite navigation
2. Old Solar Surveyor entries removed from nav
3. Notes/feedback section allows service → design handoff comments
4. Role permissions enforced (ADMIN, OWNER, PM, OPS_MGR, OPS, TECH_OPS)

### Stage 9: Polish + Training
Help/glossary panel. Production guarantee threshold guidance for service team. Tutorial or walkthrough content. Clean up old Solar Surveyor code paths.

**Deliverable:** Tool is self-explanatory for new users.

**Acceptance criteria:**
1. Help panel explains key terms (TSRF, SAV, mismatch, clipping, design score)
2. Service team guide explains production guarantee comparison workflow
3. Old Solar Surveyor routes redirect to Solar Designer
4. Old `src/lib/solar/engine/` code removed (after confirming no other consumers)

## Dependencies

- **EagleView API credentials** — must be set up before Stage 7. Does not block Stages 1-6.
- **HubSpot production guarantee field** — need to confirm the exact property name. Does not block Stages 1-5.
- **Jacob's V12 test data** — need sample DXF/JSON/shade files for a known project to validate engine extraction in Stage 1. Jacob committed to sharing test data to the shared drive.

## What This Replaces

- **Standalone V12 HTML file** — retired after Solar Designer reaches feature parity (end of Stage 5)
- **Vercel `solar_surveyor` project** — can be decommissioned
- **PB Ops native Solar Surveyor** (`/dashboards/solar-surveyor`, `src/lib/solar/engine/`, `src/components/solar/`) — old code paths removed after Solar Designer is stable
- **`/prototypes/solar-surveyor`** — redirect removed

## Out of Scope (for now)

- PowerHub (Tesla monitoring) integration — Jacob wants this for real-world production validation, but Tesla's API requirements need investigation (question for Pat)
- Scanify integration — Jacob is still evaluating; defer until they commit
- Microinverter vs string comparison feature — Jacob said this would be valuable but isn't built yet in V12
- Inverter conversion/upgrade modeling — Ted Barnett wants this for service, but V12 doesn't support it yet

## Open Questions

1. **EagleView API pricing** — per-report? subscription? Need to understand cost before committing to auto-fetch on every search.
2. **HubSpot production guarantee property name** — which deal property stores the guarantee value?
3. **V12 test data availability** — Jacob committed to sharing; need to confirm the shared drive location and file formats.
4. **Old engine cleanup timing** — when to remove `src/lib/solar/engine/` and converge on the V12-derived engine.
