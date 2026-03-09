/**
 * Solar Engine — Internal Type Definitions
 *
 * These types are used within the engine modules only.
 * External consumers interact via the WorkerMessage protocol in types.ts.
 */

// ── Panel & Shade ────────────────────────────────────────────

export interface PanelStat {
  id: number;
  tsrf: number;
  points: string[];
  panelKey: string;
  segmentIndex?: number;
  /** F7: Pre-computed bifacial gain multiplier (1.0 for non-bifacial) */
  bifacialGain: number;
}

/** Point ID → shade sequence string (one char per half-hour slot, '0'=sun '1'=shade) */
export type ShadeData = Record<string, string>;

// ── Equipment Resolved ───────────────────────────────────────

export interface ResolvedPanel {
  key: string;
  name: string;
  watts: number;
  voc: number;
  vmp: number;
  isc: number;
  imp: number;
  tempCoVoc: number;
  tempCoIsc: number;
  tempCoPmax: number;
  cells: number;
  bypassDiodes: number;
  cellsPerSubstring: number;
  isBifacial: boolean;
  bifacialityFactor: number;
}

export interface ResolvedInverter {
  key: string;
  name: string;
  acPower: number;
  dcMax: number;
  mpptMin: number;
  mpptMax: number;
  channels: number;
  maxIsc: number;
  efficiency: number;
  architectureType: "string" | "micro" | "optimizer";
  isMicro: boolean;
  isIntegrated: boolean;
}

export interface ResolvedOptimizer {
  key: string;
  name: string;
  dcMaxInput: number;
  inputVoltageMax: number;
  maxIsc: number;
  outputVoltageMax: number;
  maxOutputCurrent: number;
  efficiency: number;
}

export interface ResolvedEss {
  key: string;
  name: string;
  capacity: number; // kWh
  power: number; // kW
  roundTrip: number; // 0-1
  dcChargeRate: number; // W
  type: "none" | "ac_coupled" | "dc_coupled";
}

// ── String & Inverter Config ─────────────────────────────────

/** A string of panel indices (referencing PanelStat[] order) */
export interface StringConfig {
  panels: number[];
}

export interface InverterConfig {
  inverterKey: string;
  stringIndices: number[]; // indices into the strings array
  batteryConfig?: BatteryConfig;
}

export interface BatteryConfig {
  essKey: string;
  totalCapacityWh: number;
  totalDcChargeW: number;
  maxDischargeW: number;
  roundTrip: number;
}

// ── Home Consumption ─────────────────────────────────────────

export interface HomeConsumptionConfig {
  enabled: boolean;
  annualKwh: number;
  monthlyKwh?: number[];
  climateZone: "hot" | "mixed" | "cold";
  priorityMode: "self_consumption" | "tou" | "export_first";
  backupReservePct: number; // 0-100
}

// ── Loss Profile ─────────────────────────────────────────────

/** All values as percentages (e.g. 2.0 means 2% loss) */
export interface LossProfile {
  soiling: number;
  mismatch: number;
  dcWiring: number;
  acWiring: number;
  availability: number;
  lid: number; // light-induced degradation
  snow: number;
  nameplate: number;
}

// ── Weather ──────────────────────────────────────────────────

/** Raw TMY data as received from host (8,760 hourly values) */
export interface TmyData {
  ghi: number[]; // W/m^2 hourly
  temperature: number[]; // degrees C hourly
}

/** Interpolated to half-hourly for engine use */
export interface TmyLookup {
  ghi: Float32Array; // 17,520 half-hourly, W/m^2
  temp: Float32Array; // 17,520 half-hourly, degrees C
  annualPSH: number; // peak sun hours
  hasTmy: boolean;
}

// ── Per-Inverter Timestep ────────────────────────────────────

export interface InverterTimestep {
  rawDcW: number;
  dcAfterBatteryW: number;
  acOutputW: number;
  clippedW: number;
  batteryChargeW: number;
}

// ── Energy Balance ───────────────────────────────────────────

export interface EnergyBalance {
  totalProductionKwh: number;
  selfConsumedKwh: number;
  gridExportKwh: number;
  gridImportKwh: number;
  batteryChargedKwh: number;
  batteryDischargedKwh: number;
  batteryLossesKwh: number;
  curtailedKwh: number;
  clippedKwh: number;
  /** SOC_end - SOC_start — closes energy balance equation [P1-F2] */
  deltaStoredKwh: number;
}

// ── Dispatch Result ──────────────────────────────────────────

export interface DispatchResult {
  energyBalance: EnergyBalance;
  clippingLossPct: number;
  curtailedKwh: number;
}

// ── Model Results ────────────────────────────────────────────

export interface ModelAResult {
  annualKwh: number;
  monthlyKwh: number[];
  /** Per-panel half-hourly timeseries in watts */
  panelTimeseries: Float32Array[];
}

export interface ModelBResult {
  annualKwh: number;
  monthlyKwh: number[];
  mismatchLossPct: number;
  /** Per-string half-hourly timeseries in watts */
  stringTimeseries: Float32Array[];
}

// ── Full Simulation Result (internal) ────────────────────────

export interface SimulationResult {
  modelA: ModelAResult;
  /** null for non-string architectures (micro/optimizer) [P1-F3] */
  modelB: ModelBResult | null;
  dispatch: DispatchResult | null;
  panelCount: number;
  systemSizeKw: number;
  systemTsrf: number;
  specificYield: number;
}

// ── Runner Input (maps from WorkerRunMessage.payload) ────────

export interface RunnerInput {
  panels: PanelStat[];
  shadeData: ShadeData;
  strings: StringConfig[];
  inverters: InverterConfig[];
  resolvedPanels: Record<string, ResolvedPanel>;
  resolvedInverters: Record<string, ResolvedInverter>;
  resolvedOptimizer: ResolvedOptimizer | null;
  resolvedEss: ResolvedEss | null;
  architectureType: "string" | "micro" | "optimizer";
  lossProfile: LossProfile;
  tmyData: TmyData | null;
  homeConsumption: HomeConsumptionConfig | null;
  groundAlbedo: number;
  clippingThreshold: number;
}
