# Solar Designer Stage 2: Core UI Shell — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the dashboard page, tab layout, equipment selection, site conditions panel, and file upload that wire into the Stage 1 engine — producing a working upload → pick equipment → see panel count flow with no persistence.

**Architecture:** Single client page at `/dashboards/solar-designer` wrapped in `DashboardShell`. All state is in-memory via React `useState`/`useReducer` — no DB, no API routes except a thin upload endpoint for server-side file parsing. The page imports directly from `@/lib/solar/v12-engine` for equipment catalog and file parsing. Tab content for unbuilt tabs (Stages 3-5) renders placeholder cards.

**Tech Stack:** Next.js 16.1, React 19, TypeScript 5, Tailwind v4 CSS tokens, DashboardShell, v12-engine barrel exports

**Spec:** `docs/superpowers/specs/2026-04-05-solar-designer-design.md` — Stage 2 acceptance criteria (lines 287-297)

**Stage 1 dependency:** `src/lib/solar/v12-engine/` (all modules from Stage 1)

---

## Acceptance Criteria (from spec, narrowed for Stage 1 parser reality)

1. Page loads at `/dashboards/solar-designer` wrapped in `DashboardShell`
2. JSON file upload parses layout and displays panel count; CSV file upload is accepted and shade data stored (no panels — shade-only); DXF file upload stores radiance points with count feedback (panel positions require Stage 3 visualizer)
3. Equipment selection panel shows panels and inverters from catalog
4. Site conditions panel (temps, albedo, losses) renders with editable defaults
5. Tab bar shows all 8 tabs (content placeholder for unbuilt tabs)

> **DXF limitation:** The Stage 1 `parseDXF()` returns `radiancePoints[]` (measurement locations with TSRF/irradiance) but always returns `panels: []`. V12 derives panel positions from radiance point clustering in the visualizer — that logic belongs in Stage 3. For now, DXF uploads store radiance points and show a message explaining that panel positions will be derived when the visualizer is built.

---

## File Structure

### New files to create

| File | Responsibility |
|------|---------------|
| `src/app/dashboards/solar-designer/page.tsx` | Dashboard page — DashboardShell wrapper, state management, tab router |
| `src/components/solar-designer/TabBar.tsx` | 8-tab navigation bar with active state styling |
| `src/components/solar-designer/FileUploadPanel.tsx` | Drag-and-drop file upload for DXF/JSON/CSV with parsing feedback |
| `src/components/solar-designer/EquipmentPanel.tsx` | Panel and inverter selection from v12-engine catalog |
| `src/components/solar-designer/SiteConditionsPanel.tsx` | Temperature, albedo, loss profile inputs with defaults |
| `src/components/solar-designer/SystemSummaryBar.tsx` | Compact bar showing panel count, system size, equipment names |
| `src/components/solar-designer/PlaceholderTab.tsx` | Reusable placeholder for unbuilt tabs (Stages 3-8) |
| `src/components/solar-designer/types.ts` | Shared UI state types (SolarDesignerState, tab union, action types) |
| `src/app/api/solar-designer/upload/route.ts` | POST endpoint — receives file, parses server-side, returns PanelGeometry[] + ShadeTimeseries |
| `src/__tests__/components/solar-designer/equipment-panel.test.tsx` | Equipment selection rendering + interaction |
| `src/__tests__/components/solar-designer/site-conditions-panel.test.tsx` | Site conditions defaults + editing |
| `src/__tests__/components/solar-designer/file-upload-panel.test.tsx` | File upload parsing integration |
| `src/__tests__/api/solar-designer-upload.test.ts` | Upload API route unit tests |

### Existing files to modify

| File | Change |
|------|--------|
| `src/lib/role-permissions.ts` | Add `/dashboards/solar-designer` and `/api/solar-designer/upload` to ADMIN, OWNER, PROJECT_MANAGER, OPERATIONS_MANAGER, OPERATIONS, TECH_OPS roles |
| `src/lib/page-directory.ts` | Add `/dashboards/solar-designer` to `APP_PAGE_ROUTES` (API route not listed here — access controlled via role-permissions) |
| `src/components/DashboardShell.tsx` | Add `/dashboards/solar-designer` to `SUITE_MAP` (maps to both Service and D&E suites) |
| `src/app/suites/design-engineering/page.tsx` | Add Solar Designer card to LINKS array |
| `src/app/suites/service/page.tsx` | Add Solar Designer card to LINKS array |

---

## Chunk 1: Route Registration + Page Shell (Tasks 1-3)

### Task 1: Register the route and page directory entries

**Files:**
- Modify: `src/lib/role-permissions.ts`
- Modify: `src/lib/page-directory.ts`
- Modify: `src/components/DashboardShell.tsx`
- Modify: `src/app/suites/design-engineering/page.tsx`
- Modify: `src/app/suites/service/page.tsx`

- [ ] **Step 1: Add route to role-permissions.ts**

Add `/dashboards/solar-designer` and `/api/solar-designer/upload` to the `allowedRoutes` arrays for these 6 roles (per spec line 256): ADMIN, OWNER, PROJECT_MANAGER, OPERATIONS_MANAGER, OPERATIONS, TECH_OPS.

