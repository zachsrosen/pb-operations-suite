'use client';

import { useMemo, useState } from 'react';
import type { CoreSolarDesignerResult } from '@/lib/solar/v12-engine';
import { aggregateTimeseries, sumTimeseries } from '@/lib/solar/v12-engine';
import type { AggregationPeriod } from '@/lib/solar/v12-engine/timeseries';
import type { UIStringConfig } from './types';
import TimeseriesChart from './TimeseriesChart';

interface TimeseriesTabProps {
  result: CoreSolarDesignerResult | null;
  strings: UIStringConfig[];
}

const PERIODS: AggregationPeriod[] = ['day', 'week', 'month', 'year'];
const PERIOD_LABELS: Record<AggregationPeriod, string> = {
  day: 'Day', week: 'Week', month: 'Month', year: 'Year',
};

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_START_DAYS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

/** Convert day-of-year (0-364) to "Month Day" label */
function dayLabel(dayIndex: number): string {
  let m = 0;
  for (let i = 11; i >= 0; i--) {
    if (dayIndex >= MONTH_START_DAYS[i]) { m = i; break; }
  }
  const dayOfMonth = dayIndex - MONTH_START_DAYS[m] + 1;
  return `${MONTH_NAMES[m]} ${dayOfMonth}`;
}

export default function TimeseriesTab({ result, strings }: TimeseriesTabProps) {
  const [period, setPeriod] = useState<AggregationPeriod>('year');
  const [startDay, setStartDay] = useState(0);
  const [selectedString, setSelectedString] = useState<number | null>(null); // null = system total

  // Compute aggregated views
  const chartData = useMemo(() => {
    if (!result) return null;

    const indSeries = selectedString === null
      ? sumTimeseries(result.independentTimeseries)
      : null; // No Model A for individual strings
    const strSeries = selectedString === null
      ? sumTimeseries(result.stringTimeseries)
      : result.stringTimeseries[selectedString] ?? null;

    if (!indSeries && !strSeries) return null;

    const sd = period === 'year' ? 0 : startDay;
    const modelA = indSeries ? aggregateTimeseries(indSeries, period, sd) : null;
    const modelB = strSeries ? aggregateTimeseries(strSeries, period, sd) : null;

    return { modelA, modelB };
  }, [result, period, startDay, selectedString]);

  // Date navigator bounds
  const navLabel = period === 'day'
    ? dayLabel(startDay)
    : period === 'week'
      ? `Week ${Math.floor(startDay / 7) + 1}`
      : period === 'month'
        ? MONTH_NAMES[MONTH_START_DAYS.findLastIndex(d => startDay >= d)]
        : '';

  const navigate = (delta: number) => {
    if (period === 'day') {
      setStartDay(d => Math.max(0, Math.min(364, d + delta)));
    } else if (period === 'week') {
      setStartDay(d => {
        const week = Math.floor(d / 7) + delta;
        return Math.max(0, Math.min(51, week)) * 7;
      });
    } else if (period === 'month') {
      setStartDay(d => {
        const m = MONTH_START_DAYS.indexOf(d) !== -1 ? MONTH_START_DAYS.indexOf(d) : 0;
        const idx = Math.max(0, Math.min(11, m + delta));
        return MONTH_START_DAYS[idx];
      });
    }
  };

  if (!result) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <p className="text-muted text-sm">Run analysis to see timeseries data</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Period Toggle */}
      <div className="flex gap-1 bg-surface rounded-lg p-1 w-fit">
        {PERIODS.map(p => (
          <button
            key={p}
            onClick={() => { setPeriod(p); setStartDay(0); }}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              p === period
                ? 'bg-orange-500 text-white'
                : 'text-muted hover:text-foreground hover:bg-surface-2'
            }`}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>

      {/* Date Navigator */}
      {period !== 'year' && (
        <div data-testid="date-nav" className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            disabled={startDay <= 0}
            className="px-2 py-1 text-sm text-muted hover:text-foreground disabled:opacity-30"
          >
            ←
          </button>
          <span className="text-sm font-medium min-w-[120px] text-center">{navLabel}</span>
          <button
            onClick={() => navigate(1)}
            disabled={
              period === 'day' ? startDay >= 364 :
              period === 'week' ? startDay >= 51 * 7 :
              MONTH_START_DAYS.indexOf(startDay) >= 11
            }
            className="px-2 py-1 text-sm text-muted hover:text-foreground disabled:opacity-30"
          >
            →
          </button>
        </div>
      )}

      {/* Chart */}
      {chartData && (
        <TimeseriesChart
          modelA={chartData.modelA ?? chartData.modelB!}
          modelB={chartData.modelA ? chartData.modelB ?? undefined : undefined}
        />
      )}

      {/* String Selector */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-muted">View:</label>
        <select
          value={selectedString === null ? 'total' : String(selectedString)}
          onChange={e => setSelectedString(e.target.value === 'total' ? null : Number(e.target.value))}
          className="bg-surface border border-border rounded-md px-2 py-1 text-sm text-foreground"
        >
          <option value="total">System Total</option>
          {strings.map((s, i) => (
            <option key={s.id} value={String(i)}>
              String {s.id} ({s.panelIds.length} panels)
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
