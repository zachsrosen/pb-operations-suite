import { render, screen } from '@testing-library/react';
import RunAnalysisButton from '@/components/solar-designer/RunAnalysisButton';
import type { SolarDesignerState } from '@/components/solar-designer/types';
import type { ResolvedPanel, ResolvedInverter } from '@/lib/solar/v12-engine';

const mockPanel: ResolvedPanel = {
  key: 'rec_440', name: 'REC 440', watts: 440,
  voc: 48.4, vmp: 40.8, isc: 11.5, imp: 10.79,
  tempCoVoc: -0.0024, tempCoIsc: 0.0004, tempCoPmax: -0.0026,
  cells: 132, bypassDiodes: 3, cellsPerSubstring: 44,
  isBifacial: false, bifacialityFactor: 0,
};

const mockInverter: ResolvedInverter = {
  key: 'sol_ark', name: 'Sol-Ark 15K', acPower: 15000, dcMax: 20000,
  mpptMin: 60, mpptMax: 500, channels: 4, maxIsc: 25,
  efficiency: 0.97, architectureType: 'string', isMicro: false, isIntegrated: false,
};

const mockDispatch = jest.fn();

function makeState(overrides: Partial<SolarDesignerState>): SolarDesignerState {
  return {
    panels: [], shadeData: {}, shadeFidelity: 'full', shadeSource: 'manual',
    radiancePoints: [], uploadedFiles: [], panelShadeMap: {},
    siteAddress: null, siteFormattedAddress: null, siteLatLng: null,
    mapAlignment: { offsetX: 0, offsetY: 0, rotation: 0, scale: 1 },
    panelKey: '', inverterKey: '', selectedPanel: null, selectedInverter: null,
    siteConditions: { tempMin: -10, tempMax: 45, groundAlbedo: 0.2, clippingThreshold: 1, exportLimitW: 0 },
    lossProfile: { soiling: 2, mismatch: 2, dcWiring: 2, acWiring: 1, availability: 3, lid: 1.5, snow: 0, nameplate: 1 },
    strings: [], activeStringId: null, nextStringId: 1,
    inverters: [], result: null,
    activeTab: 'visualizer', isUploading: false, uploadError: null,
    isAnalyzing: false, analysisProgress: null, analysisError: null, resultStale: false,
    ...overrides,
  } as SolarDesignerState;
}

describe('RunAnalysisButton', () => {
  it('renders disabled when no panels', () => {
    render(<RunAnalysisButton state={makeState({})} dispatch={mockDispatch} />);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('renders disabled when no equipment selected', () => {
    render(<RunAnalysisButton state={makeState({
      panels: [{ id: 'p1', x: 0, y: 0, width: 1, height: 1.7, azimuth: 0, tilt: 20, shadePointIds: [] }],
      strings: [{ id: 1, panelIds: ['p1'] }],
    })} dispatch={mockDispatch} />);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('renders disabled when some panels are unassigned', () => {
    render(<RunAnalysisButton state={makeState({
      panels: [
        { id: 'p1', x: 0, y: 0, width: 1, height: 1.7, azimuth: 0, tilt: 20, shadePointIds: [] },
        { id: 'p2', x: 2, y: 0, width: 1, height: 1.7, azimuth: 0, tilt: 20, shadePointIds: [] },
      ],
      strings: [{ id: 1, panelIds: ['p1'] }], // p2 unassigned
      selectedPanel: mockPanel,
      selectedInverter: mockInverter,
      panelKey: 'rec_440',
      inverterKey: 'sol_ark',
    })} dispatch={mockDispatch} />);
    expect(screen.getByRole('button')).toBeDisabled();
    expect(screen.getByRole('button').title).toMatch(/unassigned/);
  });

  it('renders enabled when all panels assigned', () => {
    render(<RunAnalysisButton state={makeState({
      panels: [{ id: 'p1', x: 0, y: 0, width: 1, height: 1.7, azimuth: 0, tilt: 20, shadePointIds: [] }],
      strings: [{ id: 1, panelIds: ['p1'] }],
      selectedPanel: mockPanel,
      selectedInverter: mockInverter,
      panelKey: 'rec_440',
      inverterKey: 'sol_ark',
    })} dispatch={mockDispatch} />);
    expect(screen.getByRole('button')).toBeEnabled();
  });

  it('shows progress when analyzing', () => {
    render(<RunAnalysisButton state={makeState({
      panels: [{ id: 'p1', x: 0, y: 0, width: 1, height: 1.7, azimuth: 0, tilt: 20, shadePointIds: [] }],
      strings: [{ id: 1, panelIds: ['p1'] }],
      selectedPanel: mockPanel, selectedInverter: mockInverter,
      panelKey: 'rec_440', inverterKey: 'sol_ark',
      isAnalyzing: true, analysisProgress: { percent: 42, stage: 'Model A' },
    })} dispatch={mockDispatch} />);
    expect(screen.getByText(/42%/)).toBeInTheDocument();
    expect(screen.getByText(/Model A/)).toBeInTheDocument();
  });

  it('shows stale indicator when resultStale is true', () => {
    render(<RunAnalysisButton state={makeState({
      panels: [{ id: 'p1', x: 0, y: 0, width: 1, height: 1.7, azimuth: 0, tilt: 20, shadePointIds: [] }],
      strings: [{ id: 1, panelIds: ['p1'] }],
      selectedPanel: mockPanel, selectedInverter: mockInverter,
      panelKey: 'rec_440', inverterKey: 'sol_ark',
      resultStale: true, result: {} as any,
    })} dispatch={mockDispatch} />);
    expect(screen.getByTestId('stale-indicator')).toBeInTheDocument();
  });

  it('shows error when analysisError is set', () => {
    render(<RunAnalysisButton state={makeState({
      panels: [{ id: 'p1', x: 0, y: 0, width: 1, height: 1.7, azimuth: 0, tilt: 20, shadePointIds: [] }],
      strings: [{ id: 1, panelIds: ['p1'] }],
      selectedPanel: mockPanel, selectedInverter: mockInverter,
      panelKey: 'rec_440', inverterKey: 'sol_ark',
      analysisError: 'Worker crashed',
    })} dispatch={mockDispatch} />);
    expect(screen.getByText(/Worker crashed/)).toBeInTheDocument();
  });
});
