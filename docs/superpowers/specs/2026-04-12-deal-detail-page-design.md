# Deal Detail Page

A full-page deal record view inside the suite UI — a read-only V1 replica of a HubSpot deal record that teams can use for quick reference, project tracking, and cross-department handoffs without switching to HubSpot.

## Route

`/dashboards/deals/[pipeline]/[dealId]` — hybrid server/client page.

- `pipeline`: `project`, `sales`, `dnr`, `service`, `roofing`
- `dealId`: Prisma Deal `id` (cuid) or `hubspotDealId` (numeric string)

The server component fetches the deal from Prisma, the client `DealDetailView` renders the interactive UI.

Add route to `SUITE_MAP` in `DashboardShell.tsx` under Operations Suite. Breadcrumb: `Operations Suite › Deals › {dealName}`.

## Navigation

### Entry points

1. **Deals table slide-out panel** — Add an "Open full record" link/button inside `DealDetailPanel.tsx`. Note: the current `TableDeal.id` is numeric (HubSpot deal ID), not the Prisma cuid, so the panel link uses the HubSpot ID form: `/dashboards/deals/{pipeline}/{hubspotDealId}`. The server component will redirect to the canonical cuid path on first load. This is acceptable — the redirect is a one-time 307 that's invisible to the user. If a future API change adds the Prisma `id` to the table payload, the link should switch to the cuid form to skip the redirect.

2. **Direct URL** — Shareable links. The canonical URL uses the Prisma `id` (cuid): `/dashboards/deals/project/clxyz123`. If someone navigates with a HubSpot deal ID (`/dashboards/deals/project/12345678`), the server component looks it up and issues a `redirect()` to the canonical cuid-based path.

3. **Global search** — Future: `GlobalSearch.tsx` results link to the detail page using the canonical cuid URL.

### Canonical URL resolution

The server component enforces a single canonical URL per deal: `/dashboards/deals/{pipeline}/{cuid}`. Two redirects ensure this:

1. **Identifier normalization:** If `[dealId]` is numeric (a HubSpot deal ID), look up the deal by `hubspotDealId`, then `redirect()` to `/dashboards/deals/{pipeline}/{deal.id}` (the cuid). All entry points (slide-out panel, global search, share links) should generate cuid-based URLs to avoid the redirect hop.

2. **Pipeline normalization:** If the URL `[pipeline]` segment doesn't match `deal.pipeline.toLowerCase()`, `redirect()` to the canonical pipeline path. This prevents duplicate routes and keeps breadcrumbs/share-links consistent.

## Data Source

### Server fetch

The `page.tsx` server component:

1. Looks up the deal by `dealId` param — try `prisma.deal.findUnique({ where: { id } })` first, fall back to `prisma.deal.findUnique({ where: { hubspotDealId } })`.
2. If not found, render a 404 component.
3. Pass the full `Deal` row as a serialized prop to the client `DealDetailView`.

No API route needed — direct Prisma access in the server component. This avoids a loading spinner and gives instant render.

### Contact data (existing — no schema change needed)

The Deal mirror already stores association-derived contact and company data, populated during batch/webhook sync from HubSpot association resolution (not deal properties):

| Prisma Column | Source | Notes |
|---|---|---|
| `customerName` | Contact association → `firstname + lastname` | Full name from associated contact |
| `customerEmail` | Contact association → `email` | Primary email |
| `customerPhone` | Contact association → `phone` | Primary phone |
| `hubspotContactId` | Contact association → `hs_object_id` | For HubSpot contact link |
| `companyName` | Company association → `name` | Associated company name |
| `hubspotCompanyId` | Company association → `hs_object_id` | For HubSpot company link |

The ContactCard sidebar renders from these existing columns. No new schema fields needed.

**Optional P2 enhancement:** If split first/last name is needed (e.g., for personalized emails), add `contactFirstName` / `contactLastName` as *new distinct columns* mapped from `first_name___primary_contact` / `last_name___primary_contact` deal properties. Do NOT overwrite the existing association-derived `customerName`. Similarly, `consultant_name__for_integration_` → `consultantName` and `consultant_email__for_integrations_` → `consultantEmail` can be added as new columns, and `customer_type` → `customerType`.

### Service pipeline fields (P1 pre-requisite)

