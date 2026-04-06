# Solar Designer Stage 1: Core Engine Extraction — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract V12's core analysis math into typed TypeScript modules with the `CoreSolarDesignerInput/Result` contract, validated to match V12 output within 0.1%.

**Architecture:** The existing `src/lib/solar/engine/` already has 7 V12-ported modules. We evaluate each against V12, reuse what matches, re-port what diverges. New modules (layout-parser, equipment catalog, CSV shade parser) fill gaps. All modules export pure functions with no DOM/browser dependencies. A new `v12-engine/` directory re-exports the canonical set under the Core contract, while existing engine code stays untouched (consumed by old Solar Surveyor until Stage 9 cleanup).

**Tech Stack:** TypeScript 5, Jest (ts-jest), Float32Array timeseries, Web Worker protocol (existing `WorkerProgressMessage`/`WorkerResultMessage`)

**Spec:** `docs/superpowers/specs/2026-04-05-solar-designer-design.md`

---

## File Structure

### New files to create

| File | Responsibility |
|------|---------------|
| `src/lib/solar/v12-engine/types.ts` | Core input/output contracts (`CoreSolarDesignerInput`, `CoreSolarDesignerResult`, `PanelGeometry`, `ShadeTimeseries`, `StringConfig`, `InverterConfig`, `EquipmentSelection`, `SiteConditions`, `LossProfile`, `ClippingEvent`) |
| `src/lib/solar/v12-engine/constants.ts` | Re-exports from existing `engine/constants.ts` + new constants |
| `src/lib/solar/v12-engine/equipment.ts` | V12 built-in equipment catalog (8 panels, 9 inverters, 6 ESS) |
| `src/lib/solar/v12-engine/layout-parser.ts` | DXF + JSON file parsing → `PanelGeometry[]` |
| `src/lib/solar/v12-engine/csv-shade-parser.ts` | Shade CSV → `ShadeTimeseries` |
| `src/lib/solar/v12-engine/physics.ts` | Re-export existing `engine/physics.ts` (already V12-faithful) |
| `src/lib/solar/v12-engine/weather.ts` | Re-export existing `engine/weather.ts` (already V12-faithful) |
| `src/lib/solar/v12-engine/consumption.ts` | Re-export existing `engine/consumption.ts` (already V12-faithful) |
| `src/lib/solar/v12-engine/production.ts` | Re-export existing `engine/model-a.ts` (already V12-faithful) |
| `src/lib/solar/v12-engine/stringing.ts` | Auto-string algorithm + voltage validation (new — V12 line 2357) |
| `src/lib/solar/v12-engine/mismatch.ts` | Re-export existing `engine/model-b.ts` + explicit mismatch calc |
| `src/lib/solar/v12-engine/clipping.ts` | Clipping event detection extracted from dispatch (V12 line 1953) |
| `src/lib/solar/v12-engine/timeseries.ts` | Timeseries aggregation helpers (day/week/month/year views) |
| `src/lib/solar/v12-engine/runner.ts` | Core runner using `CoreSolarDesignerInput` → `CoreSolarDesignerResult` |
| `src/lib/solar/v12-engine/worker.ts` | Web Worker entry point wiring CoreRunner to worker protocol [AC 5] |
| `src/lib/solar/v12-engine/index.ts` | Barrel export |
| `src/__tests__/lib/solar-v12-engine/test-helpers.ts` | Shared test utilities (expectClose, expectInRange, fixture builders) |
| `src/__tests__/lib/solar-v12-engine/fixtures/synthetic-10-panel.json` | Synthetic 10-panel test fixture |
| `src/__tests__/lib/solar-v12-engine/types.test.ts` | Type contract validation tests |
| `src/__tests__/lib/solar-v12-engine/equipment.test.ts` | Equipment catalog tests |
| `src/__tests__/lib/solar-v12-engine/layout-parser.test.ts` | DXF/JSON parser tests |
| `src/__tests__/lib/solar-v12-engine/csv-shade-parser.test.ts` | CSV shade parser tests |
| `src/__tests__/lib/solar-v12-engine/physics.test.ts` | Physics module validation (re-exports match) |
| `src/__tests__/lib/solar-v12-engine/weather.test.ts` | Weather module validation (re-exports match) |
| `src/__tests__/lib/solar-v12-engine/production.test.ts` | Production module validation (re-exports match) |
| `src/__tests__/lib/solar-v12-engine/mismatch.test.ts` | Mismatch re-export smoke tests |
| `src/__tests__/lib/solar-v12-engine/stringing.test.ts` | Auto-string + voltage validation tests |
| `src/__tests__/lib/solar-v12-engine/clipping.test.ts` | Clipping event detection tests |
| `src/__tests__/lib/solar-v12-engine/timeseries.test.ts` | Timeseries aggregation tests |
| `src/__tests__/lib/solar-v12-engine/runner.test.ts` | Core runner integration test |
| `src/__tests__/lib/solar-v12-engine/parity.test.ts` | V12 parity: CoreRunner vs existing Runner for same inputs |
| `src/lib/solar/v12-engine/worker.ts` | Web Worker entry point wiring CoreRunner to worker protocol |
| `src/__tests__/lib/solar-v12-engine/worker.test.ts` | Worker entry point: no DOM deps, message routing |

### Existing files to reference (read-only in this stage)

| File | Why |
|------|-----|
| `src/lib/solar/engine/engine-types.ts` | Existing type definitions to extend/bridge |
| `src/lib/solar/engine/constants.ts` | Shared constants (TIMESTEPS, HALF_HOUR_FACTOR, etc.) |
| `src/lib/solar/engine/physics.ts` | Already V12-faithful — re-export |
| `src/lib/solar/engine/weather.ts` | Already V12-faithful — re-export |
| `src/lib/solar/engine/consumption.ts` | Already V12-faithful — re-export |
| `src/lib/solar/engine/model-a.ts` | Already V12-faithful — re-export as `production.ts` |
| `src/lib/solar/engine/model-b.ts` | Already V12-faithful — re-export via `mismatch.ts` |
| `src/lib/solar/engine/dispatch.ts` | Already V12-faithful — clipping extraction source |
| `src/lib/solar/engine/architecture.ts` | System derate, mismatch loss calc |
| `src/lib/solar/engine/runner.ts` | Existing runner — parity test target |
| `src/lib/solar/types.ts` | Worker protocol types |
| `src/__tests__/lib/solar-engine/test-helpers.ts` | Existing test helpers to reuse |
| `src/__tests__/lib/solar-engine/fixtures/` | Existing fixtures to reference |

---

## Chunk 1: Types, Constants, and Test Infrastructure

### Task 1: Create Core type contracts

**Files:**
- Create: `src/lib/solar/v12-engine/types.ts`

- [ ] **Step 1: Write the type definitions file**

```typescript
/**
 * Solar Designer V12 Engine — Core Type Contracts
 *
 * These types define the Core interface for Stages 1-4.
 * Extended types (battery, AI, scenarios) are added in Stage 5.
 *
 * Spec: docs/superpowers/specs/2026-04-05-solar-designer-design.md
 */

// Re-export existing types that are unchanged
export type {
  LossProfile,
  StringConfig,
  InverterConfig,
  BatteryConfig,
  HomeConsumptionConfig as ConsumptionConfig,
  ResolvedPanel,
  ResolvedInverter,
  ResolvedOptimizer,
  ResolvedEss,
  TmyData,
  TmyLookup,
  EnergyBalance,
  ModelAResult,
  ModelBResult,
  DispatchResult,
  PanelStat,
} from '../engine/engine-types';

// ── Shade Timeseries (explicit definition — not aliased from ShadeData) ──
// Per-point shade data: keys are shade point IDs, values are binary shade strings.
// Each string is 17,520 chars (365 days × 48 half-hour intervals), '0' = shade, '1' = sun.
// This matches V12's shade encoding. All adapters (DXF, CSV, EagleView, Google Solar) normalize to this.
export type ShadeTimeseries = Record<string, string>;

// ── Panel Geometry (universal input from all data sources) ────

export interface PanelGeometry {
  id: string;
  x: number;            // meters in layout coordinates
  y: number;            // meters in layout coordinates
  width: number;        // meters
  height: number;       // meters
  azimuth: number;      // compass bearing 0-360°
  tilt: number;         // degrees from horizontal 0-90°
  roofSegmentId?: string;
  shadePointIds: string[];
}

// ── Equipment Selection ──────────────────────────────────────

export interface EquipmentSelection {
  panelKey: string;
  inverterKey: string;
  optimizerKey?: string;
  essKey?: string;
}

// ── Site Conditions ──────────────────────────────────────────

export interface SiteConditions {
  tempMin: number;      // °C — minimum ambient for voltage derating
  tempMax: number;      // °C — maximum ambient for voltage derating
  groundAlbedo: number; // 0-1 — ground reflectance for bifacial
  clippingThreshold: number; // 0-1 — fraction of rated AC power
  exportLimitW: number; // watts — 0 = no limit
}

// ── Clipping Events ──────────────────────────────────────────

export interface ClippingEvent {
  inverterId: number;
  inverterName: string;
  startStep: number;    // timestep index 0-17519
  endStep: number;
  durationMin: number;
  peakClipW: number;    // watts clipped
  totalClipWh: number;  // watt-hours clipped in this event
  date: string;         // "MMM D"
  startTime: string;    // "H:MM"
  endTime: string;      // "H:MM"
}

// ── Core Input (Stages 1-4) ─────────────────────────────────

export interface CoreSolarDesignerInput {
  panels: PanelGeometry[];
  shadeData: ShadeTimeseries;
  strings: StringConfig[];
  inverters: InverterConfig[];
  equipment: EquipmentSelection;
  siteConditions: SiteConditions;
  consumption?: ConsumptionConfig;
  lossProfile: LossProfile;
}

// ── Core Result (Stages 1-4) ────────────────────────────────

export interface CoreSolarDesignerResult {
  panelStats: PanelStat[];
  production: {
    independentAnnual: number;
    stringLevelAnnual: number;
    eagleViewAnnual: number;  // 0 until Stage 7; derived from SAV if manual upload includes it
  };
  mismatchLossPct: number;
  clippingLossPct: number;
  clippingEvents: ClippingEvent[];
  independentTimeseries: Float32Array[];  // per-panel
  stringTimeseries: Float32Array[];       // per-string
  shadeFidelity: 'full' | 'approximate';
  shadeSource: 'manual' | 'eagleview' | 'google-solar';
  // System stats
  panelCount: number;
  systemSizeKw: number;
  systemTsrf: number;
  specificYield: number;
}

// ── Shade Fidelity ──────────────────────────────────────────

export type ShadeFidelity = 'full' | 'approximate';
export type ShadeSource = 'manual' | 'eagleview' | 'google-solar';
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx tsc --noEmit`
Expected: No new type errors introduced by types.ts

