import { render, screen } from '@testing-library/react';
import StringingTab from '@/components/solar-designer/StringingTab';
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
  activeTab: 'stringing',
  isUploading: false,
  uploadError: null,
};

describe('StringingTab', () => {
  it('renders empty state when no panels', () => {
    render(<StringingTab state={baseState} dispatch={jest.fn()} />);
    expect(screen.getByText(/upload.*layout/i)).toBeInTheDocument();
  });

  it('renders StringList sidebar when panels exist', () => {
    const state = {
      ...baseState,
      panels: [
        { id: 'p1', x: 0, y: 0, width: 1, height: 1.7, azimuth: 0, tilt: 20, shadePointIds: [] },
      ],
    };
    render(<StringingTab state={state} dispatch={jest.fn()} />);
    expect(screen.getByText(/strings/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new/i })).toBeInTheDocument();
  });

  it('shows auto-string button when equipment is selected', () => {
    const state = {
      ...baseState,
      panels: [
        { id: 'p1', x: 0, y: 0, width: 1, height: 1.7, azimuth: 0, tilt: 20, shadePointIds: [] },
      ],
      selectedPanel: {
        key: 'rec_440', name: 'REC 440', watts: 440,
        voc: 48.4, vmp: 40.8, isc: 11.5, imp: 10.79,
        tempCoVoc: -0.0024, tempCoIsc: 0.0004, tempCoPmax: -0.0026,
        cells: 132, bypassDiodes: 3, cellsPerSubstring: 44,
        isBifacial: false, bifacialityFactor: 0,
      },
      selectedInverter: {
        key: 'tesla_pw3', name: 'Tesla PW3', acPower: 11500, dcMax: 15000,
        mpptMin: 60, mpptMax: 500, channels: 6, maxIsc: 25,
        efficiency: 0.975, architectureType: 'string' as const, isMicro: false, isIntegrated: true,
      },
      panelKey: 'rec_440',
    };
    render(<StringingTab state={state} dispatch={jest.fn()} />);
    expect(screen.getByRole('button', { name: /auto/i })).toBeInTheDocument();
  });

  it('shows unassigned panel count', () => {
    const state = {
      ...baseState,
      panels: [
        { id: 'p1', x: 0, y: 0, width: 1, height: 1.7, azimuth: 0, tilt: 20, shadePointIds: [] },
        { id: 'p2', x: 2, y: 0, width: 1, height: 1.7, azimuth: 0, tilt: 20, shadePointIds: [] },
      ],
    };
    render(<StringingTab state={state} dispatch={jest.fn()} />);
    expect(screen.getByText(/2 unassigned/i)).toBeInTheDocument();
  });
});
