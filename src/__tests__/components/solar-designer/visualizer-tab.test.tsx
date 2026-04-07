import { render, screen } from '@testing-library/react';
import VisualizerTab from '@/components/solar-designer/VisualizerTab';
import type { SolarDesignerState } from '@/components/solar-designer/types';
import { DEFAULT_MAP_ALIGNMENT } from '@/components/solar-designer/types';
import { DEFAULT_SITE_CONDITIONS, DEFAULT_LOSS_PROFILE } from '@/lib/solar/v12-engine';

const baseState: SolarDesignerState = {
  panels: [],
  shadeData: {},
  shadeFidelity: 'full',
  shadeSource: 'manual',
  radiancePoints: [],
  uploadedFiles: [],
  panelShadeMap: {},
  siteAddress: null,
  siteFormattedAddress: null,
  siteLatLng: null,
  mapAlignment: DEFAULT_MAP_ALIGNMENT,
  panelKey: '',
  inverterKey: '',
  selectedPanel: null,
  selectedInverter: null,
  siteConditions: DEFAULT_SITE_CONDITIONS,
  lossProfile: DEFAULT_LOSS_PROFILE,
  strings: [],
  activeStringId: null,
  nextStringId: 1,
  inverters: [],
  result: null,
  isAnalyzing: false,
  analysisProgress: null,
  analysisError: null,
  resultStale: false,
  activeTab: 'visualizer',
  isUploading: false,
  uploadError: null,
};

describe('VisualizerTab', () => {
  it('renders empty state when no panels', () => {
    render(<VisualizerTab state={baseState} dispatch={jest.fn()} />);
    expect(screen.getByText(/upload.*layout/i)).toBeInTheDocument();
  });

  it('renders shade slider when panels exist', () => {
    const state = {
      ...baseState,
      panels: [
        { id: 'p1', x: 0, y: 0, width: 1, height: 1.7, azimuth: 0, tilt: 20, shadePointIds: [] },
      ],
    };
    render(<VisualizerTab state={state} dispatch={jest.fn()} />);
    expect(screen.getByText(/day/i)).toBeInTheDocument();
    expect(screen.getByText(/time/i)).toBeInTheDocument();
  });

  it('renders shade/tsrf toggle', () => {
    const state = {
      ...baseState,
      panels: [
        { id: 'p1', x: 0, y: 0, width: 1, height: 1.7, azimuth: 0, tilt: 20, shadePointIds: [] },
      ],
    };
    render(<VisualizerTab state={state} dispatch={jest.fn()} />);
    expect(screen.getByText(/shade/i)).toBeInTheDocument();
    expect(screen.getByText(/tsrf/i)).toBeInTheDocument();
  });
});