| HubSpot Property | Prisma Column | Type |
|---|---|---|
| `service_type` | `serviceType` | String? |
| `service_visit_status` | `serviceVisitStatus` | String? |
| `service_visit_complete_date` | `serviceVisitCompleteDate` | DateTime? |
| `service_agreement_id` | `serviceAgreementId` | String? |
| `service_revisit_status` | `serviceRevisitStatus` | String? |
| `service_issue_resolved` | `serviceIssueResolved` | String? |
| `notes_for_service` | `serviceNotes` | String? |
| `service_account_number` | `serviceAccountNumber` | String? |
| `service_rate_equivalent` | `serviceRateEquivalent` | String? |
| `service_documents` | `serviceDocumentsUrl` | String? |
| `service_documents_folder_id` | `serviceDocumentsFolderId` | String? |

### Roofing/D&R pipeline fields (P1 pre-requisite)

| HubSpot Property | Prisma Column | Type |
|---|---|---|
| `roof_type` | `roofType` | String? |
| `roof_age` | `roofAge` | String? |
| `current_roofing_material` | `currentRoofingMaterial` | String? |
| `desired_roofing_material` | `desiredRoofingMaterial` | String? |
| `roof_color_selection` | `roofColorSelection` | String? |
| `roofing_project_type` | `roofingProjectType` | String? |
| `notes_for_roofing` | `roofingNotes` | String? |
| `roofr_form_url` | `roofrFormUrl` | String? |
| `roofr_id` | `roofrId` | String? |
| `roofr_property_information` | `roofrPropertyInfo` | String? |
| `roofr_property_type` | `roofrPropertyType` | String? |
| `os_roof_slope` | `roofSlope` | String? |
| `roofr_gclid` | `roofrGclid` | String? |

### P2 fields (fast follow)

These are useful but not blocking V1 launch:

**Scheduling extras:** `construction_schedule_start_date`, `construction_schedule_end_date`, `lead_installer`, `tentative_install_date`, `is_construction_scheduled_`, `mpu_scheduled_for`

**Inspection extras:** `ahj_inspections_required`, `inspections_lead`, `is_inspection_scheduled_`, `project_quality_score`, `quality_review_needed_`, `tentative_inspection_date`, `inspection_documents`, `inspection_document_folder_id`

**Incentive details:** `cpa_submit_date`, `cpa_blocked_date`, `cpa_expiration_date`, `n3ce_submit_date`, `n3ce_blocked_date`, `pbsr_submit_date`, `pbsr_blocked_date`, `sgip_app_number`, `sgip_submit_date`, `sgip_blocked_date`, `incentive_status`, `incentive_submit_date`

**Document folders:** `permit_document_id`, `permit_documents`, `interconnection_document_id`, `interconnection_documents`, `inspection_document_folder_id`, `installation_document_id`, `installation_documents`, `sales_document_folder_id`

## Page Layout

### Architecture

```
page.tsx (server component)
  └── DealDetailView.tsx (client component)
        ├── DealHeader          — name, stage badge, pipeline, location, amount
        ├── MilestoneTimeline   — visual pipeline progress
        ├── StatusFlagsBar      — boolean flag chips
        └── TwoColumnLayout
              ├── Left: CollapsibleSection[] — driven by section registry
              └── Right: DealSidebar (pinned)
                    ├── TeamCard
                    ├── EquipmentCard
                    ├── ContactCard
                    ├── ExternalLinksCard
                    └── QuickActionsCard (V2 placeholder)
```

### DashboardShell integration

```tsx
<DashboardShell
  title={deal.dealName}
  accentColor="orange"
  breadcrumbs={[
    { label: "Deals", href: "/dashboards/deals" },
    { label: deal.dealName }
  ]}
  syncMeta={{
    source: "deal-mirror",
    lastSyncedAt: deal.lastSyncedAt,
    staleness: formatStaleness(deal.lastSyncedAt),
  }}
  fullWidth={true}
>
```

### Above the fold

These three sections are always visible, not collapsible.

#### 1. DealHeader

Top-level deal identity. Single row layout:

| Element | Source | Notes |
|---|---|---|
| Deal name | `deal.dealName` | `text-lg font-semibold` |
| Stage badge | `deal.stage` | Colored pill using `getStageColor(pipeline, stage)` (see Styling) |
| Pipeline label | `deal.pipeline` | Plain text, muted |
| Location | `deal.pbLocation` | Plain text, muted |
| Amount | `deal.amount` | Green, formatted via `formatMoney()` |
| "Open in HubSpot" button | `deal.hubspotUrl` | External link, orange accent |

