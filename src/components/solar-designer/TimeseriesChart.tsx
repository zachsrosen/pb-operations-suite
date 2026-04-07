'use client';

import { useMemo, useState } from 'react';
import type { TimeseriesView } from '@/lib/solar/v12-engine/timeseries';

interface TimeseriesChartProps {
  modelA: TimeseriesView;
  modelB?: TimeseriesView;
}

const H = 200;
const PAD = { top: 20, right: 16, bottom: 32, left: 56 };
const W = 600;
const INNER_W = W - PAD.left - PAD.right;
const INNER_H = H;

export default function TimeseriesChart({ modelA, modelB }: TimeseriesChartProps) {
  const [_hovered, setHovered] = useState<number | null>(null);
  const isYear = modelA.period === 'year';

  const maxVal = useMemo(() => {
    const allVals = [...modelA.values, ...(modelB?.values ?? [])];
    return Math.max(...allVals, 1);
  }, [modelA, modelB]);

  const yTicks = useMemo(() => {
    const step = Math.ceil(maxVal / 4 / (maxVal > 1000 ? 100 : 10)) * (maxVal > 1000 ? 100 : 10);
    const ticks: number[] = [];
    for (let v = 0; v <= maxVal; v += step) ticks.push(v);
    return ticks;
  }, [maxVal]);

  const unit = modelA.period === 'day' ? 'Wh' : 'kWh';

  // Area chart path builder
  const buildPath = (values: number[], close: boolean) => {
    const n = values.length;
    const points = values.map((v, i) => {
      const x = PAD.left + (i / (n - 1)) * INNER_W;
      const y = PAD.top + INNER_H - (v / maxVal) * INNER_H;
      return `${x},${y}`;
    });
    const line = `M${points.join(' L')}`;
    if (close) {
      const baseY = PAD.top + INNER_H;
      return `${line} L${PAD.left + INNER_W},${baseY} L${PAD.left},${baseY} Z`;
    }
    return line;
  };

  return (
    <div className="bg-surface rounded-lg border border-border p-4">
      <p className="text-xs text-muted mb-3">
        {isYear ? 'Annual' : modelA.period.charAt(0).toUpperCase() + modelA.period.slice(1)} Production ({unit})
      </p>
      <svg viewBox={`0 0 ${W} ${H + PAD.top + PAD.bottom}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        {/* Y gridlines */}
        {yTicks.map(tick => {
          const y = PAD.top + INNER_H - (tick / maxVal) * INNER_H;
          return (
            <g key={tick}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y}
                stroke="currentColor" strokeOpacity={0.1} strokeDasharray="4" />
              <text x={PAD.left - 8} y={y + 3} textAnchor="end" className="fill-muted" fontSize={10}>
                {tick.toLocaleString()}
              </text>
            </g>
          );
        })}

        {isYear ? (
          /* Area chart for year view */
          <>
            <path d={buildPath(modelA.values, true)} fill="rgba(249,115,22,0.2)" stroke="none" />
            <path d={buildPath(modelA.values, false)} fill="none" stroke="#f97316" strokeWidth={2} />
            {modelB && (
              <>
                <path d={buildPath(modelB.values, false)} fill="none"
                  stroke="#06b6d4" strokeWidth={2} strokeDasharray="6 3" />
              </>
            )}
            {/* X labels */}
            {modelA.labels.map((label, i) => {
              const x = PAD.left + (i / (modelA.values.length - 1)) * INNER_W;
              return (
                <text key={i} x={x} y={PAD.top + INNER_H + 16}
                  textAnchor="middle" className="fill-muted" fontSize={10}>{label}</text>
              );
            })}
          </>
        ) : (
          /* Bar chart for day/week/month */
          <>
            {modelA.values.map((aVal, i) => {
              const bVal = modelB?.values[i] ?? 0;
              const gw = INNER_W / modelA.values.length;
              const gx = PAD.left + i * gw;
              const barW = modelB ? gw * 0.35 : gw * 0.7;
              const aH = (aVal / maxVal) * INNER_H;
              const bH = (bVal / maxVal) * INNER_H;
              const baseY = PAD.top + INNER_H;
              return (
                <g key={i}
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <rect x={gx + gw * 0.1} y={baseY - aH} width={barW} height={aH}
                    rx={2} fill="rgba(249,115,22,0.7)" />
                  {modelB && (
                    <rect x={gx + gw * 0.1 + barW + 2} y={baseY - bH} width={barW} height={bH}
                      rx={2} fill="rgba(6,182,212,0.5)" />
                  )}
                  {/* X label — show every Nth to avoid overlap */}
                  {(modelA.values.length <= 12 || i % Math.ceil(modelA.values.length / 12) === 0) && (
                    <text x={gx + gw / 2} y={baseY + 16} textAnchor="middle"
                      className="fill-muted" fontSize={9}>{modelA.labels[i]}</text>
                  )}
                </g>
              );
            })}
          </>
        )}
      </svg>

      {/* Legend */}
      <div className="flex gap-4 mt-2 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-orange-500/70" />
          Independent (Model A)
        </span>
        {modelB && (
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-cyan-500/50" />
            String-level (Model B)
          </span>
        )}
      </div>
    </div>
  );
}
