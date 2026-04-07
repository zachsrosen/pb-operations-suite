import { associateShadePoints } from '@/lib/solar/v12-engine/shade-association';
import type { PanelGeometry } from '@/lib/solar/v12-engine/types';
import type { RadiancePoint } from '@/lib/solar/v12-engine/layout-parser';

function makePanel(overrides: Partial<PanelGeometry> & { id: string }): PanelGeometry {
  return {
    x: 0, y: 0, width: 1.0, height: 1.7, azimuth: 0, tilt: 20,
    shadePointIds: [], ...overrides,
  };
}

function makePoint(overrides: Partial<RadiancePoint> & { id: string }): RadiancePoint {
  return {
    x: 0, y: 0, actualIrradiance: 1000, nominalIrradiance: 1000, tsrf: 0.85,
    ...overrides,
  };
}

describe('associateShadePoints', () => {
  it('assigns a point inside an axis-aligned panel', () => {
    const panels = [makePanel({ id: 'p1', x: 5, y: 5, width: 1.0, height: 1.7 })];
    const points = [makePoint({ id: 'r1', x: 5.2, y: 5.3 })];
    const result = associateShadePoints(panels, points);
    expect(result['p1']).toEqual(['r1']);
  });

  it('assigns a point inside a rotated panel', () => {
    const panels = [makePanel({ id: 'p1', x: 0, y: 0, width: 2.0, height: 2.0, azimuth: 45 })];
    const points = [makePoint({ id: 'r1', x: 0.0, y: 0.5 })];
    const result = associateShadePoints(panels, points);
    expect(result['p1']).toEqual(['r1']);
  });

  it('rejects a point outside a rotated panel', () => {
    const panels = [makePanel({ id: 'p1', x: 0, y: 0, width: 1.0, height: 1.0, azimuth: 45 })];
    const points = [makePoint({ id: 'r1', x: 1.5, y: 0 })];
    const result = associateShadePoints(panels, points);
    expect(result['p1']).toEqual([]);
  });

  it('assigns multiple points to multiple panels', () => {
    const panels = [
      makePanel({ id: 'p1', x: 0, y: 0, width: 2, height: 2 }),
      makePanel({ id: 'p2', x: 5, y: 0, width: 2, height: 2 }),
    ];
    const points = [
      makePoint({ id: 'r1', x: 0.5, y: 0.5 }),
      makePoint({ id: 'r2', x: 5.5, y: 0.5 }),
      makePoint({ id: 'r3', x: -0.5, y: 0.0 }),
    ];
    const result = associateShadePoints(panels, points);
    expect(result['p1']).toEqual(['r1', 'r3']);
    expect(result['p2']).toEqual(['r2']);
  });

  it('drops points outside all panels silently', () => {
    const panels = [makePanel({ id: 'p1', x: 0, y: 0, width: 1, height: 1 })];
    const points = [makePoint({ id: 'r1', x: 100, y: 100 })];
    const result = associateShadePoints(panels, points);
    expect(result['p1']).toEqual([]);
  });

  it('returns empty arrays for panels with no points', () => {
    const panels = [
      makePanel({ id: 'p1', x: 0, y: 0 }),
      makePanel({ id: 'p2', x: 10, y: 10 }),
    ];
    const points = [makePoint({ id: 'r1', x: 0.1, y: 0.1 })];
    const result = associateShadePoints(panels, points);
    expect(result['p1']).toEqual(['r1']);
    expect(result['p2']).toEqual([]);
  });

  it('handles empty inputs', () => {
    expect(associateShadePoints([], [])).toEqual({});
    const panels = [makePanel({ id: 'p1', x: 0, y: 0 })];
    expect(associateShadePoints(panels, [])).toEqual({ p1: [] });
    const points = [makePoint({ id: 'r1', x: 0, y: 0 })];
    expect(associateShadePoints([], points)).toEqual({});
  });

  it('tie-breaks border points to lower-index panel', () => {
    const panels = [
      makePanel({ id: 'p1', x: 0.5, y: 0, width: 1, height: 2 }),
      makePanel({ id: 'p2', x: 1.5, y: 0, width: 1, height: 2 }),
    ];
    const points = [makePoint({ id: 'r1', x: 1.0, y: 0 })];
    const result = associateShadePoints(panels, points);
    expect(result['p1']).toEqual(['r1']);
    expect(result['p2']).toEqual([]);
  });
});