**Important:** Not all roles have `/dashboards/solar-surveyor`. Add the route explicitly to each role block:
- **ADMIN** (~line 153): after `/dashboards/solar-surveyor`
- **OWNER** (~line 474): after `/dashboards/solar-surveyor`
- **PROJECT_MANAGER** (~line 580): after `/dashboards/solar-surveyor`
- **TECH_OPS** (~line 668): after `/dashboards/solar-surveyor`
- **OPERATIONS_MANAGER** (~line 284): after the equipment catalog section (these roles don't have solar-surveyor)
- **OPERATIONS** (~line 206): after the equipment catalog section

```typescript
// Add to each role's allowedRoutes:
"/dashboards/solar-designer",
"/api/solar-designer/upload",
```

- [ ] **Step 2: Add to page-directory.ts**

Add entry to `APP_PAGE_ROUTES` array (alphabetical order, near the solar-surveyor entry):

```typescript
"/dashboards/solar-designer",
```

Note: The API route does NOT go in page-directory — API access is controlled via role-permissions.ts.

- [ ] **Step 3: Add to DashboardShell SUITE_MAP**

In `src/components/DashboardShell.tsx`, add to the `SUITE_MAP` object after the solar-surveyor entry:

```typescript
"/dashboards/solar-designer": { href: "/suites/service", label: "Service" },
```

Note: spec says accessible from both Service and D&E suites. We pick Service as the primary breadcrumb target since the service team is the primary user. D&E users will still access it via direct link or their suite nav.

- [ ] **Step 4: Add to suite landing pages**

`suite-nav.ts` only defines top-level suite entries and the switcher allowlist — it does NOT have per-suite link arrays. Dashboard links are defined in each suite's landing page.

Add a Solar Designer card to both:

**`src/app/suites/design-engineering/page.tsx`** — find the `LINKS` array (near line 87, after the Solar Surveyor entry) and add:
```typescript
{
  href: "/dashboards/solar-designer",
  title: "Solar Designer",
  description: "Solar design analysis and production modeling.",
  tag: "TOOL",
  icon: "☀️",
  section: "Tools",
},
```

**`src/app/suites/service/page.tsx`** — find the `LINKS` array and add the same card object in the Tools section.

- [ ] **Step 5: Commit**

```bash
git add src/lib/role-permissions.ts src/lib/page-directory.ts src/components/DashboardShell.tsx src/app/suites/design-engineering/page.tsx src/app/suites/service/page.tsx
git commit -m "feat(solar-designer): register route, permissions, and navigation entries"
```

---

### Task 2: UI state types

**Files:**
- Create: `src/components/solar-designer/types.ts`

- [ ] **Step 1: Define the shared UI state types**

```typescript
/**
 * Solar Designer — Shared UI State Types
 *
 * All state is in-memory (no persistence until Stage 5).
 */
import type {
  PanelGeometry,
  ShadeTimeseries,
  ShadeFidelity,
  ShadeSource,
  ResolvedPanel,
  ResolvedInverter,
  LossProfile,
  SiteConditions,
  StringConfig,
  InverterConfig,
  CoreSolarDesignerResult,
} from '@/lib/solar/v12-engine';

// ── Tab Navigation ──────────────────────────────────────────

export type SolarDesignerTab =
  | 'visualizer'
  | 'stringing'
  | 'production'
  | 'timeseries'
  | 'inverters'
  | 'battery'
  | 'ai'
  | 'scenarios';

export const TAB_LABELS: Record<SolarDesignerTab, string> = {
  visualizer: 'Visualizer',
  stringing: 'Stringing',
  production: 'Production',
  timeseries: '30-Min Series',
  inverters: 'Inverters',
  battery: 'Battery',
  ai: 'AI Analysis',
  scenarios: 'Scenarios',
};

// ── Designer State ──────────────────────────────────────────

export interface UploadedFile {
  name: string;
  type: 'dxf' | 'json' | 'csv';
  size: number;
}

export interface SolarDesignerState {
  // Layout data (from file upload)
  panels: PanelGeometry[];
  shadeData: ShadeTimeseries;
  shadeFidelity: ShadeFidelity;
  shadeSource: ShadeSource;
  radiancePointCount: number;  // DXF radiance points (panels derived in Stage 3)
  uploadedFiles: UploadedFile[];

  // Equipment selection
  panelKey: string;
  inverterKey: string;
  selectedPanel: ResolvedPanel | null;
  selectedInverter: ResolvedInverter | null;

  // Site conditions
  siteConditions: SiteConditions;

  // Loss profile
  lossProfile: LossProfile;

  // Stringing (Stage 3 will populate)
  strings: StringConfig[];
  inverters: InverterConfig[];

  // Analysis result (Stage 4 will populate)
  result: CoreSolarDesignerResult | null;

  // UI state
  activeTab: SolarDesignerTab;
  isUploading: boolean;
  uploadError: string | null;
}

// ── Actions ─────────────────────────────────────────────────

export type SolarDesignerAction =
  | { type: 'SET_TAB'; tab: SolarDesignerTab }
  | { type: 'UPLOAD_START' }
  | { type: 'UPLOAD_SUCCESS'; panels: PanelGeometry[]; shadeData: ShadeTimeseries; files: UploadedFile[]; shadeFidelity: ShadeFidelity; shadeSource: ShadeSource; radiancePointCount: number }
  | { type: 'UPLOAD_ERROR'; error: string }
  | { type: 'SET_PANEL'; key: string; panel: ResolvedPanel }
  | { type: 'SET_INVERTER'; key: string; inverter: ResolvedInverter }
  | { type: 'SET_SITE_CONDITIONS'; conditions: Partial<SiteConditions> }
  | { type: 'SET_LOSS_PROFILE'; profile: Partial<LossProfile> }
  | { type: 'SET_STRINGS'; strings: StringConfig[]; inverters: InverterConfig[] }
  | { type: 'SET_RESULT'; result: CoreSolarDesignerResult }
  | { type: 'RESET' };
```

- [ ] **Step 2: Commit**

```bash
git add src/components/solar-designer/types.ts
git commit -m "feat(solar-designer): add shared UI state types and tab definitions"
```

---

### Task 3: Page shell with tab bar and reducer

**Files:**
- Create: `src/app/dashboards/solar-designer/page.tsx`
- Create: `src/components/solar-designer/TabBar.tsx`
- Create: `src/components/solar-designer/PlaceholderTab.tsx`

- [ ] **Step 1: Create TabBar component**

```tsx
'use client';

import type { SolarDesignerTab } from './types';
import { TAB_LABELS } from './types';

const TAB_ORDER: SolarDesignerTab[] = [
  'visualizer', 'stringing', 'production', 'timeseries',
  'inverters', 'battery', 'ai', 'scenarios',
];

interface TabBarProps {
  activeTab: SolarDesignerTab;
  onTabChange: (tab: SolarDesignerTab) => void;
  /** Tabs that have real content (not placeholder). Affects styling. */
  enabledTabs?: SolarDesignerTab[];
}

export default function TabBar({ activeTab, onTabChange, enabledTabs }: TabBarProps) {
  return (
    <div className="flex items-center gap-1 border-b border-t-border overflow-x-auto">
      {TAB_ORDER.map((tab) => {
        const isActive = tab === activeTab;
        const isEnabled = !enabledTabs || enabledTabs.includes(tab);
        return (
          <button
            key={tab}
            onClick={() => onTabChange(tab)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
              isActive
                ? 'border-orange-500 text-orange-500'
                : isEnabled
                  ? 'border-transparent text-muted hover:text-foreground'
                  : 'border-transparent text-muted/50 hover:text-muted'
            }`}
          >
            {TAB_LABELS[tab]}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Create PlaceholderTab component**

```tsx
interface PlaceholderTabProps {
  tabName: string;
  targetStage: number;
}

export default function PlaceholderTab({ tabName, targetStage }: PlaceholderTabProps) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-16 h-16 rounded-2xl bg-surface-2 flex items-center justify-center mb-4">
        <span className="text-2xl opacity-40">🔧</span>
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-1">{tabName}</h3>
      <p className="text-sm text-muted max-w-md">
        This tab will be available in Stage {targetStage}. Upload files and select equipment to get started.
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Create the page with reducer**

The page uses `useReducer` for state management. For now, the sidebar has equipment and site conditions panels (implemented in Tasks 5-6), and the main area has the tab bar + tab content.

```tsx
'use client';

