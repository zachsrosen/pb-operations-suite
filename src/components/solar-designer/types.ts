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
