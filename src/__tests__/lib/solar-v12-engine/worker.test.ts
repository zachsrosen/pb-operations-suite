import { handleWorkerMessage } from '@/lib/solar/v12-engine/worker';
import type { CoreSolarDesignerInput } from '@/lib/solar/v12-engine/types';

describe('Worker entry point', () => {
  it('routes a RUN_SIMULATION message and returns a RESULT message', () => {
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

    const messages: any[] = [];
    const mockPostMessage = (msg: any) => messages.push(msg);

    handleWorkerMessage(
      { type: 'RUN_SIMULATION', payload: input },
      mockPostMessage
    );

    const progressMsgs = messages.filter(m => m.type === 'SIMULATION_PROGRESS');
    const resultMsgs = messages.filter(m => m.type === 'SIMULATION_RESULT');
    expect(progressMsgs.length).toBeGreaterThan(0);
    expect(resultMsgs).toHaveLength(1);
    expect(resultMsgs[0].payload.panelCount).toBe(1);
    expect(resultMsgs[0].payload.production.independentAnnual).toBeGreaterThan(0);
  });

  it('returns an error message for invalid input', () => {
    const messages: any[] = [];
    const mockPostMessage = (msg: any) => messages.push(msg);

    handleWorkerMessage(
      { type: 'RUN_SIMULATION', payload: { panels: null } },
      mockPostMessage
    );

    const errorMsgs = messages.filter(m => m.type === 'SIMULATION_ERROR');
    expect(errorMsgs).toHaveLength(1);
  });

  it('ignores messages with unknown type', () => {
    const messages: any[] = [];
    const mockPostMessage = (msg: any) => messages.push(msg);

    handleWorkerMessage(
      { type: 'UNKNOWN_TYPE', payload: {} },
      mockPostMessage
    );

    expect(messages).toHaveLength(0);
  });
});