import { useReducer } from 'react';
import DashboardShell from '@/components/DashboardShell';
import TabBar from '@/components/solar-designer/TabBar';
import PlaceholderTab from '@/components/solar-designer/PlaceholderTab';
import { DEFAULT_SITE_CONDITIONS, DEFAULT_LOSS_PROFILE } from '@/lib/solar/v12-engine';
import type { SolarDesignerState, SolarDesignerAction, SolarDesignerTab } from '@/components/solar-designer/types';

const INITIAL_STATE: SolarDesignerState = {
  panels: [],
  shadeData: {},
  shadeFidelity: 'full',
  shadeSource: 'manual',
  radiancePointCount: 0,
  uploadedFiles: [],
  panelKey: '',
  inverterKey: '',
  selectedPanel: null,
  selectedInverter: null,
  siteConditions: DEFAULT_SITE_CONDITIONS,
  lossProfile: DEFAULT_LOSS_PROFILE,
  strings: [],
  inverters: [],
  result: null,
  activeTab: 'visualizer',
  isUploading: false,
  uploadError: null,
};

function reducer(state: SolarDesignerState, action: SolarDesignerAction): SolarDesignerState {
  switch (action.type) {
    case 'SET_TAB':
      return { ...state, activeTab: action.tab };
    case 'UPLOAD_START':
      return { ...state, isUploading: true, uploadError: null };
    case 'UPLOAD_SUCCESS':
      return {
        ...state,
        isUploading: false,
        panels: action.panels,
        shadeData: action.shadeData,
        shadeFidelity: action.shadeFidelity,
        shadeSource: action.shadeSource,
        radiancePointCount: action.radiancePointCount,
        uploadedFiles: action.files,
        uploadError: null,
        // Reset downstream state on new upload
        strings: [],
        inverters: [],
        result: null,
      };
    case 'UPLOAD_ERROR':
      return { ...state, isUploading: false, uploadError: action.error };
    case 'SET_PANEL':
      return { ...state, panelKey: action.key, selectedPanel: action.panel };
    case 'SET_INVERTER':
      return { ...state, inverterKey: action.key, selectedInverter: action.inverter };
    case 'SET_SITE_CONDITIONS':
      return { ...state, siteConditions: { ...state.siteConditions, ...action.conditions } };
    case 'SET_LOSS_PROFILE':
      return { ...state, lossProfile: { ...state.lossProfile, ...action.profile } };
    case 'SET_STRINGS':
      return { ...state, strings: action.strings, inverters: action.inverters };
    case 'SET_RESULT':
      return { ...state, result: action.result };
    case 'RESET':
      return INITIAL_STATE;
    default:
      return state;
  }
}

// Tabs with real content in Stage 2 (none yet — all placeholders)
const ENABLED_TABS: SolarDesignerTab[] = [];

export default function SolarDesignerPage() {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  const handleTabChange = (tab: SolarDesignerTab) => {
    dispatch({ type: 'SET_TAB', tab });
  };

  return (
    <DashboardShell title="Solar Designer" accentColor="orange" fullWidth>
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Left sidebar: Upload + Equipment + Site Conditions */}
        <aside className="w-full lg:w-80 lg:shrink-0 space-y-4">
          {/* FileUploadPanel — Task 7 */}
          <div className="rounded-xl bg-surface p-4 shadow-card">
            <h3 className="text-sm font-semibold text-foreground mb-3">Layout Files</h3>
            <p className="text-xs text-muted">File upload panel — coming in Task 7</p>
          </div>

          {/* EquipmentPanel — Task 5 */}
          <div className="rounded-xl bg-surface p-4 shadow-card">
            <h3 className="text-sm font-semibold text-foreground mb-3">Equipment</h3>
            <p className="text-xs text-muted">Equipment selection — coming in Task 5</p>
          </div>

          {/* SiteConditionsPanel — Task 6 */}
          <div className="rounded-xl bg-surface p-4 shadow-card">
            <h3 className="text-sm font-semibold text-foreground mb-3">Site Conditions</h3>
            <p className="text-xs text-muted">Site conditions — coming in Task 6</p>
          </div>

          {/* SystemSummaryBar — Task 8 */}
        </aside>

        {/* Main content: Tabs */}
        <main className="flex-1 min-w-0">
          <TabBar
            activeTab={state.activeTab}
            onTabChange={handleTabChange}
            enabledTabs={ENABLED_TABS}
          />
          <div className="mt-4">
            {state.activeTab === 'visualizer' && <PlaceholderTab tabName="Visualizer" targetStage={3} />}
            {state.activeTab === 'stringing' && <PlaceholderTab tabName="Stringing" targetStage={3} />}
            {state.activeTab === 'production' && <PlaceholderTab tabName="Production" targetStage={4} />}
            {state.activeTab === 'timeseries' && <PlaceholderTab tabName="30-Min Series" targetStage={4} />}
            {state.activeTab === 'inverters' && <PlaceholderTab tabName="Inverters" targetStage={4} />}
            {state.activeTab === 'battery' && <PlaceholderTab tabName="Battery" targetStage={5} />}
            {state.activeTab === 'ai' && <PlaceholderTab tabName="AI Analysis" targetStage={5} />}
            {state.activeTab === 'scenarios' && <PlaceholderTab tabName="Scenarios" targetStage={5} />}
          </div>
        </main>
      </div>
    </DashboardShell>
  );
}
```

- [ ] **Step 4: Verify tsc compiles and page renders**

Run: `npx tsc --noEmit 2>&1 | grep solar-designer`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboards/solar-designer/page.tsx src/components/solar-designer/TabBar.tsx src/components/solar-designer/PlaceholderTab.tsx
git commit -m "feat(solar-designer): page shell with DashboardShell, tab bar, and state reducer"
```

---

## Chunk 2: Equipment Panel + Site Conditions (Tasks 4-6)

### Task 4: Equipment panel test

**Files:**
- Create: `src/__tests__/components/solar-designer/equipment-panel.test.tsx`

- [ ] **Step 1: Write failing tests for equipment panel**

