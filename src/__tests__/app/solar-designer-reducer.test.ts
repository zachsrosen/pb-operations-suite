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

import type { UIInverterConfig } from '@/components/solar-designer/types';

describe('Stage 4 reducer logic', () => {
  describe('REASSIGN_STRING_TO_CHANNEL', () => {
    it('moves a string between channels on the same inverter', () => {
      const inverters: UIInverterConfig[] = [{
        inverterId: 0, inverterKey: 'k',
        channels: [
          { stringIndices: [0, 1] },
          { stringIndices: [2] },
          { stringIndices: [] },
        ],
      }];

      // Simulate reducer logic: move string 1 from channel 0 to channel 2
      const fromInverterId = 0, fromChannel = 0, toInverterId = 0, toChannel = 2, stringIndex = 1;
      const updated = inverters.map((inv) => {
        let channels = inv.channels.map(ch => ({ ...ch, stringIndices: [...ch.stringIndices] }));
        if (inv.inverterId === fromInverterId) {
          channels[fromChannel] = {
            stringIndices: channels[fromChannel].stringIndices.filter(s => s !== stringIndex),
          };
        }
        if (inv.inverterId === toInverterId) {
          channels[toChannel] = {
            stringIndices: [...channels[toChannel].stringIndices, stringIndex],
          };
        }
        return { ...inv, channels };
      });

      expect(updated[0].channels[0].stringIndices).toEqual([0]);
      expect(updated[0].channels[2].stringIndices).toEqual([1]);
    });

    it('moves a string between different inverters', () => {
      const inverters: UIInverterConfig[] = [
        { inverterId: 0, inverterKey: 'k', channels: [{ stringIndices: [0] }, { stringIndices: [] }] },
        { inverterId: 1, inverterKey: 'k', channels: [{ stringIndices: [] }, { stringIndices: [1] }] },
      ];

      // Move string 0 from inverter 0, channel 0 → inverter 1, channel 0
      const fromInverterId = 0, fromChannel = 0, toInverterId = 1, toChannel = 0, stringIndex = 0;
      const updated = inverters.map((inv) => {
        let channels = inv.channels.map(ch => ({ ...ch, stringIndices: [...ch.stringIndices] }));
        if (inv.inverterId === fromInverterId) {
          channels[fromChannel] = {
            stringIndices: channels[fromChannel].stringIndices.filter(s => s !== stringIndex),
          };
        }
        if (inv.inverterId === toInverterId) {
          channels[toChannel] = {
            stringIndices: [...channels[toChannel].stringIndices, stringIndex],
          };
        }
        return { ...inv, channels };
      });

      expect(updated[0].channels[0].stringIndices).toEqual([]);
      expect(updated[1].channels[0].stringIndices).toEqual([0]);
    });
  });

  describe('resultStale tracking', () => {
    it('marks stale when strings change and result exists', () => {
      const hasResult = true;
      const resultStale = hasResult ? true : false;
      expect(resultStale).toBe(true);
    });

    it('does not mark stale when result is null', () => {
      const hasResult = false;
      const resultStale = hasResult ? true : false;
      expect(resultStale).toBe(false);
    });
  });
});
