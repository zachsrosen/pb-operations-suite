'use client';

import { useReducer, useEffect } from 'react';
import DashboardShell from '@/components/DashboardShell';
import TabBar from '@/components/solar-designer/TabBar';
import PlaceholderTab from '@/components/solar-designer/PlaceholderTab';
import EquipmentPanel from '@/components/solar-designer/EquipmentPanel';
import SiteConditionsPanel from '@/components/solar-designer/SiteConditionsPanel';
import FileUploadPanel from '@/components/solar-designer/FileUploadPanel';
import SystemSummaryBar from '@/components/solar-designer/SystemSummaryBar';
import VisualizerTab from '@/components/solar-designer/VisualizerTab';
import StringingTab from '@/components/solar-designer/StringingTab';
import AddressInput from '@/components/solar-designer/AddressInput';
import { DEFAULT_SITE_CONDITIONS, DEFAULT_LOSS_PROFILE, associateShadePoints } from '@/lib/solar/v12-engine';
import type { SolarDesignerState, SolarDesignerAction, SolarDesignerTab, UIStringConfig } from '@/components/solar-designer/types';
import { DEFAULT_MAP_ALIGNMENT } from '@/components/solar-designer/types';

const INITIAL_STATE: SolarDesignerState = {
  panels: [],
  shadeData: {},
  shadeFidelity: 'full',
  shadeSource: 'manual',
  radiancePoints: [],
  uploadedFiles: [],
  panelShadeMap: {},
  siteAddress: null,
  siteFormattedAddress: null,
  siteLatLng: null,
  mapAlignment: DEFAULT_MAP_ALIGNMENT,
  panelKey: '',
  inverterKey: '',
  selectedPanel: null,
  selectedInverter: null,
  siteConditions: DEFAULT_SITE_CONDITIONS,
  lossProfile: DEFAULT_LOSS_PROFILE,
  strings: [],
  activeStringId: null,
  nextStringId: 1,
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
        radiancePoints: action.radiancePoints,
        uploadedFiles: action.files,
        uploadError: null,
        panelShadeMap: {},
        panelKey: '',
        inverterKey: '',
        selectedPanel: null,
        selectedInverter: null,
        strings: [],
        activeStringId: null,
        nextStringId: 1,
        mapAlignment: DEFAULT_MAP_ALIGNMENT,
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
      // TODO(Stage 4): Add proper StringConfig[] → UIStringConfig[] bridge
      // This action is only dispatched by the full engine in Stage 4.
      // For now, cast to satisfy the type system.
      return {
        ...state,
        strings: action.strings as unknown as UIStringConfig[],
        inverters: action.inverters,
      };
    case 'SET_RESULT':
      return { ...state, result: action.result };
    case 'SET_SHADE_POINT_IDS':
      return { ...state, panelShadeMap: action.panelShadeMap };
    case 'SET_ADDRESS':
      return {
        ...state,
        siteAddress: action.address,
        siteFormattedAddress: action.formattedAddress,
        siteLatLng: { lat: action.lat, lng: action.lng },
      };
    case 'SET_MAP_ALIGNMENT':
      return { ...state, mapAlignment: { ...state.mapAlignment, ...action.alignment } };
    case 'SET_ACTIVE_STRING':
      return { ...state, activeStringId: action.stringId };
    case 'ASSIGN_PANEL': {
      if (state.activeStringId === null) return state;
      // Remove panel from any existing string first
      const cleaned = state.strings.map(s => ({
        ...s,
        panelIds: s.panelIds.filter(id => id !== action.panelId),
      }));
      // Add to active string
      return {
        ...state,
        strings: cleaned.map(s =>
          s.id === state.activeStringId
            ? { ...s, panelIds: [...s.panelIds, action.panelId] }
            : s
        ),
      };
    }
    case 'UNASSIGN_PANEL':
      return {
        ...state,
        strings: state.strings.map(s => ({
          ...s,
          panelIds: s.panelIds.filter(id => id !== action.panelId),
        })),
      };
    case 'CREATE_STRING': {
      const newString = { id: state.nextStringId, panelIds: [] as string[] };
      return {
        ...state,
        strings: [...state.strings, newString],
        activeStringId: state.nextStringId,
        nextStringId: state.nextStringId + 1,
      };
    }
    case 'DELETE_STRING':
      return {
        ...state,
        strings: state.strings.filter(s => s.id !== action.stringId),
        activeStringId: state.activeStringId === action.stringId ? null : state.activeStringId,
      };
    case 'AUTO_STRING': {
      const manualPanelIds = new Set(state.strings.flatMap(s => s.panelIds));
      let currentId = state.nextStringId;
      const newStrings = action.strings
        .map(es => ({
          panelIds: es.panels.map(i => action.panels[i].id).filter(id => !manualPanelIds.has(id)),
        }))
        .filter(s => s.panelIds.length > 0)
        .map(s => ({ id: currentId++, panelIds: s.panelIds }));
      return {
        ...state,
        strings: [...state.strings, ...newStrings],
        nextStringId: currentId,
      };
    }
    case 'RESET':
      return INITIAL_STATE;
    default:
      return state;
  }
}

const ENABLED_TABS: SolarDesignerTab[] = ['visualizer', 'stringing'];

export default function SolarDesignerPage() {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  // Run shade association after panels + radiance points are loaded
  useEffect(() => {
    if (state.panels.length > 0 && state.radiancePoints.length > 0) {
      const map = associateShadePoints(state.panels, state.radiancePoints);
      dispatch({ type: 'SET_SHADE_POINT_IDS', panelShadeMap: map });
    }
  }, [state.panels, state.radiancePoints]);

  const handleTabChange = (tab: SolarDesignerTab) => {
    dispatch({ type: 'SET_TAB', tab });
  };

  return (
    <DashboardShell title="Solar Designer" accentColor="orange" fullWidth>
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Left sidebar: Upload + Equipment + Site Conditions */}
        <aside className="w-full lg:w-80 lg:shrink-0 space-y-4">
          <FileUploadPanel uploadedFiles={state.uploadedFiles} panelCount={state.panels.length}
            radiancePointCount={state.radiancePoints.length} isUploading={state.isUploading}
            uploadError={state.uploadError} dispatch={dispatch} />

          <AddressInput dispatch={dispatch} formattedAddress={state.siteFormattedAddress} />

          <EquipmentPanel panelKey={state.panelKey} inverterKey={state.inverterKey}
            selectedPanel={state.selectedPanel} selectedInverter={state.selectedInverter} dispatch={dispatch} />

          <SiteConditionsPanel siteConditions={state.siteConditions} lossProfile={state.lossProfile} dispatch={dispatch} />

          <SystemSummaryBar panelCount={state.panels.length} selectedPanel={state.selectedPanel}
            selectedInverter={state.selectedInverter} stringCount={state.strings.length} />
        </aside>

        {/* Main content: Tabs */}
        <main className="flex-1 min-w-0">
          <TabBar
            activeTab={state.activeTab}
            onTabChange={handleTabChange}
            enabledTabs={ENABLED_TABS}
          />
          <div className="mt-4">
            {state.activeTab === 'visualizer' && <VisualizerTab state={state} dispatch={dispatch} />}
            {state.activeTab === 'stringing' && <StringingTab state={state} dispatch={dispatch} />}
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
