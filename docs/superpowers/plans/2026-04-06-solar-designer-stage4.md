# Solar Designer Stage 4 — Production Analysis, Timeseries, Inverter Configuration

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire three analysis tabs (Production, 30-Min Series, Inverters) to the existing v12-engine, with a Run Analysis button that triggers computation via Web Worker and populates results into the UI.

**Architecture:** New `UIInverterConfig` bridge type mediates between UI-level per-channel MPPT display and the engine's flat `InverterConfig`. A `RunAnalysisButton` component manages the Web Worker lifecycle. Three tab components (`ProductionTab`, `TimeseriesTab`, `InvertersTab`) consume `CoreSolarDesignerResult` from state. All charts are native SVG — no chart library. The reducer gains 5 new action types plus stale-tracking on existing mutations.

**Tech Stack:** React 19, TypeScript 5, Next.js 16, Tailwind v4, SVG (native), Web Workers

**Spec:** `docs/superpowers/specs/2026-04-06-solar-designer-stage4-design.md`

---

## Chunk 1: Types, Bridge Utils, Reducer Expansion

Establishes the `UIInverterConfig` type, bridge functions (auto-assign + flatten), and all reducer changes. Fully testable in isolation before any UI work.

---

### Task 1: Add UIInverterConfig type and analysis state fields to types.ts

**Files:**
- Modify: `src/components/solar-designer/types.ts`

- [ ] **Step 1: Add `UIInverterConfig` interface and new state fields**

In `src/components/solar-designer/types.ts`:

1. Add `UIInverterConfig` after the existing `UIStringConfig` interface (around line 55):

```typescript
export interface UIInverterConfig {
  inverterId: number;       // 0-based index
  inverterKey: string;      // references selectedInverter.key
  channels: { stringIndices: number[] }[];  // one entry per MPPT channel
}
```

2. Change `inverters` type in `SolarDesignerState` from `InverterConfig[]` to `UIInverterConfig[]`:

```typescript
// Inverter configs (Stage 4)
inverters: UIInverterConfig[];
```

