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
