'use client';

import { useMemo, useState } from 'react';
import type { TimeseriesView } from '@/lib/solar/v12-engine/timeseries';

interface ProductionChartProps {
  modelA: TimeseriesView;
  modelB: TimeseriesView;
}

const CHART_HEIGHT = 200;
const CHART_PADDING = { top: 20, right: 16, bottom: 40, left: 56 };

export default function ProductionChart({ modelA, modelB }: ProductionChartProps) {
  const [hoveredMonth, setHoveredMonth] = useState<number | null>(null);

  const maxVal = useMemo(() => {
    return Math.max(...modelA.values, ...modelB.values, 1);
  }, [modelA, modelB]);

  const barCount = modelA.values.length;

  // Y-axis ticks
  const yTicks = useMemo(() => {
    const step = Math.ceil(maxVal / 4 / 100) * 100;
    const ticks: number[] = [];
    for (let v = 0; v <= maxVal; v += step) ticks.push(v);
    return ticks;
  }, [maxVal]);

  return (
    <div className="bg-surface rounded-lg border border-border p-4">
      <p className="text-xs text-muted mb-3">Monthly Production (kWh)</p>
      <svg
        viewBox={`0 0 600 ${CHART_HEIGHT + CHART_PADDING.top + CHART_PADDING.bottom}`}
        className="w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Y-axis gridlines + labels */}
        {yTicks.map(tick => {
          const y = CHART_PADDING.top + CHART_HEIGHT - (tick / maxVal) * CHART_HEIGHT;
          return (
            <g key={tick}>
              <line
                x1={CHART_PADDING.left} x2={600 - CHART_PADDING.right}
                y1={y} y2={y}
                stroke="currentColor" strokeOpacity={0.1} strokeDasharray="4"
              />
              <text x={CHART_PADDING.left - 8} y={y + 3} textAnchor="end"
                className="fill-muted" fontSize={10}>{tick.toLocaleString()}</text>
            </g>
          );
        })}

        {/* Bars */}
        {modelA.values.map((aVal, i) => {
          const bVal = modelB.values[i] ?? 0;
          const groupWidth = (600 - CHART_PADDING.left - CHART_PADDING.right) / barCount;
          const barWidth = groupWidth * 0.35;
          const gx = CHART_PADDING.left + i * groupWidth;
          const aHeight = (aVal / maxVal) * CHART_HEIGHT;
          const bHeight = (bVal / maxVal) * CHART_HEIGHT;
          const baseY = CHART_PADDING.top + CHART_HEIGHT;

          return (
            <g
              key={i}
              onMouseEnter={() => setHoveredMonth(i)}
              onMouseLeave={() => setHoveredMonth(null)}
            >
              {/* Model A bar (orange) */}
              <rect
                x={gx + groupWidth * 0.1}
                y={baseY - aHeight}
                width={barWidth}
                height={aHeight}
                rx={2}
                fill="rgba(249, 115, 22, 0.7)"
              />
              {/* Model B bar (cyan) */}
              <rect
                x={gx + groupWidth * 0.1 + barWidth + 2}
                y={baseY - bHeight}
                width={barWidth}
                height={bHeight}
                rx={2}
                fill="rgba(6, 182, 212, 0.5)"
              />
              {/* X-axis label */}
              <text
                x={gx + groupWidth / 2}
                y={baseY + 16}
                textAnchor="middle"
                className="fill-muted"
                fontSize={10}
              >
                {modelA.labels[i]}
              </text>
              {/* Hover overlay */}
              {hoveredMonth === i && (
                <rect
                  x={gx} y={CHART_PADDING.top}
                  width={groupWidth} height={CHART_HEIGHT}
                  fill="currentColor" fillOpacity={0.05}
                />
              )}
            </g>
          );
        })}

        {/* Tooltip */}
        {hoveredMonth !== null && (() => {
          const delta = modelA.values[hoveredMonth] - modelB.values[hoveredMonth];
          return (
            <g>
              <rect
                x={250} y={2} width={120} height={58} rx={4}
                className="fill-surface-elevated" stroke="currentColor" strokeOpacity={0.2}
              />
              <text x={255} y={16} fontSize={10} className="fill-foreground" fontWeight="bold">
                {modelA.labels[hoveredMonth]}
              </text>
              <text x={255} y={28} fontSize={9} fill="#f97316">
                A: {modelA.values[hoveredMonth].toLocaleString()} kWh
              </text>
              <text x={255} y={40} fontSize={9} fill="#06b6d4">
                B: {modelB.values[hoveredMonth].toLocaleString()} kWh
              </text>
              <text x={255} y={52} fontSize={9} className="fill-muted">
                Δ: {delta.toLocaleString()} kWh
              </text>
            </g>
          );
        })()}
      </svg>

      {/* Legend */}
      <div className="flex gap-4 mt-2 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-orange-500/70" />
          Independent (Model A)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-cyan-500/50" />
          String-level (Model B)
        </span>
      </div>
    </div>
  );
}
