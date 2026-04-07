'use client';

import { useCallback, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import type { SolarDesignerState, SolarDesignerAction } from './types';
import type { CoreSolarDesignerInput, EquipmentSelection } from '@/lib/solar/v12-engine';
import { autoAssignInverters, flattenInverterConfigs } from './inverter-bridge';
import { createAnalysisWorker } from './worker-factory';

export interface RunAnalysisHandle {
  run: () => void;
}

interface RunAnalysisButtonProps {
  state: SolarDesignerState;
  dispatch: (action: SolarDesignerAction) => void;
}

const RunAnalysisButton = forwardRef<RunAnalysisHandle, RunAnalysisButtonProps>(
  function RunAnalysisButton({ state, dispatch }, ref) {
  const workerRef = useRef<Worker | null>(null);

  // Clean up worker on unmount to prevent background leaks
  useEffect(() => {
    return () => { workerRef.current?.terminate(); };
  }, []);

  const assignedPanelCount = new Set(state.strings.flatMap(s => s.panelIds)).size;
  const allPanelsAssigned = assignedPanelCount === state.panels.length;

  const canRun =
    state.panels.length > 0 &&
    state.selectedPanel !== null &&
    state.selectedInverter !== null &&
    state.strings.length > 0 &&
    allPanelsAssigned;

  // Partial assignment message for tooltip
  const disabledReason = !state.panels.length
    ? 'Upload a layout to get started.'
    : !state.selectedPanel || !state.selectedInverter
      ? 'Select panel and inverter equipment.'
      : !state.strings.length
        ? 'Create at least one string.'
        : !allPanelsAssigned
          ? `${state.panels.length - assignedPanelCount} of ${state.panels.length} panels are unassigned. Assign all panels to strings before running analysis.`
          : undefined;

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

    // 5. Create worker via factory (injectable for testing)
    const worker = createAnalysisWorker();
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

  useImperativeHandle(ref, () => ({ run: handleRun }), [handleRun]);

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
        title={disabledReason}
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
});

export default RunAnalysisButton;
