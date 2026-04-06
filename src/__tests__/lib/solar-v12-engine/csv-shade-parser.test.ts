import { parseShadeCSV } from '@/lib/solar/v12-engine/csv-shade-parser';
import { TIMESTEPS } from '@/lib/solar/v12-engine/constants';

describe('parseShadeCSV', () => {
  it('parses a header row + data rows into ShadeTimeseries', () => {
    const csv = [
      'timestep,PT001,PT002',
      '0,1,0',
      '1,1,1',
      '2,0,1',
    ].join('\n');
    const result = parseShadeCSV(csv);
    expect(result.data['PT001']!.slice(0, 3)).toBe('110');
    expect(result.data['PT002']!.slice(0, 3)).toBe('011');
    expect(result.errors).toHaveLength(0);
  });

  it('pads short sequences to TIMESTEPS with 0 (unshaded)', () => {
    const csv = 'timestep,PT001\n0,1\n1,0';
    const result = parseShadeCSV(csv);
    expect(result.data['PT001']).toHaveLength(TIMESTEPS);
    expect(result.data['PT001']![0]).toBe('1');
    expect(result.data['PT001']![1]).toBe('0');
    expect(result.data['PT001']![2]).toBe('0'); // padded with '0' = sun
  });

  it('returns error for empty CSV', () => {
    const result = parseShadeCSV('');
    expect(result.errors).toHaveLength(1);
  });

  it('sets fidelity to full for CSV uploads', () => {
    const csv = 'timestep,PT001\n0,1';
    const result = parseShadeCSV(csv);
    expect(result.fidelity).toBe('full');
    expect(result.source).toBe('manual');
  });
});
