# Service Suite Deferred Items — Design Spec

**Date**: 2026-03-27
**Source**: Zach / Jessica Service Suite meeting (Mar 26, 2026) — Non-Goals section
**Scope**: Master scheduler service job enhancements, service backlog stage filtering, sync modal UX improvements

---

## 1. Goals and Non-Goals

### Goals
- Day view on the master scheduler (`/dashboards/scheduler`) with hour-by-hour timeline
- Zuper and HubSpot links in the master scheduler's overlay detail modal for service/D&R jobs
- All assignees shown on service/D&R overlay events (abbreviated on card, full list in modal)
- Service backlog reclassifies Inspection/Invoicing as "built" to match the ops backlog pattern
- Sync modal system columns sorted alphabetically with Internal pinned first
- Sync modal sticky header row with system color coding
- Sync modal custom text input option in per-cell dropdowns, propagated as a source to sibling columns

### Non-Goals
- HubSpot workflow automation changes
- New HubSpot properties for schedule start/complete dates
- Adding new stages to the service pipeline (e.g., Close Out)
- Changes to the dedicated service scheduler (`/dashboards/service-scheduler`) — enhancements target the master scheduler only

---

## 2. Master Scheduler Service Job Enhancements

### 2a. Day View

**Current state:** The master scheduler (`/dashboards/scheduler`) has Month, Week, and Gantt views. No day view exists. Clicking a date on the month/week grid does nothing beyond showing events for that cell.

**Design:**

Add a **Day** view as the fourth view mode in the toggle bar: Month | Week | **Day** | Gantt.

**Entry points:**
- Click the "Day" button in the view toggle
- Click a date number on the month or week grid to jump directly to that day's view

**Layout:**
- Vertical time axis from **6:00 AM to 8:00 PM** (15 rows at 1-hour intervals)
- Full-width single lane — all job types (installs, inspections, surveys, service, D&R, forecasts) render in the same column
- Each job renders as a colored block spanning its scheduled time to end time (default: 1 hour if no duration)
- Jobs without a scheduled time slot stack in an **"All Day / Unscheduled"** row pinned at the top above the time grid
- Color coding matches existing month/week conventions:
  - Blue: Construction/Install
  - Cyan: Survey
  - Violet: Inspection
  - Purple (dashed): Service overlay
  - Amber (dashed): D&R overlay
  - Emerald: RTB
  - Yellow: Blocked

**Navigation:**
- Prev/Next day arrows
- "Today" button
- Date label showing full date (e.g., "Thursday, March 27, 2026")
- Keyboard: left/right arrows change day

**Overlap behavior:** When events overlap in time, render them side-by-side within the time lane, each taking equal fractional width (e.g., two overlapping events each get 50% width). This matches the Google Calendar pattern. If three or more overlap, divide equally.

**Empty state:** When no jobs exist for the selected day, show a centered "No scheduled jobs" message in the time grid area.

**Click behavior:** Clicking a job opens the same detail modal/panel as month/week views (project detail panel for core projects, overlay detail modal for service/D&R).

### 2b. Overlay Detail Modal — Links

**Current state:** The overlay detail modal for service and D&R jobs is read-only with no external links. Regular project detail panels already have HubSpot and Zuper links.

**Design:**

Add two link buttons to the bottom of the overlay detail modal (matching the style of the regular project detail panel):

1. **"Open in Zuper"** — links to `https://web.zuperpro.com/jobs/{jobUid}/details`
   - Always shown (all overlay events have a Zuper job UID)

2. **"Open in HubSpot"** — links to `https://app.hubspot.com/contacts/{portalId}/deal/{dealId}`
   - Only shown when `hubspotDealId` is available on the overlay event
   - Some service/D&R jobs may not be linked to a HubSpot deal

**Data plumbing required:**
- The `OverlayEvent` interface in `scheduler/page.tsx` does not currently include `hubspotDealId`. Add `hubspotDealId?: string` to the interface.
- The `mapJobsToOverlayEvents` function must pass through `j.hubspotDealId` from the `ZuperCategoryJob` data (which already returns it from the API).
- `HUBSPOT_PORTAL_ID` is already available as `process.env.HUBSPOT_PORTAL_ID` server-side. The scheduler page is a client component — use the existing pattern from other scheduler pages (hardcoded `21710069` fallback, or expose via a layout-level server prop).

Button style: outlined buttons with external-link icon, matching existing link patterns in the scheduler.

### 2c. All Assignees

**Current state:** Overlay events carry a single `assignedUser: string` field (first assigned user from Zuper). The calendar card shows the first name only. The detail modal shows the single name.

**Design:**

