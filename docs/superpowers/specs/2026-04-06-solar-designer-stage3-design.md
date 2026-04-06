# Solar Designer Stage 3 — Visualizer + Stringing Design Spec

## Overview

Stage 3 adds the two interactive tabs that make the Solar Designer usable: a panel visualizer with shade animation over a satellite image, and a mode-based string builder with live voltage validation. These build on Stage 2's shell (file upload, equipment selection, site conditions) and the v12-engine's core modules (layout parsing, shade data, auto-stringing, physics).

**Goal:** Upload layout files, see panels on a satellite image with shade animation, build strings manually or auto-assign, validate voltage limits.

**Architecture:** Single shared `PanelCanvas` SVG renderer used by both Visualizer and Stringing tabs. Shade-to-panel spatial association runs client-side as a pure function. Address geocoding provides satellite imagery context. Mode-based string builder with live voltage validation.

## Prerequisites

- Stage 1 (v12-engine) and Stage 2 (UI shell) merged or available on the working branch
- Google Geocoding API and Static Maps API enabled on the project's Google Cloud credentials (existing `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` or a separate API key)

## File Structure

### New Files (9)

| File | Responsibility |
|------|---------------|
| `src/lib/solar/v12-engine/shade-association.ts` | Pure function: radiance points → panel shade map. AABB prefilter + point-in-rotated-rect for accuracy. |
| `src/lib/solar/v12-engine/string-validation.ts` | Per-string Voc cold / Vmp hot calculation against inverter MPPT limits. Returns valid/warning/error status with violation details. |
| `src/components/solar-designer/PanelCanvas.tsx` | Stateless SVG renderer: panels + shade/TSRF layer + string color layer + hover tooltip. Props-only, no dispatch awareness. Accepts `backgroundImageUrl` for satellite tile. |
| `src/components/solar-designer/VisualizerTab.tsx` | Composes PanelCanvas + ShadeSlider. Fetches satellite tile URL, passes as prop. Shade/TSRF mode toggle. |
| `src/components/solar-designer/StringingTab.tsx` | Composes PanelCanvas + StringList. Click-to-assign interaction via `onPanelClick` callback. Auto-string button. |
| `src/components/solar-designer/ShadeSlider.tsx` | Day (1–365) + time-of-day (0–47) slider pair. Computes and emits timestep index. |
| `src/components/solar-designer/StringList.tsx` | Sidebar list of string cards: color swatch, panel count, voltage stats, validation badge. New/delete/select controls. Unassigned panel count. |
| `src/components/solar-designer/AddressInput.tsx` | Text input with geocode trigger. Dispatches `SET_ADDRESS` on success. Sits in sidebar above equipment panel. |
| `src/components/solar-designer/MapAlignmentControls.tsx` | Drag, rotate, and scale controls for positioning the panel array over the satellite image. Interaction: click-and-drag on the satellite image to reposition, rotation slider above the canvas, scroll wheel to zoom/scale. |

### Modified Files

| File | Change |
|------|--------|
| `src/components/solar-designer/types.ts` | New UI string type (`UIStringConfig`), 9 new action types, new state fields (`radiancePoints`, `panelShadeMap`, address/geocoding, map alignment, stringing UI state). `UPLOAD_SUCCESS` action gains `radiancePoints: RadiancePoint[]`. |
| `src/app/dashboards/solar-designer/page.tsx` | New state fields in `INITIAL_STATE` (including `radiancePoints: []`), new reducer cases, `UPLOAD_SUCCESS` stores `radiancePoints`. Visualizer + Stringing tabs render real components instead of placeholders. |
| `src/app/api/solar-designer/upload/route.ts` | Return full `radiancePoints: RadiancePoint[]` array (not just count) in the upload response. The `allRadiancePoints` accumulator replaces `radiancePointCount`. |
| `src/lib/solar/v12-engine/index.ts` | Add `RadiancePoint` to barrel exports (currently not exported) |

## Component Design

### PanelCanvas (shared SVG renderer)

Stateless component — receives render-ready props, emits callbacks. Does not know about the reducer, dispatch, or data fetching.

