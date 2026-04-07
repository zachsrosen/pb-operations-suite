import {
  autoAssignInverters,
  flattenInverterConfigs,
} from '@/components/solar-designer/inverter-bridge';
import type { UIInverterConfig } from '@/components/solar-designer/types';

describe('autoAssignInverters', () => {
  it('distributes 4 strings across 2 inverters with 3 channels each', () => {
    const result = autoAssignInverters(4, 3, 'sol_ark_15k');
    expect(result).toHaveLength(2);
    // Inverter 0: channels [0], [1], [2]
    expect(result[0]).toEqual({
      inverterId: 0,
      inverterKey: 'sol_ark_15k',
      channels: [
        { stringIndices: [0] },
        { stringIndices: [1] },
        { stringIndices: [2] },
      ],
    });
    // Inverter 1: channel [3], empty, empty
    expect(result[1]).toEqual({
      inverterId: 1,
      inverterKey: 'sol_ark_15k',
      channels: [
        { stringIndices: [3] },
        { stringIndices: [] },
        { stringIndices: [] },
      ],
    });
  });

  it('handles exact fit — 6 strings, 3 channels = 2 full inverters', () => {
    const result = autoAssignInverters(6, 3, 'key');
    expect(result).toHaveLength(2);
    expect(result[0].channels.every(ch => ch.stringIndices.length === 1)).toBe(true);
    expect(result[1].channels.every(ch => ch.stringIndices.length === 1)).toBe(true);
  });

  it('returns single inverter when strings fit in one', () => {
    const result = autoAssignInverters(2, 4, 'key');
    expect(result).toHaveLength(1);
    expect(result[0].channels).toHaveLength(4);
    expect(result[0].channels[0].stringIndices).toEqual([0]);
    expect(result[0].channels[1].stringIndices).toEqual([1]);
    expect(result[0].channels[2].stringIndices).toEqual([]);
    expect(result[0].channels[3].stringIndices).toEqual([]);
  });

  it('returns empty array for 0 strings', () => {
    expect(autoAssignInverters(0, 3, 'key')).toEqual([]);
  });
});

describe('flattenInverterConfigs', () => {
  it('flattens UIInverterConfig[] to engine InverterConfig[]', () => {
    const ui: UIInverterConfig[] = [
      {
        inverterId: 0,
        inverterKey: 'sol_ark_15k',
        channels: [
          { stringIndices: [0, 1] },
          { stringIndices: [2] },
          { stringIndices: [] },
        ],
      },
    ];
    const flat = flattenInverterConfigs(ui);
    expect(flat).toEqual([
      { inverterKey: 'sol_ark_15k', stringIndices: [0, 1, 2] },
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(flattenInverterConfigs([])).toEqual([]);
  });
});
