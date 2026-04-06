/**
 * V12 Equipment Catalog Tests
 */
import {
  getBuiltInPanels,
  getBuiltInInverters,
  getBuiltInEss,
  resolvePanel,
  resolveInverter,
  resolveEss,
} from '@/lib/solar/v12-engine/equipment';

describe('Built-in equipment catalog', () => {
  it('has 8 panel models', () => {
    expect(getBuiltInPanels()).toHaveLength(8);
  });

  it('has 9 inverter models', () => {
    expect(getBuiltInInverters()).toHaveLength(9);
  });

  it('has 6 ESS models', () => {
    expect(getBuiltInEss()).toHaveLength(6);
  });

  it('all panels have required electrical specs', () => {
    for (const p of getBuiltInPanels()) {
      expect(p.watts).toBeGreaterThan(0);
      expect(p.voc).toBeGreaterThan(0);
      expect(p.vmp).toBeGreaterThan(0);
      expect(p.isc).toBeGreaterThan(0);
      expect(p.imp).toBeGreaterThan(0);
      expect(p.tempCoVoc).toBeLessThan(0);
      expect(p.tempCoIsc).toBeGreaterThan(0);
      expect(p.tempCoPmax).toBeLessThan(0);
      expect(p.bypassDiodes).toBeGreaterThan(0);
      expect(p.cellsPerSubstring).toBe(Math.round(p.cells / p.bypassDiodes));
    }
  });

  it('all inverters have valid MPPT range', () => {
    for (const inv of getBuiltInInverters()) {
      expect(inv.mpptMax).toBeGreaterThan(inv.mpptMin);
      expect(inv.acPower).toBeGreaterThan(0);
      expect(inv.efficiency).toBeGreaterThan(0.9);
      expect(inv.efficiency).toBeLessThanOrEqual(1.0);
    }
  });
});

describe('resolvePanel', () => {
  it('resolves a known panel key', () => {
    const panel = resolvePanel('rec_alpha_440');
    expect(panel).not.toBeNull();
    expect(panel!.watts).toBe(440);
    expect(panel!.name).toContain('REC');
  });

  it('returns null for unknown key', () => {
    expect(resolvePanel('nonexistent_panel')).toBeNull();
  });
});

describe('resolveInverter', () => {
  it('resolves Tesla PW3', () => {
    const inv = resolveInverter('tesla_pw3');
    expect(inv).not.toBeNull();
    expect(inv!.acPower).toBe(11500);
    expect(inv!.isIntegrated).toBe(true);
  });
});

describe('resolveEss', () => {
  it('resolves Tesla PW3 battery', () => {
    const ess = resolveEss('tesla_pw3_ess');
    expect(ess).not.toBeNull();
    expect(ess!.capacity).toBe(13.5);
  });
});
