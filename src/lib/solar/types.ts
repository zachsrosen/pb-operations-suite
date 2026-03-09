/**
 * Solar Surveyor — Shared TypeScript Types
 *
 * Type definitions used across API routes, the Web Worker engine,
 * and React frontend components.
 */

import type { SolarEquipmentCategory } from "@/generated/prisma/enums";

// ── F1: Google Solar API Shade ────────────────────────────────

export interface GoogleSolarRoofSegment {
  azimuthDegrees: number;
  pitchDegrees: number;
  stats: {
    areaMeters2: number;
    sunshineQuantiles: number[]; // 11 values, 0th-100th percentile
    groundAreaMeters2: number;
  };
  center: { latitude: number; longitude: number };
  boundingBox: {
    sw: { latitude: number; longitude: number };
    ne: { latitude: number; longitude: number };
  };
  planeHeightAtCenterMeters: number;
}

export interface GoogleSolarPanel {
  center: { latitude: number; longitude: number };
  orientation: "LANDSCAPE" | "PORTRAIT";
  yearlyEnergyDcKwh: number;
  segmentIndex: number;
}

export interface GoogleSolarWholeRoofStats {
  areaMeters2: number;
  sunshineQuantiles: number[];
  groundAreaMeters2: number;
}

export interface GoogleSolarData {
  roofSegments: GoogleSolarRoofSegment[];
  solarPanels: GoogleSolarPanel[];
  wholeRoofStats: GoogleSolarWholeRoofStats;
  maxArrayPanelsCount: number;
  maxSunshineHoursPerYear: number;
  imageryDate: { year: number; month: number; day: number };
  imageryQuality: "HIGH" | "MEDIUM" | "LOW";
}

export type ShadeFallbackReason = "NO_COVERAGE" | "LOW_QUALITY" | "API_ERROR";

export interface ShadeApiResponse {
  data: GoogleSolarData | null;
  source: "cache" | "google" | "none";
  latE5: number;
  lngE5: number;
  fetchedAt?: string;
  fallbackReason?: ShadeFallbackReason;
}

// ── F4: Custom Equipment ──────────────────────────────────────

/** Re-export the Prisma enum for convenience */
export { SolarEquipmentCategory };

/** Reserved key prefixes that cannot be used for custom equipment */
export const RESERVED_KEY_PREFIXES = [
  "custom_",
  "built_in_",
  "system_",
  "default_",
] as const;

/** Canonicalize an equipment key: lowercase, alphanumeric + underscore only */
export function canonicalizeEquipmentKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_");
}

/** Base fields shared by all equipment profiles */
interface EquipmentProfileBase {
  name: string;
  manufacturer?: string;
}

/** Panel-specific profile fields */
export interface PanelProfile extends EquipmentProfileBase {
  watts: number;
  voc: number;
  vmp: number;
  isc: number;
  imp: number;
  tempCoVoc: number; // %/°C
  tempCoIsc: number; // %/°C
  tempCoPmax: number; // %/°C
  length: number; // mm
  width: number; // mm
  cells: number;
  bypassDiodes: number;
  cellsPerSubstring: number;
  /** F7: Bifacial support */
  isBifacial?: boolean;
  bifacialityFactor?: number; // 0-1, typically 0.65-0.85
}

/** Inverter-specific profile fields */
export interface InverterProfile extends EquipmentProfileBase {
  maxPowerW: number;
  maxVdc: number;
  mpptMin: number;
  mpptMax: number;
  mpptChannels: number;
  maxIsc: number;
  nominalVac: number;
  maxEfficiency: number;
  type: "string" | "micro" | "hybrid";
}

/** ESS (Energy Storage System) profile fields */
export interface EssProfile extends EquipmentProfileBase {
  capacityKwh: number;
  maxChargeKw: number;
  maxDischargeKw: number;
  roundTripEfficiency: number;
  depthOfDischarge: number;
  nominalVoltage: number;
}

/** Optimizer profile fields */
export interface OptimizerProfile extends EquipmentProfileBase {
  maxInputW: number;
  maxInputVoc: number;
  maxOutputVdc: number;
  maxOutputIsc: number;
  mpptRange: [number, number]; // [min, max] voltage
}

export type EquipmentProfile =
  | PanelProfile
  | InverterProfile
  | EssProfile
  | OptimizerProfile;

