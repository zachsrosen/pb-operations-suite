'use client';

import type { PanelGeometry, ShadeTimeseries } from '@/lib/solar/v12-engine';
import type { UIStringConfig, MapAlignment } from './types';

// ── String Color Palette (12 colors) ──────────────────────────
const STRING_COLORS = [
  '#f97316', '#06b6d4', '#a78bfa', '#22c55e',
  '#f43f5e', '#eab308', '#ec4899', '#14b8a6',
  '#8b5cf6', '#f59e0b', '#10b981', '#6366f1',
];

interface PanelCanvasProps {
  panels: PanelGeometry[];
  panelShadeMap: Record<string, string[]>;
  shadeData: ShadeTimeseries;
  strings: UIStringConfig[];
  timestep: number | null;
  renderMode: 'shade' | 'tsrf' | 'strings';
  activeStringId: number | null;
  panelTsrfMap?: Record<string, number>;
  backgroundImageUrl?: string;
  mapAlignment?: MapAlignment;
  onPanelClick?: (panelId: string) => void;
  onPanelHover?: (panelId: string | null) => void;
}

const PADDING = 2;

/** Compute viewBox from panel bounding box, accounting for rotation */
function computeViewBox(panels: PanelGeometry[]) {
  if (panels.length === 0) return { x: 0, y: 0, w: 100, h: 80 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of panels) {
    const hw = p.width / 2;
    const hh = p.height / 2;
    const corners: [number, number][] = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
    const rad = (p.azimuth * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    for (const [cx, cy] of corners) {
      const rx = p.x + cx * cos - cy * sin;
      const ry = p.y + cx * sin + cy * cos;
      minX = Math.min(minX, rx);
      maxX = Math.max(maxX, rx);
      minY = Math.min(minY, ry);
      maxY = Math.max(maxY, ry);
    }
  }
  return {
    x: minX - PADDING,
    y: minY - PADDING,
    w: maxX - minX + PADDING * 2,
    h: maxY - minY + PADDING * 2,
  };
}

/** Build panelId → { stringIndex, stringId } reverse lookup */
function buildStringLookup(strings: UIStringConfig[]): Map<string, { index: number; id: number }> {
  const map = new Map<string, { index: number; id: number }>();
  strings.forEach((s, i) => {
    for (const pid of s.panelIds) {
      map.set(pid, { index: i, id: s.id });
    }
  });
  return map;
}

/** Get shade status for a panel at a timestep (proportion of shaded points) */
function getPanelShadeRatio(
  panelId: string,
  panelShadeMap: Record<string, string[]>,
  shadeData: ShadeTimeseries,
  timestep: number
): number | null {
  const pointIds = panelShadeMap[panelId];
  if (!pointIds || pointIds.length === 0) return null;
  let shadedCount = 0;
  for (const pid of pointIds) {
    const seq = shadeData[pid];
    if (seq && seq[timestep] === '1') shadedCount++;
  }
  return shadedCount / pointIds.length;
}

/** Get TSRF for a panel: uses pre-computed map, falls back to PanelGeometry.tsrf */
function getPanelTsrf(
  panelId: string,
  panelTsrfMap: Record<string, number> | undefined,
  panels: PanelGeometry[]
): number | null {
  if (panelTsrfMap?.[panelId] != null) return panelTsrfMap[panelId];
  const panel = panels.find(p => p.id === panelId);
  if (panel?.tsrf != null) return panel.tsrf;
  return null;
}

/** Map TSRF 0-1 to heatmap color (red → yellow → green) */
function tsrfToColor(tsrf: number): string {
  const clamped = Math.max(0, Math.min(1, tsrf));
  if (clamped < 0.5) {
    const t = clamped / 0.5;
    const r = 239;
    const g = Math.round(68 + t * 163);
    const b = 68;
    return `rgb(${r},${g},${b})`;
  } else {
    const t = (clamped - 0.5) / 0.5;
    const r = Math.round(239 - t * 205);
    const g = Math.round(231 - t * 34);
    const b = 68;
    return `rgb(${r},${g},${b})`;
  }
}

const DEFAULT_ALIGNMENT: MapAlignment = { offsetX: 0, offsetY: 0, rotation: 0, scale: 1 };

export default function PanelCanvas({
  panels,
  panelShadeMap,
  shadeData,
  strings,
  timestep,
  renderMode,
  activeStringId,
  panelTsrfMap,
  backgroundImageUrl,
  mapAlignment = DEFAULT_ALIGNMENT,
  onPanelClick,
  onPanelHover,
}: PanelCanvasProps) {
  if (panels.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[320px] rounded-xl border-2 border-dashed border-t-border bg-surface-2">
        <p className="text-sm text-muted">Upload a layout file to see panels</p>
      </div>
    );
  }

  const vb = computeViewBox(panels);
  const stringLookup = buildStringLookup(strings);

  return (
    <div className="relative rounded-xl overflow-hidden bg-[#1a1a2e]">
      <svg
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        className="w-full"
        style={{ minHeight: 320 }}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Background satellite image */}
        {backgroundImageUrl && (
          <g transform={`translate(${mapAlignment.offsetX}, ${mapAlignment.offsetY}) rotate(${mapAlignment.rotation}, ${vb.x + vb.w / 2}, ${vb.y + vb.h / 2}) scale(${mapAlignment.scale})`}>
            <image
              href={backgroundImageUrl}
              x={vb.x}
              y={vb.y}
              width={vb.w}
              height={vb.h}
              preserveAspectRatio="xMidYMid slice"
              opacity={0.6}
            />
          </g>
        )}

        {/* Panel rects */}
        {panels.map((panel) => {
          const sInfo = stringLookup.get(panel.id);
          let fill = 'none';
          let stroke = '#666';
          let strokeWidth = 1;
          let strokeDasharray: string | undefined = '4,2';
          let opacity = 1;
          let label: string | undefined;

          if (renderMode === 'shade') {
            const hasShadeData = (panelShadeMap[panel.id]?.length ?? 0) > 0;
            if (!hasShadeData) {
              fill = 'none';
              stroke = '#666';
              strokeDasharray = '4,2';
              label = 'no data';
            } else if (timestep !== null) {
              const ratio = getPanelShadeRatio(panel.id, panelShadeMap, shadeData, timestep);
              if (ratio !== null && ratio > 0.5) {
                fill = '#1e3a5f';
                stroke = '#2563eb';
                opacity = 0.7;
              } else {
                fill = '#3b82f6';
                stroke = '#60a5fa';
                opacity = 0.9;
              }
              strokeDasharray = undefined;
            } else {
              fill = '#3b82f6';
              stroke = '#60a5fa';
              opacity = 0.9;
              strokeDasharray = undefined;
            }
          } else if (renderMode === 'tsrf') {
            const tsrf = getPanelTsrf(panel.id, panelTsrfMap, panels);
            if (tsrf !== null) {
              fill = tsrfToColor(tsrf);
              stroke = tsrfToColor(Math.min(1, tsrf + 0.1));
              strokeDasharray = undefined;
              label = `${(tsrf * 100).toFixed(0)}%`;
            } else {
              fill = 'none';
              stroke = '#666';
              strokeDasharray = '4,2';
              label = 'N/A';
            }
          } else if (renderMode === 'strings') {
            if (sInfo) {
              const colorIdx = sInfo.index % STRING_COLORS.length;
              fill = STRING_COLORS[colorIdx];
              stroke = activeStringId === sInfo.id ? '#f97316' : STRING_COLORS[colorIdx];
              strokeWidth = activeStringId === sInfo.id ? 2 : 1;
              strokeDasharray = undefined;
              opacity = 0.85;
              label = `${sInfo.index + 1}`;
            } else {
              fill = 'none';
              stroke = '#666';
              strokeDasharray = '4,2';
            }
          }

          const hw = panel.width / 2;
          const hh = panel.height / 2;

          return (
            <g
              key={panel.id}
              transform={`translate(${panel.x}, ${panel.y}) rotate(${panel.azimuth})`}
              style={{ cursor: onPanelClick ? 'pointer' : 'default' }}
              onClick={() => onPanelClick?.(panel.id)}
              onMouseEnter={() => onPanelHover?.(panel.id)}
              onMouseLeave={() => onPanelHover?.(null)}
            >
              <rect
                data-panel-id={panel.id}
                x={-hw}
                y={-hh}
                width={panel.width}
                height={panel.height}
                rx={0.05}
                fill={fill}
                stroke={stroke}
                strokeWidth={strokeWidth * (vb.w / 500)}
                strokeDasharray={strokeDasharray}
                opacity={opacity}
              />
              {label && (
                <text
                  x={0}
                  y={0}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={panel.height * 0.25}
                  fill={renderMode === 'strings' ? '#fff' : '#999'}
                  fontWeight={600}
                  pointerEvents="none"
                >
                  {label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
