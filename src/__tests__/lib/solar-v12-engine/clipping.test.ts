import { detectClippingEvents } from '@/lib/solar/v12-engine/clipping';

describe('detectClippingEvents', () => {
  it('detects a contiguous clipping event', () => {
    const clipped = new Float32Array(17520).fill(0);
    for (let t = 100; t <= 105; t++) {
      clipped[t] = 500;
    }

    const events = detectClippingEvents({
      inverterId: 0,
      inverterName: 'Test Inverter',
      clippedTimeseries: clipped,
    });

    expect(events).toHaveLength(1);
    expect(events[0].startStep).toBe(100);
    expect(events[0].endStep).toBe(105);
    expect(events[0].durationMin).toBe(180); // 6 * 30 min
    expect(events[0].peakClipW).toBe(500);
    expect(events[0].totalClipWh).toBeCloseTo(1500, 0); // 500W * 3h
  });

  it('separates non-contiguous events', () => {
    const clipped = new Float32Array(17520).fill(0);
    clipped[100] = 200;
    clipped[101] = 200;
    // gap
    clipped[200] = 300;

    const events = detectClippingEvents({
      inverterId: 0, inverterName: 'Test', clippedTimeseries: clipped,
    });

    expect(events).toHaveLength(2);
  });

  it('returns empty for no clipping', () => {
    const clipped = new Float32Array(17520).fill(0);
    const events = detectClippingEvents({
      inverterId: 0, inverterName: 'Test', clippedTimeseries: clipped,
    });
    expect(events).toHaveLength(0);
  });
});
