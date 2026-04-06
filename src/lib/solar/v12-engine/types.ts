/**
 * Solar Designer V12 Engine — Core Type Contracts
 *
 * These types define the Core interface for Stages 1-4.
 * Extended types (battery, AI, scenarios) are added in Stage 5.
 *
 * Spec: docs/superpowers/specs/2026-04-05-solar-designer-design.md
 */

// Re-export existing types needed for Stages 1-4 (Core).
// BatteryConfig, EnergyBalance, DispatchResult are Stage 5 — not exported here.
export type {
  LossProfile,
  StringConfig,
  InverterConfig,
  HomeConsumptionConfig as ConsumptionConfig,
  ResolvedPanel,
  ResolvedInverter,
  TmyData,
  TmyLookup,
  ModelAResult,
  ModelBResult,
  PanelStat,
} from '../engine/engine-types';

// Local imports for use within this file's interfaces
import type {
  LossProfile,
  StringConfig,
  InverterConfig,
  HomeConsumptionConfig as ConsumptionConfig,
  PanelStat,
} from '../engine/engine-types';

// ── Shade Timeseries (explicit definition — not aliased from ShadeData) ──
// Per-point shade data: keys are shade point IDs, values are binary shade strings.
// Each string is 17,520 chars (365 days × 48 half-hour intervals), '0' = sun, '1' = shade.
// This matches the spec encoding. All adapters (DXF, CSV, EagleView, Google Solar) normalize to this.
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
  /** Optional per-panel TSRF override. Used by legacy adapter for parity testing.
   *  In production, TSRF should be derived from shade data + panel orientation. */
  tsrf?: number;
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
