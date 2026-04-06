import { parseJSON, parseDXF, type LayoutParseResult } from '@/lib/solar/v12-engine/layout-parser';
import * as fs from 'fs';
import * as path from 'path';

const fixturesDir = path.join(__dirname, 'fixtures');

describe('parseJSON', () => {
  it('parses panels from EagleView-style JSON', () => {
    const json = fs.readFileSync(path.join(fixturesDir, 'sample-layout.json'), 'utf-8');
    const result = parseJSON(json);
    expect(result.panels).toHaveLength(3);
    expect(result.panels[0].id).toBe('panel_0');
  });

  it('calculates centroid position for each panel', () => {
    const json = fs.readFileSync(path.join(fixturesDir, 'sample-layout.json'), 'utf-8');
    const result = parseJSON(json);
    expect(result.panels[0].x).toBeCloseTo(0.51, 1);
    expect(result.panels[0].y).toBeCloseTo(0.91, 1);
  });

  it('skips obstruction/tree types', () => {
    const json = JSON.stringify({
      panels: [
        { data: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
      ],
      obstructions: [
        { data: [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 6, y: 6 }, { x: 5, y: 6 }], type: "tree" },
      ],
    });
    const result = parseJSON(json);
    expect(result.panels).toHaveLength(1);
  });

  it('returns empty for invalid JSON', () => {
    const result = parseJSON('not valid json');
    expect(result.panels).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
  });
});

describe('parseDXF', () => {
  it('parses POINT entities with EVT extended data', () => {
    const dxf = fs.readFileSync(path.join(fixturesDir, 'sample-layout.dxf'), 'utf-8');
    const result = parseDXF(dxf);
    expect(result.radiancePoints).toHaveLength(3);
  });

  it('extracts TSRF from metadata', () => {
    const dxf = fs.readFileSync(path.join(fixturesDir, 'sample-layout.dxf'), 'utf-8');
    const result = parseDXF(dxf);
    expect(result.radiancePoints[0].tsrf).toBeCloseTo(0.95, 2);
    expect(result.radiancePoints[2].tsrf).toBeCloseTo(0.80, 2);
  });

  it('negates Y coordinates (V12 convention)', () => {
    const dxf = fs.readFileSync(path.join(fixturesDir, 'sample-layout.dxf'), 'utf-8');
    const result = parseDXF(dxf);
    expect(result.radiancePoints[0].y).toBeCloseTo(0.9, 1);
  });

  it('filters zero-irradiance edge-bleed points', () => {
    const dxf = `0\nSECTION\n2\nENTITIES\n0\nPOINT\n10\n0.5\n20\n-0.9\n1001\nEVT\n1000\nPointName=PT001\n1000\nActualIrradiance=0\n1000\nNominalIrradiance=1000\n1000\nTSRF=0.0\n0\nENDSEC\n0\nEOF`;
    const result = parseDXF(dxf);
    expect(result.radiancePoints).toHaveLength(0);
  });
});
