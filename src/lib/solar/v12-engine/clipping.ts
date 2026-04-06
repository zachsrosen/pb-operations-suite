/**
 * Solar Designer V12 Engine — Clipping Event Detection
 *
 * Scans a clipped-watts timeseries and extracts contiguous clipping events
 * with duration, peak clip, total clip energy, and human-readable date/time.
 * Ported from V12 dispatch logic.
 */
import type { ClippingEvent } from './types';
import { SLOTS_PER_DAY, MONTH_START_DAY } from './constants';

export interface ClippingDetectionInput {
  inverterId: number;
  inverterName: string;
  clippedTimeseries: Float32Array; // 17520 elements, watts clipped per step
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function timestepToDate(step: number): string {
  const day = Math.floor(step / SLOTS_PER_DAY);
  let month = 0;
  for (let m = 11; m >= 0; m--) {
    if (day >= MONTH_START_DAY[m]) { month = m; break; }
  }
  const dayOfMonth = day - MONTH_START_DAY[month] + 1;
  return `${MONTH_NAMES[month]} ${dayOfMonth}`;
}

function timestepToTime(step: number): string {
  const halfHour = step % SLOTS_PER_DAY;
  const hour = Math.floor(halfHour / 2);
  const min = (halfHour % 2) * 30;
  return `${hour}:${min.toString().padStart(2, '0')}`;
}

export function detectClippingEvents(input: ClippingDetectionInput): ClippingEvent[] {
  const { inverterId, inverterName, clippedTimeseries } = input;
  const events: ClippingEvent[] = [];

  let inEvent = false;
  let startStep = 0;
  let peakClipW = 0;
  let totalClipWh = 0;

  for (let t = 0; t < clippedTimeseries.length; t++) {
    const clipped = clippedTimeseries[t];
    if (clipped > 0) {
      if (!inEvent) {
        inEvent = true;
        startStep = t;
        peakClipW = 0;
        totalClipWh = 0;
      }
      peakClipW = Math.max(peakClipW, clipped);
      totalClipWh += clipped / 2; // 30 min = 0.5 hours
    } else if (inEvent) {
      // End of event
      const endStep = t - 1;
      events.push({
        inverterId,
        inverterName,
        startStep,
        endStep,
        durationMin: (endStep - startStep + 1) * 30,
        peakClipW,
        totalClipWh,
        date: timestepToDate(startStep),
        startTime: timestepToTime(startStep),
        endTime: timestepToTime(endStep + 1),
      });
      inEvent = false;
    }
  }

  // Handle event that extends to the end
  if (inEvent) {
    const endStep = clippedTimeseries.length - 1;
    events.push({
      inverterId, inverterName, startStep, endStep,
      durationMin: (endStep - startStep + 1) * 30,
      peakClipW, totalClipWh,
      date: timestepToDate(startStep),
      startTime: timestepToTime(startStep),
      endTime: timestepToTime(endStep + 1),
    });
  }

  return events;
}