#### 2. MilestoneTimeline

Horizontal pipeline progress visualization. Each pipeline has its own stage sequence.

**Project pipeline stages:**
Survey → Design → Permitting → IC → RTB → Construction → Inspection → PTO → Complete

**Stage states:**
- **Completed** — green circle with checkmark, date below
- **Current** — orange circle with dot, glowing shadow, stage name highlighted
- **Future** — gray circle with empty ring, "—" below

Stage completion is derived from milestone dates:
- Survey: `siteSurveyCompletionDate`
- Design: `designCompletionDate`
- Permitting: `permitIssueDate`
- IC: `icApprovalDate`
- RTB: `rtbDate`
- Construction: `constructionCompleteDate`
- Inspection: `inspectionPassDate`
- PTO: `ptoCompletionDate`

Current stage is derived from `deal.stage` string matching.

**Other pipeline stage sequences:**

Stage order for all pipelines is sourced from the local `DealPipelineConfig` table in Postgres — **not** from `getStageOrder()` in `deals-pipeline.ts`, which fetches live from HubSpot on cache miss. Since this page's core promise is fast, local-only rendering from the Deal mirror, it must not introduce live HubSpot latency into the request path.

The server component reads `DealPipelineConfig` via Prisma:

```typescript
const pipelineConfig = await prisma.dealPipelineConfig.findUnique({
  where: { pipeline: deal.pipeline },
});

// DealPipelineConfig.stages is stored as:
// { id: string, name: string, displayOrder: number, isActive: boolean }[]
// (synced from HubSpot via syncPipelineConfigs() in deal-sync.ts)
type StoredStage = { id: string; name: string; displayOrder: number; isActive: boolean };

const stages = (pipelineConfig?.stages as StoredStage[]) ?? [];
const stageOrder: string[] = stages
  .sort((a, b) => a.displayOrder - b.displayOrder)
  .map(s => s.name);
```

`DealPipelineConfig.stages` is a Json column containing the full HubSpot `displayOrder`-sorted stage list (including terminal stages like "Closed Won", "Closed Lost"), synced during `syncPipelineConfigs()` in the deal-sync batch job. This is distinct from `ACTIVE_STAGES` which only contains non-terminal stages and should NOT be used for the timeline.

Per-pipeline rendering:

- **Project:** Full timeline (Survey → Design → Permitting → IC → RTB → Construction → Inspection → PTO → Complete). Terminal stages (Closed Won/Lost) shown as final node if applicable.
- **Sales:** Abbreviated timeline — Sales stages are less linear, so show a simplified version or omit the timeline if the stage count exceeds a threshold (>10 stages = collapse to current-stage-only indicator).
- **D&R, Service, Roofing:** Full timeline from `DealPipelineConfig.stages` output. These pipelines have fewer stages, so the timeline renders cleanly.

The timeline component accepts a `stages: { key, label, completedDate?, isCurrent }[]` prop — the `page.tsx` server component maps the `DealPipelineConfig` stage order + deal milestone dates into this generic shape via a `buildTimelineStages(pipeline, stageOrder, deal)` helper.

#### 3. StatusFlagsBar

Horizontal row of status chips. Shows all boolean flags from the deal, with visual encoding:

| State | Style |
|---|---|
| `true` | Green background, checkmark, "✓ {label}" |
| `false` (relevant to current/past stages) | Orange background, "◌ {label}" |
| `false` (future stages) | Gray background, "— {label}" |

Relevance logic: a flag is "relevant" if the pipeline stage it relates to is ≤ the current stage. Example: `isPermitSubmitted=false` is orange if the deal is past permitting, but gray if the deal is still in design.

**Boolean flags shown (Project pipeline):**
`isSiteSurveyScheduled`, `isSiteSurveyCompleted`, `isDaSent`, `isLayoutApproved`, `isDesignDrafted`, `isDesignCompleted`, `isPermitSubmitted`, `isPermitIssued`, `isIcSubmitted`, `isIcApproved`, `isInspectionPassed`, `hasInspectionFailed`

Other pipelines show only their relevant flags (or omit the bar if the pipeline has no boolean flags).

