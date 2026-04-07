'use client';

import { useCallback, useMemo } from 'react';
import PanelCanvas from './PanelCanvas';
import StringList from './StringList';
import { autoString } from '@/lib/solar/v12-engine';
import type { PanelStat } from '@/lib/solar/v12-engine';
import type { SolarDesignerState, SolarDesignerAction } from './types';

interface StringingTabProps {
  state: SolarDesignerState;
  dispatch: (action: SolarDesignerAction) => void;
}

/** Bridge: PanelGeometry[] → PanelStat[] for autoString() */
function panelGeometryToPanelStats(
  panels: SolarDesignerState['panels'],
  panelShadeMap: Record<string, string[]>,
  panelKey: string
): PanelStat[] {
  return panels.map((pg, i) => ({
    id: i,
    tsrf: pg.tsrf ?? 0.85,
    points: panelShadeMap[pg.id] ?? [],
    panelKey,
    bifacialGain: 1.0,
  }));
}

export default function StringingTab({ state, dispatch }: StringingTabProps) {
  const { panels, selectedPanel, selectedInverter, panelKey, panelShadeMap, siteConditions } = state;
  const canAutoString = selectedPanel !== null && selectedInverter !== null;

  // ALL hooks must be called before any conditional returns
  const satelliteUrl = useMemo(() => {
    if (!state.siteLatLng) return undefined;
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_STATIC_KEY;
    if (!key) return undefined;
    const { lat, lng } = state.siteLatLng;
    return `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=20&size=640x640&maptype=satellite&key=${key}`;
  }, [state.siteLatLng]);

  const handlePanelClick = useCallback((panelId: string) => {
    if (state.activeStringId === null) return;
    // Check if panel belongs to active string → unassign. Otherwise → assign.
    const activeString = state.strings.find(s => s.id === state.activeStringId);
    if (activeString?.panelIds.includes(panelId)) {
      dispatch({ type: 'UNASSIGN_PANEL', panelId });
    } else {
      dispatch({ type: 'ASSIGN_PANEL', panelId });
    }
  }, [state.activeStringId, state.strings, dispatch]);

  const handleAutoString = useCallback(() => {
    if (!selectedPanel || !selectedInverter) return;
    const panelStats = panelGeometryToPanelStats(panels, panelShadeMap, panelKey);
    // Filter to only unassigned panels for auto-stringer
    const assignedIds = new Set(state.strings.flatMap(s => s.panelIds));
    const unassignedStats = panelStats.filter((_, i) => !assignedIds.has(panels[i].id));
    if (unassignedStats.length === 0) return;

    // Re-index for autoString (it expects contiguous 0..N-1)
    const reindexed = unassignedStats.map((ps, i) => ({ ...ps, id: i }));
    const result = autoString({
      panels: reindexed,
      panel: selectedPanel,
      inverter: selectedInverter,
      tempMin: siteConditions.tempMin,
    });

    // Map reindexed results back to original panel indices
    const unassignedPanels = panels.filter(p => !assignedIds.has(p.id));
    const remappedStrings = result.strings.map(s => ({
      panels: s.panels.map(i => panels.indexOf(unassignedPanels[i])),
    }));

    dispatch({ type: 'AUTO_STRING', strings: remappedStrings, panels });
  }, [selectedPanel, selectedInverter, panels, panelShadeMap, panelKey, state.strings, siteConditions.tempMin, dispatch]);

  // Empty state — AFTER hooks
  if (panels.length === 0) {
    return (
      <PanelCanvas
        panels={[]}
        panelShadeMap={{}}
        shadeData={{}}
        strings={[]}
        timestep={null}
        renderMode="strings"
        activeStringId={null}
      />
    );
  }

  return (
    <div className="flex gap-4">
      {/* Left: StringList sidebar */}
      <StringList
        strings={state.strings}
        activeStringId={state.activeStringId}
        totalPanelCount={panels.length}
        selectedPanel={selectedPanel}
        selectedInverter={selectedInverter}
        tempMin={siteConditions.tempMin}
        tempMax={siteConditions.tempMax}
        dispatch={dispatch}
      />

      {/* Right: Canvas + Auto button */}
      <div className="flex-1 min-w-0 space-y-3">
        <div className="flex items-center gap-3">
          <button
            aria-label="Auto-string"
            onClick={handleAutoString}
            disabled={!canAutoString}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Auto
          </button>
          {!canAutoString && (
            <span className="text-xs text-muted">Select panel + inverter to auto-string</span>
          )}
        </div>

        {/* Canvas */}
        <PanelCanvas
          panels={panels}
          panelShadeMap={panelShadeMap}
          shadeData={state.shadeData}
          strings={state.strings}
          timestep={null}
          renderMode="strings"
          activeStringId={state.activeStringId}
          backgroundImageUrl={satelliteUrl}
          mapAlignment={state.mapAlignment}
          onPanelClick={handlePanelClick}
        />
      </div>
    </div>
  );
}
