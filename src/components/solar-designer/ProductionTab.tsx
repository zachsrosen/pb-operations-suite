'use client';

import { useMemo, useState } from 'react';
import type { CoreSolarDesignerResult, PanelGeometry } from '@/lib/solar/v12-engine';
import { aggregateTimeseries, sumTimeseries, HALF_HOUR_FACTOR } from '@/lib/solar/v12-engine';
import type { UIStringConfig } from './types';
import ProductionChart from './ProductionChart';

interface ProductionTabProps {
  result: CoreSolarDesignerResult | null;
  panels: PanelGeometry[];
  strings: UIStringConfig[];
}

/** Sum a Float32Array and convert W half-hours to kWh */
function timeseriesKwh(ts: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < ts.length; i++) sum += ts[i];
  return sum / HALF_HOUR_FACTOR;
}

type SortKey = 'panel' | 'tsrf' | 'independent' | 'string' | 'delta';

export default function ProductionTab({ result, panels, strings }: ProductionTabProps) {
  const [sortKey, setSortKey] = useState<SortKey>('delta');
  const [sortAsc, setSortAsc] = useState(false);

  // Aggregate timeseries for chart
  const chartData = useMemo(() => {
    if (!result) return null;
    const modelA = aggregateTimeseries(sumTimeseries(result.independentTimeseries), 'year', 0);
    const modelB = aggregateTimeseries(sumTimeseries(result.stringTimeseries), 'year', 0);
    return { modelA, modelB };
  }, [result]);

  // Build per-panel table rows
  const tableRows = useMemo(() => {
    if (!result) return [];
    // Build a lookup: panelIndex → stringIndex
    const panelToString = new Map<number, number>();
    strings.forEach((s, si) => {
      s.panelIds.forEach(pid => {
        const pi = panels.findIndex(p => p.id === pid);
        if (pi >= 0) panelToString.set(pi, si);
      });
    });

    return panels.map((panel, i) => {
      const tsrf = result.panelStats[i]?.tsrf ?? 0;
      const indKwh = result.independentTimeseries[i]
        ? timeseriesKwh(result.independentTimeseries[i])
        : 0;

      // String kWh: even share of string total
      const si = panelToString.get(i);
      let strKwh = 0;
      if (si !== undefined && result.stringTimeseries[si]) {
        const stringTotal = timeseriesKwh(result.stringTimeseries[si]);
        const panelsInString = strings[si]?.panelIds.length ?? 1;
        strKwh = stringTotal / panelsInString;
      }

      const delta = indKwh > 0 ? ((indKwh - strKwh) / indKwh) * 100 : 0;

      return { panelId: panel.id, tsrf, indKwh, strKwh, delta };
    });
  }, [result, panels, strings]);

  // Sort rows
  const sortedRows = useMemo(() => {
    const rows = [...tableRows];
    const dir = sortAsc ? 1 : -1;
    rows.sort((a, b) => {
      switch (sortKey) {
        case 'panel': return dir * a.panelId.localeCompare(b.panelId);
        case 'tsrf': return dir * (a.tsrf - b.tsrf);
        case 'independent': return dir * (a.indKwh - b.indKwh);
        case 'string': return dir * (a.strKwh - b.strKwh);
        case 'delta': return dir * (a.delta - b.delta);
        default: return 0;
      }
    });
    return rows;
  }, [tableRows, sortKey, sortAsc]);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(key === 'panel'); // panel asc by default, everything else desc
    }
  };

  if (!result) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <p className="text-muted text-sm">Run analysis to see production results</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard label="Annual Production" value={`${result.production.stringLevelAnnual.toLocaleString()} kWh`} accent="orange" />
        <MetricCard label="Specific Yield" value={`${result.specificYield.toLocaleString()} kWh/kWp`} accent="cyan" />
        <MetricCard label="Mismatch Loss" value={`${result.mismatchLossPct.toFixed(1)}%`} accent="red" />
        <MetricCard label="System TSRF" value={result.systemTsrf.toFixed(2)} accent="green" />
      </div>

      {/* Monthly Chart */}
      {chartData && <ProductionChart modelA={chartData.modelA} modelB={chartData.modelB} />}

      {/* Per-Panel Table */}
      <div className="bg-surface rounded-lg border border-border overflow-hidden">
        <div className="overflow-x-auto max-h-80 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 sticky top-0 z-10">
              <tr>
                {([
                  ['panel', 'Panel'],
                  ['tsrf', 'TSRF'],
                  ['independent', 'Independent (kWh)'],
                  ['string', 'String (kWh)'],
                  ['delta', '\u0394 Loss (%)'],
                ] as [SortKey, string][]).map(([key, label]) => (
                  <th
                    key={key}
                    onClick={() => handleSort(key)}
                    className="px-3 py-2 text-left text-xs text-muted font-medium cursor-pointer hover:text-foreground transition-colors"
                  >
                    {label} {sortKey === key && (sortAsc ? '↑' : '↓')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sortedRows.map(row => (
                <tr key={row.panelId} className="hover:bg-surface-2/50 transition-colors">
                  <td className="px-3 py-1.5 text-xs font-mono">{row.panelId}</td>
                  <td className="px-3 py-1.5 text-xs">{row.tsrf.toFixed(2)}</td>
                  <td className="px-3 py-1.5 text-xs">{row.indKwh.toFixed(0)}</td>
                  <td className="px-3 py-1.5 text-xs">{row.strKwh.toFixed(0)}</td>
                  <td className={`px-3 py-1.5 text-xs font-medium ${
                    row.delta > 2 ? 'text-red-400' : row.delta > 1 ? 'text-yellow-400' : 'text-foreground'
                  }`}>
                    {row.delta.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** Inline MetricCard — lightweight version for Production tab */
function MetricCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  const colors: Record<string, string> = {
    orange: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
    cyan: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
    red: 'bg-red-500/10 text-red-400 border-red-500/20',
    green: 'bg-green-500/10 text-green-400 border-green-500/20',
  };
  return (
    <div className={`rounded-lg border p-3 text-center ${colors[accent] ?? colors.orange}`}>
      <p className="text-[10px] uppercase tracking-wider text-muted mb-1">{label}</p>
      <p className="text-lg font-bold">{value}</p>
    </div>
  );
}
