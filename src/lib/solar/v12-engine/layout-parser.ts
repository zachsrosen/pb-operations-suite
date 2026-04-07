/**
 * Solar Designer V12 Engine — DXF/JSON Layout Parser
 *
 * Parses panel layout data from EagleView-style JSON and V12 DXF exports.
 * JSON format: polygon vertex arrays per panel → centroid + bounding box.
 * DXF format: POINT entities with EVT extended data → radiance measurement points.
 *
 * Ported from V12 lines 1145-1238.
 */
import type { PanelGeometry } from './types';

export interface RadiancePoint {
  id: string;
  x: number;
  y: number;
  actualIrradiance: number;
  nominalIrradiance: number;
  tsrf: number;
}

export interface LayoutParseResult {
  panels: PanelGeometry[];
  radiancePoints: RadiancePoint[];
  errors: string[];
}

// ── JSON Parser ───────────────────────────────────────────────

interface VertexPoint {
  x: number;
  y: number;
}

interface PanelEntry {
  data: VertexPoint[];
  type?: string;
}

interface LayoutJSON {
  panels?: PanelEntry[];
  obstructions?: PanelEntry[];
  [key: string]: unknown;
}

export function parseJSON(raw: string): LayoutParseResult {
  const errors: string[] = [];
  const panels: PanelGeometry[] = [];

  let parsed: LayoutJSON;
  try {
    parsed = JSON.parse(raw) as LayoutJSON;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { panels: [], radiancePoints: [], errors: [`JSON parse error: ${msg}`] };
  }

  const entries = parsed.panels ?? [];
  let idx = 0;
  for (const entry of entries) {
    // Skip non-panel types (obstructions, trees, etc.)
    if (entry.type && entry.type !== 'panel') {
      continue;
    }

    const vertices = entry.data ?? [];
    if (vertices.length < 3) {
      errors.push(`panel_${idx}: insufficient vertices (${vertices.length})`);
      idx++;
      continue;
    }

    // Calculate centroid
    const sumX = vertices.reduce((acc, v) => acc + v.x, 0);
    const sumY = vertices.reduce((acc, v) => acc + v.y, 0);
    const cx = sumX / vertices.length;
    const cy = sumY / vertices.length;

    // Calculate bounding box for width/height
    const xs = vertices.map(v => v.x);
    const ys = vertices.map(v => v.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    panels.push({
      id: `panel_${idx}`,
      x: cx,
      y: cy,
      width: maxX - minX,
      height: maxY - minY,
      azimuth: 180,       // default south-facing; overridden by DXF/EagleView metadata if present
      tilt: 20,           // default tilt; overridden if metadata present
      shadePointIds: [],  // populated by shade assignment after parsing
    });

    idx++;
  }

  return { panels, radiancePoints: [], errors };
}

// ── DXF Parser ────────────────────────────────────────────────

interface DxfPointBuilder {
  x: number;
  y: number;
  name: string;
  actualIrradiance: number;
  nominalIrradiance: number;
  tsrf: number;
  inEvt: boolean;
}

function emptyBuilder(): DxfPointBuilder {
  return {
    x: 0,
    y: 0,
    name: '',
    actualIrradiance: -1,
    nominalIrradiance: 0,
    tsrf: 0,
    inEvt: false,
  };
}

export function parseDXF(raw: string): LayoutParseResult {
  const radiancePoints: RadiancePoint[] = [];

  const lines = raw.split(/\r?\n/);
  let inEntities = false;
  let inPoint = false;
  let current = emptyBuilder();
  let prevCode = '';

  const finalizePoint = () => {
    if (inPoint && current.actualIrradiance > 0) {
      const id = current.name || `pt_${radiancePoints.length}`;
      radiancePoints.push({
        id,
        x: current.x,
        y: -current.y,   // negate Y for V12 convention
        actualIrradiance: current.actualIrradiance,
        nominalIrradiance: current.nominalIrradiance,
        tsrf: current.tsrf,
      });
    }
    inPoint = false;
    current = emptyBuilder();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Track group codes: every even-indexed line is a code, odd-indexed is the value
    // We process them as pairs: code on one line, value on the next
    if (i % 2 === 0) {
      // This is a group code line
      prevCode = line;
      continue;
    }

    // This is the value line corresponding to prevCode
    const code = prevCode;
    const value = line;

    if (code === '2' && value === 'ENTITIES') {
      inEntities = true;
      continue;
    }

    if (!inEntities) continue;

    if (code === '0') {
      // New entity or section marker
      if (inPoint) {
        finalizePoint();
      }

      if (value === 'POINT') {
        inPoint = true;
        current = emptyBuilder();
      } else if (value === 'ENDSEC' || value === 'EOF') {
        inEntities = false;
      }
      continue;
    }

    if (!inPoint) continue;

    if (code === '10') {
      current.x = parseFloat(value);
    } else if (code === '20') {
      current.y = parseFloat(value);
    } else if (code === '1001' && value === 'EVT') {
      current.inEvt = true;
    } else if (code === '1000' && current.inEvt) {
      const eqIdx = value.indexOf('=');
      if (eqIdx === -1) continue;
      const key = value.slice(0, eqIdx);
      const val = value.slice(eqIdx + 1);

      if (key === 'PointName') {
        current.name = val;
      } else if (key === 'ActualIrradiance') {
        current.actualIrradiance = parseFloat(val);
      } else if (key === 'NominalIrradiance') {
        current.nominalIrradiance = parseFloat(val);
      } else if (key === 'TSRF') {
        current.tsrf = parseFloat(val);
      }
    }
  }

  // Finalize last point if file ends without explicit ENDSEC
  if (inPoint) {
    finalizePoint();
  }

  return { panels: [], radiancePoints, errors: [] };
}
