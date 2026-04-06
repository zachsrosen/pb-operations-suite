'use client';

import { useState, useCallback, useMemo } from 'react';
import PanelCanvas from './PanelCanvas';
import ShadeSlider from './ShadeSlider';
import MapAlignmentControls from './MapAlignmentControls';
import type { RadiancePoint } from '@/lib/solar/v12-engine';
import type { SolarDesignerState, SolarDesignerAction, MapAlignment } from './types';

interface VisualizerTabProps {
  state: SolarDesignerState;
  dispatch: (action: SolarDesignerAction) => void;
}

type VisualizerMode = 'shade' | 'tsrf';

/** Compute average TSRF per panel from associated radiance points */
function computePanelTsrfMap(
  panelShadeMap: Record<string, string[]>,
  radiancePoints: RadiancePoint[]
): Record<string, number> {
  if (radiancePoints.length === 0) return {};
  const pointMap = new Map(radiancePoints.map(rp => [rp.id, rp.tsrf]));
  const result: Record<string, number> = {};
  for (const [panelId, pointIds] of Object.entries(panelShadeMap)) {
    const tsrfs = pointIds.map(id => pointMap.get(id)).filter((t): t is number => t != null);
    if (tsrfs.length > 0) {
      result[panelId] = tsrfs.reduce((a, b) => a + b, 0) / tsrfs.length;
    }
  }
  return result;
}

// Default timestep matching ShadeSlider defaults: Jun 21, 2:00 PM
const DEFAULT_TIMESTEP = (172 - 1) * 48 + 28; // 8236

/** Derive day + time from timestep for legend display */
function formatTimestepLabel(timestep: number): string {
  const day = Math.floor(timestep / 48) + 1;
  const timeSlot = timestep % 48;
  const date = new Date(2025, 0, day);
  const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const hours = Math.floor(timeSlot / 2);
  const minutes = (timeSlot % 2) * 30;
  const time = new Date(2025, 0, 1, hours, minutes);
  const timeStr = time.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${dateStr} ${timeStr}`;
}

export default function VisualizerTab({ state, dispatch }: VisualizerTabProps) {
  const [mode, setMode] = useState<VisualizerMode>('shade');
  const [timestep, setTimestep] = useState<number>(DEFAULT_TIMESTEP);

  const handleTimestepChange = useCallback((ts: number) => {
    setTimestep(ts);
  }, []);

  const handleAlignmentChange = useCallback((partial: Partial<MapAlignment>) => {
    dispatch({ type: 'SET_MAP_ALIGNMENT', alignment: partial });
  }, [dispatch]);

  // Build satellite tile URL from geocoded coordinates
  const satelliteUrl = useMemo(() => {
    if (!state.siteLatLng) return undefined;
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_STATIC_KEY;
    if (!key) return undefined;
    const { lat, lng } = state.siteLatLng;
    return `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=20&size=640x640&maptype=satellite&key=${key}`;
  }, [state.siteLatLng]);

  // Pre-compute TSRF map for heatmap mode
  const panelTsrfMap = useMemo(
    () => computePanelTsrfMap(state.panelShadeMap, state.radiancePoints),
    [state.panelShadeMap, state.radiancePoints]
  );

  // Count shaded panels at current timestep (for legend)
  const shadedCount = useMemo(() => {
    if (mode !== 'shade') return 0;
    let count = 0;
    for (const panel of state.panels) {
      const pointIds = state.panelShadeMap[panel.id];
      if (!pointIds || pointIds.length === 0) continue;
      let shadedPoints = 0;
      for (const pid of pointIds) {
        const seq = state.shadeData[pid];
        if (seq && seq[timestep] === '1') shadedPoints++;
      }
      if (shadedPoints / pointIds.length > 0.5) count++;
    }
    return count;
  }, [state.panels, state.panelShadeMap, state.shadeData, timestep, mode]);

  return (
    <div className="space-y-3">
      {/* Controls bar */}
      {state.panels.length > 0 && (
        <div className="flex items-center gap-4 flex-wrap p-3 rounded-xl bg-surface">
          {mode === 'shade' && (
            <ShadeSlider onTimestepChange={handleTimestepChange} />
          )}
          <div className="ml-auto flex gap-2">
            <button
              onClick={() => setMode('shade')}
              className={`px-3 py-1 text-xs font-semibold rounded transition-colors ${
                mode === 'shade'
                  ? 'bg-orange-500 text-white'
                  : 'bg-surface-2 text-muted hover:text-foreground'
              }`}
            >
              Shade
            </button>
            <button
              onClick={() => setMode('tsrf')}
              className={`px-3 py-1 text-xs font-semibold rounded transition-colors ${
                mode === 'tsrf'
                  ? 'bg-orange-500 text-white'
                  : 'bg-surface-2 text-muted hover:text-foreground'
              }`}
            >
              TSRF
            </button>
          </div>
        </div>
      )}

      {/* Map alignment controls (only when satellite image available) */}
      {satelliteUrl && state.panels.length > 0 && (
        <div className="p-3 rounded-xl bg-surface">
          <MapAlignmentControls
            alignment={state.mapAlignment}
            onChange={handleAlignmentChange}
          />
        </div>
      )}

      {/* Canvas */}
      <PanelCanvas
        panels={state.panels}
        panelShadeMap={state.panelShadeMap}
        shadeData={state.shadeData}
        strings={state.strings}
        timestep={mode === 'shade' ? timestep : null}
        renderMode={mode}
        activeStringId={null}
        panelTsrfMap={panelTsrfMap}
        backgroundImageUrl={satelliteUrl}
        mapAlignment={state.mapAlignment}
      />

      {/* Legend bar */}
      {state.panels.length > 0 && (
        <div className="flex items-center gap-5 px-3 py-2 rounded-xl bg-surface text-xs">
          {mode === 'shade' && (
            <>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm bg-[#3b82f6]" />
                <span className="text-muted">Sun</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm bg-[#1e3a5f]" />
                <span className="text-muted">Shadow</span>
              </div>
            </>
          )}
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm border border-dashed border-[#666]" />
            <span className="text-muted">No data</span>
          </div>
          <span className="ml-auto text-muted">
            {state.panels.length} panels
            {mode === 'shade' && ` | ${shadedCount} in shadow | ${formatTimestepLabel(timestep)}`}
          </span>
        </div>
      )}
    </div>
  );
}
