import { render, screen } from '@testing-library/react';
import ProductionChart from '@/components/solar-designer/ProductionChart';
import type { TimeseriesView } from '@/lib/solar/v12-engine/timeseries';

const mockModelA: TimeseriesView = {
  values: [500, 600, 800, 1000, 1200, 1400, 1300, 1100, 900, 700, 500, 400],
  labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  period: 'year',
};

const mockModelB: TimeseriesView = {
  values: [490, 585, 780, 975, 1170, 1365, 1268, 1073, 878, 683, 488, 390],
  labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  period: 'year',
};

describe('ProductionChart', () => {
  it('renders 12 month labels', () => {
    render(<ProductionChart modelA={mockModelA} modelB={mockModelB} />);
    expect(screen.getByText('Jan')).toBeInTheDocument();
    expect(screen.getByText('Jun')).toBeInTheDocument();
    expect(screen.getByText('Dec')).toBeInTheDocument();
  });

  it('renders SVG bars', () => {
    const { container } = render(<ProductionChart modelA={mockModelA} modelB={mockModelB} />);
    const rects = container.querySelectorAll('rect');
    // 12 months × 2 bars each = 24 rects
    expect(rects.length).toBe(24);
  });

  it('renders legend labels', () => {
    render(<ProductionChart modelA={mockModelA} modelB={mockModelB} />);
    expect(screen.getByText(/Independent/)).toBeInTheDocument();
    expect(screen.getByText(/String-level/)).toBeInTheDocument();
  });
});
