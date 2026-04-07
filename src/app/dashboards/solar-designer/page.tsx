'use client';

import { Suspense, useReducer, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import DashboardShell from '@/components/DashboardShell';
import TabBar from '@/components/solar-designer/TabBar';
import PlaceholderTab from '@/components/solar-designer/PlaceholderTab';
import EquipmentPanel from '@/components/solar-designer/EquipmentPanel';
import SiteConditionsPanel from '@/components/solar-designer/SiteConditionsPanel';
import FileUploadPanel from '@/components/solar-designer/FileUploadPanel';
import SystemSummaryBar from '@/components/solar-designer/SystemSummaryBar';
import VisualizerTab from '@/components/solar-designer/VisualizerTab';
import StringingTab from '@/components/solar-designer/StringingTab';
import ProductionTab from '@/components/solar-designer/ProductionTab';
import TimeseriesTab from '@/components/solar-designer/TimeseriesTab';
import AddressInput from '@/components/solar-designer/AddressInput';
import RunAnalysisButton from '@/components/solar-designer/RunAnalysisButton';
import InvertersTab from '@/components/solar-designer/InvertersTab';
import { DEFAULT_SITE_CONDITIONS, DEFAULT_LOSS_PROFILE, associateShadePoints } from '@/lib/solar/v12-engine';
import type { SolarDesignerState, SolarDesignerAction, SolarDesignerTab, UIStringConfig, UIInverterConfig } from '@/components/solar-designer/types';
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
  isAnalyzing: false,
  analysisProgress: null,
  analysisError: null,
  resultStale: false,
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
      return { ...state, panelKey: action.key, selectedPanel: action.panel, ...(state.result ? { resultStale: true } : {}) };
    case 'SET_INVERTER':
      return { ...state, inverterKey: action.key, selectedInverter: action.inverter, ...(state.result ? { resultStale: true } : {}) };
    case 'SET_SITE_CONDITIONS':
      return {
        ...state,
        siteConditions: { ...state.siteConditions, ...action.conditions },
        ...(state.result ? { resultStale: true } : {}),
      };
    case 'SET_LOSS_PROFILE':
      return {
        ...state,
        lossProfile: { ...state.lossProfile, ...action.profile },
        ...(state.result ? { resultStale: true } : {}),
      };
    case 'SET_STRINGS':
      // TODO(Stage 4): Add proper StringConfig[] → UIStringConfig[] bridge
      // This action is only dispatched by the full engine in Stage 4.
      // For now, cast to satisfy the type system.
      return {
        ...state,
        strings: action.strings as unknown as UIStringConfig[],
        inverters: action.inverters as unknown as UIInverterConfig[],
        ...(state.result ? { resultStale: true } : {}),
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
        ...(state.result ? { resultStale: true } : {}),
      };
    }
    case 'UNASSIGN_PANEL':
      return {
        ...state,
        strings: state.strings.map(s => ({
          ...s,
          panelIds: s.panelIds.filter(id => id !== action.panelId),
        })),
        ...(state.result ? { resultStale: true } : {}),
      };
    case 'CREATE_STRING': {
      const newString = { id: state.nextStringId, panelIds: [] as string[] };
      return {
        ...state,
        strings: [...state.strings, newString],
        activeStringId: state.nextStringId,
        nextStringId: state.nextStringId + 1,
        ...(state.result ? { resultStale: true } : {}),
      };
    }
    case 'DELETE_STRING':
      return {
        ...state,
        strings: state.strings.filter(s => s.id !== action.stringId),
        activeStringId: state.activeStringId === action.stringId ? null : state.activeStringId,
        ...(state.result ? { resultStale: true } : {}),
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
        ...(state.result ? { resultStale: true } : {}),
      };
    }
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
    case 'RESET':
      return INITIAL_STATE;
    default:
      return state;
  }
}

const SUITE_BREADCRUMBS: Record<string, { label: string; href: string }> = {
  de: { label: 'D&E', href: '/suites/design-engineering' },
  service: { label: 'Service', href: '/suites/service' },
};

export default function SolarDesignerPage() {
  return (
    <Suspense>
      <SolarDesignerInner />
    </Suspense>
  );
}

function SolarDesignerInner() {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const runAnalysisRef = useRef<import('@/components/solar-designer/RunAnalysisButton').RunAnalysisHandle>(null);
  const searchParams = useSearchParams();

  // Breadcrumb points back to whichever suite the user came from
  const breadcrumbs = useMemo(() => {
    const from = searchParams.get('suite');
    const parent = from ? SUITE_BREADCRUMBS[from] : null;
    return parent ? [parent] : undefined;
  }, [searchParams]);

  const enabledTabs = useMemo<SolarDesignerTab[]>(() => {
    const base: SolarDesignerTab[] = ['visualizer', 'stringing'];
    if (state.result) {
      return [...base, 'production', 'timeseries', 'inverters'];
    }
    return base;
  }, [state.result]);

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
    <DashboardShell title="Solar Designer" accentColor="orange" fullWidth breadcrumbs={breadcrumbs}>
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

          <RunAnalysisButton ref={runAnalysisRef} state={state} dispatch={dispatch} />
        </aside>

        {/* Main content: Tabs */}
        <main className="flex-1 min-w-0">
          <TabBar
            activeTab={state.activeTab}
            onTabChange={handleTabChange}
            enabledTabs={enabledTabs}
          />
          <div className="mt-4">
            {state.activeTab === 'visualizer' && <VisualizerTab state={state} dispatch={dispatch} />}
            {state.activeTab === 'stringing' && <StringingTab state={state} dispatch={dispatch} />}
            {state.activeTab === 'production' && (
              <ProductionTab result={state.result} panels={state.panels} strings={state.strings} />
            )}
            {state.activeTab === 'timeseries' && (
              <TimeseriesTab result={state.result} strings={state.strings} />
            )}
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
            {state.activeTab === 'battery' && <PlaceholderTab tabName="Battery" targetStage={5} />}
            {state.activeTab === 'ai' && <PlaceholderTab tabName="AI Analysis" targetStage={5} />}
            {state.activeTab === 'scenarios' && <PlaceholderTab tabName="Scenarios" targetStage={5} />}
          </div>
        </main>
      </div>
    </DashboardShell>
  );
}