### Below the fold — Two-Column Layout

`display: flex` with `flex: 2` (left) and `flex: 1` (right sidebar). On screens < 1024px, collapses to single column with sidebar below main content.

#### Left Column: Collapsible Sections

Each section is a `CollapsibleSection` component:

```tsx
interface CollapsibleSectionProps {
  title: string;
  fieldCount: number;
  defaultOpen: boolean;
  children: React.ReactNode;
}
```

Sections render a 2-column grid of field/value pairs. Empty fields show "—" (never hidden).

```tsx
interface FieldDef {
  label: string;
  value: string | number | null;
  format?: "date" | "money" | "decimal" | "days" | "boolean" | "status";
  accentColor?: string; // for status dots
}
```

#### Serialized Deal DTO

The server component fetches a Prisma `Deal` row, then serializes it for the client. `Date` fields become ISO strings (`string | null`), `Decimal` fields become `number | null`, and `Json` fields (like `departmentLeads`) are pre-parsed. The client never touches the Prisma `Deal` type directly.

```typescript
// src/components/deal-detail/types.ts
export interface SerializedDeal {
  // Identity
  id: string;
  hubspotDealId: string;
  dealName: string;
  pipeline: string; // DealPipeline enum value as string
  stage: string;
  stageId: string;
  amount: number | null;

  // All other fields follow the same pattern:
  // - DateTime? → string | null (ISO 8601)
  // - Decimal? → number | null
  // - Json → pre-parsed object
  // - String/Int/Boolean → as-is
  [key: string]: unknown; // escape hatch for field access in registry
}
```

The `page.tsx` server component builds this via a `serializeDeal(deal: PrismaDeal): SerializedDeal` helper that handles all type conversions in one place.

#### Section Registry

A data-driven config that maps each pipeline to its ordered list of sections. This avoids if/else chains and makes adding pipeline-specific sections trivial. The registry consumes `SerializedDeal` (not the Prisma type) so all field access is safe on the client.

```typescript
interface SectionConfig {
  key: string;
  title: string;
  defaultOpen: boolean;
  pipelines: string[] | "all"; // DealPipeline enum values
  fields: (deal: SerializedDeal) => FieldDef[];
}

const SECTION_REGISTRY: SectionConfig[] = [
  // ... entries below
];
```

**Sections (Project pipeline):**

| # | Section | Default | Fields |
|---|---|---|---|
| 1 | Project Details | Open | address (full), AHJ, utility, location, amount, close date, project type, project number, system size DC, system size AC |
| 2 | Milestone Dates | Open | All 27 date fields from Deal model, grouped: Survey (3), Design (6), Permitting (2), IC (2), Construction (3), Inspection (5), PTO (2), Forecasted (3), Other (1 — createDate) |
| 3 | Status Details | Open | All status string fields: surveyStatus, designStatus, layoutStatus, permittingStatus, icStatus, installStatus, finalInspectionStatus, ptoStatus, readyForInspection, inspectionFailCount, inspectionFailureReason, participateEnergyStatus |
| 4 | Install Planning | Collapsed | installCrew, installDifficulty, expectedDaysForInstall, daysForInstallers, daysForElectricians, expectedInstallerCount, expectedElectricianCount, installNotes |
| 5 | Revision Counts | Collapsed | daRevisionCount, asBuiltRevisionCount, permitRevisionCount, icRevisionCount, totalRevisionCount |
| 6 | QC Turnaround Metrics | Collapsed | All 19 turnaround day fields, formatted as "X.X days" |
| 7 | Incentive Programs | Collapsed | n3ceEvStatus, n3ceBatteryStatus, sgipStatus, pbsrStatus, cpaStatus, participateEnergyStatus, isParticipateEnergy |

**Additional sections by pipeline:**

| Pipeline | Extra Sections |
|---|---|
| Service | "Service Details" (Open) — serviceType, serviceVisitStatus, serviceVisitCompleteDate, serviceRevisitStatus, serviceIssueResolved, serviceAccountNumber, serviceAgreementId, serviceRateEquivalent, serviceNotes |
| D&R | "Roofing Details" (Open) — roofType, roofAge, currentRoofingMaterial, desiredRoofingMaterial, roofColorSelection, roofingProjectType, roofSlope, roofingNotes |
| Roofing | Same "Roofing Details" section as D&R |
| Sales | Only "Project Details" and "Milestone Dates" (subset). Sales deals have fewer operational fields. |

