/**
 * Tests for the Solar Designer reducer — Stage 3 action cases.
 * Since the reducer is defined inline in page.tsx, we test the bridge
 * logic (AUTO_STRING) directly here.
 */
import type { PanelGeometry } from '@/lib/solar/v12-engine/types';

describe('AUTO_STRING bridge logic', () => {
  it('converts engine StringConfig[] indices to UIStringConfig[] panel IDs', () => {
    const panels: PanelGeometry[] = [
      { id: 'p-A', x: 0, y: 0, width: 1, height: 1.7, azimuth: 0, tilt: 20, shadePointIds: [] },
      { id: 'p-B', x: 2, y: 0, width: 1, height: 1.7, azimuth: 0, tilt: 20, shadePointIds: [] },
      { id: 'p-C', x: 4, y: 0, width: 1, height: 1.7, azimuth: 0, tilt: 20, shadePointIds: [] },
    ];
    const engineStrings = [{ panels: [0, 1] }, { panels: [2] }];
    const existingManualStrings = [{ id: 1, panelIds: ['p-A'] }]; // p-A already assigned
    const nextStringId = 2;

    // Bridge logic (same as reducer):
    const manualPanelIds = new Set(existingManualStrings.flatMap(s => s.panelIds));
    let currentId = nextStringId;
    const newStrings = engineStrings
      .map(es => ({
        panelIds: es.panels.map(i => panels[i].id).filter(id => !manualPanelIds.has(id)),
      }))
      .filter(s => s.panelIds.length > 0)
      .map(s => ({ id: currentId++, panelIds: s.panelIds }));

    expect(newStrings).toEqual([
      { id: 2, panelIds: ['p-B'] },     // p-A was filtered out from first string
      { id: 3, panelIds: ['p-C'] },
    ]);
    expect(currentId).toBe(4); // nextStringId advanced
  });

  it('drops empty strings after filtering manual assignments', () => {
    const panels: PanelGeometry[] = [
      { id: 'p-A', x: 0, y: 0, width: 1, height: 1.7, azimuth: 0, tilt: 20, shadePointIds: [] },
      { id: 'p-B', x: 2, y: 0, width: 1, height: 1.7, azimuth: 0, tilt: 20, shadePointIds: [] },
    ];
    const engineStrings = [{ panels: [0, 1] }];
    // Both panels already manually assigned
    const existingManualStrings = [{ id: 1, panelIds: ['p-A', 'p-B'] }];
    const nextStringId = 2;

    const manualPanelIds = new Set(existingManualStrings.flatMap(s => s.panelIds));
    let currentId = nextStringId;
    const newStrings = engineStrings
      .map(es => ({
        panelIds: es.panels.map(i => panels[i].id).filter(id => !manualPanelIds.has(id)),
      }))
      .filter(s => s.panelIds.length > 0)
      .map(s => ({ id: currentId++, panelIds: s.panelIds }));

    expect(newStrings).toEqual([]); // All filtered out
    expect(currentId).toBe(2); // nextStringId unchanged
  });
});
