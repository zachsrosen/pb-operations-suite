import * as v12Physics from '@/lib/solar/v12-engine/physics';
import * as originalPhysics from '@/lib/solar/engine/physics';

describe('v12-engine/physics re-exports', () => {
  it('solarFactor matches original', () => {
    for (let h = 0; h < 48; h++) {
      expect(v12Physics.solarFactor(h)).toBe(originalPhysics.solarFactor(h));
    }
  });

  it('seasonFactor matches original', () => {
    for (let d = 0; d < 365; d++) {
      expect(v12Physics.seasonFactor(d)).toBe(originalPhysics.seasonFactor(d));
    }
  });

  it('getSeasonalTSRF matches original', () => {
    expect(v12Physics.getSeasonalTSRF(0.85, 172, false))
      .toBe(originalPhysics.getSeasonalTSRF(0.85, 172, false));
  });
});
