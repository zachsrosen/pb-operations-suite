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

  // ── Per-panel format ────────────────────────────────────────
  // Handles single-line shade strings AND multi-line single-column
  // CSVs where lines.length <= TIMESTEPS and there's a pointId.
  if (pointId) {
    // Strip any BOM and whitespace, collapse all lines into shade values
    const cleaned = raw.replace(/^\uFEFF/, '');
    const allVals: string[] = [];

    for (const line of cleaned.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Row could be a single 0/1 char, a comma-separated list, or a
      // continuous binary string — handle all three.
      if (trimmed.includes(',')) {
        for (const cell of trimmed.split(',')) {
          const v = cell.trim();
          if (v === '') continue;
          // Treat any non-zero numeric value as shaded (1)
          allVals.push(v === '0' || v === '0.0' || v === '0.00' ? '0' : '1');
        }
      } else if (/^[01]+$/.test(trimmed) && trimmed.length > 1) {
        // Continuous binary string on this line
        allVals.push(...trimmed.split(''));
      } else {
        // Single value per row (could be 0, 1, decimal shade factor, etc.)
        const num = parseFloat(trimmed);
        if (!isNaN(num)) {
          allVals.push(num === 0 ? '0' : '1');
        }
        // Skip non-numeric rows (headers, labels)
      }
    }

    if (allVals.length > 0) {
      data[pointId] = allVals.join('').padEnd(TIMESTEPS, '0');
      return { data, fidelity: 'full', source: 'manual', errors };
    }

    errors.push(`Could not parse shade data (${lines.length} lines, first 80 chars: ${raw.slice(0, 80).replace(/\n/g, '\\n')})`);
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
