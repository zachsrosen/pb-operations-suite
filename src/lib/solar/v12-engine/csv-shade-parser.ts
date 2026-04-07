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

/**
 * Parse a shade CSV file. Supports two formats:
 *
 * 1. **Combined CSV** — header row with point IDs, data rows with 0/1 values:
 *    ```
 *    timestep,IP2577,IP2484,...
 *    0,0,1,...
 *    1,0,0,...
 *    ```
 *
 * 2. **Per-panel CSV** — individual file per irradiance point (from V12 shade
 *    export). The file contains a single column of 0/1 values (one per timestep)
 *    or a single row of a binary shade string. Point ID is derived from the
 *    filename via the `pointId` parameter.
 *
 * @param raw  The raw CSV text.
 * @param pointId  Optional point ID for per-panel format (derived from filename).
 */
export function parseShadeCSV(raw: string, pointId?: string): ShadeParseResult {
  const errors: string[] = [];
  const data: ShadeTimeseries = {};

  if (!raw.trim()) {
    return { data, fidelity: 'full', source: 'manual', errors: ['Empty CSV'] };
  }

  const lines = raw.trim().split(/\r?\n/);

  // ── Per-panel format (1 line = binary shade string) ────────
  if (lines.length === 1) {
    const line = lines[0].trim();
    // Single line of 0/1 chars — the shade binary string itself
    if (/^[01]+$/.test(line) && pointId) {
      data[pointId] = line.padEnd(TIMESTEPS, '0');
      return { data, fidelity: 'full', source: 'manual', errors };
    }
    // Single row of comma-separated 0/1 values
    if (line.includes(',') && pointId) {
      const vals = line.split(',').map(v => v.trim() === '0' ? '0' : '1');
      data[pointId] = vals.join('').padEnd(TIMESTEPS, '0');
      return { data, fidelity: 'full', source: 'manual', errors };
    }
    if (!pointId) {
      errors.push('Single-line CSV needs a filename-derived point ID');
    } else {
      errors.push('Unrecognized single-line CSV format');
    }
    return { data, fidelity: 'full', source: 'manual', errors };
  }

  // ── Per-panel format (multi-line, one value per row) ───────
  // Detect: first line is NOT a header (it's numeric / 0/1)
  const firstLineIsData = /^[01,\s]+$/.test(lines[0]) && !lines[0].includes('IP') && !lines[0].includes('id');
  if (firstLineIsData && pointId) {
    const vals: string[] = [];
    for (const line of lines) {
      const v = line.split(',')[0]?.trim();
      if (v === '0' || v === '1') vals.push(v);
    }
    data[pointId] = vals.join('').padEnd(TIMESTEPS, '0');
    return { data, fidelity: 'full', source: 'manual', errors };
  }

  // ── Combined format (header + data rows) ───────────────────
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
