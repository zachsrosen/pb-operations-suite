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
  RadiancePoint,
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

export interface UIStringConfig {
  id: number;
  panelIds: string[];
}

export interface UIInverterConfig {
  inverterId: number;       // 0-based index
  inverterKey: string;      // references selectedInverter.key
  channels: { stringIndices: number[] }[];  // one entry per MPPT channel
}

export interface MapAlignment {
  offsetX: number;
  offsetY: number;
  rotation: number;
  scale: number;
}

export const DEFAULT_MAP_ALIGNMENT: MapAlignment = {
  offsetX: 0,
  offsetY: 0,
  rotation: 0,
  scale: 1,
};

export interface SolarDesignerState {
  // Layout data (from file upload)
  panels: PanelGeometry[];
  shadeData: ShadeTimeseries;
  shadeFidelity: ShadeFidelity;
  shadeSource: ShadeSource;
  radiancePoints: RadiancePoint[];
  uploadedFiles: UploadedFile[];

  // Shade association (derived from radiancePoints + panels)
  panelShadeMap: Record<string, string[]>;

  // Site address + geocoding
  siteAddress: string | null;
  siteFormattedAddress: string | null;
  siteLatLng: { lat: number; lng: number } | null;

  // Map alignment (satellite image positioning)
  mapAlignment: MapAlignment;

  // Equipment selection
  panelKey: string;
  inverterKey: string;
  selectedPanel: ResolvedPanel | null;
  selectedInverter: ResolvedInverter | null;

  // Site conditions
  siteConditions: SiteConditions;

  // Loss profile
  lossProfile: LossProfile;

  // Stringing (Stage 3 interactive)
  strings: UIStringConfig[];
  activeStringId: number | null;
  nextStringId: number;

  // Inverter configs (Stage 4)
  inverters: UIInverterConfig[];

  // Analysis result (Stage 4)
  result: CoreSolarDesignerResult | null;

  // Analysis lifecycle (Stage 4)
  isAnalyzing: boolean;
  analysisProgress: { percent: number; stage: string } | null;
  analysisError: string | null;
  resultStale: boolean;

  // UI state
  activeTab: SolarDesignerTab;
  isUploading: boolean;
  uploadError: string | null;
}

// ── Actions ─────────────────────────────────────────────────

export type SolarDesignerAction =
  | { type: 'SET_TAB'; tab: SolarDesignerTab }
  | { type: 'UPLOAD_START' }
  | { type: 'UPLOAD_SUCCESS'; panels: PanelGeometry[]; shadeData: ShadeTimeseries; files: UploadedFile[]; shadeFidelity: ShadeFidelity; shadeSource: ShadeSource; radiancePoints: RadiancePoint[] }
  | { type: 'UPLOAD_ERROR'; error: string }
  | { type: 'SET_PANEL'; key: string; panel: ResolvedPanel }
  | { type: 'SET_INVERTER'; key: string; inverter: ResolvedInverter }
  | { type: 'SET_SITE_CONDITIONS'; conditions: Partial<SiteConditions> }
  | { type: 'SET_LOSS_PROFILE'; profile: Partial<LossProfile> }
  | { type: 'SET_STRINGS'; strings: StringConfig[]; inverters: InverterConfig[] }
  | { type: 'SET_RESULT'; result: CoreSolarDesignerResult }
  | { type: 'RESET' }
  // Stage 3 additions
  | { type: 'SET_SHADE_POINT_IDS'; panelShadeMap: Record<string, string[]> }
  | { type: 'SET_ADDRESS'; address: string; formattedAddress: string; lat: number; lng: number }
  | { type: 'SET_MAP_ALIGNMENT'; alignment: Partial<MapAlignment> }
  | { type: 'SET_ACTIVE_STRING'; stringId: number | null }
  | { type: 'ASSIGN_PANEL'; panelId: string }
  | { type: 'UNASSIGN_PANEL'; panelId: string }
  | { type: 'CREATE_STRING' }
  | { type: 'DELETE_STRING'; stringId: number }
  | { type: 'AUTO_STRING'; strings: StringConfig[]; panels: PanelGeometry[] }
  // Stage 4 additions
  | { type: 'RUN_ANALYSIS_START' }
  | { type: 'SET_ANALYSIS_PROGRESS'; percent: number; stage: string }
  | { type: 'SET_ANALYSIS_RESULT'; result: CoreSolarDesignerResult; inverters: UIInverterConfig[] }
  | { type: 'SET_ANALYSIS_ERROR'; error: string }
  | { type: 'REASSIGN_STRING_TO_CHANNEL'; stringIndex: number; fromInverterId: number; fromChannel: number; toInverterId: number; toChannel: number };
