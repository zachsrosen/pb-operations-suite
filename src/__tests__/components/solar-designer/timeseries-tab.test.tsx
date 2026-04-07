import { render, screen, fireEvent } from '@testing-library/react';
import TimeseriesTab from '@/components/solar-designer/TimeseriesTab';
import type { CoreSolarDesignerResult } from '@/lib/solar/v12-engine';

function makeEmptyTimeseries(): Float32Array {
  return new Float32Array(17520);
}

function makeMockResult(): CoreSolarDesignerResult {
  return {
    panelStats: [{ id: 0, tsrf: 0.93, points: [], panelKey: 'k', bifacialGain: 1 }],
    production: { independentAnnual: 12500, stringLevelAnnual: 12200, eagleViewAnnual: 0 },
    mismatchLossPct: 2.4, clippingLossPct: 0, clippingEvents: [],
    independentTimeseries: [makeEmptyTimeseries()],
    stringTimeseries: [makeEmptyTimeseries()],
    shadeFidelity: 'full', shadeSource: 'manual',
    panelCount: 1, systemSizeKw: 0.44, systemTsrf: 0.93, specificYield: 1420,
  };
}

describe('TimeseriesTab', () => {
  it('renders empty state when result is null', () => {
    render(<TimeseriesTab result={null} strings={[]} />);
    expect(screen.getByText(/Run analysis/)).toBeInTheDocument();
  });

  it('renders period toggle buttons', () => {
    render(<TimeseriesTab result={makeMockResult()} strings={[{ id: 1, panelIds: ['p1'] }]} />);
    expect(screen.getByText('Day')).toBeInTheDocument();
    expect(screen.getByText('Week')).toBeInTheDocument();
    expect(screen.getByText('Month')).toBeInTheDocument();
    expect(screen.getByText('Year')).toBeInTheDocument();
  });

  it('shows date navigator when period is not Year', () => {
    render(<TimeseriesTab result={makeMockResult()} strings={[{ id: 1, panelIds: ['p1'] }]} />);
    // Default is Year — no navigator
    expect(screen.queryByTestId('date-nav')).not.toBeInTheDocument();
    // Switch to Day
    fireEvent.click(screen.getByText('Day'));
    expect(screen.getByTestId('date-nav')).toBeInTheDocument();
  });

  it('renders string selector dropdown', () => {
    render(<TimeseriesTab result={makeMockResult()} strings={[{ id: 1, panelIds: ['p1'] }]} />);
    expect(screen.getByText(/System Total/)).toBeInTheDocument();
  });
});