export interface CustomEquipmentRecord {
  id: string;
  category: SolarEquipmentCategory;
  key: string;
  profile: EquipmentProfile;
  isArchived: boolean;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

// ── F5: Map-Based Design ──────────────────────────────────────

export interface PanelPlacement {
  dx: number; // offset in meters from segment origin
  dy: number; // offset in meters from segment origin
  s: number; // segment index
}

export interface RoofSegmentGeometry {
  origin: { lat: number; lng: number };
  azimuthDeg: number;
  tiltDeg: number;
  polygon: Array<{ lat: number; lng: number }>;
}

export interface DesignState {
  roofGeometry: Record<string, unknown> | null; // GeoJSON FeatureCollection
  panelPlacements: PanelPlacement[] | null;
  segments: RoofSegmentGeometry[];
}

// ── F7: Bifacial Modeling ─────────────────────────────────────

export interface AlbedoPreset {
  label: string;
  value: number;
}

export const ALBEDO_PRESETS: AlbedoPreset[] = [
  { label: "Grass", value: 0.2 },
  { label: "Concrete", value: 0.3 },
  { label: "Sand", value: 0.4 },
  { label: "Snow", value: 0.6 },
  { label: "White Roof", value: 0.7 },
];

export interface BifacialParams {
  ghi: number;
  albedo: number;
  bifacialityFactor: number;
  tiltRadians: number;
  gcr: number; // ground coverage ratio
}

/**
 * Calculate bifacial gain multiplier.
 * Returns 1.0 for non-bifacial panels (no effect).
 */
export function calculateBifacialGain(params: BifacialParams): number {
  const { albedo, bifacialityFactor, tiltRadians, gcr } = params;
  if (!bifacialityFactor || bifacialityFactor <= 0) return 1.0;
  const viewFactor = (1 + Math.cos(tiltRadians)) / 2;
  const selfShadingFactor = Math.max(0, 1 - gcr * 1.5);
  const rearFraction = albedo * viewFactor * selfShadingFactor;
  return 1 + bifacialityFactor * rearFraction;
}

// ── F9: Monitoring (Phase 4-5 — types only for now) ───────────

export type MonitoringPlatform = "ENPHASE" | "SOLAREDGE" | "TESLA";
export type MonitoringConnectionStatus =
  | "ACTIVE"
  | "REAUTH_REQUIRED"
  | "DISCONNECTED";

export interface TokenEnvelope {
  ciphertext: string; // base64 AES-256-GCM encrypted { accessToken, refreshToken }
  iv: string; // base64 12-byte IV
  tag: string; // base64 16-byte auth tag
  keyVersion: number; // rotation version
}

export interface MonitoringDataPoint {
  date: string; // ISO 8601 UTC midnight
  productionWh: number;
  consumptionWh?: number;
}

export interface MonitoringAdapter {
  getAuthUrl(callbackUrl: string, state: string): string;
  exchangeCode(code: string): Promise<TokenEnvelope>;
  refreshAccessToken(refreshToken: string): Promise<TokenEnvelope>;
  getSiteProduction(
    siteId: string,
    startDate: string,
    endDate: string
  ): Promise<MonitoringDataPoint[]>;
  listSites(accessToken: string): Promise<Array<{ id: string; name: string }>>;
}

// ── Web Worker Protocol ───────────────────────────────────────

export type WorkerMessageType =
  | "RUN_SIMULATION"
  | "SIMULATION_PROGRESS"
  | "SIMULATION_RESULT"
  | "SIMULATION_ERROR";

export interface WorkerRunMessage {
  type: "RUN_SIMULATION";
  payload: {
    weatherData: { ghi: number[]; temperature: number[] };
    panelStats: Array<{
      tsrf: number;
      panelKey: string;
      segmentIndex?: number;
    }>;
    equipmentConfig: Record<string, unknown>;
    stringsConfig: Record<string, unknown>;
    siteConditions: {
      groundAlbedo?: number;
      [key: string]: unknown;
    };
    lossProfile: Record<string, unknown>;
    batteryConfig?: Record<string, unknown>;
    homeConsumptionConfig?: Record<string, unknown>;
  };
}

export interface WorkerProgressMessage {
  type: "SIMULATION_PROGRESS";
  payload: { percent: number; stage: string };
}

/** Energy balance for system dispatch results [P1-F2] */
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

export interface WorkerResultMessage {
  type: "SIMULATION_RESULT";
  payload: {
    /** Bump on breaking changes — consumer rejects unknown versions [P2-F4] */
    schemaVersion: 1;
    modelA: {
      annualKwh: number;
      monthlyKwh: number[];
    };
    /** null for non-string architectures (micro/optimizer) [P1-F3] */
    modelB: {
      annualKwh: number;
      monthlyKwh: number[];
      mismatchLossPct: number;
    } | null;
    dispatch?: {
      energyBalance: EnergyBalance;
      clippingLossPct: number;
      curtailedKwh: number;
    };
    panelCount: number;
    systemSizeKw: number;
    systemTsrf: number;
    specificYield: number;
  };
}

export interface WorkerErrorMessage {
  type: "SIMULATION_ERROR";
  payload: { message: string; code?: string };
}

export type WorkerMessage =
  | WorkerRunMessage
  | WorkerProgressMessage
  | WorkerResultMessage
  | WorkerErrorMessage;
