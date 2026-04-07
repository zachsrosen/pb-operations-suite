import { render, screen, fireEvent } from '@testing-library/react';
import InvertersTab from '@/components/solar-designer/InvertersTab';
import type { CoreSolarDesignerResult, ResolvedInverter } from '@/lib/solar/v12-engine';
import type { UIInverterConfig, UIStringConfig } from '@/components/solar-designer/types';

const mockInverter: ResolvedInverter = {
  key: 'sol_ark', name: 'Sol-Ark 15K', acPower: 15000, dcMax: 20000,
  mpptMin: 60, mpptMax: 500, channels: 3, maxIsc: 25,
  efficiency: 0.97, architectureType: 'string', isMicro: false, isIntegrated: false,
};

const mockStrings: UIStringConfig[] = [
  { id: 1, panelIds: ['p1', 'p2', 'p3'] },
  { id: 2, panelIds: ['p4', 'p5'] },
];

const mockUIInverters: UIInverterConfig[] = [{
  inverterId: 0, inverterKey: 'sol_ark',
  channels: [
    { stringIndices: [0] },
    { stringIndices: [1] },
    { stringIndices: [] },
  ],
}];

function makeEmptyResult(): CoreSolarDesignerResult {
  return {
    panelStats: [], production: { independentAnnual: 0, stringLevelAnnual: 0, eagleViewAnnual: 0 },
    mismatchLossPct: 0, clippingLossPct: 0, clippingEvents: [],
    independentTimeseries: [], stringTimeseries: [],
    shadeFidelity: 'full', shadeSource: 'manual',
    panelCount: 0, systemSizeKw: 0, systemTsrf: 0, specificYield: 0,
  };
}

const mockDispatch = jest.fn();

describe('InvertersTab', () => {
  beforeEach(() => mockDispatch.mockReset());

  it('renders empty state when result is null', () => {
    render(
      <InvertersTab result={null} inverters={[]} strings={[]}
        selectedInverter={null} selectedPanel={null} resultStale={false} dispatch={mockDispatch} />
    );
    expect(screen.getByText(/Run analysis/)).toBeInTheDocument();
  });

  it('renders inverter card with MPPT channels', () => {
    render(
      <InvertersTab result={makeEmptyResult()} inverters={mockUIInverters} strings={mockStrings}
        selectedInverter={mockInverter} selectedPanel={null} resultStale={false} dispatch={mockDispatch} />
    );
    expect(screen.getByText(/Sol-Ark 15K/)).toBeInTheDocument();
    expect(screen.getByText(/MPPT 1/)).toBeInTheDocument();
    expect(screen.getByText(/MPPT 2/)).toBeInTheDocument();
    expect(screen.getByText(/MPPT 3/)).toBeInTheDocument();
  });

  it('shows empty channel indicator', () => {
    render(
      <InvertersTab result={makeEmptyResult()} inverters={mockUIInverters} strings={mockStrings}
        selectedInverter={mockInverter} selectedPanel={null} resultStale={false} dispatch={mockDispatch} />
    );
    expect(screen.getByText(/empty/)).toBeInTheDocument();
  });

  it('shows stale banner with re-run button when resultStale is true', () => {
    const mockRerun = jest.fn();
    render(
      <InvertersTab result={makeEmptyResult()} inverters={mockUIInverters} strings={mockStrings}
        selectedInverter={mockInverter} selectedPanel={null} resultStale={true} dispatch={mockDispatch}
        onRerun={mockRerun} />
    );
    expect(screen.getByText(/re-run/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/re-run/i));
    expect(mockRerun).toHaveBeenCalledTimes(1);
  });

  it('shows clipping placeholder when events are empty', () => {
    render(
      <InvertersTab result={makeEmptyResult()} inverters={mockUIInverters} strings={mockStrings}
        selectedInverter={mockInverter} selectedPanel={null} resultStale={false} dispatch={mockDispatch} />
    );
    expect(screen.getByText(/Stage 5/i)).toBeInTheDocument();
  });
});
