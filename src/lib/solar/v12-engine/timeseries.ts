/**
 * Solar Designer V12 Engine — Timeseries Aggregation
 *
 * Aggregates a 17,520-element Float32Array (365 days × 48 half-hour steps)
 * into day/week/month/year views. Also provides element-wise sum for multi-
 * inverter or multi-panel timeseries combination.
 */
import { TIMESTEPS, SLOTS_PER_DAY, MONTH_START_DAY, MONTH_END_DAY, HALF_HOUR_FACTOR } from './constants';

export type AggregationPeriod = 'day' | 'week' | 'month' | 'year';

export interface TimeseriesView {
  values: number[];
  labels: string[];
  period: AggregationPeriod;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function aggregateTimeseries(
  series: Float32Array,
  period: AggregationPeriod,
  startDay: number
): TimeseriesView {
  switch (period) {
    case 'day': {
      // Extract 48 half-hourly values for the given day
      const start = startDay * SLOTS_PER_DAY;
      const values: number[] = [];
      const labels: string[] = [];
      for (let i = 0; i < SLOTS_PER_DAY; i++) {
        values.push(series[start + i] || 0);
        const hour = Math.floor(i / 2);
        const min = (i % 2) * 30;
        labels.push(`${hour}:${min.toString().padStart(2, '0')}`);
      }
      return { values, labels, period };
    }
    case 'week': {
      // Sum each day for 7 days starting from startDay
      const values: number[] = [];
      const labels: string[] = [];
      const dayNames = ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5', 'Day 6', 'Day 7'];
      for (let d = 0; d < 7; d++) {
        const dayIdx = startDay + d;
        if (dayIdx >= 365) break;
        let dayTotal = 0;
        const base = dayIdx * SLOTS_PER_DAY;
        for (let s = 0; s < SLOTS_PER_DAY; s++) {
          dayTotal += series[base + s] || 0;
        }
        values.push(dayTotal);
        labels.push(dayNames[d]);
      }
      return { values, labels, period };
    }
    case 'month': {
      // Sum each day in the month that startDay falls in
      let monthIdx = 0;
      for (let m = 11; m >= 0; m--) {
        if (startDay >= MONTH_START_DAY[m]) { monthIdx = m; break; }
      }
      const values: number[] = [];
      const labels: string[] = [];
      const daysInMonth = MONTH_END_DAY[monthIdx] - MONTH_START_DAY[monthIdx];
      for (let d = 0; d < daysInMonth; d++) {
        const dayIdx = MONTH_START_DAY[monthIdx] + d;
        let dayTotal = 0;
        const base = dayIdx * SLOTS_PER_DAY;
        for (let s = 0; s < SLOTS_PER_DAY; s++) {
          dayTotal += series[base + s] || 0;
        }
        values.push(dayTotal);
        labels.push(`${d + 1}`);
      }
      return { values, labels, period };
    }
    case 'year': {
      // Sum by month
      const values: number[] = [];
      for (let m = 0; m < 12; m++) {
        let monthTotal = 0;
        const startSlot = MONTH_START_DAY[m] * SLOTS_PER_DAY;
        const endSlot = MONTH_END_DAY[m] * SLOTS_PER_DAY;
        for (let t = startSlot; t < endSlot; t++) {
          monthTotal += series[t] || 0;
        }
        values.push(monthTotal);
      }
      return { values, labels: [...MONTH_NAMES], period };
    }
  }
}

/**
 * Convert a TimeseriesView's values from raw watt-half-hours to kWh.
 * For 'day' period: each value is a single timestep (watts × 0.5h / 1000).
 * For week/month: each value is a daily sum of timesteps → same conversion.
 * For year: each value is a monthly sum of timesteps → same conversion.
 */
export function viewToKwh(view: TimeseriesView): TimeseriesView {
  return {
    ...view,
    values: view.values.map(v => v / HALF_HOUR_FACTOR),
  };
}

export function sumTimeseries(seriesArray: Float32Array[]): Float32Array {
  const result = new Float32Array(TIMESTEPS);
  for (const series of seriesArray) {
    for (let t = 0; t < TIMESTEPS; t++) {
      result[t] += series[t];
    }
  }
  return result;
}