- [ ] **Step 3: Commit**

```bash
git add src/lib/solar/v12-engine/types.ts
git commit -m "feat(solar-designer): add Core type contracts for v12-engine"
```

### Task 2: Create constants barrel

**Files:**
- Create: `src/lib/solar/v12-engine/constants.ts`

- [ ] **Step 1: Write the constants file**

```typescript
/**
 * Solar Designer V12 Engine — Constants
 *
 * Re-exports shared constants from existing engine.
 * Add new v12-specific constants here.
 */

export {
  TIMESTEPS,
  HALF_HOUR_FACTOR,
  DAYS_PER_YEAR,
  SLOTS_PER_DAY,
  HOURS_PER_YEAR,
  MONTH_START_DAY,
  MONTH_END_DAY,
  timestepToMonthIndex,
  sumToMonthly,
  sumTotal,
} from '../engine/constants';

/** Default site conditions matching V12 defaults */
export const DEFAULT_SITE_CONDITIONS = {
  tempMin: -10,        // °C (V12 default cold temp)
  tempMax: 45,         // °C (V12 default hot temp)
  groundAlbedo: 0.2,   // grass
  clippingThreshold: 1.0, // 100% of rated AC
  exportLimitW: 0,     // no export limit
} as const;

/** Default loss profile matching V12 defaults */
export const DEFAULT_LOSS_PROFILE = {
  soiling: 2.0,
  mismatch: 2.0,
  dcWiring: 2.0,
  acWiring: 1.0,
  availability: 3.0,
  lid: 1.5,
  snow: 0.0,
  nameplate: 1.0,
} as const;
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/solar/v12-engine/constants.ts
git commit -m "feat(solar-designer): add v12-engine constants with defaults"
```

### Task 3: Create test infrastructure

**Files:**
- Create: `src/__tests__/lib/solar-v12-engine/test-helpers.ts`
- Create: `src/__tests__/lib/solar-v12-engine/fixtures/synthetic-10-panel.json`

- [ ] **Step 1: Write test helpers**

```typescript
/**
 * Solar V12 Engine — Test Helpers
 *
 * Shared assertion utilities for engine tests.
 * Adapted from existing src/__tests__/lib/solar-engine/test-helpers.ts
 */

/**
 * Assert that `actual` is within `tolerance` of `expected`.
 */
export function expectClose(
  actual: number,
  expected: number,
  tolerance: number,
  label = ''
): void {
  const diff = Math.abs(actual - expected);
  if (diff > tolerance) {
    throw new Error(
      `${label ? label + ': ' : ''}Expected ${expected} ± ${tolerance}, got ${actual} (diff ${diff})`
    );
  }
}

/**
 * Assert that `actual` is within [min, max].
 */
export function expectInRange(
  actual: number,
  min: number,
  max: number,
  label = ''
): void {
  if (actual < min || actual > max) {
    throw new Error(
      `${label ? label + ': ' : ''}Expected [${min}, ${max}], got ${actual}`
    );
  }
}

/**
 * Build a minimal PanelGeometry for testing.
 */
export function makePanelGeometry(overrides: Partial<import('@/lib/solar/v12-engine/types').PanelGeometry> & { id: string }) {
  return {
    x: 0,
    y: 0,
    width: 1.02,
    height: 1.82,
    azimuth: 180,
    tilt: 30,
    shadePointIds: [],
    ...overrides,
  };
}

/**
 * Build a minimal SiteConditions for testing.
 */
export function makeSiteConditions(overrides: Partial<import('@/lib/solar/v12-engine/types').SiteConditions> = {}) {
  return {
    tempMin: -10,
    tempMax: 45,
    groundAlbedo: 0.2,
    clippingThreshold: 1.0,
    exportLimitW: 0,
    ...overrides,
  };
}
```

- [ ] **Step 2: Write the synthetic 10-panel fixture**

Create `src/__tests__/lib/solar-v12-engine/fixtures/synthetic-10-panel.json` with a 10-panel system:
- 10 panels: REC 440W, azimuth 180°, tilt 30°, TSRF ranging 0.75-0.95
- 2 strings of 5 panels each
- 1 Tesla PW3 inverter
- No shade data (tests seasonal TSRF decomposition path)
- No TMY data (tests synthetic irradiance path)
- Default loss profile

The fixture uses the `RunnerInput` shape from `engine-types.ts` (with numeric `id` fields matching `PanelStat`). The parity test maps this to `PanelGeometry[]` (which uses string `id`) at runtime — see Task 13. This is intentional: one fixture serves both runners, with the parity test bridging the type gap.

```json
{
  "panels": [
    { "id": 0, "tsrf": 0.95, "points": [], "panelKey": "rec_alpha_440", "bifacialGain": 1.0 },
    { "id": 1, "tsrf": 0.93, "points": [], "panelKey": "rec_alpha_440", "bifacialGain": 1.0 },
    { "id": 2, "tsrf": 0.90, "points": [], "panelKey": "rec_alpha_440", "bifacialGain": 1.0 },
    { "id": 3, "tsrf": 0.88, "points": [], "panelKey": "rec_alpha_440", "bifacialGain": 1.0 },
    { "id": 4, "tsrf": 0.85, "points": [], "panelKey": "rec_alpha_440", "bifacialGain": 1.0 },
    { "id": 5, "tsrf": 0.83, "points": [], "panelKey": "rec_alpha_440", "bifacialGain": 1.0 },
    { "id": 6, "tsrf": 0.80, "points": [], "panelKey": "rec_alpha_440", "bifacialGain": 1.0 },
    { "id": 7, "tsrf": 0.78, "points": [], "panelKey": "rec_alpha_440", "bifacialGain": 1.0 },
    { "id": 8, "tsrf": 0.76, "points": [], "panelKey": "rec_alpha_440", "bifacialGain": 1.0 },
    { "id": 9, "tsrf": 0.75, "points": [], "panelKey": "rec_alpha_440", "bifacialGain": 1.0 }
  ],
  "shadeData": {},
  "strings": [
    { "panels": [0, 1, 2, 3, 4] },
    { "panels": [5, 6, 7, 8, 9] }
  ],
  "inverters": [
    { "inverterKey": "tesla_pw3", "stringIndices": [0, 1] }
  ],
  "resolvedPanels": {
    "rec_alpha_440": {
      "key": "rec_alpha_440",
      "name": "REC Alpha 440",
      "watts": 440,
      "voc": 48.4,
      "vmp": 40.8,
      "isc": 11.5,
      "imp": 10.79,
      "tempCoVoc": -0.0024,
      "tempCoIsc": 0.0004,
      "tempCoPmax": -0.0026,
      "cells": 132,
      "bypassDiodes": 3,
      "cellsPerSubstring": 44,
      "isBifacial": false,
      "bifacialityFactor": 0
    }
  },
  "resolvedInverters": {
    "tesla_pw3": {
      "key": "tesla_pw3",
      "name": "Tesla Powerwall 3 (11.5kW)",
      "acPower": 11500,
      "dcMax": 15000,
      "mpptMin": 60,
      "mpptMax": 500,
      "channels": 6,
      "maxIsc": 25,
      "efficiency": 0.975,
      "architectureType": "string",
      "isMicro": false,
      "isIntegrated": true
    }
  },
  "resolvedOptimizer": null,
  "resolvedEss": null,
  "architectureType": "string",
  "lossProfile": {
    "soiling": 2.0,
    "mismatch": 2.0,
    "dcWiring": 2.0,
    "acWiring": 1.0,
    "availability": 3.0,
    "lid": 1.5,
    "snow": 0.0,
    "nameplate": 1.0
  },
  "tmyData": null,
  "homeConsumption": null,
  "groundAlbedo": 0.2,
  "clippingThreshold": 1.0
}
```

