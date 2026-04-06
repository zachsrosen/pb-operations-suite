import { aggregateTimeseries, sumTimeseries, type TimeseriesView } from '@/lib/solar/v12-engine/timeseries';

describe('aggregateTimeseries', () => {
  it('aggregates a full-year timeseries to daily view for day 0', () => {
    const ts = new Float32Array(17520);
    for (let t = 0; t < 48; t++) ts[t] = 1000;
    const view = aggregateTimeseries(ts, 'day', 0);
    expect(view.values).toHaveLength(48);
    expect(view.values[0]).toBe(1000);
  });

  it('aggregates to monthly view (year)', () => {
    const ts = new Float32Array(17520).fill(100);
    const view = aggregateTimeseries(ts, 'year', 0);
    expect(view.values).toHaveLength(12);
    expect(view.values[0]).toBeGreaterThan(0);
  });

  it('handles week view', () => {
    const ts = new Float32Array(17520).fill(50);
    const view = aggregateTimeseries(ts, 'week', 0);
    expect(view.values).toHaveLength(7);
  });
});

describe('sumTimeseries', () => {
  it('sums multiple timeseries element-wise', () => {
    const a = new Float32Array(17520).fill(100);
    const b = new Float32Array(17520).fill(200);
    const result = sumTimeseries([a, b]);
    expect(result).toHaveLength(17520);
    expect(result[0]).toBe(300);
    expect(result[17519]).toBe(300);
  });

  it('returns zeros for empty array', () => {
    const result = sumTimeseries([]);
    expect(result).toHaveLength(17520);
    expect(result[0]).toBe(0);
  });
});
