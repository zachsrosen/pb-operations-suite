import { runCoreAnalysis } from '@/lib/solar/v12-engine/runner';
import type { CoreSolarDesignerInput } from '@/lib/solar/v12-engine/types';
import type { WorkerProgressMessage } from '@/lib/solar/types';

const noopProgress = (_msg: WorkerProgressMessage) => {};

describe('Core Runner', () => {
  it('returns a valid CoreSolarDesignerResult for a minimal input', () => {
    const input: CoreSolarDesignerInput = {
      panels: [{
        id: 'p0', x: 0, y: 0, width: 1.02, height: 1.82,
        azimuth: 180, tilt: 30, shadePointIds: [],
      }],
      shadeData: {},
      strings: [{ panels: [0] }],
      inverters: [{ inverterKey: 'tesla_pw3', stringIndices: [0] }],
      equipment: { panelKey: 'rec_alpha_440', inverterKey: 'tesla_pw3' },
      siteConditions: {
        tempMin: -10, tempMax: 45, groundAlbedo: 0.2,
        clippingThreshold: 1.0, exportLimitW: 0,
      },
      lossProfile: {
        soiling: 2, mismatch: 2, dcWiring: 2, acWiring: 1,
        availability: 3, lid: 1.5, snow: 0, nameplate: 1,
      },
    };

    const result = runCoreAnalysis(input, noopProgress);

    expect(result.panelCount).toBe(1);
    expect(result.production.independentAnnual).toBeGreaterThan(0);
    expect(result.shadeFidelity).toBe('full');
    expect(result.shadeSource).toBe('manual');
    expect(result.clippingEvents).toBeInstanceOf(Array);
  });

  it('returns zero for empty panel array', () => {
    const input: CoreSolarDesignerInput = {
      panels: [],
      shadeData: {},
      strings: [],
      inverters: [],
      equipment: { panelKey: 'rec_alpha_440', inverterKey: 'tesla_pw3' },
      siteConditions: {
        tempMin: -10, tempMax: 45, groundAlbedo: 0.2,
        clippingThreshold: 1.0, exportLimitW: 0,
      },
      lossProfile: {
        soiling: 2, mismatch: 2, dcWiring: 2, acWiring: 1,
        availability: 3, lid: 1.5, snow: 0, nameplate: 1,
      },
    };

    const result = runCoreAnalysis(input, noopProgress);
    expect(result.panelCount).toBe(0);
    expect(result.production.independentAnnual).toBe(0);
  });

  it('reports progress during execution', () => {
    const progresses: number[] = [];
    const input: CoreSolarDesignerInput = {
      panels: [{
        id: 'p0', x: 0, y: 0, width: 1.02, height: 1.82,
        azimuth: 180, tilt: 30, shadePointIds: [],
      }],
      shadeData: {},
      strings: [{ panels: [0] }],
      inverters: [{ inverterKey: 'tesla_pw3', stringIndices: [0] }],
      equipment: { panelKey: 'rec_alpha_440', inverterKey: 'tesla_pw3' },
      siteConditions: {
        tempMin: -10, tempMax: 45, groundAlbedo: 0.2,
        clippingThreshold: 1.0, exportLimitW: 0,
      },
      lossProfile: {
        soiling: 2, mismatch: 2, dcWiring: 2, acWiring: 1,
        availability: 3, lid: 1.5, snow: 0, nameplate: 1,
      },
    };

    runCoreAnalysis(input, (msg) => progresses.push(msg.payload.percent));
    expect(progresses.length).toBeGreaterThan(0);
    expect(progresses[progresses.length - 1]).toBe(100);
  });
});