Sections with `pipelines: "all"` appear for every pipeline. Pipeline-specific sections only appear when the deal's pipeline matches.

#### Right Column: Pinned Sidebar

The sidebar uses `position: sticky; top: 80px` (below DashboardShell header) so it stays visible while the left column scrolls.

##### TeamCard

| Field | Source |
|---|---|
| Owner | `deal.dealOwnerName` |
| PM | `deal.projectManager` |
| Ops Manager | `deal.operationsManager` |
| Surveyor | `deal.siteSurveyor` |
| Design Lead | `departmentLeads.design` |
| Permit Tech | `departmentLeads.permit_tech` |
| IC Tech | `departmentLeads.interconnections_tech` |
| RTB Lead | `departmentLeads.rtb_lead` |

Show all fields regardless of pipeline. Empty fields show "—".

##### EquipmentCard

| Field | Source | Format |
|---|---|---|
| Module | `moduleBrand` + `moduleModel` + `(×moduleCount)` | "REC 400AA (×31)" |
| Inverter | `inverterBrand` + `inverterModel` + `(×inverterQty)` | "Enphase IQ8+ (×31)" |
| Battery | `batteryBrand` + `batteryModel` + `(×batteryCount)` | "Enphase 5P (×2)" |
| Battery Expansion | `batteryExpansionModel` + `(×batteryExpansionCount)` | Only shown if count > 0 |
| EV Charger | `evCount` | "×{count}" or "—" |
| System Size | `systemSizeKwdc` / `systemSizeKwac` | "12.4 kW DC / 11.2 kW AC" |

##### ContactCard

Uses existing association-derived columns — no schema changes needed.

| Field | Source |
|---|---|
| Name | `deal.customerName` |
| Email | `deal.customerEmail` (clickable `mailto:`) |
| Phone | `deal.customerPhone` (clickable `tel:`) |
| Company | `deal.companyName` |
| HubSpot Contact | Link to `https://app.hubspot.com/contacts/{portalId}/record/0-1/{deal.hubspotContactId}` (if present) |

##### ExternalLinksCard