**Props:**
```typescript
interface PanelCanvasProps {
  panels: PanelGeometry[];
  panelShadeMap: Record<string, string[]>;     // panelId → shadePointIds
  shadeData: ShadeTimeseries;                   // pointId → binary string
  strings: UIStringConfig[];                    // for string color overlay
  timestep: number | null;                      // current shade timestep (null = no shade view)
  renderMode: 'shade' | 'tsrf' | 'strings';    // determines fill logic
  activeStringId: number | null;                // highlighted string in stringing mode
  backgroundImageUrl?: string;                  // satellite tile
  mapAlignment?: MapAlignment;                  // offset/rotation/scale for satellite
  onPanelClick?: (panelId: string) => void;     // click handler for stringing
  onPanelHover?: (panelId: string | null) => void;
}
```

**Rendering logic per panel:**
- `shade` mode: Blue fill at full opacity if sun, dark blue at reduced opacity if shaded, based on `shadeData[pointId][timestep]` averaged across associated points. Panels with empty `panelShadeMap[panelId]` render as dashed outline with "no data" label.
- `tsrf` mode: Heatmap gradient from red (low TSRF) to green (high TSRF). TSRF derived from associated radiance points' average TSRF. Static — no time dependency.
- `strings` mode: Fill color from string palette. String number label on each panel. Unassigned panels are dashed gray outlines. Active string's panels get a highlight stroke.

**ViewBox calculation:** Computed from panel bounding box with padding. All panel coordinates are in layout-space meters from the JSON upload.

### VisualizerTab

Composes `PanelCanvas` in `shade` or `tsrf` mode with `ShadeSlider` controls above.

- Fetches Google Maps Static API tile when `siteLatLng` is available, passes URL to PanelCanvas as `backgroundImageUrl`
- Renders `MapAlignmentControls` when satellite image is loaded
- Shade/TSRF toggle switches `renderMode`
- Bottom legend bar shows panel count, shaded count at current timestep, current date/time

**Fallback when geocoding unavailable:** Visualizer renders normally without satellite background. Panels display on a neutral dark canvas. All shade/TSRF functionality works. The `AddressInput` shows an error message but doesn't block the tab.

### StringingTab

Composes `PanelCanvas` in `strings` mode with `StringList` sidebar.

- `onPanelClick` dispatches `ASSIGN_PANEL` (if panel is unassigned or belongs to a different string) or `UNASSIGN_PANEL` (if panel belongs to the active string)
- Satellite background carries over from Visualizer (same `siteLatLng` and `mapAlignment` state)
- Auto-string button calls `autoString()` from v12-engine, dispatches `AUTO_STRING`. The engine targets valid string lengths but may produce strings that violate voltage limits (e.g., edge cases with few remaining panels). Violations are surfaced via `string-validation.ts` in StringList, not silently prevented.
- Auto-string button disabled when no equipment is selected (panel + inverter both required)

### ShadeSlider

Two range inputs:
- **Day slider:** Range 1–365. Label displays formatted calendar date (e.g., "Jun 21"). Default: 172 (summer solstice).
- **Time slider:** Range 0–47. Label displays formatted 12-hour time (e.g., "2:00 PM"). Default: 28 (2:00 PM).
- **Timestep computation:** `(day - 1) * 48 + timeSlot`. Emitted via `onTimestepChange(index: number)`.

### StringList

Sidebar rendered inside StringingTab:
- **Header:** "Strings" label + "New" button + "Auto" button
- **Per-string card:** Color swatch, string name (e.g., "String 1"), panel count, Voc cold, Vmp hot, MPPT range from inverter, validation badge
- **Active string:** Orange border highlight. Clicking a card sets it as active.
- **Delete:** X button per string. Removes string and leaves its panels unassigned.
- **Unassigned count:** Bottom card showing count of panels not yet assigned to any string.
- **Auto-string explainer:** Brief text explaining what auto-string does.

### AddressInput

- Text input in the sidebar, positioned between FileUploadPanel and EquipmentPanel
- On submit (Enter key or button), calls `GET /api/solar/geocode?address=...` (reuses existing geocode route — already has auth via `requireSolarAuth`, zod validation, and error handling)
- On success, dispatches `SET_ADDRESS` with `{ address, formattedAddress, lat, lng }`
- Shows formatted address as confirmation text after successful geocode
- Shows error message on geocode failure (invalid address, API error) — does not block other functionality

