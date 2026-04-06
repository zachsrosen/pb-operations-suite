import { autoString } from '@/lib/solar/v12-engine/stringing';
import type { PanelStat, ResolvedPanel, ResolvedInverter } from '@/lib/solar/v12-engine/types';

const mockPanel: ResolvedPanel = {
  key: 'rec_440', name: 'REC 440', watts: 440,
  voc: 48.4, vmp: 40.8, isc: 11.5, imp: 10.79,
  tempCoVoc: -0.0024, tempCoIsc: 0.0004, tempCoPmax: -0.0026,
  cells: 132, bypassDiodes: 3, cellsPerSubstring: 44,
  isBifacial: false, bifacialityFactor: 0,
};

const mockInverter: ResolvedInverter = {
  key: 'tesla_pw3', name: 'Tesla PW3', acPower: 11500, dcMax: 15000,
  mpptMin: 60, mpptMax: 500, channels: 6, maxIsc: 25,
  efficiency: 0.975, architectureType: 'string', isMicro: false, isIntegrated: true,
};

describe('autoString', () => {
  it('groups panels into valid strings by TSRF (high to low)', () => {
    const panels: PanelStat[] = Array.from({ length: 10 }, (_, i) => ({
      id: i, tsrf: 0.95 - i * 0.02, points: [], panelKey: 'rec_440', bifacialGain: 1.0,
    }));
    const result = autoString({
      panels, panel: mockPanel, inverter: mockInverter, tempMin: -10,
    });
    expect(result.strings.length).toBeGreaterThan(0);
    const firstStringTsrfs = result.strings[0].panels.map(i => panels[i].tsrf);
    expect(firstStringTsrfs[0]).toBeGreaterThanOrEqual(firstStringTsrfs[firstStringTsrfs.length - 1]);
  });

  it('respects max panels per string from inverter voltage limit', () => {
    const panels: PanelStat[] = Array.from({ length: 20 }, (_, i) => ({
      id: i, tsrf: 0.85, points: [], panelKey: 'rec_440', bifacialGain: 1.0,
    }));
    const result = autoString({
      panels, panel: mockPanel, inverter: mockInverter, tempMin: -20,
    });
    // max = floor(500 / Voc_cold) where Voc_cold = 48.4 * (1 + -0.0024 * (-20 - 25))
    // = 48.4 * 1.108 = 53.63V → max = floor(500 / 53.63) = 9
    for (const s of result.strings) {
      expect(s.panels.length).toBeLessThanOrEqual(9);
    }
  });

  it('returns warnings for strings that violate voltage limits', () => {
    const panels: PanelStat[] = Array.from({ length: 3 }, (_, i) => ({
      id: i, tsrf: 0.85, points: [], panelKey: 'rec_440', bifacialGain: 1.0,
    }));
    const result = autoString({
      panels,
      panel: mockPanel,
      inverter: { ...mockInverter, mpptMin: 200 },
      tempMin: -10,
    });
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