All links open in new tab. Only show links that have values (hide empty ones — exception to the "—" rule, since empty links aren't actionable).

| Link | Source | Icon hint |
|---|---|---|
| HubSpot Record | `deal.hubspotUrl` | HubSpot orange |
| Zuper Job | `https://app.zuper.co/app/job-detail/{deal.zuperUid}` (only if `zuperUid` exists) | Zuper blue |
| Google Drive | `deal.driveUrl` | Drive icon |
| Design Folder | `deal.designDocumentsUrl \|\| deal.designFolderUrl \|\| deal.allDocumentFolderUrl` | Folder icon |
| OpenSolar | `deal.openSolarUrl` | Solar icon |

##### QuickActionsCard (V2 placeholder)

Dashed-border placeholder card with muted text: "Edit fields, sync to HubSpot, schedule..."

Renders only if the user's role has edit permissions (future). For V1, show the placeholder for all users as a teaser.

## Empty Field Handling

All fields show "—" for null/empty values. No fields are hidden based on value. This makes gaps in the data visible — teams can see what's missing at a glance.

Exception: ExternalLinksCard hides empty links (a "—" link isn't useful).

## Styling

- Use theme tokens throughout (`bg-surface`, `bg-surface-2`, `text-foreground`, `text-muted`, `border-t-border`)
- Collapsible section headers: `bg-surface-2` with hover state
- Field labels: `text-xs text-muted uppercase tracking-wider`
- Field values: `text-sm text-foreground`
- Stage badge colors: pipeline-aware via `getStageColor(pipeline, stage)` helper in `section-registry.ts`. For the Project pipeline, reuses existing `STAGE_COLORS` from `lib/constants.ts`. For other pipelines, assigns colors by position in the `DealPipelineConfig.stages` order — early stages get cool colors (blue/indigo), mid stages get warm (orange/amber), terminal stages get green (won) or gray (lost). Fallback: `#71717A` (zinc-500) for unrecognized stages.
- Status dots: green (complete), orange (in-progress/pending), gray (future/empty)
- Sidebar cards: `bg-surface-2 rounded-lg p-3` with `text-xs` labels
- External links: `text-blue-400 hover:text-blue-300`
- Responsive breakpoint: `lg:flex-row flex-col` for the two-column layout
- Add `stagger-grid` class to section content grids for entry animation

## Component Files

```
src/app/dashboards/deals/[pipeline]/[dealId]/
  ├── page.tsx                  — server component (Prisma fetch, serialization)
  └── DealDetailView.tsx        — client component (full page layout)

src/components/deal-detail/
  ├── DealHeader.tsx            — name, stage, pipeline, amount
  ├── MilestoneTimeline.tsx     — horizontal pipeline progress
  ├── StatusFlagsBar.tsx        — boolean flag chips
  ├── CollapsibleSection.tsx    — generic accordion section
  ├── FieldGrid.tsx             — 2-column field/value grid
  ├── DealSidebar.tsx           — pinned right sidebar container
  ├── TeamCard.tsx              — team members
  ├── EquipmentCard.tsx         — equipment summary
  ├── ContactCard.tsx           — homeowner contact info
  ├── ExternalLinksCard.tsx     — outbound links
  ├── QuickActionsCard.tsx      — V2 placeholder
  └── section-registry.ts      — pipeline → sections config
```

## DealDetailPanel Update

Add a single line to the existing `DealDetailPanel.tsx` slide-out:

```tsx
<Link
  href={`/dashboards/deals/${deal.pipeline?.toLowerCase() ?? "project"}/${deal.id}`}
  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface-2 text-foreground border border-t-border rounded-lg text-xs font-medium hover:bg-surface-2/80 transition-colors"
>
  Open full record →
</Link>
```

Place it next to the existing "Open in HubSpot" button in the quick actions area. Note: `deal.id` here is the HubSpot deal ID (numeric) from `TableDeal`, not the Prisma cuid. The server component will redirect to the canonical cuid-based URL on load (see Canonical URL Resolution above).

## Versioning Roadmap

### V1 (this spec) — Read-only deal record
- All fields displayed, "—" for empty
- All 5 pipelines supported via section registry
- Pipeline-specific sections for Service, D&R, Roofing
- No edit capability
- Pre-req: P1 schema additions (service + roofing fields). Contact data uses existing association-derived columns.

### V2 — Inline edit
- `QuickActionsCard` becomes functional
- Field values become editable inputs on click
- Changes write back to Deal mirror + queue HubSpot sync via outbox
- Role-gated: only users with appropriate permissions can edit
- Optimistic UI with rollback on sync failure

### V3 — PB-opinionated views
- Custom views layered on top of the raw deal record
- "Project Health" summary card with automated risk flags
- "Next Steps" widget showing what's blocking the deal
- Pipeline-specific dashboards (e.g., install readiness checklist for Construction stage)
- Team activity timeline (who did what, when)

## Implementation Notes

- The `section-registry.ts` pattern is intentional — it makes the page data-driven so adding new sections or pipeline-specific overrides is a config change, not a component change. The registry consumes `SerializedDeal`, not the Prisma type.
- `deal.departmentLeads` is stored as `Json` in Prisma. The `serializeDeal()` helper pre-parses it using the existing `parseDepartmentLeads()` from `deal-reader.ts` (move to a shared util).
- For the milestone timeline, the `page.tsx` server component reads `DealPipelineConfig` from Postgres (not `getStageOrder()` which hits live HubSpot). A `buildTimelineStages(pipeline, stageOrder, deal)` helper maps the local stage order + milestone dates into the component's `{ key, label, completedDate?, isCurrent }[]` prop shape. All data for this page comes from Prisma — zero live HubSpot calls at render time.
- The sidebar's sticky positioning must account for the DashboardShell top bar height. Use `top: var(--shell-header-height, 64px)` or a hardcoded `top-16` if the shell header is fixed at 64px.
- The `[dealId]` route segment should handle both cuid format (`clxyz...`) and numeric HubSpot IDs (`12345678`). The server component tries both lookups.
- The server component creates a `SerializedDeal` via `serializeDeal()`: `Decimal` → `number | null`, `Date` → ISO string `| null`, `Json` → pre-parsed object. The client never imports or references Prisma types.
- If the URL `[pipeline]` segment doesn't match the deal's actual pipeline, the server component issues `redirect()` to the canonical path. No duplicate routes.
