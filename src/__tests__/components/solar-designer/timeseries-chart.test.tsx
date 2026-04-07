import { render, screen } from '@testing-library/react';
import TimeseriesChart from '@/components/solar-designer/TimeseriesChart';
import type { TimeseriesView } from '@/lib/solar/v12-engine/timeseries';

const yearView: TimeseriesView = {
  values: [500, 600, 800, 1000, 1200, 1400, 1300, 1100, 900, 700, 500, 400],
  labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  period: 'year',
};

const dayView: TimeseriesView = {
  values: Array.from({ length: 48 }, (_, i) => i < 12 || i > 36 ? 0 : 200 + i * 10),
  labels: Array.from({ length: 48 }, (_, i) => `${Math.floor(i / 2)}:${(i % 2) * 30 || '00'}`),
  period: 'day',
};

describe('TimeseriesChart', () => {
  it('renders year view as area chart with month labels', () => {
    render(<TimeseriesChart modelA={yearView} modelB={yearView} />);
    expect(screen.getByText('Jan')).toBeInTheDocument();
    expect(screen.getByText('Dec')).toBeInTheDocument();
  });

  it('renders day view as bar chart', () => {
    const { container } = render(<TimeseriesChart modelA={dayView} />);
    const rects = container.querySelectorAll('rect');
    expect(rects.length).toBeGreaterThan(0);
  });

  it('renders single series when modelB is undefined', () => {
    const { container } = render(<TimeseriesChart modelA={dayView} />);
    // Should still render without errors
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});