**Data model change:**
- Change overlay event shape from `crew: string` (single) to `assignedUsers: string[]` (array of all assigned user names from the Zuper job response)
- The Zuper job response includes an `assigned_to` array with `user_name` fields for each assignee
- **API route change required:** `src/app/api/zuper/jobs/by-category/route.ts` currently maps only the first assigned user (breaks after first). Update to return all assigned users as `assignedUsers: string[]` in the response.

**Calendar card rendering:**
- One assignee: Show first name as-is (e.g., "Mike")
- Multiple assignees: Show first assignee's first name + count (e.g., "Mike +1", "Sarah +2")
- Displayed at the existing `text-[0.45rem] opacity-60` size below the job title

**Detail modal rendering:**
- "Assigned To" field shows all names as a comma-separated list (e.g., "Mike Johnson, Sarah Lee")
- Falls back to "Unassigned" when array is empty

---

## 3. Service Backlog Stage Filtering

**Current state:** The service backlog page (`/dashboards/service-backlog`) classifies stages into three tiers:
- **Backlog**: Project Preparation, Site Visit Scheduling, Inspection, Invoicing
- **In Progress**: Work In Progress
- **Completed**: Completed, Cancelled (excluded by API)

Inspection and Invoicing are incorrectly included in the backlog. By these stages, equipment has been procured and installed — they shouldn't count as "needed" equipment.

**Design:**

Mirror the ops equipment backlog (`/dashboards/equipment-backlog`) pattern by adding a "built" tier.

**Stage reclassification:**

| Classification | Stages | Behavior |
|---|---|---|
| **Backlog** | Project Preparation, Site Visit Scheduling | Full stat row, included in stage breakdown table |
| **In Progress** | Work In Progress | Full stat row, included in stage breakdown table |
| **Built** | Inspection, Invoicing | Compact summary line, excluded from stage breakdown table |
| **Excluded** | Completed, Cancelled | Filtered server-side by API, never returned |

**Code changes in `service-backlog/page.tsx`:**

1. Add `BUILT_STAGES` constant:
```typescript
const BUILT_STAGES = new Set(["Inspection", "Invoicing"]);
```

2. Expand `StageClass` type (drop `"completed"` — the API never returns Completed/Cancelled stages, so remove `COMPLETED_STAGES` and the completed branch entirely):
```typescript
type StageClass = "backlog" | "in_progress" | "built";
```

3. Update `classifyStage()` (remove the completed branch — server already filters those):
```typescript
function classifyStage(stage: string): StageClass {
  if (BUILT_STAGES.has(stage)) return "built";
  if (IN_PROGRESS_STAGES.has(stage)) return "in_progress";
  return "backlog";
}
```

4. Exclude built stages from the stage breakdown table (same pattern as ops backlog line 491):
```typescript
if (classifyStage(p.stage) === "built") continue;
```

5. Add compact green summary line (matching ops backlog pattern):
```tsx
{builtTotals.projects > 0 && (
  <div className="text-xs text-muted mb-6 text-center">
    <span className="text-green-400">{builtTotals.projects}</span> built projects not shown
    ({builtTotals.modules.toLocaleString()} modules, {builtTotals.inverters.toLocaleString()} inverters, {builtTotals.batteries.toLocaleString()} batteries)
  </div>
)}
```

6. Exclude built projects from headline backlog stat totals.

**No API changes needed** — the stages are already fetched, just reclassified client-side.

---

## 4. Sync Modal UX Improvements

**Current state:** `src/components/catalog/SyncModal.tsx` displays a field-by-field sync comparison grid for a single internal product across linked external systems (Zoho, HubSpot, Zuper). Current issues:
- System columns render in API response order (unpredictable)
- Column headers scroll out of view on long field lists
- No way to enter a custom value when all source options are incorrect
- No visual differentiation between system columns

### 4a. System Column Ordering

- **Internal** column pinned first (immediately after the field name column)
- External system columns sorted **alphabetically**: HubSpot → Zoho → Zuper
- Applied when building the column array from linked systems, before rendering

### 4b. Sticky Header Row with System Color Coding

**Sticky behavior:**
- `thead` gets `position: sticky; top: 0; z-index: 10`
- Solid background color on the sticky header to prevent content bleeding through

**System color coding — each system column gets a distinct color treatment:**

| System | Color Token | Top Border | Header Background |
|---|---|---|---|
| Internal | `emerald-500` | `border-t-2 border-emerald-500` | `bg-emerald-500/10` |
| HubSpot | `orange-500` | `border-t-2 border-orange-500` | `bg-orange-500/10` |
| Zoho | `red-500` | `border-t-2 border-red-500` | `bg-red-500/10` |
| Zuper | `purple-500` | `border-t-2 border-purple-500` | `bg-purple-500/10` |

The tinted background (`/10` opacity) extends to the full column body so system boundaries are visible even while scrolling. Subtle enough not to interfere with field value readability or the existing green/blue cell selection highlights.