- [ ] **Step 3: Write type contract tests**

Create `src/__tests__/lib/solar-v12-engine/types.test.ts`:

```typescript
/**
 * V12 Engine Types — Contract Tests
 *
 * Validates that Core types are structurally compatible
 * with existing engine types (bridging old and new).
 */
import type {
  CoreSolarDesignerInput,
  CoreSolarDesignerResult,
  PanelGeometry,
  ShadeTimeseries,
  ClippingEvent,
  SiteConditions,
  EquipmentSelection,
} from '@/lib/solar/v12-engine/types';

describe('CoreSolarDesignerInput', () => {
  it('accepts a valid input object', () => {
    const input: CoreSolarDesignerInput = {
      panels: [{
        id: 'p1', x: 0, y: 0, width: 1.02, height: 1.82,
        azimuth: 180, tilt: 30, shadePointIds: [],
      }],
      shadeData: {},
      strings: [{ panels: [0] }],
      inverters: [{ inverterKey: 'inv1', stringIndices: [0] }],
      equipment: { panelKey: 'rec_440', inverterKey: 'inv1' },
      siteConditions: {
        tempMin: -10, tempMax: 45, groundAlbedo: 0.2,
        clippingThreshold: 1.0, exportLimitW: 0,
      },
      lossProfile: {
        soiling: 2, mismatch: 2, dcWiring: 2, acWiring: 1,
        availability: 3, lid: 1.5, snow: 0, nameplate: 1,
      },
    };
    // Type-level test — if this compiles, the contract is valid
    expect(input.panels).toHaveLength(1);
  });
});

describe('CoreSolarDesignerResult', () => {
  it('has all required fields', () => {
    const result: CoreSolarDesignerResult = {
      panelStats: [],
      production: { independentAnnual: 100, stringLevelAnnual: 95, eagleViewAnnual: 0 },
      mismatchLossPct: 5,
      clippingLossPct: 2,
      clippingEvents: [],
      independentTimeseries: [],
      stringTimeseries: [],
      shadeFidelity: 'full',
      shadeSource: 'manual',
      panelCount: 10,
      systemSizeKw: 4.4,
      systemTsrf: 0.85,
      specificYield: 1200,
    };
    expect(result.shadeFidelity).toBe('full');
  });
});

describe('ShadeTimeseries', () => {
  it('is a Record<string, string> matching V12 binary shade format', () => {
    const shade: ShadeTimeseries = {
      'pt_001': '1'.repeat(17520), // fully unshaded
      'pt_002': '0'.repeat(17520), // fully shaded
    };
    expect(shade['pt_001']).toHaveLength(17520);
    expect(shade['pt_002']![0]).toBe('0');
  });
});

describe('ClippingEvent', () => {
  it('captures event duration and energy', () => {
    const event: ClippingEvent = {
      inverterId: 0,
      inverterName: 'Tesla PW3',
      startStep: 5000,
      endStep: 5003,
      durationMin: 120,
      peakClipW: 500,
      totalClipWh: 250,
      date: 'Jun 15',
      startTime: '12:00',
      endTime: '14:00',
    };
    expect(event.durationMin).toBe(120);
  });
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/lib/solar-v12-engine/types.test.ts --verbose`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/__tests__/lib/solar-v12-engine/ src/lib/solar/v12-engine/
git commit -m "feat(solar-designer): Stage 1 types, constants, test infrastructure"
```

---

## Chunk 2: Equipment Catalog and Re-exported Modules

### Task 4: Create V12 built-in equipment catalog

**Files:**
- Create: `src/lib/solar/v12-engine/equipment.ts`
- Create: `src/__tests__/lib/solar-v12-engine/equipment.test.ts`

- [ ] **Step 1: Write failing tests for equipment catalog**

```typescript
/**
 * V12 Equipment Catalog Tests
 */
import {
  getBuiltInPanels,
  getBuiltInInverters,
  getBuiltInEss,
  resolvePanel,
  resolveInverter,
  resolveEss,
} from '@/lib/solar/v12-engine/equipment';

describe('Built-in equipment catalog', () => {
  it('has 8 panel models', () => {
    expect(getBuiltInPanels()).toHaveLength(8);
  });

  it('has 9 inverter models', () => {
    expect(getBuiltInInverters()).toHaveLength(9);
  });

  it('has 6 ESS models', () => {
    expect(getBuiltInEss()).toHaveLength(6);
  });

  it('all panels have required electrical specs', () => {
    for (const p of getBuiltInPanels()) {
      expect(p.watts).toBeGreaterThan(0);
      expect(p.voc).toBeGreaterThan(0);
      expect(p.vmp).toBeGreaterThan(0);
      expect(p.isc).toBeGreaterThan(0);
      expect(p.imp).toBeGreaterThan(0);
      expect(p.tempCoVoc).toBeLessThan(0); // always negative
      expect(p.tempCoIsc).toBeGreaterThan(0); // always positive
      expect(p.tempCoPmax).toBeLessThan(0); // always negative
      expect(p.bypassDiodes).toBeGreaterThan(0);
      expect(p.cellsPerSubstring).toBe(Math.round(p.cells / p.bypassDiodes));
    }
  });

  it('all inverters have valid MPPT range', () => {
    for (const inv of getBuiltInInverters()) {
      expect(inv.mpptMax).toBeGreaterThan(inv.mpptMin);
      expect(inv.acPower).toBeGreaterThan(0);
      expect(inv.efficiency).toBeGreaterThan(0.9);
      expect(inv.efficiency).toBeLessThanOrEqual(1.0);
    }
  });
});

describe('resolvePanel', () => {
  it('resolves a known panel key', () => {
    const panel = resolvePanel('rec_alpha_440');
    expect(panel).not.toBeNull();
    expect(panel!.watts).toBe(440);
    expect(panel!.name).toContain('REC');
  });

  it('returns null for unknown key', () => {
    expect(resolvePanel('nonexistent_panel')).toBeNull();
  });
});

describe('resolveInverter', () => {
  it('resolves Tesla PW3', () => {
    const inv = resolveInverter('tesla_pw3');
    expect(inv).not.toBeNull();
    expect(inv!.acPower).toBe(11500);
    expect(inv!.isIntegrated).toBe(true);
  });
});

