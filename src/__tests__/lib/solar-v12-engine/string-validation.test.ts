import { validateString } from '@/lib/solar/v12-engine/string-validation';
import type { ResolvedPanel, ResolvedInverter } from '@/lib/solar/v12-engine/types';

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

describe('validateString', () => {
  it('returns valid for a string within MPPT window', () => {
    const result = validateString(9, mockPanel, mockInverter, -10, 45);
    expect(result.status).toBe('valid');
    expect(result.message).toBeNull();
    expect(result.vocCold).toBeCloseTo(472.0, 0);
    expect(result.vmpHot).toBeCloseTo(347.9, 0);
  });

  it('returns error when Voc cold exceeds MPPT max', () => {
    const result = validateString(11, mockPanel, mockInverter, -10, 45);
    expect(result.status).toBe('error');
    expect(result.message).toMatch(/voc.*exceeds.*mppt max/i);
  });

  it('returns error when Vmp hot falls below MPPT min', () => {
    const result = validateString(1, mockPanel, mockInverter, -10, 45);
    expect(result.status).toBe('error');
    expect(result.message).toMatch(/vmp.*below.*mppt min/i);
  });

  it('returns warning when Voc cold approaches MPPT max (within 5%)', () => {
    const customInverter = { ...mockInverter, mpptMax: 510 };
    const result = validateString(10, mockPanel, customInverter, 5, 45);
    expect(result.status).toBe('warning');
    expect(result.message).toMatch(/approaching/i);
  });

  it('returns warning when Vmp hot approaches MPPT min (within 5%)', () => {
    const result = validateString(2, mockPanel, { ...mockInverter, mpptMin: 75 }, -10, 45);
    expect(result.status).toBe('warning');
    expect(result.message).toMatch(/approaching/i);
  });

  it('returns valid for zero panels (edge case)', () => {
    const result = validateString(0, mockPanel, mockInverter, -10, 45);
    expect(result.status).toBe('valid');
    expect(result.vocCold).toBe(0);
    expect(result.vmpHot).toBe(0);
  });

  it('includes numeric values in result', () => {
    const result = validateString(9, mockPanel, mockInverter, -10, 45);
    expect(result.mpptMin).toBe(60);
    expect(result.mpptMax).toBe(500);
    expect(typeof result.vocCold).toBe('number');
    expect(typeof result.vmpHot).toBe('number');
  });
});