Test that:
1. Panel dropdown renders all 8 built-in panels
2. Inverter dropdown renders all 9 built-in inverters
3. Selecting a panel dispatches SET_PANEL with the resolved spec
4. Selecting an inverter dispatches SET_INVERTER with the resolved spec
5. Selected equipment shows key specs (watts, Voc for panels; AC power, MPPT range for inverters)

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import EquipmentPanel from '@/components/solar-designer/EquipmentPanel';
import { getBuiltInPanels, getBuiltInInverters } from '@/lib/solar/v12-engine';

const mockDispatch = jest.fn();

describe('EquipmentPanel', () => {
  beforeEach(() => mockDispatch.mockClear());

  it('renders all 8 built-in panels in dropdown', () => {
    render(<EquipmentPanel panelKey="" inverterKey="" selectedPanel={null} selectedInverter={null} dispatch={mockDispatch} />);
    const panels = getBuiltInPanels();
    const panelSelect = screen.getByLabelText(/panel/i);
    // +1 for the placeholder option
    expect(panelSelect.querySelectorAll('option')).toHaveLength(panels.length + 1);
  });

  it('renders all 9 built-in inverters in dropdown', () => {
    render(<EquipmentPanel panelKey="" inverterKey="" selectedPanel={null} selectedInverter={null} dispatch={mockDispatch} />);
    const inverters = getBuiltInInverters();
    const inverterSelect = screen.getByLabelText(/inverter/i);
    expect(inverterSelect.querySelectorAll('option')).toHaveLength(inverters.length + 1);
  });

  it('dispatches SET_PANEL when panel selected', () => {
    render(<EquipmentPanel panelKey="" inverterKey="" selectedPanel={null} selectedInverter={null} dispatch={mockDispatch} />);
    const panelSelect = screen.getByLabelText(/panel/i);
    fireEvent.change(panelSelect, { target: { value: 'rec_alpha_440' } });
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SET_PANEL', key: 'rec_alpha_440' })
    );
  });

  it('shows panel specs when selected', () => {
    const panels = getBuiltInPanels();
    const rec = panels.find(p => p.key === 'rec_alpha_440')!;
    render(<EquipmentPanel panelKey="rec_alpha_440" inverterKey="" selectedPanel={rec} selectedInverter={null} dispatch={mockDispatch} />);
    expect(screen.getByText(/440/)).toBeInTheDocument();  // watts
    expect(screen.getByText(/Voc/i)).toBeInTheDocument();  // voltage spec
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --testPathPatterns='equipment-panel' --no-coverage`
Expected: FAIL — EquipmentPanel not found

- [ ] **Step 3: Commit failing test**

```bash
git add src/__tests__/components/solar-designer/equipment-panel.test.tsx
git commit -m "test(solar-designer): add failing equipment panel tests"
```

---

### Task 5: Equipment panel implementation

**Files:**
- Create: `src/components/solar-designer/EquipmentPanel.tsx`

- [ ] **Step 1: Implement EquipmentPanel**

```tsx
'use client';

import type { ResolvedPanel, ResolvedInverter } from '@/lib/solar/v12-engine';
import { getBuiltInPanels, getBuiltInInverters, resolvePanel, resolveInverter } from '@/lib/solar/v12-engine';
import type { SolarDesignerAction } from './types';

interface EquipmentPanelProps {
  panelKey: string;
  inverterKey: string;
  selectedPanel: ResolvedPanel | null;
  selectedInverter: ResolvedInverter | null;
  dispatch: (action: SolarDesignerAction) => void;
}

const panels = getBuiltInPanels();
const inverters = getBuiltInInverters();

export default function EquipmentPanel({
  panelKey,
  inverterKey,
  selectedPanel,
  selectedInverter,
  dispatch,
}: EquipmentPanelProps) {
  const handlePanelChange = (key: string) => {
    const panel = resolvePanel(key);
    if (panel) {
      dispatch({ type: 'SET_PANEL', key, panel });
    }
  };

  const handleInverterChange = (key: string) => {
    const inverter = resolveInverter(key);
    if (inverter) {
      dispatch({ type: 'SET_INVERTER', key, inverter });
    }
  };

  return (
    <div className="rounded-xl bg-surface p-4 shadow-card space-y-4">
      <h3 className="text-sm font-semibold text-foreground">Equipment</h3>

      {/* Panel Selection */}
      <div>
        <label htmlFor="panel-select" className="block text-xs font-medium text-muted mb-1">Panel</label>
        <select
          id="panel-select"
          value={panelKey}
          onChange={(e) => handlePanelChange(e.target.value)}
          className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground"
        >
          <option value="">Select panel...</option>
          {panels.map((p) => (
            <option key={p.key} value={p.key}>{p.name} ({p.watts}W)</option>
          ))}
        </select>
        {selectedPanel && (
          <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-muted">
            <span>{selectedPanel.watts}W</span>
            <span>Voc {selectedPanel.voc.toFixed(1)}V</span>
            <span>Vmp {selectedPanel.vmp.toFixed(1)}V</span>
            <span>{selectedPanel.cells} cells</span>
            {selectedPanel.isBifacial && <span className="col-span-2 text-orange-500">Bifacial</span>}
          </div>
        )}
      </div>

      {/* Inverter Selection */}
      <div>
        <label htmlFor="inverter-select" className="block text-xs font-medium text-muted mb-1">Inverter</label>
        <select
          id="inverter-select"
          value={inverterKey}
          onChange={(e) => handleInverterChange(e.target.value)}
          className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground"
        >
          <option value="">Select inverter...</option>
          {inverters.map((inv) => (
            <option key={inv.key} value={inv.key}>{inv.name} ({(inv.acPower / 1000).toFixed(1)}kW)</option>
          ))}
        </select>
        {selectedInverter && (
          <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-muted">
            <span>AC {(selectedInverter.acPower / 1000).toFixed(1)}kW</span>
            <span>MPPT {selectedInverter.mpptMin}-{selectedInverter.mpptMax}V</span>
            <span>Eff {(selectedInverter.efficiency * 100).toFixed(1)}%</span>
            <span className="capitalize">{selectedInverter.architectureType}</span>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run tests**

Run: `npx jest --testPathPatterns='equipment-panel' --no-coverage`
Expected: PASS

- [ ] **Step 3: Wire into page**

Replace the equipment placeholder in `page.tsx` with:

```tsx
import EquipmentPanel from '@/components/solar-designer/EquipmentPanel';

// In the sidebar, replace the equipment placeholder div with:
<EquipmentPanel
  panelKey={state.panelKey}
  inverterKey={state.inverterKey}
  selectedPanel={state.selectedPanel}
  selectedInverter={state.selectedInverter}
  dispatch={dispatch}
/>
```

- [ ] **Step 4: Verify tsc + lint**

Run: `npx tsc --noEmit 2>&1 | grep solar-designer && npx eslint src/components/solar-designer/ src/app/dashboards/solar-designer/`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/components/solar-designer/EquipmentPanel.tsx src/app/dashboards/solar-designer/page.tsx
git commit -m "feat(solar-designer): equipment selection panel with catalog dropdowns and spec display"
```

---

### Task 6: Site conditions panel

**Files:**
- Create: `src/components/solar-designer/SiteConditionsPanel.tsx`
- Create: `src/__tests__/components/solar-designer/site-conditions-panel.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import SiteConditionsPanel from '@/components/solar-designer/SiteConditionsPanel';
import { DEFAULT_SITE_CONDITIONS, DEFAULT_LOSS_PROFILE } from '@/lib/solar/v12-engine';

const mockDispatch = jest.fn();

describe('SiteConditionsPanel', () => {
  beforeEach(() => mockDispatch.mockClear());

  it('renders with default values', () => {
    render(
      <SiteConditionsPanel
        siteConditions={DEFAULT_SITE_CONDITIONS}
        lossProfile={DEFAULT_LOSS_PROFILE}
        dispatch={mockDispatch}
      />
    );
    // Default temp min is -10
    const tempMin = screen.getByLabelText(/min temp/i) as HTMLInputElement;
    expect(tempMin.value).toBe('-10');
  });

  it('dispatches SET_SITE_CONDITIONS on temp change', () => {
    render(
      <SiteConditionsPanel
        siteConditions={DEFAULT_SITE_CONDITIONS}
        lossProfile={DEFAULT_LOSS_PROFILE}
        dispatch={mockDispatch}
      />
    );
    const tempMin = screen.getByLabelText(/min temp/i);
    fireEvent.change(tempMin, { target: { value: '-15' } });
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SET_SITE_CONDITIONS' })
    );
  });

  it('renders loss profile fields', () => {
    render(
      <SiteConditionsPanel
        siteConditions={DEFAULT_SITE_CONDITIONS}
        lossProfile={DEFAULT_LOSS_PROFILE}
        dispatch={mockDispatch}
      />
    );
    expect(screen.getByLabelText(/soiling/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --testPathPatterns='site-conditions-panel' --no-coverage`
Expected: FAIL

- [ ] **Step 3: Implement SiteConditionsPanel**

```tsx
'use client';

import { useState } from 'react';
import type { SiteConditions, LossProfile } from '@/lib/solar/v12-engine';
import type { SolarDesignerAction } from './types';

interface SiteConditionsPanelProps {
  siteConditions: SiteConditions;
  lossProfile: LossProfile;
  dispatch: (action: SolarDesignerAction) => void;
}

export default function SiteConditionsPanel({
  siteConditions,
  lossProfile,
  dispatch,
}: SiteConditionsPanelProps) {
  const [expanded, setExpanded] = useState(true);

  const handleSiteChange = (field: keyof SiteConditions, value: number) => {
    dispatch({ type: 'SET_SITE_CONDITIONS', conditions: { [field]: value } });
  };

  const handleLossChange = (field: keyof LossProfile, value: number) => {
    dispatch({ type: 'SET_LOSS_PROFILE', profile: { [field]: value } });
  };

  return (
    <div className="rounded-xl bg-surface p-4 shadow-card space-y-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full text-sm font-semibold text-foreground"
      >
        <span>Site Conditions</span>
        <span className="text-xs text-muted">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="space-y-3">
          {/* Temperature */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="temp-min" className="block text-xs text-muted mb-1">Min Temp (°C)</label>
              <input
                id="temp-min"
                type="number"
                value={siteConditions.tempMin}
                onChange={(e) => handleSiteChange('tempMin', Number(e.target.value))}
                className="w-full rounded-lg border border-t-border bg-surface-2 px-2 py-1.5 text-sm text-foreground"
              />
            </div>
            <div>
              <label htmlFor="temp-max" className="block text-xs text-muted mb-1">Max Temp (°C)</label>
              <input
                id="temp-max"
                type="number"
                value={siteConditions.tempMax}
                onChange={(e) => handleSiteChange('tempMax', Number(e.target.value))}
                className="w-full rounded-lg border border-t-border bg-surface-2 px-2 py-1.5 text-sm text-foreground"
              />
            </div>
          </div>

          {/* Albedo */}
          <div>
            <label htmlFor="albedo" className="block text-xs text-muted mb-1">Ground Albedo</label>
            <input
              id="albedo"
              type="number"
              step="0.05"
              min="0"
              max="1"
              value={siteConditions.groundAlbedo}
              onChange={(e) => handleSiteChange('groundAlbedo', Number(e.target.value))}
              className="w-full rounded-lg border border-t-border bg-surface-2 px-2 py-1.5 text-sm text-foreground"
            />
          </div>

          {/* Loss Profile */}
          <div className="pt-2 border-t border-t-border">
            <p className="text-xs font-medium text-muted mb-2">Loss Profile (%)</p>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(lossProfile) as (keyof LossProfile)[]).map((key) => (
                <div key={key}>
                  <label htmlFor={`loss-${key}`} className="block text-xs text-muted mb-0.5 capitalize">
                    {key === 'dcWiring' ? 'DC Wiring' : key === 'acWiring' ? 'AC Wiring' : key === 'lid' ? 'LID' : key}
                  </label>
                  <input
                    id={`loss-${key}`}
                    type="number"
                    step="0.5"
                    min="0"
                    max="100"
                    value={lossProfile[key]}
                    onChange={(e) => handleLossChange(key, Number(e.target.value))}
                    className="w-full rounded-lg border border-t-border bg-surface-2 px-2 py-1.5 text-sm text-foreground"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {!expanded && (
        <p className="text-xs text-muted">
          {siteConditions.tempMin}°C / {siteConditions.tempMax}°C, albedo {siteConditions.groundAlbedo}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test**

Run: `npx jest --testPathPatterns='site-conditions-panel' --no-coverage`
Expected: PASS

- [ ] **Step 5: Wire into page**

Replace the site conditions placeholder in `page.tsx` with the real component:

```tsx
import SiteConditionsPanel from '@/components/solar-designer/SiteConditionsPanel';

// In sidebar:
<SiteConditionsPanel
  siteConditions={state.siteConditions}
  lossProfile={state.lossProfile}
  dispatch={dispatch}
/>
```

- [ ] **Step 6: Verify tsc + lint + tests**

Run: `npx tsc --noEmit 2>&1 | grep solar-designer && npx jest --testPathPatterns='solar-designer' --no-coverage`
Expected: All pass, no type errors

- [ ] **Step 7: Commit**

```bash
git add src/components/solar-designer/SiteConditionsPanel.tsx src/__tests__/components/solar-designer/site-conditions-panel.test.tsx src/app/dashboards/solar-designer/page.tsx
git commit -m "feat(solar-designer): site conditions panel with temp, albedo, and loss profile inputs"
```

---

## Chunk 3: File Upload (Tasks 7-9)

### Task 7: Upload API route

**Files:**
- Create: `src/app/api/solar-designer/upload/route.ts`
- Create: `src/__tests__/api/solar-designer-upload.test.ts`

- [ ] **Step 1: Write parser smoke tests + route-level test**

The test file has two describe blocks:
1. Parser smoke tests — verify the v12-engine functions the route depends on
2. Route-level test — exercise the actual POST handler with FormData

```typescript
import { parseJSON, parseDXF, parseShadeCSV } from '@/lib/solar/v12-engine';
import { POST } from '@/app/api/solar-designer/upload/route';
import { NextRequest } from 'next/server';

// ── Parser smoke tests (verify underlying v12-engine functions) ──

describe('Solar Designer parser smoke tests', () => {
  it('parses JSON layout and returns panels', () => {
    const json = JSON.stringify({
      panels: [
        { data: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1.8 }, { x: 0, y: 1.8 }] },
        { data: [{ x: 2, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 1.8 }, { x: 2, y: 1.8 }] },
      ],
    });
    const result = parseJSON(json);
    expect(result.panels.length).toBe(2);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects invalid JSON', () => {
    const result = parseJSON('not valid json');
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('parses shade CSV (column-oriented: first col = timestep, remaining = point IDs)', () => {
    // parseShadeCSV expects: header = timestep,<pointId1>,<pointId2>,...
    // Data rows = <stepIndex>,<0|1>,<0|1>,...  where 0=sun, 1=shade
    const csv = 'timestep,pt_1,pt_2\n0,0,1\n1,1,1\n2,0,1\n';
    const result = parseShadeCSV(csv);
    expect(Object.keys(result.data)).toHaveLength(2);
    expect(result.data['pt_1']).toBeDefined();
    expect(result.data['pt_2']).toBeDefined();
    // pt_1 shade string starts with '010' (sun, shade, sun)
    expect(result.data['pt_1'].substring(0, 3)).toBe('010');
  });
});

// ── Route-level tests (exercise POST handler with FormData) ──

function makeRequest(files: { name: string; content: string }[]): NextRequest {
  const formData = new FormData();
  for (const f of files) {
    formData.append('files', new Blob([f.content], { type: 'application/octet-stream' }), f.name);
  }
  return new NextRequest('http://localhost/api/solar-designer/upload', {
    method: 'POST',
    body: formData,
  });
}

describe('POST /api/solar-designer/upload', () => {
  it('returns 400 when no files provided', async () => {
    const req = new NextRequest('http://localhost/api/solar-designer/upload', {
      method: 'POST',
      body: new FormData(),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/no files/i);
  });

  it('parses JSON file and returns panels with fileCount', async () => {
    const json = JSON.stringify({
      panels: [
        { data: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1.8 }, { x: 0, y: 1.8 }] },
      ],
    });
    const req = makeRequest([{ name: 'layout.json', content: json }]);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.panels).toHaveLength(1);
    expect(body.fileCount).toBe(1);
    expect(body.radiancePointCount).toBe(0);
    expect(body.shadeFidelity).toBe('full');
    expect(body.shadeSource).toBe('manual');
  });

  it('parses CSV file and returns shade data (no panels)', async () => {
    const csv = 'timestep,pt_1,pt_2\n0,0,1\n1,1,0\n';
    const req = makeRequest([{ name: 'shade.csv', content: csv }]);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.panels).toHaveLength(0);
    expect(Object.keys(body.shadeData)).toHaveLength(2);
    expect(body.radiancePointCount).toBe(0);
  });

  it('returns errors for unsupported file types', async () => {
    const req = makeRequest([{ name: 'readme.txt', content: 'hello' }]);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.errors.length).toBeGreaterThan(0);
    expect(body.errors[0]).toMatch(/unsupported file type/i);
  });

  it('handles mixed file upload (JSON + CSV)', async () => {
    const json = JSON.stringify({
      panels: [
        { data: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1.8 }, { x: 0, y: 1.8 }] },
      ],
    });
    const csv = 'timestep,pt_1\n0,1\n1,0\n';
    const req = makeRequest([
      { name: 'layout.json', content: json },
      { name: 'shade.csv', content: csv },
    ]);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.panels).toHaveLength(1);
    expect(Object.keys(body.shadeData)).toHaveLength(1);
    expect(body.fileCount).toBe(2);
  });
});
```

- [ ] **Step 2: Run parser smoke tests first (route tests will fail until Step 3)**

Run: `npx jest --testPathPatterns='solar-designer-upload' --no-coverage -t 'parser smoke'`
Expected: PASS (testing existing library functions)

- [ ] **Step 3: Implement upload API route**

The route accepts multipart form data with files. It reads the file content, determines type from extension, parses using v12-engine functions, and returns the result.

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { parseJSON, parseDXF, parseShadeCSV } from '@/lib/solar/v12-engine';
import type { PanelGeometry, ShadeTimeseries, ShadeFidelity, ShadeSource } from '@/lib/solar/v12-engine';

interface UploadResult {
  panels: PanelGeometry[];
  shadeData: ShadeTimeseries;
  shadeFidelity: ShadeFidelity;
  shadeSource: ShadeSource;
  radiancePointCount: number;  // DXF radiance points (panels derived in Stage 3)
  fileCount: number;
  errors: string[];
}

export async function POST(req: NextRequest): Promise<NextResponse<UploadResult | { error: string }>> {
  try {
    const formData = await req.formData();
    const files = formData.getAll('files') as File[];

    if (files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    }

    const allPanels: PanelGeometry[] = [];
    const allShadeData: ShadeTimeseries = {};
    const allErrors: string[] = [];
    let radiancePointCount = 0;

    for (const file of files) {
      const text = await file.text();
      const ext = file.name.split('.').pop()?.toLowerCase();

      if (ext === 'json') {
        const result = parseJSON(text);
        if (result.errors.length > 0) {
          allErrors.push(...result.errors.map(e => `${file.name}: ${e}`));
        }
        // parseJSON returns PanelGeometry[] directly
        allPanels.push(...result.panels);
      } else if (ext === 'dxf') {
        const result = parseDXF(text);
        if (result.errors.length > 0) {
          allErrors.push(...result.errors.map(e => `${file.name}: ${e}`));
        }
        // parseDXF returns panels[] (always empty in Stage 1) and radiancePoints[]
        // Radiance points are measurement locations — panels are derived from them
        // in Stage 3's visualizer via clustering. Track count for UI feedback.
        allPanels.push(...result.panels);
        radiancePointCount += result.radiancePoints.length;
      } else if (ext === 'csv') {
        const result = parseShadeCSV(text);
        if (result.errors.length > 0) {
          allErrors.push(...result.errors.map(e => `${file.name}: ${e}`));
        }
        Object.assign(allShadeData, result.data);
      } else {
        allErrors.push(`${file.name}: Unsupported file type .${ext}. Expected .dxf, .json, or .csv`);
      }
    }

    return NextResponse.json({
      panels: allPanels,
      shadeData: allShadeData,
      shadeFidelity: 'full',  // Manual uploads are always full fidelity
      shadeSource: 'manual',
      radiancePointCount,
      fileCount: files.length,
      errors: allErrors,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upload failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run full test suite (parser + route tests)**

Run: `npx jest --testPathPatterns='solar-designer-upload' --no-coverage`
Expected: PASS — all parser smoke tests and route-level tests green

- [ ] **Step 5: Verify tsc**

Run: `npx tsc --noEmit 2>&1 | grep solar-designer`
Expected: No type errors

- [ ] **Step 6: Commit**

```bash
git add src/app/api/solar-designer/upload/route.ts src/__tests__/api/solar-designer-upload.test.ts
git commit -m "feat(solar-designer): upload API route for DXF/JSON/CSV file parsing"
```

---

### Task 8: File upload panel component

**Files:**
- Create: `src/components/solar-designer/FileUploadPanel.tsx`
- Create: `src/__tests__/components/solar-designer/file-upload-panel.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { render, screen } from '@testing-library/react';
import FileUploadPanel from '@/components/solar-designer/FileUploadPanel';

const mockDispatch = jest.fn();

describe('FileUploadPanel', () => {
  it('renders drop zone when no files uploaded', () => {
    render(
      <FileUploadPanel
        uploadedFiles={[]}
        panelCount={0}
        radiancePointCount={0}
        isUploading={false}
        uploadError={null}
        dispatch={mockDispatch}
      />
    );
    expect(screen.getByText(/drop.*files/i)).toBeInTheDocument();
  });

  it('shows panel count when files are uploaded', () => {
    render(
      <FileUploadPanel
        uploadedFiles={[{ name: 'layout.json', type: 'json', size: 1024 }]}
        panelCount={24}
        radiancePointCount={0}
        isUploading={false}
        uploadError={null}
        dispatch={mockDispatch}
      />
    );
    expect(screen.getByText(/24 panels/i)).toBeInTheDocument();
  });

  it('shows radiance point message for DXF with no panels', () => {
    render(
      <FileUploadPanel
        uploadedFiles={[{ name: 'site.dxf', type: 'dxf', size: 2048 }]}
        panelCount={0}
        radiancePointCount={42}
        isUploading={false}
        uploadError={null}
        dispatch={mockDispatch}
      />
    );
    expect(screen.getByText(/42 radiance points/i)).toBeInTheDocument();
    expect(screen.getByText(/stage 3/i)).toBeInTheDocument();
  });

  it('shows loading state during upload', () => {
    render(
      <FileUploadPanel
        uploadedFiles={[]}
        panelCount={0}
        radiancePointCount={0}
        isUploading={true}
        uploadError={null}
        dispatch={mockDispatch}
      />
    );
    expect(screen.getByText(/parsing/i)).toBeInTheDocument();
  });

  it('shows error message on upload failure', () => {
    render(
      <FileUploadPanel
        uploadedFiles={[]}
        panelCount={0}
        radiancePointCount={0}
        isUploading={false}
        uploadError="Invalid DXF format"
        dispatch={mockDispatch}
      />
    );
    expect(screen.getByText(/invalid dxf/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement FileUploadPanel**

```tsx
'use client';

import { useRef, useCallback } from 'react';
import type { SolarDesignerAction, UploadedFile } from './types';

interface FileUploadPanelProps {
  uploadedFiles: UploadedFile[];
  panelCount: number;
  radiancePointCount: number;
  isUploading: boolean;
  uploadError: string | null;
  dispatch: (action: SolarDesignerAction) => void;
}

const ACCEPTED_EXTENSIONS = ['.dxf', '.json', '.csv'];

export default function FileUploadPanel({
  uploadedFiles,
  panelCount,
  radiancePointCount,
  isUploading,
  uploadError,
  dispatch,
}: FileUploadPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter((f) => {
      const ext = '.' + f.name.split('.').pop()?.toLowerCase();
      return ACCEPTED_EXTENSIONS.includes(ext);
    });

    if (files.length === 0) {
      dispatch({ type: 'UPLOAD_ERROR', error: 'No valid files. Expected .dxf, .json, or .csv' });
      return;
    }

    dispatch({ type: 'UPLOAD_START' });

    try {
      const formData = new FormData();
      files.forEach((f) => formData.append('files', f));

      const res = await fetch('/api/solar-designer/upload', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `Upload failed (${res.status})`);
      }

      const data = await res.json();

      if (data.errors?.length > 0 && data.panels.length === 0) {
        throw new Error(data.errors.join('; '));
      }

      dispatch({
        type: 'UPLOAD_SUCCESS',
        panels: data.panels,
        shadeData: data.shadeData,
        shadeFidelity: data.shadeFidelity,
        shadeSource: data.shadeSource,
        radiancePointCount: data.radiancePointCount ?? 0,
        files: files.map((f) => ({
          name: f.name,
          type: f.name.split('.').pop()?.toLowerCase() as 'dxf' | 'json' | 'csv',
          size: f.size,
        })),
      });
    } catch (err) {
      dispatch({
        type: 'UPLOAD_ERROR',
        error: err instanceof Error ? err.message : 'Upload failed',
      });
    }
  }, [dispatch]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  return (
    <div className="rounded-xl bg-surface p-4 shadow-card space-y-3">
      <h3 className="text-sm font-semibold text-foreground">Layout Files</h3>

      {/* Drop zone */}
      <div
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        className="flex flex-col items-center justify-center gap-2 h-24 rounded-xl border-2 border-dashed border-t-border hover:border-orange-500 cursor-pointer transition-colors bg-surface-2 hover:bg-surface-elevated"
      >
        {isUploading ? (
          <span className="text-sm text-muted animate-pulse">Parsing files...</span>
        ) : (
          <>
            <span className="text-lg opacity-40">📐</span>
            <span className="text-xs text-muted">Drop DXF, JSON, or CSV files here</span>
          </>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".dxf,.json,.csv"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files);
        }}
      />

      {/* Error */}
      {uploadError && (
        <p className="text-xs text-red-500">{uploadError}</p>
      )}

      {/* Uploaded files summary */}
      {uploadedFiles.length > 0 && (
        <div className="space-y-1">
          {uploadedFiles.map((f, i) => (
            <div key={i} className="flex items-center justify-between text-xs">
              <span className="text-foreground truncate">{f.name}</span>
              <span className="text-muted uppercase">{f.type}</span>
            </div>
          ))}
          <div className="pt-1 border-t border-t-border space-y-1">
            <span className="text-sm font-semibold text-orange-500">
              {panelCount} panels loaded
            </span>
            {panelCount === 0 && radiancePointCount > 0 && (
              <p className="text-xs text-muted">
                {radiancePointCount} radiance points from DXF — panel positions will be
                derived when the visualizer is built (Stage 3).
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Run tests**

Run: `npx jest --testPathPatterns='file-upload-panel' --no-coverage`
Expected: PASS

- [ ] **Step 4: Wire into page**

Replace the file upload placeholder in `page.tsx`:

```tsx
import FileUploadPanel from '@/components/solar-designer/FileUploadPanel';

// In sidebar:
<FileUploadPanel
  uploadedFiles={state.uploadedFiles}
  panelCount={state.panels.length}
  radiancePointCount={state.radiancePointCount}
  isUploading={state.isUploading}
  uploadError={state.uploadError}
  dispatch={dispatch}
/>
```

- [ ] **Step 5: Verify tsc + lint + tests**

Run: `npx tsc --noEmit 2>&1 | grep solar-designer && npx eslint src/components/solar-designer/ src/app/dashboards/solar-designer/ src/app/api/solar-designer/ && npx jest --testPathPatterns='solar-designer' --no-coverage`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add src/components/solar-designer/FileUploadPanel.tsx src/__tests__/components/solar-designer/file-upload-panel.test.tsx src/app/dashboards/solar-designer/page.tsx
git commit -m "feat(solar-designer): file upload panel with drag-and-drop and parse feedback"
```

---

### Task 9: System summary bar

**Files:**
- Create: `src/components/solar-designer/SystemSummaryBar.tsx`

- [ ] **Step 1: Create SystemSummaryBar**

Compact read-only bar that shows the current state at a glance: panel count, system size, selected equipment.

```tsx
'use client';

import type { ResolvedPanel, ResolvedInverter } from '@/lib/solar/v12-engine';

interface SystemSummaryBarProps {
  panelCount: number;
  selectedPanel: ResolvedPanel | null;
  selectedInverter: ResolvedInverter | null;
  stringCount: number;
}

export default function SystemSummaryBar({
  panelCount,
  selectedPanel,
  selectedInverter,
  stringCount,
}: SystemSummaryBarProps) {
  if (panelCount === 0 && !selectedPanel) return null;

  const systemKw = selectedPanel ? (selectedPanel.watts * panelCount) / 1000 : 0;

  return (
    <div className="rounded-xl bg-surface p-3 shadow-card">
      <div className="grid grid-cols-2 gap-2 text-xs">
        {panelCount > 0 && (
          <>
            <div>
              <span className="text-muted">Panels</span>
              <p className="text-sm font-semibold text-foreground">{panelCount}</p>
            </div>
            {selectedPanel && (
              <div>
                <span className="text-muted">System</span>
                <p className="text-sm font-semibold text-foreground">{systemKw.toFixed(2)} kW</p>
              </div>
            )}
          </>
        )}
        {selectedPanel && (
          <div className="col-span-2 truncate">
            <span className="text-muted">Panel:</span>{' '}
            <span className="text-foreground">{selectedPanel.name}</span>
          </div>
        )}
        {selectedInverter && (
          <div className="col-span-2 truncate">
            <span className="text-muted">Inverter:</span>{' '}
            <span className="text-foreground">{selectedInverter.name}</span>
          </div>
        )}
        {stringCount > 0 && (
          <div>
            <span className="text-muted">Strings</span>
            <p className="text-sm font-semibold text-foreground">{stringCount}</p>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into page sidebar (after site conditions)**

```tsx
import SystemSummaryBar from '@/components/solar-designer/SystemSummaryBar';

// At end of sidebar:
<SystemSummaryBar
  panelCount={state.panels.length}
  selectedPanel={state.selectedPanel}
  selectedInverter={state.selectedInverter}
  stringCount={state.strings.length}
/>
```

- [ ] **Step 3: Verify tsc + full test suite**

Run: `npx tsc --noEmit 2>&1 | grep solar-designer && npx jest --testPathPatterns='solar-designer' --no-coverage`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add src/components/solar-designer/SystemSummaryBar.tsx src/app/dashboards/solar-designer/page.tsx
git commit -m "feat(solar-designer): system summary bar showing panel count, system size, and equipment"
```

---

## Chunk 4: Integration Test + Final Cleanup (Task 10)

### Task 10: End-to-end smoke test and final validation

**Files:**
- Verify all existing tests pass
- Run project-wide lint and tsc

- [ ] **Step 1: Run all solar-designer tests**

Run: `npx jest --testPathPatterns='solar-designer' --no-coverage`
Expected: All pass

- [ ] **Step 2: Run project-wide tsc**

Run: `npx tsc --noEmit 2>&1 | grep -E 'solar-designer|error' | head -20`
Expected: No solar-designer errors (pre-existing errors in other files are OK)

- [ ] **Step 3: Run lint on all new files**

Run: `npx eslint src/components/solar-designer/ src/app/dashboards/solar-designer/ src/app/api/solar-designer/ src/__tests__/components/solar-designer/ src/__tests__/api/solar-designer-upload.test.ts`
Expected: 0 errors, 0 warnings

- [ ] **Step 4: Verify acceptance criteria**

Manual checklist against spec:
1. ✅ Page at `/dashboards/solar-designer` wrapped in `DashboardShell`
2. ✅ DXF/JSON/CSV upload parses and displays panel count
3. ✅ Equipment panel shows 8 panels and 9 inverters from catalog
4. ✅ Site conditions panel with temps, albedo, and loss profile (editable defaults)
5. ✅ Tab bar shows all 8 tabs with placeholder content for unbuilt tabs

- [ ] **Step 5: Final commit (if any cleanup needed)**

Only commit if there are actual changes. Stage specific files:
```bash
git add src/components/solar-designer/ src/app/dashboards/solar-designer/ src/app/api/solar-designer/ src/__tests__/components/solar-designer/ src/__tests__/api/solar-designer-upload.test.ts
git commit -m "chore(solar-designer): Stage 2 cleanup and final validation"
```