describe('resolveEss', () => {
  it('resolves Tesla PW3 battery', () => {
    const ess = resolveEss('tesla_pw3_ess');
    expect(ess).not.toBeNull();
    expect(ess!.capacity).toBe(13.5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/__tests__/lib/solar-v12-engine/equipment.test.ts --verbose`
Expected: FAIL — module not found

- [ ] **Step 3: Write the equipment catalog**

Create `src/lib/solar/v12-engine/equipment.ts` — port the equipment data from V12 HTML (lines 515-545). Use the exact same spec values. Each entry maps to a `ResolvedPanel`/`ResolvedInverter`/`ResolvedEss` from engine-types.

Key data to port from V12:
- **Panels (8):** REC Alpha 440, Hyundai 430, QCells 430, Canadian 440, Trina 440, Jinko Tiger Neo 440, SEG 430 BTD (bifacial), SEG 430 BG (bifacial)
- **Inverters (9):** Tesla PW3 11.5kW, Tesla PW3 standalone, Enphase IQ8M, IQ8A, IQ8H, SolarEdge SE7600H, SE10000H, Generac PWRcell, Generac snap-RS
- **ESS (6):** Tesla PW2, PW3, Enphase 5P, 10T, Generac PWRcell, PWRcell+

Each panel entry must include: key, name, watts, voc, vmp, isc, imp, tempCoVoc, tempCoIsc, tempCoPmax, cells, bypassDiodes, cellsPerSubstring, length, width, isBifacial, bifacialityFactor.

Each inverter entry must include: key, name, acPower, dcMax, mpptMin, mpptMax, channels, maxIsc, efficiency, architectureType, isMicro, isIntegrated.

Each ESS entry must include: key, name, capacity, power, roundTrip, dcChargeRate, type.

Export `getBuiltInPanels()`, `getBuiltInInverters()`, `getBuiltInEss()`, `resolvePanel(key)`, `resolveInverter(key)`, `resolveEss(key)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/lib/solar-v12-engine/equipment.test.ts --verbose`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/solar/v12-engine/equipment.ts src/__tests__/lib/solar-v12-engine/equipment.test.ts
git commit -m "feat(solar-designer): V12 built-in equipment catalog with 8 panels, 9 inverters, 6 ESS"
```

### Task 5: Create re-export modules for V12-faithful existing code

**Files:**
- Create: `src/lib/solar/v12-engine/physics.ts`
- Create: `src/lib/solar/v12-engine/weather.ts`
- Create: `src/lib/solar/v12-engine/consumption.ts`
- Create: `src/lib/solar/v12-engine/production.ts`
- Create: `src/__tests__/lib/solar-v12-engine/physics.test.ts`

- [ ] **Step 1: Create re-export modules**

Each file is a thin re-export that names the module consistently with the spec:

`src/lib/solar/v12-engine/physics.ts`:
```typescript
/**
 * Solar Designer V12 Engine — Physics
 *
 * Re-exports from existing engine/physics.ts (already V12-faithful).
 * See: src/lib/solar/engine/physics.ts header "Ported from V12 physics.js"
 */
export {
  solarFactor,
  seasonFactor,
  getSeasonalTSRF,
  getPanelShadeFactorAtTimestep,
  calculateStringElectrical,
} from '../engine/physics';

export type {
  StringElectricalInput,
  StringElectricalResult,
} from '../engine/physics';
```

`src/lib/solar/v12-engine/weather.ts`:
```typescript
/**
 * Re-exports from existing engine/weather.ts (Ported from V12 weather.js).
 */
export {
  prepareTmyLookup,
  getTmyIrradiance,
  getTemperatureDerate,
} from '../engine/weather';
```

`src/lib/solar/v12-engine/consumption.ts`:
```typescript
/**
 * Re-exports from existing engine/consumption.ts (Ported from V12 app.js:548-692).
 */
export { generateConsumptionProfile } from '../engine/consumption';
```

`src/lib/solar/v12-engine/production.ts`:
```typescript
/**
 * Re-exports Model A (independent panel production) from existing engine.
 * Ported from V12 app.js:1079-1114.
 */
export { runModelA } from '../engine/model-a';
export type { ModelAResult } from '../engine/engine-types';
```

- [ ] **Step 2: Write smoke tests for all re-exported modules**

`src/__tests__/lib/solar-v12-engine/physics.test.ts`:
```typescript
/**
 * Verify physics re-exports work identically to direct imports.
 */
import * as v12Physics from '@/lib/solar/v12-engine/physics';
import * as originalPhysics from '@/lib/solar/engine/physics';

describe('v12-engine/physics re-exports', () => {
  it('solarFactor matches original', () => {
    for (let h = 0; h < 48; h++) {
      expect(v12Physics.solarFactor(h)).toBe(originalPhysics.solarFactor(h));
    }
  });

  it('seasonFactor matches original', () => {
    for (let d = 0; d < 365; d++) {
      expect(v12Physics.seasonFactor(d)).toBe(originalPhysics.seasonFactor(d));
    }
  });

  it('getSeasonalTSRF matches original', () => {
    expect(v12Physics.getSeasonalTSRF(0.85, 172, false))
      .toBe(originalPhysics.getSeasonalTSRF(0.85, 172, false));
  });
});
```

`src/__tests__/lib/solar-v12-engine/weather.test.ts`:
```typescript
/**
 * Verify weather re-exports work identically to direct imports.
 */
import { prepareTmyLookup } from '@/lib/solar/v12-engine/weather';
import { prepareTmyLookup as originalPrepareTmyLookup } from '@/lib/solar/engine/weather';

describe('v12-engine/weather re-exports', () => {
  it('prepareTmyLookup is the same function', () => {
    expect(prepareTmyLookup).toBe(originalPrepareTmyLookup);
  });

  it('returns a lookup function for null input (synthetic path)', () => {
    const lookup = prepareTmyLookup(null as any);
    expect(typeof lookup).toBe('function');
  });
});
```

`src/__tests__/lib/solar-v12-engine/production.test.ts`:
```typescript
/**
 * Verify production (Model A) re-exports work identically to direct imports.
 */
import { runModelA } from '@/lib/solar/v12-engine/production';
import { runModelA as originalRunModelA } from '@/lib/solar/engine/model-a';

describe('v12-engine/production re-exports', () => {
  it('runModelA is the same function', () => {
    expect(runModelA).toBe(originalRunModelA);
  });
});
```

- [ ] **Step 3: Run all re-export tests**

Run: `npx jest src/__tests__/lib/solar-v12-engine/physics.test.ts src/__tests__/lib/solar-v12-engine/weather.test.ts src/__tests__/lib/solar-v12-engine/production.test.ts --verbose`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add src/lib/solar/v12-engine/physics.ts src/lib/solar/v12-engine/weather.ts \
  src/lib/solar/v12-engine/consumption.ts src/lib/solar/v12-engine/production.ts \
  src/__tests__/lib/solar-v12-engine/physics.test.ts \
  src/__tests__/lib/solar-v12-engine/weather.test.ts \
  src/__tests__/lib/solar-v12-engine/production.test.ts
git commit -m "feat(solar-designer): re-export V12-faithful physics, weather, consumption, production"
```

---

## Chunk 3: Layout Parser and Shade Parser

### Task 6: Create DXF/JSON layout parser

**Files:**
- Create: `src/lib/solar/v12-engine/layout-parser.ts`
- Create: `src/__tests__/lib/solar-v12-engine/layout-parser.test.ts`
- Create: `src/__tests__/lib/solar-v12-engine/fixtures/sample-layout.json`
- Create: `src/__tests__/lib/solar-v12-engine/fixtures/sample-layout.dxf`

- [ ] **Step 1: Write test fixtures**

`sample-layout.json` — minimal EagleView-style JSON with 3 panels:
```json
{
  "panels": [
    { "data": [{"x": 0, "y": 0}, {"x": 1.02, "y": 0}, {"x": 1.02, "y": 1.82}, {"x": 0, "y": 1.82}] },
    { "data": [{"x": 1.1, "y": 0}, {"x": 2.12, "y": 0}, {"x": 2.12, "y": 1.82}, {"x": 1.1, "y": 1.82}] },
    { "data": [{"x": 2.2, "y": 0}, {"x": 3.22, "y": 0}, {"x": 3.22, "y": 1.82}, {"x": 2.2, "y": 1.82}] }
  ]
}
```

`sample-layout.dxf` — minimal DXF with 3 POINT entities with EVT extended data. Use the V12 DXF format:
```
0
SECTION
2
ENTITIES
0
POINT
10
0.5
20
-0.9
1001
EVT
1000
PointName=PT001
1000
ActualIrradiance=950
1000
NominalIrradiance=1000
1000
TSRF=0.95
0
POINT
10
1.6
20
-0.9
1001
EVT
1000
PointName=PT002
1000
ActualIrradiance=900
1000
NominalIrradiance=1000
1000
TSRF=0.90
0
POINT
10
2.7
20
-0.9
1001
EVT
1000
PointName=PT003
1000
ActualIrradiance=800
1000
NominalIrradiance=1000
1000
TSRF=0.80
0
ENDSEC
0
EOF
```

- [ ] **Step 2: Write failing tests**

```typescript
/**
 * Layout Parser Tests
 */
import { parseJSON, parseDXF, type LayoutParseResult } from '@/lib/solar/v12-engine/layout-parser';
import * as fs from 'fs';
import * as path from 'path';

const fixturesDir = path.join(__dirname, 'fixtures');

describe('parseJSON', () => {
  it('parses panels from EagleView-style JSON', () => {
    const json = fs.readFileSync(path.join(fixturesDir, 'sample-layout.json'), 'utf-8');
    const result = parseJSON(json);
    expect(result.panels).toHaveLength(3);
    expect(result.panels[0].id).toBe('panel_0');
  });

  it('calculates centroid position for each panel', () => {
    const json = fs.readFileSync(path.join(fixturesDir, 'sample-layout.json'), 'utf-8');
    const result = parseJSON(json);
    // First panel centroid: (0.51, 0.91)
    expect(result.panels[0].x).toBeCloseTo(0.51, 1);
    expect(result.panels[0].y).toBeCloseTo(0.91, 1);
  });

  it('skips obstruction/tree types', () => {
    const json = JSON.stringify({
      panels: [
        { data: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
      ],
      obstructions: [
        { data: [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 6, y: 6 }, { x: 5, y: 6 }], type: "tree" },
      ],
    });
    const result = parseJSON(json);
    expect(result.panels).toHaveLength(1);
  });

  it('returns empty for invalid JSON', () => {
    const result = parseJSON('not valid json');
    expect(result.panels).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
  });
});

describe('parseDXF', () => {
  it('parses POINT entities with EVT extended data', () => {
    const dxf = fs.readFileSync(path.join(fixturesDir, 'sample-layout.dxf'), 'utf-8');
    const result = parseDXF(dxf);
    expect(result.radiancePoints).toHaveLength(3);
  });

  it('extracts TSRF from metadata', () => {
    const dxf = fs.readFileSync(path.join(fixturesDir, 'sample-layout.dxf'), 'utf-8');
    const result = parseDXF(dxf);
    expect(result.radiancePoints[0].tsrf).toBeCloseTo(0.95, 2);
    expect(result.radiancePoints[2].tsrf).toBeCloseTo(0.80, 2);
  });

  it('negates Y coordinates (V12 convention)', () => {
    const dxf = fs.readFileSync(path.join(fixturesDir, 'sample-layout.dxf'), 'utf-8');
    const result = parseDXF(dxf);
    // DXF has y=-0.9, so parsed y should be 0.9 (negated)
    expect(result.radiancePoints[0].y).toBeCloseTo(0.9, 1);
  });

  it('filters zero-irradiance edge-bleed points', () => {
    const dxf = `0\nSECTION\n2\nENTITIES\n0\nPOINT\n10\n0.5\n20\n-0.9\n1001\nEVT\n1000\nPointName=PT001\n1000\nActualIrradiance=0\n1000\nNominalIrradiance=1000\n1000\nTSRF=0.0\n0\nENDSEC\n0\nEOF`;
    const result = parseDXF(dxf);
    expect(result.radiancePoints).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx jest src/__tests__/lib/solar-v12-engine/layout-parser.test.ts --verbose`
Expected: FAIL — module not found

- [ ] **Step 4: Write the layout parser**

Create `src/lib/solar/v12-engine/layout-parser.ts`:

Port from V12 lines 1145-1230 (JSON parser) and 1183-1238 (DXF parser). The module exports:

```typescript
export interface RadiancePoint {
  id: string;
  x: number;
  y: number;
  actualIrradiance: number;
  nominalIrradiance: number;
  tsrf: number;
}

export interface LayoutParseResult {
  panels: PanelGeometry[];
  radiancePoints: RadiancePoint[];
  errors: string[];
}

export function parseJSON(raw: string): LayoutParseResult { /* ... */ }
export function parseDXF(raw: string): LayoutParseResult { /* ... */ }
```

Key implementation notes from V12:
- JSON parser: Recursively scan for objects with `.data` property containing `[{x, y}]` polygon arrays. Skip obstruction/tree types. Negate y-coordinates. Calculate centroid for PanelGeometry position.
- DXF parser: Line-by-line state machine. Parse POINT entities (code 10=x, 20=y with y-negated). Read extended data blocks (code 1001='EVT', code 1000 for key=value metadata). Filter zero-irradiance points.
- Both parsers produce `PanelGeometry[]` with auto-generated IDs (`panel_0`, `panel_1`, etc.).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest src/__tests__/lib/solar-v12-engine/layout-parser.test.ts --verbose`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/solar/v12-engine/layout-parser.ts \
  src/__tests__/lib/solar-v12-engine/layout-parser.test.ts \
  src/__tests__/lib/solar-v12-engine/fixtures/sample-layout.json \
  src/__tests__/lib/solar-v12-engine/fixtures/sample-layout.dxf
git commit -m "feat(solar-designer): DXF/JSON layout parser ported from V12"
```

### Task 7: Create CSV shade parser

**Files:**
- Create: `src/lib/solar/v12-engine/csv-shade-parser.ts`
- Create: `src/__tests__/lib/solar-v12-engine/csv-shade-parser.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
/**
 * CSV Shade Parser Tests
 */
import { parseShadeCSV } from '@/lib/solar/v12-engine/csv-shade-parser';
import { TIMESTEPS } from '@/lib/solar/v12-engine/constants';

describe('parseShadeCSV', () => {
  it('parses a header row + data rows into ShadeTimeseries', () => {
    // Format: first column is timestep, remaining columns are point IDs
    const csv = [
      'timestep,PT001,PT002',
      '0,1,0',
      '1,1,1',
      '2,0,1',
    ].join('\n');
    const result = parseShadeCSV(csv);
    expect(result.data['PT001']).toBe('110');
    expect(result.data['PT002']).toBe('011');
    expect(result.errors).toHaveLength(0);
  });

  it('pads short sequences to TIMESTEPS with 1 (unshaded)', () => {
    const csv = 'timestep,PT001\n0,1\n1,0';
    const result = parseShadeCSV(csv);
    expect(result.data['PT001']).toHaveLength(TIMESTEPS);
    expect(result.data['PT001']![0]).toBe('1');
    expect(result.data['PT001']![1]).toBe('0');
    expect(result.data['PT001']![2]).toBe('1'); // padded
  });

  it('returns error for empty CSV', () => {
    const result = parseShadeCSV('');
    expect(result.errors).toHaveLength(1);
  });

  it('sets fidelity to full for CSV uploads', () => {
    const csv = 'timestep,PT001\n0,1';
    const result = parseShadeCSV(csv);
    expect(result.fidelity).toBe('full');
    expect(result.source).toBe('manual');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/__tests__/lib/solar-v12-engine/csv-shade-parser.test.ts --verbose`
Expected: FAIL — module not found

- [ ] **Step 3: Write the CSV shade parser**

```typescript
/**
 * Solar Designer V12 Engine — CSV Shade Parser
 *
 * Parses shade CSV files into the ShadeTimeseries binary format.
 * CSV format: header row with point IDs, data rows with 0/1 shade values.
 */
import { TIMESTEPS } from './constants';
import type { ShadeTimeseries, ShadeFidelity, ShadeSource } from './types';

export interface ShadeParseResult {
  data: ShadeTimeseries;
  fidelity: ShadeFidelity;
  source: ShadeSource;
  errors: string[];
}

export function parseShadeCSV(raw: string): ShadeParseResult {
  const errors: string[] = [];
  const data: ShadeTimeseries = {};

  if (!raw.trim()) {
    return { data, fidelity: 'full', source: 'manual', errors: ['Empty CSV'] };
  }

  const lines = raw.trim().split(/\r?\n/);
  if (lines.length < 2) {
    return { data, fidelity: 'full', source: 'manual', errors: ['CSV needs header + at least 1 data row'] };
  }

  const headers = lines[0].split(',').map(h => h.trim());
  const pointIds = headers.slice(1); // first column is timestep

  // Initialize builders
  const builders: Record<string, string[]> = {};
  for (const id of pointIds) {
    builders[id] = [];
  }

  // Parse data rows
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    for (let j = 0; j < pointIds.length; j++) {
      const val = (cols[j + 1] || '').trim();
      builders[pointIds[j]].push(val === '0' ? '0' : '1');
    }
  }

  // Build strings, pad to TIMESTEPS with '1' (unshaded)
  for (const id of pointIds) {
    const seq = builders[id].join('');
    data[id] = seq.padEnd(TIMESTEPS, '1');
  }

  return { data, fidelity: 'full', source: 'manual', errors };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/lib/solar-v12-engine/csv-shade-parser.test.ts --verbose`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/solar/v12-engine/csv-shade-parser.ts \
  src/__tests__/lib/solar-v12-engine/csv-shade-parser.test.ts
git commit -m "feat(solar-designer): CSV shade parser with fidelity tagging"
```

---

## Chunk 4: Stringing, Mismatch, Clipping, and Timeseries

### Task 8: Create stringing module (auto-string + voltage validation)

**Files:**
- Create: `src/lib/solar/v12-engine/stringing.ts`
- Create: `src/__tests__/lib/solar-v12-engine/stringing.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
/**
 * Stringing Module Tests
 */
import { autoString, type AutoStringInput } from '@/lib/solar/v12-engine/stringing';
import type { PanelStat, ResolvedPanel, ResolvedInverter } from '@/lib/solar/v12-engine/types';

const mockPanel: ResolvedPanel = {
  key: 'rec_440', name: 'REC 440', watts: 440,
  voc: 48.4, vmp: 40.8, isc: 11.5, imp: 10.79,
  tempCoVoc: -0.0024, tempCoIsc: 0.0004, tempCoPmax: -0.0026,
  cells: 132, bypassDiodes: 3, cellsPerSubstring: 44,
  isBifacial: false, bifacialityFactor: 0,
};

const mockInverter: ResolvedInverter = {
  key: 'tesla_pw3', name: 'Tesla PW3', acPower: 11500, dcMax: 15000,
  mpptMin: 60, mpptMax: 500, channels: 6, maxIsc: 25,
  efficiency: 0.975, architectureType: 'string', isMicro: false, isIntegrated: true,
};

describe('autoString', () => {
  it('groups panels into valid strings by TSRF (high to low)', () => {
    const panels: PanelStat[] = Array.from({ length: 10 }, (_, i) => ({
      id: i, tsrf: 0.95 - i * 0.02, points: [], panelKey: 'rec_440', bifacialGain: 1.0,
    }));
    const result = autoString({
      panels, panel: mockPanel, inverter: mockInverter, tempMin: -10,
    });
    expect(result.strings.length).toBeGreaterThan(0);
    // First string should have highest-TSRF panels
    const firstStringTsrfs = result.strings[0].panels.map(i => panels[i].tsrf);
    expect(firstStringTsrfs[0]).toBeGreaterThanOrEqual(firstStringTsrfs[firstStringTsrfs.length - 1]);
  });

  it('respects max panels per string from inverter voltage limit', () => {
    const panels: PanelStat[] = Array.from({ length: 20 }, (_, i) => ({
      id: i, tsrf: 0.85, points: [], panelKey: 'rec_440', bifacialGain: 1.0,
    }));
    const result = autoString({
      panels, panel: mockPanel, inverter: mockInverter, tempMin: -20,
    });
    // max = floor(500 / Voc_cold_per_panel) where Voc_cold = 48.4 * (1 + -0.0024 * (-20 - 25))
    // = 48.4 * 1.108 = 53.63V → max = floor(500 / 53.63) = 9
    for (const s of result.strings) {
      expect(s.panels.length).toBeLessThanOrEqual(9);
    }
  });

  it('returns warnings for strings that violate voltage limits', () => {
    const panels: PanelStat[] = Array.from({ length: 3 }, (_, i) => ({
      id: i, tsrf: 0.85, points: [], panelKey: 'rec_440', bifacialGain: 1.0,
    }));
    const result = autoString({
      panels,
      panel: mockPanel,
      inverter: { ...mockInverter, mpptMin: 200 }, // min too high for 3 panels
      tempMin: -10,
    });
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/__tests__/lib/solar-v12-engine/stringing.test.ts --verbose`
Expected: FAIL

- [ ] **Step 3: Write the stringing module**

Port from V12 `autoString` (line 2357). Key algorithm:
1. Calculate `maxPerString = floor(inverter.mpptMax / Voc_cold_per_panel)` where `Voc_cold = Voc * (1 + tempCoVoc * (tempMin - 25))`
2. `optimalPerString = max(8, min(maxPerString - 1, 14))`
3. Sort panels by descending TSRF
4. Pack full strings of `optimalPerString` panels
5. Remainder forms final string
6. Validate each string with `calculateStringElectrical` from physics module
7. Return `{ strings: StringConfig[], warnings: string[] }`

```typescript
export interface AutoStringInput {
  panels: PanelStat[];
  panel: ResolvedPanel;
  inverter: ResolvedInverter;
  tempMin: number;
}

export interface AutoStringResult {
  strings: StringConfig[];
  warnings: string[];
}

export function autoString(input: AutoStringInput): AutoStringResult { /* ... */ }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/lib/solar-v12-engine/stringing.test.ts --verbose`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/solar/v12-engine/stringing.ts src/__tests__/lib/solar-v12-engine/stringing.test.ts
git commit -m "feat(solar-designer): auto-string algorithm with voltage validation from V12"
```

### Task 9: Create mismatch module

**Files:**
- Create: `src/lib/solar/v12-engine/mismatch.ts`
- Create: `src/__tests__/lib/solar-v12-engine/mismatch.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
/**
 * Mismatch Module Smoke Tests
 *
 * Validates that re-exports work and produce deterministic results.
 */
import { runModelB, computeMismatchLoss } from '@/lib/solar/v12-engine/mismatch';
import { runModelB as originalRunModelB } from '@/lib/solar/engine/model-b';
import { computeMismatchLoss as originalComputeMismatchLoss } from '@/lib/solar/engine/architecture';

describe('v12-engine/mismatch re-exports', () => {
  it('runModelB is the same function as the original', () => {
    expect(runModelB).toBe(originalRunModelB);
  });

  it('computeMismatchLoss is the same function as the original', () => {
    expect(computeMismatchLoss).toBe(originalComputeMismatchLoss);
  });

  it('computeMismatchLoss returns 0 for equal inputs', () => {
    const result = computeMismatchLoss(1000, 1000, 'string');
    expect(result).toBe(0);
  });

  it('computeMismatchLoss returns positive for string mismatch', () => {
    const result = computeMismatchLoss(1000, 950, 'string');
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(100);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/__tests__/lib/solar-v12-engine/mismatch.test.ts --verbose`
Expected: FAIL — module not found

- [ ] **Step 3: Write the mismatch module**

```typescript
/**
 * Solar Designer V12 Engine — Mismatch
 *
 * Re-exports Model B (string-level production with bypass diode model)
 * and the mismatch loss calculator.
 */
export { runModelB } from '../engine/model-b';
export { computeMismatchLoss } from '../engine/architecture';
export type { ModelBResult } from '../engine/engine-types';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/lib/solar-v12-engine/mismatch.test.ts --verbose`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/solar/v12-engine/mismatch.ts src/__tests__/lib/solar-v12-engine/mismatch.test.ts
git commit -m "feat(solar-designer): mismatch module re-exporting Model B + loss calc"
```

### Task 10: Create clipping event detection module

**Files:**
- Create: `src/lib/solar/v12-engine/clipping.ts`
- Create: `src/__tests__/lib/solar-v12-engine/clipping.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
/**
 * Clipping Event Detection Tests
 */
import { detectClippingEvents } from '@/lib/solar/v12-engine/clipping';
import type { ClippingEvent } from '@/lib/solar/v12-engine/types';

describe('detectClippingEvents', () => {
  it('detects a contiguous clipping event', () => {
    // Simulate a timeseries where steps 100-105 are clipping
    const acOutput = new Float32Array(17520).fill(5000);
    const clipped = new Float32Array(17520).fill(0);
    for (let t = 100; t <= 105; t++) {
      clipped[t] = 500; // 500W clipped for 6 half-hours = 3 hours
    }

    const events = detectClippingEvents({
      inverterId: 0,
      inverterName: 'Test Inverter',
      clippedTimeseries: clipped,
    });

    expect(events).toHaveLength(1);
    expect(events[0].startStep).toBe(100);
    expect(events[0].endStep).toBe(105);
    expect(events[0].durationMin).toBe(180); // 6 * 30 min
    expect(events[0].peakClipW).toBe(500);
    expect(events[0].totalClipWh).toBeCloseTo(1500, 0); // 500W * 3h
  });

  it('separates non-contiguous events', () => {
    const clipped = new Float32Array(17520).fill(0);
    clipped[100] = 200;
    clipped[101] = 200;
    // gap
    clipped[200] = 300;

    const events = detectClippingEvents({
      inverterId: 0, inverterName: 'Test', clippedTimeseries: clipped,
    });

    expect(events).toHaveLength(2);
  });

  it('returns empty for no clipping', () => {
    const clipped = new Float32Array(17520).fill(0);
    const events = detectClippingEvents({
      inverterId: 0, inverterName: 'Test', clippedTimeseries: clipped,
    });
    expect(events).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/__tests__/lib/solar-v12-engine/clipping.test.ts --verbose`
Expected: FAIL

- [ ] **Step 3: Write the clipping event detector**

Port from V12 post-dispatch clipping event detection (line 1953). Walk the clipped timeseries, group contiguous non-zero values into events, compute duration/peak/total for each.

```typescript
export interface ClippingDetectionInput {
  inverterId: number;
  inverterName: string;
  clippedTimeseries: Float32Array; // 17520 elements, watts clipped per step
}

export function detectClippingEvents(input: ClippingDetectionInput): ClippingEvent[] {
  // Walk timeseries, group contiguous non-zero clipped values
  // For each event: compute startStep, endStep, durationMin, peakClipW, totalClipWh
  // Convert timestep to date/time strings
}
```

Key formulas:
- `durationMin = (endStep - startStep + 1) * 30`
- `totalClipWh = sum(clipped[start..end]) / 2` (divide by 2 because each step is 30 min = 0.5 hour)
- `peakClipW = max(clipped[start..end])`
- Date/time from timestep: `day = floor(step / 48)`, `halfHour = step % 48`, `hour = halfHour / 2`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/lib/solar-v12-engine/clipping.test.ts --verbose`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/solar/v12-engine/clipping.ts src/__tests__/lib/solar-v12-engine/clipping.test.ts
git commit -m "feat(solar-designer): clipping event detection extracted from V12 dispatch"
```

### Task 11: Create timeseries aggregation module

**Files:**
- Create: `src/lib/solar/v12-engine/timeseries.ts`
- Create: `src/__tests__/lib/solar-v12-engine/timeseries.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
/**
 * Timeseries Aggregation Tests
 */
import { aggregateTimeseries, type TimeseriesView } from '@/lib/solar/v12-engine/timeseries';

describe('aggregateTimeseries', () => {
  it('aggregates a full-year timeseries to daily view for day 0', () => {
    const ts = new Float32Array(17520);
    // Fill day 0 (steps 0-47) with 1000W
    for (let t = 0; t < 48; t++) ts[t] = 1000;
    const view = aggregateTimeseries(ts, 'day', 0);
    expect(view.values).toHaveLength(48);
    expect(view.values[0]).toBe(1000);
  });

  it('aggregates to monthly view', () => {
    const ts = new Float32Array(17520).fill(100);
    const view = aggregateTimeseries(ts, 'year', 0);
    expect(view.values).toHaveLength(12);
    expect(view.values[0]).toBeGreaterThan(0); // Jan total
  });

  it('handles week view', () => {
    const ts = new Float32Array(17520).fill(50);
    const view = aggregateTimeseries(ts, 'week', 0);
    expect(view.values).toHaveLength(7);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/__tests__/lib/solar-v12-engine/timeseries.test.ts --verbose`
Expected: FAIL

- [ ] **Step 3: Write timeseries aggregation**

Port from V12 `_getTsData` (line 2726) and `renderTimeseries` aggregation logic:

```typescript
export type AggregationPeriod = 'day' | 'week' | 'month' | 'year';

export interface TimeseriesView {
  values: number[];    // aggregated values
  labels: string[];    // x-axis labels
  period: AggregationPeriod;
}

export function aggregateTimeseries(
  series: Float32Array,
  period: AggregationPeriod,
  startDay: number
): TimeseriesView { /* ... */ }

/**
 * Sum multiple panel/string timeseries into a single system timeseries.
 */
export function sumTimeseries(series: Float32Array[]): Float32Array { /* ... */ }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/lib/solar-v12-engine/timeseries.test.ts --verbose`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/solar/v12-engine/timeseries.ts src/__tests__/lib/solar-v12-engine/timeseries.test.ts
git commit -m "feat(solar-designer): timeseries aggregation (day/week/month/year views)"
```

---

## Chunk 5: Core Runner, Barrel Export, and Parity Tests

### Task 12: Create Core runner

**Files:**
- Create: `src/lib/solar/v12-engine/runner.ts`
- Create: `src/__tests__/lib/solar-v12-engine/runner.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
/**
 * Core Runner Integration Tests
 */
import { runCoreAnalysis, CORE_SCHEMA_VERSION } from '@/lib/solar/v12-engine/runner';
import type { CoreSolarDesignerInput, CoreSolarDesignerResult } from '@/lib/solar/v12-engine/types';
import type { WorkerProgressMessage } from '@/lib/solar/types';

const noopProgress = (_msg: WorkerProgressMessage) => {};

describe('Core Runner', () => {
  it('returns a valid CoreSolarDesignerResult for a minimal input', () => {
    const input: CoreSolarDesignerInput = {
      panels: [{
        id: 'p0', x: 0, y: 0, width: 1.02, height: 1.82,
        azimuth: 180, tilt: 30, shadePointIds: [],
      }],
      shadeData: {},
      strings: [{ panels: [0] }],
      inverters: [{ inverterKey: 'tesla_pw3', stringIndices: [0] }],
      equipment: { panelKey: 'rec_alpha_440', inverterKey: 'tesla_pw3' },
      siteConditions: {
        tempMin: -10, tempMax: 45, groundAlbedo: 0.2,
        clippingThreshold: 1.0, exportLimitW: 0,
      },
      lossProfile: {
        soiling: 2, mismatch: 2, dcWiring: 2, acWiring: 1,
        availability: 3, lid: 1.5, snow: 0, nameplate: 1,
      },
    };

    const result = runCoreAnalysis(input, noopProgress);

    expect(result.panelCount).toBe(1);
    expect(result.production.independentAnnual).toBeGreaterThan(0);
    expect(result.shadeFidelity).toBe('full');
    expect(result.shadeSource).toBe('manual');
    expect(result.clippingEvents).toBeInstanceOf(Array);
  });

  it('returns zero for empty panel array', () => {
    const input: CoreSolarDesignerInput = {
      panels: [],
      shadeData: {},
      strings: [],
      inverters: [],
      equipment: { panelKey: 'rec_alpha_440', inverterKey: 'tesla_pw3' },
      siteConditions: {
        tempMin: -10, tempMax: 45, groundAlbedo: 0.2,
        clippingThreshold: 1.0, exportLimitW: 0,
      },
      lossProfile: {
        soiling: 2, mismatch: 2, dcWiring: 2, acWiring: 1,
        availability: 3, lid: 1.5, snow: 0, nameplate: 1,
      },
    };

    const result = runCoreAnalysis(input, noopProgress);
    expect(result.panelCount).toBe(0);
    expect(result.production.independentAnnual).toBe(0);
  });

  it('reports progress during execution', () => {
    const progresses: number[] = [];
    const input: CoreSolarDesignerInput = {
      panels: [{
        id: 'p0', x: 0, y: 0, width: 1.02, height: 1.82,
        azimuth: 180, tilt: 30, shadePointIds: [],
      }],
      shadeData: {},
      strings: [{ panels: [0] }],
      inverters: [{ inverterKey: 'tesla_pw3', stringIndices: [0] }],
      equipment: { panelKey: 'rec_alpha_440', inverterKey: 'tesla_pw3' },
      siteConditions: {
        tempMin: -10, tempMax: 45, groundAlbedo: 0.2,
        clippingThreshold: 1.0, exportLimitW: 0,
      },
      lossProfile: {
        soiling: 2, mismatch: 2, dcWiring: 2, acWiring: 1,
        availability: 3, lid: 1.5, snow: 0, nameplate: 1,
      },
    };

    runCoreAnalysis(input, (msg) => progresses.push(msg.payload.percent));
    expect(progresses.length).toBeGreaterThan(0);
    expect(progresses[progresses.length - 1]).toBe(100);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/__tests__/lib/solar-v12-engine/runner.test.ts --verbose`
Expected: FAIL

- [ ] **Step 3: Write the Core runner**

The Core runner bridges `CoreSolarDesignerInput` to the existing engine modules:

1. Resolve equipment from built-in catalog via `resolvePanel`/`resolveInverter`
2. Map `PanelGeometry[]` → `PanelStat[]` (bridge the type gap — PanelGeometry has x/y/width/height, PanelStat has tsrf/points/panelKey)
3. Call existing `prepareTmyLookup`, `generateConsumptionProfile`
4. Call existing `runModelA`, `runModelB`, `runDispatch`
5. Extract clipping events via `detectClippingEvents`
6. Map result to `CoreSolarDesignerResult`

Key: the CoreRunner does NOT modify any existing engine code. It's a new orchestrator that calls existing functions.

```typescript
export const CORE_SCHEMA_VERSION = 2;

export function runCoreAnalysis(
  input: CoreSolarDesignerInput,
  reportProgress: (msg: WorkerProgressMessage) => void
): CoreSolarDesignerResult { /* ... */ }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/lib/solar-v12-engine/runner.test.ts --verbose`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/solar/v12-engine/runner.ts src/__tests__/lib/solar-v12-engine/runner.test.ts
git commit -m "feat(solar-designer): Core runner bridging CoreSolarDesignerInput to engine"
```

### Task 13: Create barrel export and parity test

**Files:**
- Create: `src/lib/solar/v12-engine/index.ts`
- Create: `src/__tests__/lib/solar-v12-engine/parity.test.ts`

- [ ] **Step 1: Write barrel export**

```typescript
/**
 * Solar Designer V12 Engine — Public API
 *
 * Barrel export for the v12-engine module.
 * Stage 1 (Core): layout → equipment → string → analyze.
 */

// Types
export type {
  CoreSolarDesignerInput,
  CoreSolarDesignerResult,
  PanelGeometry,
  ShadeTimeseries,
  ShadeFidelity,
  ShadeSource,
  ClippingEvent,
  EquipmentSelection,
  SiteConditions,
} from './types';

// Re-exported engine types
export type {
  ConsumptionConfig,
  LossProfile,
  StringConfig,
  InverterConfig,
  PanelStat,
  ResolvedPanel,
  ResolvedInverter,
} from './types';

// Runner
export { runCoreAnalysis, CORE_SCHEMA_VERSION } from './runner';

// Equipment
export { getBuiltInPanels, getBuiltInInverters, getBuiltInEss, resolvePanel, resolveInverter, resolveEss } from './equipment';

// Layout parsing
export { parseJSON, parseDXF } from './layout-parser';
export { parseShadeCSV } from './csv-shade-parser';

// Stringing
export { autoString } from './stringing';

// Physics (re-exported)
export { solarFactor, seasonFactor, getSeasonalTSRF, calculateStringElectrical } from './physics';

// Timeseries
export { aggregateTimeseries, sumTimeseries } from './timeseries';

// Clipping
export { detectClippingEvents } from './clipping';

// Constants
export { TIMESTEPS, HALF_HOUR_FACTOR, DEFAULT_SITE_CONDITIONS, DEFAULT_LOSS_PROFILE } from './constants';

// Worker
export { handleWorkerMessage } from './worker';
```

- [ ] **Step 2: Write parity test — Core runner vs existing runner**

This is the critical V12 validation test. Feed the same 10-panel fixture through both the existing `runAnalysis` and the new `runCoreAnalysis`, and verify they produce the same output within 0.1%.

```typescript
/**
 * V12 Parity Test
 *
 * Validates that the new CoreRunner produces results matching
 * the existing runner (which is already V12-faithful) within 0.1%.
 */
import { runAnalysis } from '@/lib/solar/engine/runner';
import { runCoreAnalysis } from '@/lib/solar/v12-engine/runner';
import type { RunnerInput } from '@/lib/solar/engine/engine-types';
import type { CoreSolarDesignerInput } from '@/lib/solar/v12-engine/types';
import type { WorkerProgressMessage } from '@/lib/solar/types';
import fixture from './fixtures/synthetic-10-panel.json';
import { expectClose } from './test-helpers';

const noopProgress = (_msg: WorkerProgressMessage) => {};

describe('V12 Parity: CoreRunner vs existing Runner', () => {
  // Run existing runner once
  const existingResult = runAnalysis(fixture as unknown as RunnerInput, noopProgress);

  // Build CoreSolarDesignerInput from the same fixture
  const coreInput: CoreSolarDesignerInput = {
    panels: (fixture as any).panels.map((p: any, i: number) => ({
      id: `panel_${i}`,
      x: i * 1.1,
      y: 0,
      width: 1.02,
      height: 1.82,
      azimuth: 180,
      tilt: 30,
      shadePointIds: p.points || [],
    })),
    shadeData: fixture.shadeData as any,
    strings: fixture.strings as any,
    inverters: fixture.inverters as any,
    equipment: {
      panelKey: 'rec_alpha_440',
      inverterKey: 'tesla_pw3',
    },
    siteConditions: {
      tempMin: -10,
      tempMax: 45,
      groundAlbedo: fixture.groundAlbedo,
      clippingThreshold: fixture.clippingThreshold,
      exportLimitW: 0,
    },
    lossProfile: fixture.lossProfile as any,
  };

  const coreResult = runCoreAnalysis(coreInput, noopProgress);

  it('Model A annual kWh within 0.1%', () => {
    const tolerance = existingResult.modelA.annualKwh * 0.001;
    expectClose(
      coreResult.production.independentAnnual,
      existingResult.modelA.annualKwh,
      tolerance,
      'Model A annual'
    );
  });

  it('Model B annual kWh within 0.1% (if string architecture)', () => {
    if (!existingResult.modelB) return;
    const tolerance = existingResult.modelB.annualKwh * 0.001;
    expectClose(
      coreResult.production.stringLevelAnnual,
      existingResult.modelB.annualKwh,
      tolerance,
      'Model B annual'
    );
  });

  it('Mismatch loss % within 0.1 percentage points', () => {
    if (!existingResult.modelB) return;
    expectClose(
      coreResult.mismatchLossPct,
      existingResult.modelB.mismatchLossPct,
      0.1,
      'Mismatch %'
    );
  });

  it('Panel count matches', () => {
    expect(coreResult.panelCount).toBe(existingResult.panelCount);
  });

  it('System size matches', () => {
    expectClose(coreResult.systemSizeKw, existingResult.systemSizeKw, 0.01, 'System kW');
  });
});
```

- [ ] **Step 3: Run parity test**

Run: `npx jest src/__tests__/lib/solar-v12-engine/parity.test.ts --verbose`
Expected: All PASS (existing engine is already V12-faithful; Core runner calls the same functions)

- [ ] **Step 4: Run ALL v12-engine tests**

Run: `npx jest src/__tests__/lib/solar-v12-engine/ --verbose`
Expected: All tests PASS

- [ ] **Step 5: Run project-wide type check**

Run: `npx tsc --noEmit`
Expected: No new type errors introduced

- [ ] **Step 6: Commit**

```bash
git add src/lib/solar/v12-engine/index.ts src/__tests__/lib/solar-v12-engine/parity.test.ts
git commit -m "feat(solar-designer): barrel export + V12 parity test (Stage 1 complete)

Core engine extraction complete: 14 modules extracted/re-exported from V12,
all validated to match existing engine output within 0.1%.

Modules: types, constants, equipment, layout-parser, csv-shade-parser,
physics, weather, consumption, production, stringing, mismatch,
clipping, timeseries, runner, worker.

Spec: docs/superpowers/specs/2026-04-05-solar-designer-design.md Stage 1"
```

### Task 14: Create Web Worker entry point [AC 5]

**Files:**
- Create: `src/lib/solar/v12-engine/worker.ts`
- Create: `src/__tests__/lib/solar-v12-engine/worker.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
/**
 * Web Worker Entry Point Tests
 *
 * Validates AC 5: Engine runs in a Web Worker without blocking the main thread.
 * Tests that the worker entry point:
 * 1. Has no DOM/browser API imports
 * 2. Correctly routes WorkerRunMessage → runCoreAnalysis → WorkerResultMessage
 * 3. Sends progress messages during execution
 */
import { handleWorkerMessage } from '@/lib/solar/v12-engine/worker';
import type { CoreSolarDesignerInput } from '@/lib/solar/v12-engine/types';

describe('Worker entry point', () => {
  it('routes a RUN message and returns a RESULT message', () => {
    const input: CoreSolarDesignerInput = {
      panels: [{
        id: 'p0', x: 0, y: 0, width: 1.02, height: 1.82,
        azimuth: 180, tilt: 30, shadePointIds: [],
      }],
      shadeData: {},
      strings: [{ panels: [0] }],
      inverters: [{ inverterKey: 'tesla_pw3', stringIndices: [0] }],
      equipment: { panelKey: 'rec_alpha_440', inverterKey: 'tesla_pw3' },
      siteConditions: {
        tempMin: -10, tempMax: 45, groundAlbedo: 0.2,
        clippingThreshold: 1.0, exportLimitW: 0,
      },
      lossProfile: {
        soiling: 2, mismatch: 2, dcWiring: 2, acWiring: 1,
        availability: 3, lid: 1.5, snow: 0, nameplate: 1,
      },
    };

    const messages: any[] = [];
    const mockPostMessage = (msg: any) => messages.push(msg);

    handleWorkerMessage(
      { type: 'RUN_SIMULATION', payload: input },
      mockPostMessage
    );

    // Should have progress messages + final result
    const progressMsgs = messages.filter(m => m.type === 'SIMULATION_PROGRESS');
    const resultMsgs = messages.filter(m => m.type === 'SIMULATION_RESULT');
    expect(progressMsgs.length).toBeGreaterThan(0);
    expect(resultMsgs).toHaveLength(1);
    expect(resultMsgs[0].payload.panelCount).toBe(1);
    expect(resultMsgs[0].payload.production.independentAnnual).toBeGreaterThan(0);
  });

  it('returns an error message for invalid input', () => {
    const messages: any[] = [];
    const mockPostMessage = (msg: any) => messages.push(msg);

    handleWorkerMessage(
      { type: 'RUN_SIMULATION', payload: { panels: null } },
      mockPostMessage
    );

    const errorMsgs = messages.filter(m => m.type === 'SIMULATION_ERROR');
    expect(errorMsgs).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/__tests__/lib/solar-v12-engine/worker.test.ts --verbose`
Expected: FAIL — module not found

- [ ] **Step 3: Write the worker entry point**

```typescript
/**
 * Solar Designer V12 Engine — Web Worker Entry Point
 *
 * Wires the CoreRunner to the existing worker protocol
 * (WorkerRunMessage → WorkerProgressMessage → WorkerResultMessage).
 *
 * Usage: new Worker(new URL('./worker.ts', import.meta.url))
 *
 * IMPORTANT: This file must have ZERO DOM/browser API imports.
 * It runs in a worker context where window/document/navigator are undefined.
 * Import worker protocol types from the existing types.ts to stay aligned.
 */
import { runCoreAnalysis } from './runner';
import type { CoreSolarDesignerInput } from './types';
import type {
  WorkerRunMessage,
  WorkerProgressMessage,
  WorkerResultMessage,
} from '../types';

/**
 * Handle an incoming worker message.
 * Exported for testability — the actual worker just calls this from onmessage.
 */
export function handleWorkerMessage(
  msg: { type: string; payload: any },
  postMessage: (msg: WorkerResultMessage | WorkerProgressMessage | { type: string; payload: any }) => void
): void {
  if (msg.type !== 'RUN_SIMULATION') return;

  try {
    const result = runCoreAnalysis(msg.payload as CoreSolarDesignerInput, (progress) => {
      postMessage(progress);
    });
    postMessage({ type: 'SIMULATION_RESULT', payload: result } as WorkerResultMessage);
  } catch (err: any) {
    postMessage({ type: 'SIMULATION_ERROR', payload: { message: err?.message || 'Unknown error' } });
  }
}

// Worker self-registration — this file is only loaded via:
//   new Worker(new URL('./worker.ts', import.meta.url))
// so it always runs in a worker context. Tests import handleWorkerMessage directly.
self.onmessage = (e: MessageEvent) => {
  handleWorkerMessage(e.data, (msg) => self.postMessage(msg));
};
```

> **Note for implementer:** The `self.onmessage` assignment at module level will execute in jsdom (Jest's test environment). This is harmless — `self` is defined in jsdom but the assignment has no side effects. Tests call `handleWorkerMessage` directly and never rely on the `onmessage` wiring.

- [ ] **Step 4: Verify no DOM imports in v12-engine/**

Run: `grep -r "window\|document\|navigator\|localStorage\|sessionStorage" src/lib/solar/v12-engine/ || echo "✅ No DOM imports found"`
Expected: No matches — all modules are worker-safe.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest src/__tests__/lib/solar-v12-engine/worker.test.ts --verbose`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/solar/v12-engine/worker.ts src/__tests__/lib/solar-v12-engine/worker.test.ts
git commit -m "feat(solar-designer): Web Worker entry point for CoreRunner [AC 5]"
```

### Task 15: Run full test suite and verify no regressions

- [ ] **Step 1: Run full Jest suite**

Run: `npm run test`
Expected: No new failures — existing solar engine tests still pass, v12-engine tests all pass.

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: No new lint errors in `src/lib/solar/v12-engine/` or `src/__tests__/lib/solar-v12-engine/`.

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: Build succeeds — v12-engine modules are tree-shakeable and don't break the bundle.

---

## Summary

**Total tasks:** 15
**Total files created:** ~31 (14 source + 17 test/fixture)
**Existing files modified:** 0
**Estimated time:** 3-5 hours for experienced developer

**What Stage 1 delivers:**
- `src/lib/solar/v12-engine/` — 14 typed TypeScript modules (including worker entry point)
- Core contracts: `CoreSolarDesignerInput` → `CoreSolarDesignerResult`
- DXF/JSON layout parser, CSV shade parser
- V12-faithful physics, weather, consumption, production via re-export
- New: auto-string algorithm, clipping event detection, timeseries aggregation
- Built-in equipment catalog (8 panels, 9 inverters, 6 ESS)
- Web Worker entry point: engine runs off main thread [AC 5]
- Parity validated: output matches existing engine within 0.1%

**What it does NOT do:**
- No UI changes
- No API routes
- No database migrations
- No modifications to existing `engine/` code
- No battery dispatch, AI analysis, or scenarios (deferred to Stage 5)

**Next:** Stage 2 plan (Core UI Shell — upload → in-memory → display)