### 4c. Custom Text Input

**Dropdown addition:**
- Add a **"Custom..."** option at the bottom of each cell's source dropdown (below Keep, Internal, and system relay options)
- Visually separated with a divider line above it

**Input behavior:**
- When "Custom..." is selected, the dropdown is replaced with a compact text input field
- Small "×" button adjacent to cancel and revert to dropdown mode
- Text input auto-focuses on appearance
- Pressing Enter or blurring the input confirms the custom value

**Value propagation:**
- The typed value becomes the projected sync value for that cell
- Other system columns on the **same field row** gain a new dropdown option: **"Custom"** — showing the custom value as the projected result
- This allows the user to type a correction once and push it to all systems
- If the custom value is cleared (via "×"), the "Custom" option disappears from sibling dropdowns

**Scope:** Custom input is available on both Internal and external system columns. A custom value is row-level — one custom value per field row, shared across all columns.

**Row-level custom value model:**
- Add a parallel `customValues: Record<string, string>` state map keyed by **field name only** (not `{system}:{field}`). Each field row has at most one custom value.
- When the user types a custom value in any column (Internal, HubSpot, Zoho, or Zuper), it writes to `customValues[fieldName]`.
- **Overwrite rule:** If the user enters a custom value on HubSpot for field "name", then enters a different custom value on Zoho for the same field, the second entry overwrites the first — there is only one custom value per row. The previously-selected "Custom" on the HubSpot column now reflects the updated value. This keeps the mental model simple: "Custom" means "the corrected value for this field."
- If the user clears a custom value (via "×"), all columns on that row that had selected "Custom" revert to "Keep."

**Type system changes:**
- Add `"custom"` as a new literal to the `SelectionMap` value type (alongside `"keep"`, `"internal"`, and system names)
- In `selectionToIntents`, when source is `"custom"`, resolve the value from `customValues[fieldName]` and emit a `FieldIntent` with `mode: "manual"` and a new `customValue: string` field added to the `FieldIntent` type
- The sync plan/confirm/execute endpoints accept the custom value as an override — the backend writes it directly instead of copying from a source system

Note: `mode: "manual"` already exists in `FieldIntent` (meaning "user-selected" vs "auto-selected"). The new `customValue` field distinguishes "user picked a source" from "user typed a value." When `customValue` is present, the sync executor uses it instead of reading from any system.

---

## 5. Affected Files

| Area | Files |
|---|---|
| Master scheduler day view | `src/app/dashboards/scheduler/page.tsx` (new view mode + day component) |
| Overlay modal links | `src/app/dashboards/scheduler/page.tsx` (overlay detail modal section, OverlayEvent interface) |
| All assignees — API | `src/app/api/zuper/jobs/by-category/route.ts` (return all assigned users, not just first) |
| All assignees — frontend | `src/app/dashboards/scheduler/page.tsx` (overlay event mapping + card + modal rendering) |
| Service backlog stages | `src/app/dashboards/service-backlog/page.tsx` (stage classification + built summary) |
| Sync modal ordering | `src/components/catalog/SyncModal.tsx` (column sort logic) |
| Sync modal sticky headers | `src/components/catalog/SyncModal.tsx` (thead styling) |
| Sync modal color coding | `src/components/catalog/SyncModal.tsx` (column header + body tinting) |
| Sync modal custom input — UI | `src/components/catalog/SyncModal.tsx` (dropdown option + input UI + value propagation + customValues state) |
| Sync modal custom input — types | `src/lib/catalog-sync-types.ts` (add `customValue` to FieldIntent) |
| Sync modal custom input — intents | `src/lib/selection-to-intents.ts` (handle `"custom"` source) |
| Sync plan backend | `src/app/api/inventory/products/[id]/sync/` routes (accept custom value overrides) |

---

## 6. Testing

### Master Scheduler
- Day view renders hour slots 6am–8pm
- Clicking a date on month/week grid opens day view for that date
- All job types display with correct colors in day view
- Overlay detail modal shows Zuper + HubSpot links
- Calendar cards show "Mike +1" for multi-assignee jobs
- Detail modal lists all assignee names

### Service Backlog
- Inspection and Invoicing stages excluded from stage breakdown table
- Built summary line appears with correct counts
- Headline backlog totals exclude built projects
- Existing backlog and in-progress behavior unchanged

### Sync Modal
- System columns appear in order: Internal, HubSpot, Zoho, Zuper
- Header row remains visible when scrolling down
- Each system column has its color-coded header and tinted background
- "Custom..." option appears in dropdown, opens text input
- Typed custom value appears as source option in sibling system dropdowns
- Custom value syncs correctly with `manual` source type
- Canceling custom input reverts to dropdown without side effects