## Data Model

### State Additions

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `radiancePoints` | `RadiancePoint[]` | `[]` | Full radiance point geometry from DXF upload. Needed by `shade-association.ts` to run the spatial lookup. Stored in state so association can re-run if panels change. |
| `panelShadeMap` | `Record<string, string[]>` | `{}` | Derived enrichment: panel ID → associated shade point IDs. Separate from `panels[]`. |
| `siteAddress` | `string \| null` | `null` | Raw input address |
| `siteFormattedAddress` | `string \| null` | `null` | Google-formatted address |
| `siteLatLng` | `{ lat: number; lng: number } \| null` | `null` | Geocoded coordinates for satellite tile |
| `mapAlignment` | `MapAlignment` | `{ offsetX: 0, offsetY: 0, rotation: 0, scale: 1 }` | UI state: panel-to-satellite positioning |
| `activeStringId` | `number \| null` | `null` | Currently selected string for manual assignment |
| `nextStringId` | `number` | `1` | Monotonic counter for stable string IDs (never reused on delete) |

```typescript
interface MapAlignment {
  offsetX: number;   // meters (same coordinate space as SVG viewBox)
  offsetY: number;   // meters (same coordinate space as SVG viewBox)
  rotation: number;  // degrees
  scale: number;     // multiplier (1 = default)
}
```

### Reducer Actions (9 new)

| Action | Payload | Behavior |
|--------|---------|----------|
| `SET_SHADE_POINT_IDS` | `panelShadeMap: Record<string, string[]>` | Stores shade association result. Replaces previous map. |
| `SET_ADDRESS` | `{ address: string; formattedAddress: string; lat: number; lng: number }` | Stores geocoded address and coordinates. |
| `SET_MAP_ALIGNMENT` | `Partial<MapAlignment>` | Merges alignment changes into existing state. |
| `SET_ACTIVE_STRING` | `stringId: number \| null` | Sets the active string for manual panel assignment. |
| `ASSIGN_PANEL` | `panelId: string` | Adds panel to the active string. Removes from any previous string first. No-op if no active string. |
| `UNASSIGN_PANEL` | `panelId: string` | Removes panel from its current string. Panel becomes unassigned. |
| `CREATE_STRING` | (none) | Creates a new empty string with `id = nextStringId`, increments `nextStringId`. Sets new string as active. |
| `DELETE_STRING` | `stringId: number` | Removes string from `strings[]`. Its panels become unassigned. If deleted string was active, clears `activeStringId`. |
| `AUTO_STRING` | `result: AutoStringResult` | Bridges engine output to UI strings: converts engine `StringConfig[]` (numeric panel indices) to `UIStringConfig[]` (string panel IDs + stable IDs from `nextStringId`). Only fills previously unassigned panels. Preserves all manually assigned strings. See "Engine-to-UI String Bridge" below. |

### String Data Model

**Two string types exist — UI and engine — with a bridge between them.**

The v12-engine's `StringConfig` uses numeric panel indices (`{ panels: number[] }`) and has no `id` field. The UI needs stable IDs and string-based panel references. These are separate types with an explicit adapter.

**UI string type** (defined in `types.ts`, used by reducer + components):
```typescript
interface UIStringConfig {
  id: number;            // stable ID from nextStringId counter (never reused)
  panelIds: string[];    // ordered list of assigned panel IDs (PanelGeometry.id)
}
```

**Engine string type** (existing in `v12-engine/types.ts`, used by `autoString()` and `runCoreAnalysis()`):
```typescript
interface StringConfig {
  panels: number[];      // array of numeric panel indices
}
```

**Reverse lookup** (`panelId → stringId`) is derived at render time, not stored. Computed via a simple loop over `strings` when needed by PanelCanvas or StringList. For 20-40 panels and ≤12 strings, this is negligible cost — no memoization needed unless profiling says otherwise.

