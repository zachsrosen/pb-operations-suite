import { render, screen } from '@testing-library/react';
import ProductionTab from '@/components/solar-designer/ProductionTab';
import type { CoreSolarDesignerResult } from '@/lib/solar/v12-engine';

function makeEmptyTimeseries(): Float32Array {
  return new Float32Array(17520);
}

function makeMockResult(): CoreSolarDesignerResult {
  return {
    panelStats: [
      { id: 0, tsrf: 0.93, points: [], panelKey: 'k', bifacialGain: 1, segmentIndex: 0 },
      { id: 1, tsrf: 0.88, points: [], panelKey: 'k', bifacialGain: 1, segmentIndex: 0 },
    ],
    production: { independentAnnual: 12500, stringLevelAnnual: 12200, eagleViewAnnual: 0 },
    mismatchLossPct: 2.4,
    clippingLossPct: 0,
    clippingEvents: [],
    independentTimeseries: [makeEmptyTimeseries(), makeEmptyTimeseries()],
    stringTimeseries: [makeEmptyTimeseries()],
    shadeFidelity: 'full',
    shadeSource: 'manual',
    panelCount: 2,
    systemSizeKw: 0.88,
    systemTsrf: 0.91,
    specificYield: 1420,
  };
}

describe('ProductionTab', () => {
  it('renders empty state when result is null', () => {
    render(<ProductionTab result={null} panels={[]} strings={[]} />);
    expect(screen.getByText(/Run analysis/)).toBeInTheDocument();
  });

  it('renders 4 summary cards when result exists', () => {
    render(<ProductionTab result={makeMockResult()} panels={[
      { id: 'p1', x: 0, y: 0, width: 1, height: 1.7, azimuth: 0, tilt: 20, shadePointIds: [] },
      { id: 'p2', x: 2, y: 0, width: 1, height: 1.7, azimuth: 0, tilt: 20, shadePointIds: [] },
    ]} strings={[{ id: 1, panelIds: ['p1', 'p2'] }]} />);
    expect(screen.getByText(/12,200/)).toBeInTheDocument(); // Annual production
    expect(screen.getByText(/1,420/)).toBeInTheDocument();   // Specific yield
    expect(screen.getByText(/2\.4/)).toBeInTheDocument();    // Mismatch
    expect(screen.getByText(/0\.91/)).toBeInTheDocument();   // TSRF
  });

  it('renders the per-panel table', () => {
    render(<ProductionTab result={makeMockResult()} panels={[
      { id: 'p1', x: 0, y: 0, width: 1, height: 1.7, azimuth: 0, tilt: 20, shadePointIds: [] },
      { id: 'p2', x: 2, y: 0, width: 1, height: 1.7, azimuth: 0, tilt: 20, shadePointIds: [] },
    ]} strings={[{ id: 1, panelIds: ['p1', 'p2'] }]} />);
    // Table headers
    expect(screen.getByText('Panel')).toBeInTheDocument();
    expect(screen.getByText('TSRF')).toBeInTheDocument();
    // Panel IDs
    expect(screen.getByText('p1')).toBeInTheDocument();
    expect(screen.getByText('p2')).toBeInTheDocument();
  });
});
