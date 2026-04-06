/**
 * Solar Designer V12 Engine — CSV Shade Parser
 *
 * Parses shade CSV files into the ShadeTimeseries binary format.
 * CSV format: header row with point IDs, data rows with 0/1 shade values.
 * Encoding: '0' = sun, '1' = shade (matches spec).
 */
import { TIMESTEPS } from './constants';
import type { ShadeTimeseries, ShadeFidelity, ShadeSource } from './types';

export interface ShadeParseResult {
  data: ShadeTimeseries;
  fidelity: ShadeFidelity;
  source: ShadeSource;
  errors: string[];
}

export function parseShadeCSV(raw: string): ShadeParseResult {
  const errors: string[] = [];
  const data: ShadeTimeseries = {};

  if (!raw.trim()) {
    return { data, fidelity: 'full', source: 'manual', errors: ['Empty CSV'] };
  }

  const lines = raw.trim().split(/\r?\n/);
  if (lines.length < 2) {
    return { data, fidelity: 'full', source: 'manual', errors: ['CSV needs header + at least 1 data row'] };
  }

  const headers = lines[0].split(',').map(h => h.trim());
  const pointIds = headers.slice(1); // first column is timestep

  // Initialize builders
  const builders: Record<string, string[]> = {};
  for (const id of pointIds) {
    builders[id] = [];
  }

  // Parse data rows
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    for (let j = 0; j < pointIds.length; j++) {
      const val = (cols[j + 1] || '').trim();
      builders[pointIds[j]].push(val === '0' ? '0' : '1');
    }
  }

  // Build strings, pad to TIMESTEPS with '0' (unshaded — '0' = sun per spec)
  for (const id of pointIds) {
    const seq = builders[id].join('');
    data[id] = seq.padEnd(TIMESTEPS, '0');
  }

  return { data, fidelity: 'full', source: 'manual', errors };
}