**`DELETE_STRING` behavior:** Removes the string entry from `strings[]`. All panels that were in that string become unassigned (they no longer appear in any string's `panelIds`). If the deleted string was the `activeStringId`, `activeStringId` is set to `null`.

### Engine-to-UI String Bridge

`autoString()` returns engine `StringConfig[]` with numeric panel indices. The `AUTO_STRING` reducer case converts these to `UIStringConfig[]`:

1. Collect the set of panel IDs already assigned to manual strings.
2. For each engine `StringConfig`, map `panels: number[]` to `panelIds: string[]` using the `panels[index].id` lookup from state.
3. Filter out any panel IDs that are already manually assigned (preserves manual strings).
4. **Drop any strings that are now empty** after filtering (i.e., all their panels were already manually assigned). Do not assign IDs to empty strings.
5. Assign a new stable `id` from `nextStringId` to each remaining non-empty string, increment counter.
6. Append the new `UIStringConfig[]` entries to the existing `strings[]` array.

**Stage 4 reverse bridge:** When running the full analysis engine, `UIStringConfig[]` must be converted back to engine `StringConfig[]`. This is a simple map: `uiStrings.map(s => ({ panels: s.panelIds.map(id => panels.findIndex(p => p.id === id)) }))`. Defined in Stage 4 when the engine integration happens.

### PanelGeometry-to-PanelStat Bridge

`autoString()` requires `PanelStat[]` (engine type with `id: number`, `tsrf`, `points`, `panelKey`, `bifacialGain`), but Stage 3 state has `PanelGeometry[]`. A lightweight bridge function creates `PanelStat[]` for the auto-stringer:

```typescript
function panelGeometryToPanelStats(
  panels: PanelGeometry[],
  panelShadeMap: Record<string, string[]>,
  panelKey: string
): PanelStat[] {
  return panels.map((pg, i) => ({
    id: i,
    tsrf: pg.tsrf ?? 0.85,
    points: panelShadeMap[pg.id] ?? [],
    panelKey,
    bifacialGain: 1.0,  // simplified for stringing — full calc in Stage 4
  }));
}
```

This mirrors the existing bridge in `runner.ts` (lines 69-77). The auto-stringer only uses `id`, `tsrf`, and panel count — `points` and `bifacialGain` don't affect string assignment.

### panelShadeMap vs PanelGeometry.shadePointIds

Two shade-point references exist. Their roles are distinct:

- **`panelShadeMap`** (state field): The canonical source for UI rendering. Produced by `shade-association.ts`, stored via `SET_SHADE_POINT_IDS`. Used by `PanelCanvas` for shade visualization and by the `PanelGeometry → PanelStat` bridge for auto-stringing.
- **`PanelGeometry.shadePointIds`** (on each panel): Initialized as `[]` by the layout parser. Not populated in Stage 3. Will be populated in Stage 4 when the full engine runs — the `PanelGeometry → PanelStat` bridge writes `panelShadeMap[pg.id]` into `PanelStat.points`, which is what the engine reads.

**Rule:** UI components read from `panelShadeMap`. Engine reads from `PanelStat.points`. The bridge function is the only place that connects them.

### Existing State Reset Behavior

### Upload Contract Change (Stage 2 → Stage 3)

Stage 2's upload route returns `radiancePointCount: number` — just a count. Stage 3 changes this to return the full `radiancePoints: RadiancePoint[]` array, because the client needs the actual point geometry (x, y, TSRF) to run spatial association.

**Upload route response (updated):**
```typescript
interface UploadResult {
  panels: PanelGeometry[];
  shadeData: ShadeTimeseries;
  shadeFidelity: ShadeFidelity;
  shadeSource: ShadeSource;
  radiancePoints: RadiancePoint[];  // was: radiancePointCount: number
  fileCount: number;
  errors: string[];
}
```

**`UPLOAD_SUCCESS` action (updated):** Gains `radiancePoints: RadiancePoint[]` field. The reducer stores this in state. `radiancePointCount` is derived as `state.radiancePoints.length` — no longer a separate field.

**`FileUploadPanel` (updated):** Reads `radiancePoints.length` instead of `radiancePointCount` for the DXF feedback message.

**Shade association trigger:** After `UPLOAD_SUCCESS` dispatches and both `panels[]` and `radiancePoints[]` are in state, the page component (or a `useEffect`) calls `associateShadePoints(panels, radiancePoints)` and dispatches `SET_SHADE_POINT_IDS` with the result. This runs once per upload, not on every render.

### Existing State Reset Behavior

`UPLOAD_SUCCESS` (from Stage 2) already resets `strings`, `inverters`, and `result`. Stage 3 extends this to also reset: `radiancePoints` (replaced by new upload), `panelShadeMap`, `activeStringId`, `mapAlignment`, `nextStringId` (back to 1 so new strings start at "String 1"). Address/geocoding state is NOT reset on new upload (same site, different layout revision is a common flow).

The existing `SET_STRINGS` action from Stage 2 is **retained** for Stage 4 engine integration (bulk-setting strings from analysis results). Stage 3's granular actions (`CREATE_STRING`, `ASSIGN_PANEL`, etc.) handle interactive editing; `SET_STRINGS` handles programmatic bulk updates.

## Pure Logic Modules

### shade-association.ts

```typescript
function associateShadePoints(
  panels: PanelGeometry[],
  radiancePoints: RadiancePoint[]
): Record<string, string[]>
```

**Algorithm:**
1. Build an axis-aligned bounding box (AABB) per panel as a prefilter. Expand by a small epsilon (e.g., 0.01m) to catch points on edges.
2. For each radiance point, check which AABBs it falls within (coarse pass).
3. For each AABB hit, run a precise **point-in-rotated-rectangle** test using the panel's center `(x, y)`, dimensions `(width, height)`, and azimuth rotation.
4. Assign the point to the first panel whose rotated rectangle contains it.
5. **Tie-breaking:** If a point falls exactly on a shared border between two panels (within floating-point tolerance), assign to the panel with the lower index. This is deterministic and stable.
6. Points outside all panels are silently dropped.
7. Panels with zero associated points get an empty array in the result.

**Point-in-rotated-rect math:** Translate point relative to panel center, rotate by negative azimuth, check if rotated point falls within `±width/2` and `±height/2`.

### string-validation.ts

```typescript
interface StringValidationResult {
  status: 'valid' | 'warning' | 'error';
  vocCold: number;        // Voc at coldest temp (V)
  vmpHot: number;         // Vmp at hottest temp (V)
  mpptMin: number;        // inverter MPPT minimum (V)
  mpptMax: number;        // inverter MPPT maximum (V)
  message: string | null; // human-readable violation (null if valid)
}

function validateString(
  panelCount: number,
  panel: ResolvedPanel,
  inverter: ResolvedInverter,
  tempMin: number,   // °C — site minimum temp
  tempMax: number    // °C — site maximum temp
): StringValidationResult
```

**Voltage calculations** (property names match `ResolvedPanel` in `engine-types.ts`):
- `vocCold = panelCount × panel.voc × (1 + panel.tempCoVoc × (tempMin - 25))`
- `vmpHot = panelCount × panel.vmp × (1 + panel.tempCoPmax × (tempMax - 25))`

**Validation states:**
- **Valid** (green): `vocCold ≤ mpptMax` AND `vmpHot ≥ mpptMin`
- **Warning** (yellow): `vocCold > mpptMax × 0.95` (approaching max from below) OR `vmpHot < mpptMin × 1.05` (approaching min from above)
- **Error** (red): `vocCold > mpptMax` → "Voc {value}V exceeds MPPT max {limit}V" or `vmpHot < mpptMin` → "Vmp {value}V below MPPT min {limit}V"

## API Route

### Reuse existing: GET /api/solar/geocode

An existing geocode route at `src/app/api/solar/geocode/route.ts` already does exactly what Stage 3 needs: server-side Google Geocoding API call via `GOOGLE_MAPS_API_KEY`, with `requireSolarAuth`, zod validation, and error handling. **No new API route needed.**

**Response shape** (existing route returns `{ data: { lat, lng, formattedAddress } }`):
```json
{
  "data": {
    "lat": 39.7392,
    "lng": -104.9903,
    "formattedAddress": "1234 Main St, Denver, CO 80202, USA"
  }
}
```

The `AddressInput` component calls this route directly. Verify that `/api/solar/geocode` is covered by the existing role-permissions for solar-designer roles (it may already be under a `/api/solar` prefix match).

### Satellite tile

`VisualizerTab` constructs the Google Maps Static API URL client-side using the geocoded lat/lng. The API key for Static Maps must be a **browser-restricted key** (or unrestricted) since the URL is embedded in an `<img>` tag. This is separate from the server-side `GOOGLE_MAPS_API_KEY`. Use `NEXT_PUBLIC_GOOGLE_MAPS_STATIC_KEY` env var.

**Static API parameters:** `center={lat},{lng}&zoom=20&size=640x640&maptype=satellite&key={key}`. Zoom level 20 gives ~0.15m/pixel resolution, appropriate for roof-level panel alignment. The image is rendered as an SVG `<image>` element positioned behind the panel layer, with `MapAlignment` transforms applied in the SVG coordinate space (meters).

## Visual Design

### Panel Canvas States

| State | Fill | Stroke | Label |
|-------|------|--------|-------|
| Sun (shade mode) | `#3b82f6` (blue) | `#60a5fa` | — |
| Shaded (shade mode) | `#1e3a5f` (dark blue) | `#2563eb` | — |
| No shade data | none (transparent) | `#666` dashed | "no data" |
| TSRF heatmap | Red→Yellow→Green gradient | matching lighter shade | TSRF % |
| String assigned | String palette color | lighter variant | String number |
| Unassigned (string mode) | none (transparent) | `#666` dashed | — |
| Active string highlight | String color | `#f97316` (orange) 2px | String number |

### String Color Palette (12 colors)

```
#f97316 Orange    #06b6d4 Cyan      #a78bfa Purple    #22c55e Green
#f43f5e Rose      #eab308 Yellow    #ec4899 Pink      #14b8a6 Teal
#8b5cf6 Violet    #f59e0b Amber     #10b981 Emerald   #6366f1 Indigo
```

12 strings covers any residential layout (20-40 panels, typically 2-4 strings).

### Hover Tooltip

Displayed on panel hover in all modes:
- Panel ID
- TSRF value (average of associated radiance points, or "N/A" if no shade data)
- Shade status at current timestep (shade mode only)
- Number of associated shade points
- String assignment (string mode only)

## Acceptance Criteria

1. SVG renderer draws panels at correct x/y positions from uploaded JSON layout
2. Satellite image background loads from geocoded address; drag/rotate/scale controls align panels to roof
3. Visualizer works without satellite background when address is not set or geocoding fails
4. Day/time slider animates shade across panels using binary shade data at selected timestep
5. TSRF heatmap mode shows per-panel TSRF values as a color gradient
6. Panels with no associated shade points render with dashed outline and "no data" state
7. Click-to-assign string builder: create string, click panels to add, click again to remove from active string
8. Auto-string assigns only unassigned panels into strings targeting inverter voltage limits; surfaces warnings for any resulting strings that violate limits (the engine attempts valid groupings but does not guarantee all strings are within bounds — violations are displayed via per-string validation, not silently hidden). Preserves all existing manual assignments.
9. Per-string voltage validation displays specific violation messages (Voc cold > MPPT max, Vmp hot < MPPT min)
10. `DELETE_STRING` removes the string and leaves its panels unassigned
11. Shade association uses point-in-rotated-rect (not just AABB) for accurate mapping with rotated or tightly packed panels

## Dependencies

- `GOOGLE_MAPS_API_KEY` (existing env var, server-side — for geocoding via `/api/solar/geocode`)
- `NEXT_PUBLIC_GOOGLE_MAPS_STATIC_KEY` (new env var, browser-restricted — for Static Maps tile in `<img>`)
- Stage 2 shell (file upload, equipment selection, site conditions, tab bar, reducer)
- v12-engine modules: `autoString()`, `ResolvedPanel`, `ResolvedInverter`, `PanelGeometry`, `RadiancePoint` (add `RadiancePoint` to barrel export)

## Out of Scope (Stage 3)

- 3D roof model rendering (future — requires EagleView data from Stage 7)
- Zoom/pan controls on the canvas (add if testing shows it's needed, but 20-40 panels fit in a single viewport)
- Multi-select panel assignment (lasso/drag to select multiple panels at once)
- Undo/redo for string assignments
- Persistence of strings or shade associations to database (Stage 5)