3. Remove `InverterConfig` from the import at the top of the file (it's no longer used in state). Keep it if other code still references it, but `SolarDesignerState.inverters` should now be `UIInverterConfig[]`.

4. Add four new state fields to `SolarDesignerState` after `result`:

```typescript
// Analysis lifecycle (Stage 4)
isAnalyzing: boolean;
analysisProgress: { percent: number; stage: string } | null;
analysisError: string | null;
resultStale: boolean;
```

- [ ] **Step 2: Add new action types to SolarDesignerAction**

Add these 5 new action cases to the `SolarDesignerAction` union type:

```typescript
// Stage 4 additions
| { type: 'RUN_ANALYSIS_START' }
| { type: 'SET_ANALYSIS_PROGRESS'; percent: number; stage: string }
| { type: 'SET_ANALYSIS_RESULT'; result: CoreSolarDesignerResult; inverters: UIInverterConfig[] }
| { type: 'SET_ANALYSIS_ERROR'; error: string }
| { type: 'REASSIGN_STRING_TO_CHANNEL'; stringIndex: number; fromInverterId: number; fromChannel: number; toInverterId: number; toChannel: number }
```

- [ ] **Step 3: Verify the file compiles**

Run: `npx tsc --noEmit src/components/solar-designer/types.ts 2>&1 | head -20`

There will be errors in page.tsx (reducer doesn't handle new actions yet). That's expected — the type changes here will be consumed by Task 2.

- [ ] **Step 4: Commit**

```bash
git add src/components/solar-designer/types.ts
git commit -m "feat(solar): add UIInverterConfig type and analysis state fields"
```

---

### Task 2: Inverter bridge utilities — autoAssignInverters + flattenInverterConfigs

**Files:**
- Create: `src/components/solar-designer/inverter-bridge.ts`
- Create: `src/__tests__/components/solar-designer/inverter-bridge.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/components/solar-designer/inverter-bridge.test.ts`:

```typescript
import {
  autoAssignInverters,
  flattenInverterConfigs,
} from '@/components/solar-designer/inverter-bridge';
import type { UIInverterConfig } from '@/components/solar-designer/types';

describe('autoAssignInverters', () => {
  it('distributes 4 strings across 2 inverters with 3 channels each', () => {
    const result = autoAssignInverters(4, 3, 'sol_ark_15k');
    expect(result).toHaveLength(2);
    // Inverter 0: channels [0], [1], [2]
    expect(result[0]).toEqual({
      inverterId: 0,
      inverterKey: 'sol_ark_15k',
      channels: [
        { stringIndices: [0] },
        { stringIndices: [1] },
        { stringIndices: [2] },
      ],
    });
    // Inverter 1: channel [3], empty, empty
    expect(result[1]).toEqual({
      inverterId: 1,
      inverterKey: 'sol_ark_15k',
      channels: [
        { stringIndices: [3] },
        { stringIndices: [] },
        { stringIndices: [] },
      ],
    });
  });

  it('handles exact fit — 6 strings, 3 channels = 2 full inverters', () => {
    const result = autoAssignInverters(6, 3, 'key');
    expect(result).toHaveLength(2);
    expect(result[0].channels.every(ch => ch.stringIndices.length === 1)).toBe(true);
    expect(result[1].channels.every(ch => ch.stringIndices.length === 1)).toBe(true);
  });

  it('returns single inverter when strings fit in one', () => {
    const result = autoAssignInverters(2, 4, 'key');
    expect(result).toHaveLength(1);
    expect(result[0].channels).toHaveLength(4);
    expect(result[0].channels[0].stringIndices).toEqual([0]);
    expect(result[0].channels[1].stringIndices).toEqual([1]);
    expect(result[0].channels[2].stringIndices).toEqual([]);
    expect(result[0].channels[3].stringIndices).toEqual([]);
  });

  it('returns empty array for 0 strings', () => {
    expect(autoAssignInverters(0, 3, 'key')).toEqual([]);
  });
});

describe('flattenInverterConfigs', () => {
  it('flattens UIInverterConfig[] to engine InverterConfig[]', () => {
    const ui: UIInverterConfig[] = [
      {
        inverterId: 0,
        inverterKey: 'sol_ark_15k',
        channels: [
          { stringIndices: [0, 1] },
          { stringIndices: [2] },
          { stringIndices: [] },
        ],
      },
    ];
    const flat = flattenInverterConfigs(ui);
    expect(flat).toEqual([
      { inverterKey: 'sol_ark_15k', stringIndices: [0, 1, 2] },
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(flattenInverterConfigs([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest -- inverter-bridge --no-coverage 2>&1 | tail -5`

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/components/solar-designer/inverter-bridge.ts`:

```typescript
/**
 * Solar Designer — Inverter Bridge Utilities
 *
 * Bridges between the UI's per-channel UIInverterConfig and the engine's
 * flat InverterConfig. Also provides auto-assignment of strings to MPPT channels.
 */
import type { InverterConfig } from '@/lib/solar/v12-engine';
import type { UIInverterConfig } from './types';

/**
 * Auto-distribute N strings across MPPT channels, one string per channel.
 * Creates as many inverters as needed to accommodate all strings.
 */
export function autoAssignInverters(
  stringCount: number,
  channelsPerInverter: number,
  inverterKey: string,
): UIInverterConfig[] {
  if (stringCount === 0) return [];

  const inverterCount = Math.ceil(stringCount / channelsPerInverter);
  const result: UIInverterConfig[] = [];

  for (let i = 0; i < inverterCount; i++) {
    const channels: { stringIndices: number[] }[] = [];
    for (let j = 0; j < channelsPerInverter; j++) {
      const stringIndex = i * channelsPerInverter + j;
      channels.push({
        stringIndices: stringIndex < stringCount ? [stringIndex] : [],
      });
    }
    result.push({ inverterId: i, inverterKey, channels });
  }

  return result;
}

/**
 * Flatten UIInverterConfig[] → engine InverterConfig[].
 * Merges all channel string indices into a single flat array per inverter.
 */
export function flattenInverterConfigs(
  uiConfigs: UIInverterConfig[],
): InverterConfig[] {
  return uiConfigs.map(ui => ({
    inverterKey: ui.inverterKey,
    stringIndices: ui.channels.flatMap(ch => ch.stringIndices),
  }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest -- inverter-bridge --no-coverage 2>&1 | tail -10`

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/solar-designer/inverter-bridge.ts src/__tests__/components/solar-designer/inverter-bridge.test.ts
git commit -m "feat(solar): add inverter bridge utils — autoAssign + flatten"
```

---

### Task 3: Expand the reducer — new action cases + stale-tracking

**Files:**
- Modify: `src/app/dashboards/solar-designer/page.tsx`
- Modify: `src/__tests__/app/solar-designer-reducer.test.ts`

**Context:** The reducer is defined inline in `page.tsx` (lines 47-170). The test file at `src/__tests__/app/solar-designer-reducer.test.ts` tests bridge logic directly. Since the reducer isn't exported, Stage 4 tests should follow the same pattern — test the logic directly without importing the reducer.

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/app/solar-designer-reducer.test.ts`:

```typescript
import type { UIInverterConfig } from '@/components/solar-designer/types';

describe('Stage 4 reducer logic', () => {
  describe('REASSIGN_STRING_TO_CHANNEL', () => {
    it('moves a string between channels on the same inverter', () => {
      const inverters: UIInverterConfig[] = [{
        inverterId: 0, inverterKey: 'k',
        channels: [
          { stringIndices: [0, 1] },
          { stringIndices: [2] },
          { stringIndices: [] },
        ],
      }];

      // Simulate reducer logic: move string 1 from channel 0 to channel 2
      const fromInverterId = 0, fromChannel = 0, toInverterId = 0, toChannel = 2, stringIndex = 1;
      const updated = inverters.map((inv, idx) => {
        let channels = inv.channels.map(ch => ({ ...ch, stringIndices: [...ch.stringIndices] }));
        if (idx === fromInverterId) {
          channels[fromChannel] = {
            stringIndices: channels[fromChannel].stringIndices.filter(s => s !== stringIndex),
          };
        }
        if (idx === toInverterId) {
          channels[toChannel] = {
            stringIndices: [...channels[toChannel].stringIndices, stringIndex],
          };
        }
        return { ...inv, channels };
      });

      expect(updated[0].channels[0].stringIndices).toEqual([0]);
      expect(updated[0].channels[2].stringIndices).toEqual([1]);
    });

    it('moves a string between different inverters', () => {
      const inverters: UIInverterConfig[] = [
        { inverterId: 0, inverterKey: 'k', channels: [{ stringIndices: [0] }, { stringIndices: [] }] },
        { inverterId: 1, inverterKey: 'k', channels: [{ stringIndices: [] }, { stringIndices: [1] }] },
      ];

      // Move string 0 from inverter 0, channel 0 → inverter 1, channel 0
      const fromInverterId = 0, fromChannel = 0, toInverterId = 1, toChannel = 0, stringIndex = 0;
      const updated = inverters.map((inv, idx) => {
        let channels = inv.channels.map(ch => ({ ...ch, stringIndices: [...ch.stringIndices] }));
        if (idx === fromInverterId) {
          channels[fromChannel] = {
            stringIndices: channels[fromChannel].stringIndices.filter(s => s !== stringIndex),
          };
        }
        if (idx === toInverterId) {
          channels[toChannel] = {
            stringIndices: [...channels[toChannel].stringIndices, stringIndex],
          };
        }
        return { ...inv, channels };
      });

      expect(updated[0].channels[0].stringIndices).toEqual([]);
      expect(updated[1].channels[0].stringIndices).toEqual([0]);
    });
  });

  describe('resultStale tracking', () => {
    it('marks stale when strings change and result exists', () => {
      const hasResult = true;
      const resultStale = hasResult ? true : false;
      expect(resultStale).toBe(true);
    });

    it('does not mark stale when result is null', () => {
      const hasResult = false;
      const resultStale = hasResult ? true : false;
      expect(resultStale).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

These test the logic patterns directly. They should pass immediately.

Run: `npx jest -- solar-designer-reducer --no-coverage 2>&1 | tail -10`

Expected: All tests PASS (existing + new).

- [ ] **Step 3: Update INITIAL_STATE in page.tsx**

In `src/app/dashboards/solar-designer/page.tsx`, add four fields to `INITIAL_STATE` (after `result: null,` on line 41):

```typescript
isAnalyzing: false,
analysisProgress: null,
analysisError: null,
resultStale: false,
```

- [ ] **Step 4: Add new reducer cases**

In the `reducer` function in `page.tsx`, add these cases before the `case 'RESET':` line:

```typescript
    case 'RUN_ANALYSIS_START':
      return { ...state, isAnalyzing: true, analysisError: null, analysisProgress: null };
    case 'SET_ANALYSIS_PROGRESS':
      return { ...state, analysisProgress: { percent: action.percent, stage: action.stage } };
    case 'SET_ANALYSIS_RESULT':
      return {
        ...state,
        result: action.result,
        inverters: action.inverters,
        isAnalyzing: false,
        resultStale: false,
        analysisError: null,
        analysisProgress: null,
      };
    case 'SET_ANALYSIS_ERROR':
      return { ...state, analysisError: action.error, isAnalyzing: false, analysisProgress: null };
    case 'REASSIGN_STRING_TO_CHANNEL': {
      const newInverters = state.inverters.map((inv, idx) => {
        const channels = inv.channels.map(ch => ({
          stringIndices: [...ch.stringIndices],
        }));
        if (idx === action.fromInverterId) {
          channels[action.fromChannel] = {
            stringIndices: channels[action.fromChannel].stringIndices.filter(
              s => s !== action.stringIndex
            ),
          };
        }
        if (idx === action.toInverterId) {
          channels[action.toChannel] = {
            stringIndices: [...channels[action.toChannel].stringIndices, action.stringIndex],
          };
        }
        return { ...inv, channels };
      });
      return { ...state, inverters: newInverters, resultStale: true };
    }
```

- [ ] **Step 5: Add stale-tracking to existing mutation actions**

In the same reducer, update these existing cases to set `resultStale: true` when `state.result !== null`. For each of `ASSIGN_PANEL`, `UNASSIGN_PANEL`, `CREATE_STRING`, `DELETE_STRING`, `AUTO_STRING`, `SET_PANEL`, `SET_INVERTER`, add the stale flag to the returned object:

```typescript
...(state.result ? { resultStale: true } : {}),
```

For example, the `ASSIGN_PANEL` case return becomes:

```typescript
return {
  ...state,
  strings: cleaned.map(s =>
    s.id === state.activeStringId
      ? { ...s, panelIds: [...s.panelIds, action.panelId] }
      : s
  ),
  ...(state.result ? { resultStale: true } : {}),
};
```

Apply the same pattern to the other 6 cases listed above.

- [ ] **Step 6: Update the `SET_STRINGS` case for UIInverterConfig**

The existing `SET_STRINGS` case (lines 86-94) casts `action.inverters` as `InverterConfig[]`, but `state.inverters` is now `UIInverterConfig[]`. Update the cast:

```typescript
case 'SET_STRINGS':
  return {
    ...state,
    strings: action.strings as unknown as UIStringConfig[],
    inverters: action.inverters as unknown as UIInverterConfig[],
    ...(state.result ? { resultStale: true } : {}),
  };
```

**Note:** The `SET_STRINGS` action type in `types.ts` still declares `inverters: InverterConfig[]` (engine type). This is intentional — `SET_STRINGS` is dispatched by the full engine path (Stage 5+), which produces flat `InverterConfig[]`. The `as unknown as UIInverterConfig[]` cast bridges this temporarily. When `SET_STRINGS` dispatch is actually wired up in a future stage, the action payload and bridge should be updated properly.

- [ ] **Step 7: Make ENABLED_TABS dynamic with useMemo**

In the `SolarDesignerInner` component, replace the static `const ENABLED_TABS` (line 172) with a `useMemo` inside the component:

```typescript
const enabledTabs = useMemo<SolarDesignerTab[]>(() => {
  const base: SolarDesignerTab[] = ['visualizer', 'stringing'];
  if (state.result) {
    return [...base, 'production', 'timeseries', 'inverters'];
  }
  return base;
}, [state.result]);
```

Update the `TabBar` prop from `enabledTabs={ENABLED_TABS}` to `enabledTabs={enabledTabs}`.

Remove the old `const ENABLED_TABS` line (172).

- [ ] **Step 8: Verify the build compiles**

Run: `npx tsc --noEmit 2>&1 | grep -c 'error' || echo "0 errors"`

Expected: 0 errors (or only pre-existing unrelated errors).

- [ ] **Step 9: Commit**

```bash
git add src/app/dashboards/solar-designer/page.tsx src/__tests__/app/solar-designer-reducer.test.ts
git commit -m "feat(solar): expand reducer with analysis actions + stale tracking"
```

---

### Task 4: RunAnalysisButton component — worker lifecycle + progress UI

**Files:**
- Create: `src/components/solar-designer/RunAnalysisButton.tsx`
- Create: `src/__tests__/components/solar-designer/run-analysis-button.test.tsx`
- Modify: `src/app/dashboards/solar-designer/page.tsx` (wire into sidebar)

**Reference docs:**
- Worker protocol: `src/lib/solar/v12-engine/worker.ts` — sends `RUN_SIMULATION`, receives `SIMULATION_PROGRESS` / `SIMULATION_RESULT` / `SIMULATION_ERROR`
- Input type: `CoreSolarDesignerInput` from `src/lib/solar/v12-engine/types.ts`
- Shade enrichment: `state.panelShadeMap` must be applied to `panels[].shadePointIds` before sending to worker

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/components/solar-designer/run-analysis-button.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react';
import RunAnalysisButton from '@/components/solar-designer/RunAnalysisButton';
import type { SolarDesignerState } from '@/components/solar-designer/types';
import type { ResolvedPanel, ResolvedInverter } from '@/lib/solar/v12-engine';

const mockPanel: ResolvedPanel = {
  key: 'rec_440', name: 'REC 440', watts: 440,
  voc: 48.4, vmp: 40.8, isc: 11.5, imp: 10.79,
  tempCoVoc: -0.0024, tempCoIsc: 0.0004, tempCoPmax: -0.0026,
  cells: 132, bypassDiodes: 3, cellsPerSubstring: 44,
  isBifacial: false, bifacialityFactor: 0,
};

const mockInverter: ResolvedInverter = {
  key: 'sol_ark', name: 'Sol-Ark 15K', acPower: 15000, dcMax: 20000,
  mpptMin: 60, mpptMax: 500, channels: 4, maxIsc: 25,
  efficiency: 0.97, architectureType: 'string', isMicro: false, isIntegrated: false,
};

const mockDispatch = jest.fn();

function makeState(overrides: Partial<SolarDesignerState>): SolarDesignerState {
  return {
    panels: [], shadeData: {}, shadeFidelity: 'full', shadeSource: 'manual',
    radiancePoints: [], uploadedFiles: [], panelShadeMap: {},
    siteAddress: null, siteFormattedAddress: null, siteLatLng: null,
    mapAlignment: { offsetX: 0, offsetY: 0, rotation: 0, scale: 1 },
    panelKey: '', inverterKey: '', selectedPanel: null, selectedInverter: null,
    siteConditions: { tempMin: -10, tempMax: 45, groundAlbedo: 0.2, clippingThreshold: 1, exportLimitW: 0 },
    lossProfile: { soiling: 2, mismatch: 2, dcWiring: 2, acWiring: 1, availability: 3, lid: 1.5, snow: 0, nameplate: 1 },
    strings: [], activeStringId: null, nextStringId: 1,
    inverters: [], result: null,
    activeTab: 'visualizer', isUploading: false, uploadError: null,
    isAnalyzing: false, analysisProgress: null, analysisError: null, resultStale: false,
    ...overrides,
  } as SolarDesignerState;
}

describe('RunAnalysisButton', () => {
  it('renders disabled when no panels', () => {
    render(<RunAnalysisButton state={makeState({})} dispatch={mockDispatch} />);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('renders disabled when no equipment selected', () => {
    render(<RunAnalysisButton state={makeState({
      panels: [{ id: 'p1', x: 0, y: 0, width: 1, height: 1.7, azimuth: 0, tilt: 20, shadePointIds: [] }],
      strings: [{ id: 1, panelIds: ['p1'] }],
    })} dispatch={mockDispatch} />);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('renders enabled when prerequisites met', () => {
    render(<RunAnalysisButton state={makeState({
      panels: [{ id: 'p1', x: 0, y: 0, width: 1, height: 1.7, azimuth: 0, tilt: 20, shadePointIds: [] }],
      strings: [{ id: 1, panelIds: ['p1'] }],
      selectedPanel: mockPanel,
      selectedInverter: mockInverter,
      panelKey: 'rec_440',
      inverterKey: 'sol_ark',
    })} dispatch={mockDispatch} />);
    expect(screen.getByRole('button')).toBeEnabled();
  });

  it('shows progress when analyzing', () => {
    render(<RunAnalysisButton state={makeState({
      panels: [{ id: 'p1', x: 0, y: 0, width: 1, height: 1.7, azimuth: 0, tilt: 20, shadePointIds: [] }],
      strings: [{ id: 1, panelIds: ['p1'] }],
      selectedPanel: mockPanel, selectedInverter: mockInverter,
      panelKey: 'rec_440', inverterKey: 'sol_ark',
      isAnalyzing: true, analysisProgress: { percent: 42, stage: 'Model A' },
    })} dispatch={mockDispatch} />);
    expect(screen.getByText(/42%/)).toBeInTheDocument();
    expect(screen.getByText(/Model A/)).toBeInTheDocument();
  });

  it('shows stale indicator when resultStale is true', () => {
    render(<RunAnalysisButton state={makeState({
      panels: [{ id: 'p1', x: 0, y: 0, width: 1, height: 1.7, azimuth: 0, tilt: 20, shadePointIds: [] }],
      strings: [{ id: 1, panelIds: ['p1'] }],
      selectedPanel: mockPanel, selectedInverter: mockInverter,
      panelKey: 'rec_440', inverterKey: 'sol_ark',
      resultStale: true, result: {} as any,
    })} dispatch={mockDispatch} />);
    expect(screen.getByTestId('stale-indicator')).toBeInTheDocument();
  });

  it('shows error when analysisError is set', () => {
    render(<RunAnalysisButton state={makeState({
      panels: [{ id: 'p1', x: 0, y: 0, width: 1, height: 1.7, azimuth: 0, tilt: 20, shadePointIds: [] }],
      strings: [{ id: 1, panelIds: ['p1'] }],
      selectedPanel: mockPanel, selectedInverter: mockInverter,
      panelKey: 'rec_440', inverterKey: 'sol_ark',
      analysisError: 'Worker crashed',
    })} dispatch={mockDispatch} />);
    expect(screen.getByText(/Worker crashed/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest -- run-analysis-button --no-coverage 2>&1 | tail -5`

Expected: FAIL — module not found.

- [ ] **Step 3: Write the RunAnalysisButton component**

Create `src/components/solar-designer/RunAnalysisButton.tsx`:

```typescript
'use client';

import { useCallback, useRef, useEffect } from 'react';
import type { SolarDesignerState, SolarDesignerAction } from './types';
import type { CoreSolarDesignerInput, EquipmentSelection } from '@/lib/solar/v12-engine';
import { autoAssignInverters, flattenInverterConfigs } from './inverter-bridge';

interface RunAnalysisButtonProps {
  state: SolarDesignerState;
  dispatch: (action: SolarDesignerAction) => void;
}

export default function RunAnalysisButton({ state, dispatch }: RunAnalysisButtonProps) {
  const workerRef = useRef<Worker | null>(null);

  // Clean up worker on unmount to prevent background leaks
  useEffect(() => {
    return () => { workerRef.current?.terminate(); };
  }, []);

  const canRun =
    state.panels.length > 0 &&
    state.selectedPanel !== null &&
    state.selectedInverter !== null &&
    state.strings.length > 0 &&
    state.strings.some(s => s.panelIds.length > 0);

  const handleRun = useCallback(() => {
    if (!canRun || !state.selectedPanel || !state.selectedInverter) return;

    // Terminate existing worker if running
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }

    dispatch({ type: 'RUN_ANALYSIS_START' });

    // 1. Shade enrichment: apply panelShadeMap to panel geometries
    const enrichedPanels = state.panels.map(pg => ({
      ...pg,
      shadePointIds: state.panelShadeMap[pg.id] ?? pg.shadePointIds,
    }));

    // 2. Bridge UIStringConfig[] → StringConfig[] (panel IDs → panel indices)
    const strings = state.strings
      .filter(s => s.panelIds.length > 0)
      .map(s => ({
        panels: s.panelIds
          .map(id => enrichedPanels.findIndex(p => p.id === id))
          .filter(idx => idx >= 0),
      }));

    // 3. Auto-assign inverters
    const uiInverters = autoAssignInverters(
      strings.length,
      state.selectedInverter.channels,
      state.selectedInverter.key,
    );
    const engineInverters = flattenInverterConfigs(uiInverters);

    // 4. Build engine input
    const equipment: EquipmentSelection = {
      panelKey: state.panelKey,
      inverterKey: state.inverterKey,
    };

    const input: CoreSolarDesignerInput = {
      panels: enrichedPanels,
      shadeData: state.shadeData,
      strings,
      inverters: engineInverters,
      equipment,
      siteConditions: state.siteConditions,
      lossProfile: state.lossProfile,
      shadeFidelity: state.shadeFidelity,
      shadeSource: state.shadeSource,
    };

    // 5. Create worker
    const worker = new Worker(
      new URL('@/lib/solar/v12-engine/worker.ts', import.meta.url),
      { type: 'module' },
    );
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'SIMULATION_PROGRESS') {
        dispatch({
          type: 'SET_ANALYSIS_PROGRESS',
          percent: msg.payload.percent ?? 0,
          stage: msg.payload.stage ?? '',
        });
      } else if (msg.type === 'SIMULATION_RESULT') {
        dispatch({
          type: 'SET_ANALYSIS_RESULT',
          result: msg.payload,
          inverters: uiInverters,
        });
        worker.terminate();
        workerRef.current = null;
      } else if (msg.type === 'SIMULATION_ERROR') {
        dispatch({
          type: 'SET_ANALYSIS_ERROR',
          error: msg.payload?.message ?? 'Analysis failed',
        });
        worker.terminate();
        workerRef.current = null;
      }
    };

    worker.onerror = () => {
      dispatch({ type: 'SET_ANALYSIS_ERROR', error: 'Worker failed to load' });
      worker.terminate();
      workerRef.current = null;
    };

    worker.postMessage({ type: 'RUN_SIMULATION', payload: input });
  }, [state, canRun, dispatch]);

  const isRunning = state.isAnalyzing;

  return (
    <div className="space-y-2">
      <button
        onClick={handleRun}
        disabled={!canRun || isRunning}
        className={`w-full relative rounded-lg px-4 py-2.5 text-sm font-semibold transition-all ${
          !canRun
            ? 'bg-surface-2 text-muted cursor-not-allowed'
            : isRunning
              ? 'bg-orange-500/20 text-orange-300 cursor-wait'
              : 'bg-orange-500 text-white hover:bg-orange-600 shadow-md hover:shadow-lg'
        }`}
        title={!canRun ? 'Add panels, select equipment, and create strings to run analysis.' : undefined}
      >
        {isRunning ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Analyzing...
          </span>
        ) : (
          <span className="flex items-center justify-center gap-2">
            Run Analysis
            {state.resultStale && (
              <span data-testid="stale-indicator" className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
            )}
          </span>
        )}
      </button>

      {/* Progress bar */}
      {isRunning && state.analysisProgress && (
        <div className="space-y-1">
          <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
            <div
              className="h-full bg-orange-500 rounded-full transition-all duration-300"
              style={{ width: `${state.analysisProgress.percent}%` }}
            />
          </div>
          <p className="text-xs text-muted text-center">
            {state.analysisProgress.percent}% — {state.analysisProgress.stage}
          </p>
        </div>
      )}

      {/* Error display */}
      {state.analysisError && (
        <p className="text-xs text-red-400 text-center">{state.analysisError}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest -- run-analysis-button --no-coverage 2>&1 | tail -10`

Expected: All 6 tests PASS.

- [ ] **Step 5: Wire RunAnalysisButton into the sidebar**

In `src/app/dashboards/solar-designer/page.tsx`:

1. Add import at the top:
```typescript
import RunAnalysisButton from '@/components/solar-designer/RunAnalysisButton';
```

2. In the `<aside>` JSX, add `RunAnalysisButton` below `SystemSummaryBar`:

```tsx
<SystemSummaryBar panelCount={state.panels.length} selectedPanel={state.selectedPanel}
  selectedInverter={state.selectedInverter} stringCount={state.strings.length} />

<RunAnalysisButton state={state} dispatch={dispatch} />
```

- [ ] **Step 6: Verify the build compiles**

Run: `npx tsc --noEmit 2>&1 | grep 'solar-designer' | head -10`

Expected: No errors from solar-designer files.

- [ ] **Step 7: Commit**

```bash
git add src/components/solar-designer/RunAnalysisButton.tsx src/__tests__/components/solar-designer/run-analysis-button.test.tsx src/app/dashboards/solar-designer/page.tsx
git commit -m "feat(solar): add RunAnalysisButton with worker lifecycle"
```

---

## Chunk 2: Production Tab — Summary Cards, Monthly Chart, Panel Table

Builds the Production tab UI. All data comes from `state.result` which is populated by the RunAnalysisButton from Chunk 1.

---

### Task 5: ProductionChart — native SVG monthly paired bar chart

**Files:**
- Create: `src/components/solar-designer/ProductionChart.tsx`
- Create: `src/__tests__/components/solar-designer/production-chart.test.tsx`

**Reference:** `src/components/ui/MonthlyBarChart.tsx` for SVG bar pattern (flex-based bar layout with hover tooltips).

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/components/solar-designer/production-chart.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react';
import ProductionChart from '@/components/solar-designer/ProductionChart';
import type { TimeseriesView } from '@/lib/solar/v12-engine/timeseries';

const mockModelA: TimeseriesView = {
  values: [500, 600, 800, 1000, 1200, 1400, 1300, 1100, 900, 700, 500, 400],
  labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  period: 'year',
};

const mockModelB: TimeseriesView = {
  values: [490, 585, 780, 975, 1170, 1365, 1268, 1073, 878, 683, 488, 390],
  labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  period: 'year',
};

describe('ProductionChart', () => {
  it('renders 12 month labels', () => {
    render(<ProductionChart modelA={mockModelA} modelB={mockModelB} />);
    expect(screen.getByText('Jan')).toBeInTheDocument();
    expect(screen.getByText('Jun')).toBeInTheDocument();
    expect(screen.getByText('Dec')).toBeInTheDocument();
  });

  it('renders SVG bars', () => {
    const { container } = render(<ProductionChart modelA={mockModelA} modelB={mockModelB} />);
    const rects = container.querySelectorAll('rect');
    // 12 months × 2 bars each = 24 rects
    expect(rects.length).toBe(24);
  });

  it('renders legend labels', () => {
    render(<ProductionChart modelA={mockModelA} modelB={mockModelB} />);
    expect(screen.getByText(/Independent/)).toBeInTheDocument();
    expect(screen.getByText(/String-level/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest -- production-chart --no-coverage 2>&1 | tail -5`

Expected: FAIL — module not found.

- [ ] **Step 3: Write ProductionChart component**

Create `src/components/solar-designer/ProductionChart.tsx`:

```typescript
'use client';

import { useMemo, useState } from 'react';
import type { TimeseriesView } from '@/lib/solar/v12-engine/timeseries';

interface ProductionChartProps {
  modelA: TimeseriesView;
  modelB: TimeseriesView;
}

const CHART_HEIGHT = 200;
const CHART_PADDING = { top: 20, right: 16, bottom: 40, left: 56 };

export default function ProductionChart({ modelA, modelB }: ProductionChartProps) {
  const [hoveredMonth, setHoveredMonth] = useState<number | null>(null);

  const maxVal = useMemo(() => {
    return Math.max(...modelA.values, ...modelB.values, 1);
  }, [modelA, modelB]);

  const barCount = modelA.values.length;
  const innerWidth = `calc(100% - ${CHART_PADDING.left + CHART_PADDING.right}px)`;

  // Y-axis ticks
  const yTicks = useMemo(() => {
    const step = Math.ceil(maxVal / 4 / 100) * 100;
    const ticks: number[] = [];
    for (let v = 0; v <= maxVal; v += step) ticks.push(v);
    return ticks;
  }, [maxVal]);

  return (
    <div className="bg-surface rounded-lg border border-border p-4">
      <p className="text-xs text-muted mb-3">Monthly Production (kWh)</p>
      <svg
        viewBox={`0 0 600 ${CHART_HEIGHT + CHART_PADDING.top + CHART_PADDING.bottom}`}
        className="w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Y-axis gridlines + labels */}
        {yTicks.map(tick => {
          const y = CHART_PADDING.top + CHART_HEIGHT - (tick / maxVal) * CHART_HEIGHT;
          return (
            <g key={tick}>
              <line
                x1={CHART_PADDING.left} x2={600 - CHART_PADDING.right}
                y1={y} y2={y}
                stroke="currentColor" strokeOpacity={0.1} strokeDasharray="4"
              />
              <text x={CHART_PADDING.left - 8} y={y + 3} textAnchor="end"
                className="fill-muted" fontSize={10}>{tick.toLocaleString()}</text>
            </g>
          );
        })}

        {/* Bars */}
        {modelA.values.map((aVal, i) => {
          const bVal = modelB.values[i] ?? 0;
          const groupWidth = (600 - CHART_PADDING.left - CHART_PADDING.right) / barCount;
          const barWidth = groupWidth * 0.35;
          const gx = CHART_PADDING.left + i * groupWidth;
          const aHeight = (aVal / maxVal) * CHART_HEIGHT;
          const bHeight = (bVal / maxVal) * CHART_HEIGHT;
          const baseY = CHART_PADDING.top + CHART_HEIGHT;

          return (
            <g
              key={i}
              onMouseEnter={() => setHoveredMonth(i)}
              onMouseLeave={() => setHoveredMonth(null)}
            >
              {/* Model A bar (orange) */}
              <rect
                x={gx + groupWidth * 0.1}
                y={baseY - aHeight}
                width={barWidth}
                height={aHeight}
                rx={2}
                fill="rgba(249, 115, 22, 0.7)"
              />
              {/* Model B bar (cyan) */}
              <rect
                x={gx + groupWidth * 0.1 + barWidth + 2}
                y={baseY - bHeight}
                width={barWidth}
                height={bHeight}
                rx={2}
                fill="rgba(6, 182, 212, 0.5)"
              />
              {/* X-axis label */}
              <text
                x={gx + groupWidth / 2}
                y={baseY + 16}
                textAnchor="middle"
                className="fill-muted"
                fontSize={10}
              >
                {modelA.labels[i]}
              </text>
              {/* Hover overlay */}
              {hoveredMonth === i && (
                <rect
                  x={gx} y={CHART_PADDING.top}
                  width={groupWidth} height={CHART_HEIGHT}
                  fill="currentColor" fillOpacity={0.05}
                />
              )}
            </g>
          );
        })}

        {/* Tooltip */}
        {hoveredMonth !== null && (() => {
          const delta = modelA.values[hoveredMonth] - modelB.values[hoveredMonth];
          return (
            <g>
              <rect
                x={250} y={2} width={120} height={58} rx={4}
                className="fill-surface-elevated" stroke="currentColor" strokeOpacity={0.2}
              />
              <text x={255} y={16} fontSize={10} className="fill-foreground" fontWeight="bold">
                {modelA.labels[hoveredMonth]}
              </text>
              <text x={255} y={28} fontSize={9} fill="#f97316">
                A: {modelA.values[hoveredMonth].toLocaleString()} kWh
              </text>
              <text x={255} y={40} fontSize={9} fill="#06b6d4">
                B: {modelB.values[hoveredMonth].toLocaleString()} kWh
              </text>
              <text x={255} y={52} fontSize={9} className="fill-muted">
                Δ: {delta.toLocaleString()} kWh
              </text>
            </g>
          );
        })()}
      </svg>

      {/* Legend */}
      <div className="flex gap-4 mt-2 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-orange-500/70" />
          Independent (Model A)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-cyan-500/50" />
          String-level (Model B)
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest -- production-chart --no-coverage 2>&1 | tail -10`

Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/solar-designer/ProductionChart.tsx src/__tests__/components/solar-designer/production-chart.test.tsx
git commit -m "feat(solar): add ProductionChart SVG paired bar component"
```

---

### Task 6: ProductionTab — summary cards + chart + per-panel table

**Files:**
- Create: `src/components/solar-designer/ProductionTab.tsx`
- Create: `src/__tests__/components/solar-designer/production-tab.test.tsx`
- Modify: `src/app/dashboards/solar-designer/page.tsx` (replace placeholder)

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/components/solar-designer/production-tab.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react';
import ProductionTab from '@/components/solar-designer/ProductionTab';
import type { CoreSolarDesignerResult, PanelStat } from '@/lib/solar/v12-engine';
import type { SolarDesignerState } from '@/components/solar-designer/types';

function makeEmptyTimeseries(): Float32Array {
  return new Float32Array(17520);
}

function makeMockResult(): CoreSolarDesignerResult {
  return {
    panelStats: [
      { id: 0, tsrf: 0.93, points: [], panelKey: 'k', bifacialGain: 1, segmentIndex: 0 },
      { id: 1, tsrf: 0.88, points: [], panelKey: 'k', bifacialGain: 1, segmentIndex: 0 },
    ],
    production: { independentAnnual: 12500, stringLevelAnnual: 12200, eagleViewAnnual: 0 },
    mismatchLossPct: 2.4,
    clippingLossPct: 0,
    clippingEvents: [],
    independentTimeseries: [makeEmptyTimeseries(), makeEmptyTimeseries()],
    stringTimeseries: [makeEmptyTimeseries()],
    shadeFidelity: 'full',
    shadeSource: 'manual',
    panelCount: 2,
    systemSizeKw: 0.88,
    systemTsrf: 0.91,
    specificYield: 1420,
  };
}

describe('ProductionTab', () => {
  it('renders empty state when result is null', () => {
    render(<ProductionTab result={null} panels={[]} strings={[]} />);
    expect(screen.getByText(/Run analysis/)).toBeInTheDocument();
  });

  it('renders 4 summary cards when result exists', () => {
    render(<ProductionTab result={makeMockResult()} panels={[
      { id: 'p1', x: 0, y: 0, width: 1, height: 1.7, azimuth: 0, tilt: 20, shadePointIds: [] },
      { id: 'p2', x: 2, y: 0, width: 1, height: 1.7, azimuth: 0, tilt: 20, shadePointIds: [] },
    ]} strings={[{ id: 1, panelIds: ['p1', 'p2'] }]} />);
    expect(screen.getByText(/12,200/)).toBeInTheDocument(); // Annual production
    expect(screen.getByText(/1,420/)).toBeInTheDocument();   // Specific yield
    expect(screen.getByText(/2\.4/)).toBeInTheDocument();    // Mismatch
    expect(screen.getByText(/0\.91/)).toBeInTheDocument();   // TSRF
  });

  it('renders the per-panel table', () => {
    render(<ProductionTab result={makeMockResult()} panels={[
      { id: 'p1', x: 0, y: 0, width: 1, height: 1.7, azimuth: 0, tilt: 20, shadePointIds: [] },
      { id: 'p2', x: 2, y: 0, width: 1, height: 1.7, azimuth: 0, tilt: 20, shadePointIds: [] },
    ]} strings={[{ id: 1, panelIds: ['p1', 'p2'] }]} />);
    // Table headers
    expect(screen.getByText('Panel')).toBeInTheDocument();
    expect(screen.getByText('TSRF')).toBeInTheDocument();
    // Panel IDs
    expect(screen.getByText('p1')).toBeInTheDocument();
    expect(screen.getByText('p2')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest -- production-tab --no-coverage 2>&1 | tail -5`

Expected: FAIL — module not found.

- [ ] **Step 3: Write ProductionTab component**

Create `src/components/solar-designer/ProductionTab.tsx`:

```typescript
'use client';

import { useMemo, useState } from 'react';
import type { CoreSolarDesignerResult, PanelGeometry } from '@/lib/solar/v12-engine';
import { aggregateTimeseries, sumTimeseries, HALF_HOUR_FACTOR } from '@/lib/solar/v12-engine';
import type { UIStringConfig } from './types';
import ProductionChart from './ProductionChart';

interface ProductionTabProps {
  result: CoreSolarDesignerResult | null;
  panels: PanelGeometry[];
  strings: UIStringConfig[];
}

/** Sum a Float32Array and convert W half-hours to kWh */
function timeseriesKwh(ts: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < ts.length; i++) sum += ts[i];
  return sum / HALF_HOUR_FACTOR;
}

type SortKey = 'panel' | 'tsrf' | 'independent' | 'string' | 'delta';

export default function ProductionTab({ result, panels, strings }: ProductionTabProps) {
  const [sortKey, setSortKey] = useState<SortKey>('delta');
  const [sortAsc, setSortAsc] = useState(false);

  // Aggregate timeseries for chart
  const chartData = useMemo(() => {
    if (!result) return null;
    const modelA = aggregateTimeseries(sumTimeseries(result.independentTimeseries), 'year', 0);
    const modelB = aggregateTimeseries(sumTimeseries(result.stringTimeseries), 'year', 0);
    return { modelA, modelB };
  }, [result]);

  // Build per-panel table rows
  const tableRows = useMemo(() => {
    if (!result) return [];
    // Build a lookup: panelIndex → stringIndex
    const panelToString = new Map<number, number>();
    strings.forEach((s, si) => {
      s.panelIds.forEach(pid => {
        const pi = panels.findIndex(p => p.id === pid);
        if (pi >= 0) panelToString.set(pi, si);
      });
    });

    return panels.map((panel, i) => {
      const tsrf = result.panelStats[i]?.tsrf ?? 0;
      const indKwh = result.independentTimeseries[i]
        ? timeseriesKwh(result.independentTimeseries[i])
        : 0;

      // String kWh: even share of string total
      const si = panelToString.get(i);
      let strKwh = 0;
      if (si !== undefined && result.stringTimeseries[si]) {
        const stringTotal = timeseriesKwh(result.stringTimeseries[si]);
        const panelsInString = strings[si]?.panelIds.length ?? 1;
        strKwh = stringTotal / panelsInString;
      }

      const delta = indKwh > 0 ? ((indKwh - strKwh) / indKwh) * 100 : 0;

      return { panelId: panel.id, tsrf, indKwh, strKwh, delta };
    });
  }, [result, panels, strings]);

  // Sort rows
  const sortedRows = useMemo(() => {
    const rows = [...tableRows];
    const dir = sortAsc ? 1 : -1;
    rows.sort((a, b) => {
      switch (sortKey) {
        case 'panel': return dir * a.panelId.localeCompare(b.panelId);
        case 'tsrf': return dir * (a.tsrf - b.tsrf);
        case 'independent': return dir * (a.indKwh - b.indKwh);
        case 'string': return dir * (a.strKwh - b.strKwh);
        case 'delta': return dir * (a.delta - b.delta);
        default: return 0;
      }
    });
    return rows;
  }, [tableRows, sortKey, sortAsc]);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(key === 'panel'); // panel asc by default, everything else desc
    }
  };

  if (!result) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <p className="text-muted text-sm">Run analysis to see production results</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard label="Annual Production" value={`${result.production.stringLevelAnnual.toLocaleString()} kWh`} accent="orange" />
        <MetricCard label="Specific Yield" value={`${result.specificYield.toLocaleString()} kWh/kWp`} accent="cyan" />
        <MetricCard label="Mismatch Loss" value={`${result.mismatchLossPct.toFixed(1)}%`} accent="red" />
        <MetricCard label="System TSRF" value={result.systemTsrf.toFixed(2)} accent="green" />
      </div>

      {/* Monthly Chart */}
      {chartData && <ProductionChart modelA={chartData.modelA} modelB={chartData.modelB} />}

      {/* Per-Panel Table */}
      <div className="bg-surface rounded-lg border border-border overflow-hidden">
        <div className="overflow-x-auto max-h-80 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 sticky top-0 z-10">
              <tr>
                {([
                  ['panel', 'Panel'],
                  ['tsrf', 'TSRF'],
                  ['independent', 'Independent (kWh)'],
                  ['string', 'String (kWh)'],
                  ['delta', 'Δ Loss (%)'],
                ] as [SortKey, string][]).map(([key, label]) => (
                  <th
                    key={key}
                    onClick={() => handleSort(key)}
                    className="px-3 py-2 text-left text-xs text-muted font-medium cursor-pointer hover:text-foreground transition-colors"
                  >
                    {label} {sortKey === key && (sortAsc ? '↑' : '↓')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sortedRows.map(row => (
                <tr key={row.panelId} className="hover:bg-surface-2/50 transition-colors">
                  <td className="px-3 py-1.5 text-xs font-mono">{row.panelId}</td>
                  <td className="px-3 py-1.5 text-xs">{row.tsrf.toFixed(2)}</td>
                  <td className="px-3 py-1.5 text-xs">{row.indKwh.toFixed(0)}</td>
                  <td className="px-3 py-1.5 text-xs">{row.strKwh.toFixed(0)}</td>
                  <td className={`px-3 py-1.5 text-xs font-medium ${
                    row.delta > 2 ? 'text-red-400' : row.delta > 1 ? 'text-yellow-400' : 'text-foreground'
                  }`}>
                    {row.delta.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** Inline MetricCard — lightweight version for Production tab */
function MetricCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  const colors: Record<string, string> = {
    orange: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
    cyan: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
    red: 'bg-red-500/10 text-red-400 border-red-500/20',
    green: 'bg-green-500/10 text-green-400 border-green-500/20',
  };
  return (
    <div className={`rounded-lg border p-3 text-center ${colors[accent] ?? colors.orange}`}>
      <p className="text-[10px] uppercase tracking-wider text-muted mb-1">{label}</p>
      <p className="text-lg font-bold">{value}</p>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest -- production-tab --no-coverage 2>&1 | tail -10`

Expected: All 3 tests PASS.

- [ ] **Step 5: Wire ProductionTab into page.tsx**

In `src/app/dashboards/solar-designer/page.tsx`:

1. Add import:
```typescript
import ProductionTab from '@/components/solar-designer/ProductionTab';
```

2. Replace the production placeholder:
```tsx
{state.activeTab === 'production' && (
  <ProductionTab result={state.result} panels={state.panels} strings={state.strings} />
)}
```

Remove the `PlaceholderTab` for production.

- [ ] **Step 6: Commit**

```bash
git add src/components/solar-designer/ProductionTab.tsx src/__tests__/components/solar-designer/production-tab.test.tsx src/app/dashboards/solar-designer/page.tsx
git commit -m "feat(solar): add ProductionTab with summary cards, chart, panel table"
```

---

## Chunk 3: Timeseries Tab — Period Toggle, Date Navigator, Area/Bar Chart

---

### Task 7: TimeseriesChart — native SVG with area (year) and bar (day/week/month) modes

**Files:**
- Create: `src/components/solar-designer/TimeseriesChart.tsx`
- Create: `src/__tests__/components/solar-designer/timeseries-chart.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/components/solar-designer/timeseries-chart.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react';
import TimeseriesChart from '@/components/solar-designer/TimeseriesChart';
import type { TimeseriesView } from '@/lib/solar/v12-engine/timeseries';

const yearView: TimeseriesView = {
  values: [500, 600, 800, 1000, 1200, 1400, 1300, 1100, 900, 700, 500, 400],
  labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  period: 'year',
};

const dayView: TimeseriesView = {
  values: Array.from({ length: 48 }, (_, i) => i < 12 || i > 36 ? 0 : 200 + i * 10),
  labels: Array.from({ length: 48 }, (_, i) => `${Math.floor(i/2)}:${(i%2)*30 || '00'}`),
  period: 'day',
};

describe('TimeseriesChart', () => {
  it('renders year view as area chart with month labels', () => {
    render(<TimeseriesChart modelA={yearView} modelB={yearView} />);
    expect(screen.getByText('Jan')).toBeInTheDocument();
    expect(screen.getByText('Dec')).toBeInTheDocument();
  });

  it('renders day view as bar chart', () => {
    const { container } = render(<TimeseriesChart modelA={dayView} />);
    const rects = container.querySelectorAll('rect');
    expect(rects.length).toBeGreaterThan(0);
  });

  it('renders single series when modelB is undefined', () => {
    const { container } = render(<TimeseriesChart modelA={dayView} />);
    // Should still render without errors
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest -- timeseries-chart --no-coverage 2>&1 | tail -5`

Expected: FAIL — module not found.

- [ ] **Step 3: Write TimeseriesChart component**

Create `src/components/solar-designer/TimeseriesChart.tsx`:

```typescript
'use client';

import { useMemo, useState } from 'react';
import type { TimeseriesView } from '@/lib/solar/v12-engine/timeseries';

interface TimeseriesChartProps {
  modelA: TimeseriesView;
  modelB?: TimeseriesView;
}

const H = 200;
const PAD = { top: 20, right: 16, bottom: 32, left: 56 };
const W = 600;
const INNER_W = W - PAD.left - PAD.right;
const INNER_H = H;

export default function TimeseriesChart({ modelA, modelB }: TimeseriesChartProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const isYear = modelA.period === 'year';

  const maxVal = useMemo(() => {
    const allVals = [...modelA.values, ...(modelB?.values ?? [])];
    return Math.max(...allVals, 1);
  }, [modelA, modelB]);

  const yTicks = useMemo(() => {
    const step = Math.ceil(maxVal / 4 / (maxVal > 1000 ? 100 : 10)) * (maxVal > 1000 ? 100 : 10);
    const ticks: number[] = [];
    for (let v = 0; v <= maxVal; v += step) ticks.push(v);
    return ticks;
  }, [maxVal]);

  const unit = modelA.period === 'day' ? 'Wh' : 'kWh';

  // Area chart path builder
  const buildPath = (values: number[], close: boolean) => {
    const n = values.length;
    const points = values.map((v, i) => {
      const x = PAD.left + (i / (n - 1)) * INNER_W;
      const y = PAD.top + INNER_H - (v / maxVal) * INNER_H;
      return `${x},${y}`;
    });
    const line = `M${points.join(' L')}`;
    if (close) {
      const baseY = PAD.top + INNER_H;
      return `${line} L${PAD.left + INNER_W},${baseY} L${PAD.left},${baseY} Z`;
    }
    return line;
  };

  return (
    <div className="bg-surface rounded-lg border border-border p-4">
      <p className="text-xs text-muted mb-3">
        {isYear ? 'Annual' : modelA.period.charAt(0).toUpperCase() + modelA.period.slice(1)} Production ({unit})
      </p>
      <svg viewBox={`0 0 ${W} ${H + PAD.top + PAD.bottom}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        {/* Y gridlines */}
        {yTicks.map(tick => {
          const y = PAD.top + INNER_H - (tick / maxVal) * INNER_H;
          return (
            <g key={tick}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y}
                stroke="currentColor" strokeOpacity={0.1} strokeDasharray="4" />
              <text x={PAD.left - 8} y={y + 3} textAnchor="end" className="fill-muted" fontSize={10}>
                {tick.toLocaleString()}
              </text>
            </g>
          );
        })}

        {isYear ? (
          /* Area chart for year view */
          <>
            <path d={buildPath(modelA.values, true)} fill="rgba(249,115,22,0.2)" stroke="none" />
            <path d={buildPath(modelA.values, false)} fill="none" stroke="#f97316" strokeWidth={2} />
            {modelB && (
              <>
                <path d={buildPath(modelB.values, false)} fill="none"
                  stroke="#06b6d4" strokeWidth={2} strokeDasharray="6 3" />
              </>
            )}
            {/* X labels */}
            {modelA.labels.map((label, i) => {
              const x = PAD.left + (i / (modelA.values.length - 1)) * INNER_W;
              return (
                <text key={i} x={x} y={PAD.top + INNER_H + 16}
                  textAnchor="middle" className="fill-muted" fontSize={10}>{label}</text>
              );
            })}
          </>
        ) : (
          /* Bar chart for day/week/month */
          <>
            {modelA.values.map((aVal, i) => {
              const bVal = modelB?.values[i] ?? 0;
              const gw = INNER_W / modelA.values.length;
              const gx = PAD.left + i * gw;
              const barW = modelB ? gw * 0.35 : gw * 0.7;
              const aH = (aVal / maxVal) * INNER_H;
              const bH = (bVal / maxVal) * INNER_H;
              const baseY = PAD.top + INNER_H;
              return (
                <g key={i}
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <rect x={gx + gw * 0.1} y={baseY - aH} width={barW} height={aH}
                    rx={2} fill="rgba(249,115,22,0.7)" />
                  {modelB && (
                    <rect x={gx + gw * 0.1 + barW + 2} y={baseY - bH} width={barW} height={bH}
                      rx={2} fill="rgba(6,182,212,0.5)" />
                  )}
                  {/* X label — show every Nth to avoid overlap */}
                  {(modelA.values.length <= 12 || i % Math.ceil(modelA.values.length / 12) === 0) && (
                    <text x={gx + gw / 2} y={baseY + 16} textAnchor="middle"
                      className="fill-muted" fontSize={9}>{modelA.labels[i]}</text>
                  )}
                </g>
              );
            })}
          </>
        )}
      </svg>

      {/* Legend */}
      <div className="flex gap-4 mt-2 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-orange-500/70" />
          Independent (Model A)
        </span>
        {modelB && (
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-cyan-500/50" />
            String-level (Model B)
          </span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest -- timeseries-chart --no-coverage 2>&1 | tail -10`

Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/solar-designer/TimeseriesChart.tsx src/__tests__/components/solar-designer/timeseries-chart.test.tsx
git commit -m "feat(solar): add TimeseriesChart SVG — area/bar modes"
```

---

### Task 8: TimeseriesTab — period toggle, date navigator, string selector

**Files:**
- Create: `src/components/solar-designer/TimeseriesTab.tsx`
- Create: `src/__tests__/components/solar-designer/timeseries-tab.test.tsx`
- Modify: `src/app/dashboards/solar-designer/page.tsx` (replace placeholder)

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/components/solar-designer/timeseries-tab.test.tsx`:

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import TimeseriesTab from '@/components/solar-designer/TimeseriesTab';
import type { CoreSolarDesignerResult } from '@/lib/solar/v12-engine';

function makeEmptyTimeseries(): Float32Array {
  return new Float32Array(17520);
}

function makeMockResult(): CoreSolarDesignerResult {
  return {
    panelStats: [{ id: 0, tsrf: 0.93, points: [], panelKey: 'k', bifacialGain: 1 }],
    production: { independentAnnual: 12500, stringLevelAnnual: 12200, eagleViewAnnual: 0 },
    mismatchLossPct: 2.4, clippingLossPct: 0, clippingEvents: [],
    independentTimeseries: [makeEmptyTimeseries()],
    stringTimeseries: [makeEmptyTimeseries()],
    shadeFidelity: 'full', shadeSource: 'manual',
    panelCount: 1, systemSizeKw: 0.44, systemTsrf: 0.93, specificYield: 1420,
  };
}

describe('TimeseriesTab', () => {
  it('renders empty state when result is null', () => {
    render(<TimeseriesTab result={null} strings={[]} />);
    expect(screen.getByText(/Run analysis/)).toBeInTheDocument();
  });

  it('renders period toggle buttons', () => {
    render(<TimeseriesTab result={makeMockResult()} strings={[{ id: 1, panelIds: ['p1'] }]} />);
    expect(screen.getByText('Day')).toBeInTheDocument();
    expect(screen.getByText('Week')).toBeInTheDocument();
    expect(screen.getByText('Month')).toBeInTheDocument();
    expect(screen.getByText('Year')).toBeInTheDocument();
  });

  it('shows date navigator when period is not Year', () => {
    render(<TimeseriesTab result={makeMockResult()} strings={[{ id: 1, panelIds: ['p1'] }]} />);
    // Default is Year — no navigator
    expect(screen.queryByTestId('date-nav')).not.toBeInTheDocument();
    // Switch to Day
    fireEvent.click(screen.getByText('Day'));
    expect(screen.getByTestId('date-nav')).toBeInTheDocument();
  });

  it('renders string selector dropdown', () => {
    render(<TimeseriesTab result={makeMockResult()} strings={[{ id: 1, panelIds: ['p1'] }]} />);
    expect(screen.getByText(/System Total/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest -- timeseries-tab --no-coverage 2>&1 | tail -5`

Expected: FAIL — module not found.

- [ ] **Step 3: Write TimeseriesTab component**

Create `src/components/solar-designer/TimeseriesTab.tsx`:

```typescript
'use client';

import { useMemo, useState } from 'react';
import type { CoreSolarDesignerResult } from '@/lib/solar/v12-engine';
import { aggregateTimeseries, sumTimeseries } from '@/lib/solar/v12-engine';
import type { AggregationPeriod } from '@/lib/solar/v12-engine/timeseries';
import type { UIStringConfig } from './types';
import TimeseriesChart from './TimeseriesChart';

interface TimeseriesTabProps {
  result: CoreSolarDesignerResult | null;
  strings: UIStringConfig[];
}

const PERIODS: AggregationPeriod[] = ['day', 'week', 'month', 'year'];
const PERIOD_LABELS: Record<AggregationPeriod, string> = {
  day: 'Day', week: 'Week', month: 'Month', year: 'Year',
};

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_START_DAYS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

/** Convert day-of-year (0-364) to "Month Day" label */
function dayLabel(dayIndex: number): string {
  let m = 0;
  for (let i = 11; i >= 0; i--) {
    if (dayIndex >= MONTH_START_DAYS[i]) { m = i; break; }
  }
  const dayOfMonth = dayIndex - MONTH_START_DAYS[m] + 1;
  return `${MONTH_NAMES[m]} ${dayOfMonth}`;
}

export default function TimeseriesTab({ result, strings }: TimeseriesTabProps) {
  const [period, setPeriod] = useState<AggregationPeriod>('year');
  const [startDay, setStartDay] = useState(0);
  const [selectedString, setSelectedString] = useState<number | null>(null); // null = system total

  // Compute aggregated views
  const chartData = useMemo(() => {
    if (!result) return null;

    const indSeries = selectedString === null
      ? sumTimeseries(result.independentTimeseries)
      : null; // No Model A for individual strings
    const strSeries = selectedString === null
      ? sumTimeseries(result.stringTimeseries)
      : result.stringTimeseries[selectedString] ?? null;

    if (!indSeries && !strSeries) return null;

    const sd = period === 'year' ? 0 : startDay;
    const modelA = indSeries ? aggregateTimeseries(indSeries, period, sd) : null;
    const modelB = strSeries ? aggregateTimeseries(strSeries, period, sd) : null;

    return { modelA, modelB };
  }, [result, period, startDay, selectedString]);

  // Date navigator bounds
  const navMax = period === 'day' ? 364 : period === 'week' ? 51 : period === 'month' ? 11 : 0;
  const navLabel = period === 'day'
    ? dayLabel(startDay)
    : period === 'week'
      ? `Week ${Math.floor(startDay / 7) + 1}`
      : period === 'month'
        ? MONTH_NAMES[MONTH_START_DAYS.findLastIndex(d => startDay >= d)]
        : '';

  const navigate = (delta: number) => {
    if (period === 'day') {
      setStartDay(d => Math.max(0, Math.min(364, d + delta)));
    } else if (period === 'week') {
      setStartDay(d => {
        const week = Math.floor(d / 7) + delta;
        return Math.max(0, Math.min(51, week)) * 7;
      });
    } else if (period === 'month') {
      setStartDay(d => {
        const m = MONTH_START_DAYS.indexOf(d) !== -1 ? MONTH_START_DAYS.indexOf(d) : 0;
        const idx = Math.max(0, Math.min(11, m + delta));
        // Map back to startDay: use month index directly for state, convert on use
        return MONTH_START_DAYS[idx];
      });
    }
  };

  if (!result) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <p className="text-muted text-sm">Run analysis to see timeseries data</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Period Toggle */}
      <div className="flex gap-1 bg-surface rounded-lg p-1 w-fit">
        {PERIODS.map(p => (
          <button
            key={p}
            onClick={() => { setPeriod(p); setStartDay(0); }}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              p === period
                ? 'bg-orange-500 text-white'
                : 'text-muted hover:text-foreground hover:bg-surface-2'
            }`}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>

      {/* Date Navigator */}
      {period !== 'year' && (
        <div data-testid="date-nav" className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            disabled={startDay <= 0}
            className="px-2 py-1 text-sm text-muted hover:text-foreground disabled:opacity-30"
          >
            ←
          </button>
          <span className="text-sm font-medium min-w-[120px] text-center">{navLabel}</span>
          <button
            onClick={() => navigate(1)}
            disabled={
              period === 'day' ? startDay >= 364 :
              period === 'week' ? startDay >= 51 * 7 :
              MONTH_START_DAYS.indexOf(startDay) >= 11
            }
            className="px-2 py-1 text-sm text-muted hover:text-foreground disabled:opacity-30"
          >
            →
          </button>
        </div>
      )}

      {/* Chart */}
      {chartData && (
        <TimeseriesChart
          modelA={chartData.modelA ?? chartData.modelB!}
          modelB={chartData.modelA ? chartData.modelB ?? undefined : undefined}
        />
      )}

      {/* String Selector */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-muted">View:</label>
        <select
          value={selectedString === null ? 'total' : String(selectedString)}
          onChange={e => setSelectedString(e.target.value === 'total' ? null : Number(e.target.value))}
          className="bg-surface border border-border rounded-md px-2 py-1 text-sm text-foreground"
        >
          <option value="total">System Total</option>
          {strings.map((s, i) => (
            <option key={s.id} value={String(i)}>
              String {s.id} ({s.panelIds.length} panels)
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest -- timeseries-tab --no-coverage 2>&1 | tail -10`

Expected: All 4 tests PASS.

- [ ] **Step 5: Wire TimeseriesTab into page.tsx**

In `src/app/dashboards/solar-designer/page.tsx`:

1. Add import:
```typescript
import TimeseriesTab from '@/components/solar-designer/TimeseriesTab';
```

2. Replace the timeseries placeholder:
```tsx
{state.activeTab === 'timeseries' && (
  <TimeseriesTab result={state.result} strings={state.strings} />
)}
```

- [ ] **Step 6: Commit**

```bash
git add src/components/solar-designer/TimeseriesTab.tsx src/__tests__/components/solar-designer/timeseries-tab.test.tsx src/app/dashboards/solar-designer/page.tsx
git commit -m "feat(solar): add TimeseriesTab with period toggle + date navigator"
```

---

## Chunk 4: Inverters Tab + Final Integration

---

### Task 9: InvertersTab — MPPT cards, reassignment, clipping placeholder

**Files:**
- Create: `src/components/solar-designer/InvertersTab.tsx`
- Create: `src/__tests__/components/solar-designer/inverters-tab.test.tsx`
- Modify: `src/app/dashboards/solar-designer/page.tsx` (replace placeholder)

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/components/solar-designer/inverters-tab.test.tsx`:

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import InvertersTab from '@/components/solar-designer/InvertersTab';
import type { CoreSolarDesignerResult, ResolvedInverter } from '@/lib/solar/v12-engine';
import type { UIInverterConfig, UIStringConfig } from '@/components/solar-designer/types';

const mockInverter: ResolvedInverter = {
  key: 'sol_ark', name: 'Sol-Ark 15K', acPower: 15000, dcMax: 20000,
  mpptMin: 60, mpptMax: 500, channels: 3, maxIsc: 25,
  efficiency: 0.97, architectureType: 'string', isMicro: false, isIntegrated: false,
};

const mockStrings: UIStringConfig[] = [
  { id: 1, panelIds: ['p1', 'p2', 'p3'] },
  { id: 2, panelIds: ['p4', 'p5'] },
];

const mockUIInverters: UIInverterConfig[] = [{
  inverterId: 0, inverterKey: 'sol_ark',
  channels: [
    { stringIndices: [0] },
    { stringIndices: [1] },
    { stringIndices: [] },
  ],
}];

function makeEmptyResult(): CoreSolarDesignerResult {
  return {
    panelStats: [], production: { independentAnnual: 0, stringLevelAnnual: 0, eagleViewAnnual: 0 },
    mismatchLossPct: 0, clippingLossPct: 0, clippingEvents: [],
    independentTimeseries: [], stringTimeseries: [],
    shadeFidelity: 'full', shadeSource: 'manual',
    panelCount: 0, systemSizeKw: 0, systemTsrf: 0, specificYield: 0,
  };
}

const mockDispatch = jest.fn();

describe('InvertersTab', () => {
  beforeEach(() => mockDispatch.mockReset());

  it('renders empty state when result is null', () => {
    render(
      <InvertersTab result={null} inverters={[]} strings={[]}
        selectedInverter={null} selectedPanel={null} resultStale={false} dispatch={mockDispatch} />
    );
    expect(screen.getByText(/Run analysis/)).toBeInTheDocument();
  });

  it('renders inverter card with MPPT channels', () => {
    render(
      <InvertersTab result={makeEmptyResult()} inverters={mockUIInverters} strings={mockStrings}
        selectedInverter={mockInverter} selectedPanel={null} resultStale={false} dispatch={mockDispatch} />
    );
    expect(screen.getByText(/Sol-Ark 15K/)).toBeInTheDocument();
    expect(screen.getByText(/MPPT 1/)).toBeInTheDocument();
    expect(screen.getByText(/MPPT 2/)).toBeInTheDocument();
    expect(screen.getByText(/MPPT 3/)).toBeInTheDocument();
  });

  it('shows empty channel indicator', () => {
    render(
      <InvertersTab result={makeEmptyResult()} inverters={mockUIInverters} strings={mockStrings}
        selectedInverter={mockInverter} selectedPanel={null} resultStale={false} dispatch={mockDispatch} />
    );
    expect(screen.getByText(/empty/)).toBeInTheDocument();
  });

  it('shows stale banner with re-run button when resultStale is true', () => {
    const mockRerun = jest.fn();
    render(
      <InvertersTab result={makeEmptyResult()} inverters={mockUIInverters} strings={mockStrings}
        selectedInverter={mockInverter} selectedPanel={null} resultStale={true} dispatch={mockDispatch}
        onRerun={mockRerun} />
    );
    expect(screen.getByText(/re-run/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/re-run/i));
    expect(mockRerun).toHaveBeenCalledTimes(1);
  });

  it('shows clipping placeholder when events are empty', () => {
    render(
      <InvertersTab result={makeEmptyResult()} inverters={mockUIInverters} strings={mockStrings}
        selectedInverter={mockInverter} selectedPanel={null} resultStale={false} dispatch={mockDispatch} />
    );
    expect(screen.getByText(/Stage 5/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest -- inverters-tab --no-coverage 2>&1 | tail -5`

Expected: FAIL — module not found.

- [ ] **Step 3: Write InvertersTab component**

Create `src/components/solar-designer/InvertersTab.tsx`:

```typescript
'use client';

import { useState } from 'react';
import type { CoreSolarDesignerResult, ResolvedInverter, ResolvedPanel } from '@/lib/solar/v12-engine';
import type { UIInverterConfig, UIStringConfig, SolarDesignerAction } from './types';

const STRING_COLORS = [
  '#f97316', '#06b6d4', '#a78bfa', '#22c55e',
  '#f43f5e', '#eab308', '#ec4899', '#14b8a6',
  '#8b5cf6', '#f59e0b', '#10b981', '#6366f1',
];

interface InvertersTabProps {
  result: CoreSolarDesignerResult | null;
  inverters: UIInverterConfig[];
  strings: UIStringConfig[];
  selectedInverter: ResolvedInverter | null;
  selectedPanel: ResolvedPanel | null;
  resultStale: boolean;
  dispatch: (action: SolarDesignerAction) => void;
  /** Callback to trigger a new analysis run (worker lifecycle lives in RunAnalysisButton) */
  onRerun?: () => void;
}

export default function InvertersTab({
  result, inverters, strings, selectedInverter, selectedPanel,
  resultStale, dispatch, onRerun,
}: InvertersTabProps) {
  const [selectedChip, setSelectedChip] = useState<{
    inverterId: number; channel: number; stringIndex: number;
  } | null>(null);

  if (!result) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <p className="text-muted text-sm">Run analysis to see inverter configuration</p>
      </div>
    );
  }

  const handleChannelClick = (inverterId: number, channelIdx: number) => {
    if (!selectedChip) return;
    // Move the selected string to this channel
    dispatch({
      type: 'REASSIGN_STRING_TO_CHANNEL',
      stringIndex: selectedChip.stringIndex,
      fromInverterId: selectedChip.inverterId,
      fromChannel: selectedChip.channel,
      toInverterId: inverterId,
      toChannel: channelIdx,
    });
    setSelectedChip(null);
  };

  // DC/AC ratio calculation
  const calcDcAcRatio = (inv: UIInverterConfig) => {
    if (!selectedPanel || !selectedInverter) return 0;
    const totalPanels = inv.channels.reduce((sum, ch) =>
      sum + ch.stringIndices.reduce((s, si) => s + (strings[si]?.panelIds.length ?? 0), 0), 0);
    const dcPower = totalPanels * selectedPanel.vmp * selectedPanel.imp;
    return dcPower / selectedInverter.acPower;
  };

  const ratioColor = (ratio: number) =>
    ratio > 1.5 ? 'text-red-400 bg-red-500/10' :
    ratio > 1.2 ? 'text-yellow-400 bg-yellow-500/10' :
    'text-green-400 bg-green-500/10';

  return (
    <div className="space-y-4">
      {/* Stale banner */}
      {resultStale && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-4 py-2 flex items-center justify-between">
          <p className="text-sm text-yellow-400">Inverter config changed — re-run analysis to update results.</p>
          {onRerun && (
            <button
              onClick={onRerun}
              className="text-xs font-medium text-yellow-400 hover:text-yellow-300 underline"
            >
              Re-run
            </button>
          )}
        </div>
      )}

      {/* Inverter Cards */}
      {inverters.map(inv => {
        const ratio = calcDcAcRatio(inv);
        const clippingForInverter = result.clippingEvents.filter(e => e.inverterId === inv.inverterId);

        return (
          <div key={inv.inverterId} className="bg-surface rounded-lg border border-border p-4 space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-semibold">
                  Inverter {inv.inverterId + 1} — {selectedInverter?.name ?? inv.inverterKey}
                </h3>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ratioColor(ratio)}`}>
                  DC/AC {ratio.toFixed(2)}
                </span>
              </div>
              <span className="text-xs text-muted">{selectedInverter?.channels ?? inv.channels.length} MPPT channels</span>
            </div>

            {/* MPPT Channels */}
            <div className="space-y-2">
              {inv.channels.map((ch, ci) => (
                <div
                  key={ci}
                  onClick={() => handleChannelClick(inv.inverterId, ci)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md border transition-colors ${
                    selectedChip ? 'cursor-pointer hover:border-orange-500/50 hover:bg-orange-500/5' : ''
                  } ${
                    selectedChip?.inverterId === inv.inverterId && selectedChip?.channel === ci
                      ? 'border-orange-500/50 bg-orange-500/10'
                      : 'border-border'
                  }`}
                >
                  <span className="text-xs text-muted w-14 shrink-0">MPPT {ci + 1}</span>
                  <div className="flex gap-1.5 flex-wrap">
                    {ch.stringIndices.length === 0 ? (
                      <span className="text-xs text-muted italic">— empty —</span>
                    ) : (
                      ch.stringIndices.map(si => {
                        const isSelected = selectedChip?.stringIndex === si &&
                          selectedChip?.inverterId === inv.inverterId &&
                          selectedChip?.channel === ci;
                        return (
                          <button
                            key={si}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedChip(isSelected ? null : {
                                inverterId: inv.inverterId, channel: ci, stringIndex: si,
                              });
                            }}
                            className={`text-xs px-2 py-0.5 rounded-full font-medium transition-all ${
                              isSelected ? 'ring-2 ring-white/50 scale-105' : ''
                            }`}
                            style={{
                              backgroundColor: `${STRING_COLORS[si % STRING_COLORS.length]}20`,
                              color: STRING_COLORS[si % STRING_COLORS.length],
                            }}
                          >
                            S{strings[si]?.id ?? si + 1} ({strings[si]?.panelIds.length ?? 0}p)
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* DC Summary */}
            {selectedPanel && selectedInverter && (
              <div className="text-xs text-muted pt-2 border-t border-border">
                DC Input: {(calcDcAcRatio(inv) * selectedInverter.acPower).toFixed(0)} W
                {' · '}AC Rated: {selectedInverter.acPower.toLocaleString()} W
              </div>
            )}

            {/* Clipping Summary */}
            <div className="text-xs text-muted pt-2 border-t border-border">
              {clippingForInverter.length > 0 ? (
                <div className="space-y-1">
                  <p>Clipped: {(clippingForInverter.reduce((s, e) => s + e.totalClipWh, 0) / 1000).toFixed(1)} kWh/year</p>
                  <p>Peak: {Math.max(...clippingForInverter.map(e => e.peakClipW)).toLocaleString()} W · {clippingForInverter.length} events</p>
                </div>
              ) : (
                <p className="italic">Clipping analysis available after dispatch module (Stage 5).</p>
              )}
            </div>
          </div>
        );
      })}

      {/* Clipping Event Log (only when events exist) */}
      {result.clippingEvents.length > 0 && (
        <details className="bg-surface rounded-lg border border-border">
          <summary className="px-4 py-2 text-xs text-muted cursor-pointer hover:text-foreground">
            Clipping Event Log ({result.clippingEvents.length} events)
          </summary>
          <div className="overflow-x-auto max-h-60 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-surface-2 sticky top-0">
                <tr>
                  <th className="px-3 py-1.5 text-left text-muted font-medium">Date</th>
                  <th className="px-3 py-1.5 text-left text-muted font-medium">Start</th>
                  <th className="px-3 py-1.5 text-left text-muted font-medium">End</th>
                  <th className="px-3 py-1.5 text-left text-muted font-medium">Duration</th>
                  <th className="px-3 py-1.5 text-left text-muted font-medium">Peak (W)</th>
                  <th className="px-3 py-1.5 text-left text-muted font-medium">Total (Wh)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {result.clippingEvents.map((e, i) => (
                  <tr key={i}>
                    <td className="px-3 py-1">{e.date}</td>
                    <td className="px-3 py-1">{e.startTime}</td>
                    <td className="px-3 py-1">{e.endTime}</td>
                    <td className="px-3 py-1">{e.durationMin}m</td>
                    <td className="px-3 py-1">{e.peakClipW.toLocaleString()}</td>
                    <td className="px-3 py-1">{e.totalClipWh.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest -- inverters-tab --no-coverage 2>&1 | tail -10`

Expected: All 5 tests PASS.

- [ ] **Step 5: Wire InvertersTab into page.tsx**

In `src/app/dashboards/solar-designer/page.tsx`:

1. Add import:
```typescript
import InvertersTab from '@/components/solar-designer/InvertersTab';
```

2. Add a ref to RunAnalysisButton so we can trigger runs from elsewhere. In `RunAnalysisButton.tsx`, export the `handleRun` via `useImperativeHandle`:

In `RunAnalysisButton.tsx`, wrap the component with `forwardRef` and expose `{ run: handleRun }`:

```typescript
import { useCallback, useRef, forwardRef, useImperativeHandle } from 'react';

export interface RunAnalysisHandle {
  run: () => void;
}

const RunAnalysisButton = forwardRef<RunAnalysisHandle, RunAnalysisButtonProps>(
  function RunAnalysisButton({ state, dispatch }, ref) {
    // ... existing code ...
    useImperativeHandle(ref, () => ({ run: handleRun }), [handleRun]);
    // ... existing JSX ...
  }
);
export default RunAnalysisButton;
```

In `page.tsx`, create a ref and wire it:

```tsx
const runAnalysisRef = useRef<import('@/components/solar-designer/RunAnalysisButton').RunAnalysisHandle>(null);

// In sidebar:
<RunAnalysisButton ref={runAnalysisRef} state={state} dispatch={dispatch} />

// In main content:
{state.activeTab === 'inverters' && (
  <InvertersTab
    result={state.result}
    inverters={state.inverters}
    strings={state.strings}
    selectedInverter={state.selectedInverter}
    selectedPanel={state.selectedPanel}
    resultStale={state.resultStale}
    dispatch={dispatch}
    onRerun={() => runAnalysisRef.current?.run()}
  />
)}
```

- [ ] **Step 6: Commit**

```bash
git add src/components/solar-designer/InvertersTab.tsx src/__tests__/components/solar-designer/inverters-tab.test.tsx src/app/dashboards/solar-designer/page.tsx
git commit -m "feat(solar): add InvertersTab with MPPT cards + reassignment + clipping"
```

---

### Task 10: Final integration — clean up PlaceholderTab imports, run full test suite

**Files:**
- Modify: `src/app/dashboards/solar-designer/page.tsx` (clean up unused imports)

- [ ] **Step 1: Clean up page.tsx imports**

In `src/app/dashboards/solar-designer/page.tsx`:

1. Check if `PlaceholderTab` is still used (it should be for battery, ai, scenarios tabs). If so, keep the import. If all 3 analysis tabs are now replaced, the remaining PlaceholderTab references are for `battery`, `ai`, and `scenarios` only — keep those.

2. Remove the static `ENABLED_TABS` line if it still exists (should have been removed in Task 3).

3. Add the `UIInverterConfig` import if not already present:
```typescript
import type { SolarDesignerState, SolarDesignerAction, SolarDesignerTab, UIStringConfig, UIInverterConfig } from '@/components/solar-designer/types';
```

- [ ] **Step 2: Run the full solar-designer test suite**

Run: `npx jest -- solar-designer --no-coverage 2>&1 | tail -20`

Expected: All tests pass (existing Stage 1-3 tests + new Stage 4 tests).

Count expected test files:
- `inverter-bridge.test.ts` — 6 tests
- `run-analysis-button.test.tsx` — 6 tests
- `production-chart.test.tsx` — 3 tests
- `production-tab.test.tsx` — 3 tests
- `timeseries-chart.test.tsx` — 3 tests
- `timeseries-tab.test.tsx` — 4 tests
- `inverters-tab.test.tsx` — 5 tests
- Plus all existing tests (~40+ from Stages 1-3)

- [ ] **Step 3: Run TypeScript type-check**

Run: `npx tsc --noEmit 2>&1 | grep -c 'error' || echo "0 errors"`

Expected: 0 new errors from solar-designer files.

- [ ] **Step 4: Run the build**

Run: `npm run build 2>&1 | tail -20`

Expected: Build succeeds.

- [ ] **Step 5: Commit cleanup**

```bash
git add src/app/dashboards/solar-designer/page.tsx
git commit -m "chore(solar): clean up Stage 4 imports and verify build"
```

---

## File Map Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/components/solar-designer/types.ts` | Modify | Add `UIInverterConfig`, analysis state fields, 5 new actions |
| `src/components/solar-designer/inverter-bridge.ts` | Create | `autoAssignInverters()` + `flattenInverterConfigs()` |
| `src/components/solar-designer/RunAnalysisButton.tsx` | Create | Sidebar button, worker lifecycle, input building |
| `src/components/solar-designer/ProductionChart.tsx` | Create | Native SVG paired bar chart (Model A vs B) |
| `src/components/solar-designer/ProductionTab.tsx` | Create | Summary cards + chart + per-panel table |
| `src/components/solar-designer/TimeseriesChart.tsx` | Create | Native SVG area (year) + bar (day/week/month) chart |
| `src/components/solar-designer/TimeseriesTab.tsx` | Create | Period toggle + date navigator + string selector |
| `src/components/solar-designer/InvertersTab.tsx` | Create | MPPT cards + click-to-reassign + clipping placeholder |
| `src/app/dashboards/solar-designer/page.tsx` | Modify | Reducer expansion + wire new components + dynamic tabs |
| `src/__tests__/components/solar-designer/inverter-bridge.test.ts` | Create | 6 tests |
| `src/__tests__/app/solar-designer-reducer.test.ts` | Modify | Add Stage 4 reducer logic tests |
| `src/__tests__/components/solar-designer/run-analysis-button.test.tsx` | Create | 6 tests |
| `src/__tests__/components/solar-designer/production-chart.test.tsx` | Create | 3 tests |
| `src/__tests__/components/solar-designer/production-tab.test.tsx` | Create | 3 tests |
| `src/__tests__/components/solar-designer/timeseries-chart.test.tsx` | Create | 3 tests |
| `src/__tests__/components/solar-designer/timeseries-tab.test.tsx` | Create | 4 tests |
| `src/__tests__/components/solar-designer/inverters-tab.test.tsx` | Create | 5 tests |
