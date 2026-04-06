/**
 * V12 Engine Types — Contract Tests
 *
 * Validates that Core types are structurally compatible
 * with existing engine types (bridging old and new).
 */
import type {
  CoreSolarDesignerInput,
  CoreSolarDesignerResult,
  PanelGeometry,
  ShadeTimeseries,
  ClippingEvent,
  SiteConditions,
  EquipmentSelection,
} from '@/lib/solar/v12-engine/types';

describe('CoreSolarDesignerInput', () => {
  it('accepts a valid input object', () => {
    const input: CoreSolarDesignerInput = {
      panels: [{
        id: 'p1', x: 0, y: 0, width: 1.02, height: 1.82,
        azimuth: 180, tilt: 30, shadePointIds: [],
      }],
      shadeData: {},
      strings: [{ panels: [0] }],
      inverters: [{ inverterKey: 'inv1', stringIndices: [0] }],
      equipment: { panelKey: 'rec_440', inverterKey: 'inv1' },
      siteConditions: {
        tempMin: -10, tempMax: 45, groundAlbedo: 0.2,
        clippingThreshold: 1.0, exportLimitW: 0,
      },
      lossProfile: {
        soiling: 2, mismatch: 2, dcWiring: 2, acWiring: 1,
        availability: 3, lid: 1.5, snow: 0, nameplate: 1,
      },
    };
    // Type-level test — if this compiles, the contract is valid
    expect(input.panels).toHaveLength(1);
  });
});

describe('CoreSolarDesignerResult', () => {
  it('has all required fields', () => {
    const result: CoreSolarDesignerResult = {
      panelStats: [],
      production: { independentAnnual: 100, stringLevelAnnual: 95, eagleViewAnnual: 0 },
      mismatchLossPct: 5,
      clippingLossPct: 2,
      clippingEvents: [],
      independentTimeseries: [],
      stringTimeseries: [],
      shadeFidelity: 'full',
      shadeSource: 'manual',
      panelCount: 10,
      systemSizeKw: 4.4,
      systemTsrf: 0.85,
      specificYield: 1200,
    };
    expect(result.shadeFidelity).toBe('full');
  });
});

describe('ShadeTimeseries', () => {
  it('is a Record<string, string> matching V12 binary shade format', () => {
    const shade: ShadeTimeseries = {
      'pt_001': '0'.repeat(17520), // fully unshaded ('0' = sun)
      'pt_002': '1'.repeat(17520), // fully shaded  ('1' = shade)
    };
    expect(shade['pt_001']).toHaveLength(17520);
    expect(shade['pt_002']![0]).toBe('1'); // '1' = shade
  });
});

describe('ClippingEvent', () => {
  it('captures event duration and energy', () => {
    const event: ClippingEvent = {
      inverterId: 0,
      inverterName: 'Tesla PW3',
      startStep: 5000,
      endStep: 5003,
      durationMin: 120,
      peakClipW: 500,
      totalClipWh: 250,
      date: 'Jun 15',
      startTime: '12:00',
      endTime: '14:00',
    };
    expect(event.durationMin).toBe(120);
  });
});
