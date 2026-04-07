import { render, screen, fireEvent } from '@testing-library/react';
import StringList from '@/components/solar-designer/StringList';
import type { ResolvedPanel, ResolvedInverter } from '@/lib/solar/v12-engine/types';

const mockPanel: ResolvedPanel = {
  key: 'rec_440', name: 'REC 440', watts: 440,
  voc: 48.4, vmp: 40.8, isc: 11.5, imp: 10.79,
  tempCoVoc: -0.0024, tempCoIsc: 0.0004, tempCoPmax: -0.0026,
  cells: 132, bypassDiodes: 3, cellsPerSubstring: 44,
  isBifacial: false, bifacialityFactor: 0,
};

const mockInverter: ResolvedInverter = {
  key: 'tesla_pw3', name: 'Tesla PW3', acPower: 11500, dcMax: 15000,
  mpptMin: 60, mpptMax: 500, channels: 6, maxIsc: 25,
  efficiency: 0.975, architectureType: 'string', isMicro: false, isIntegrated: true,
};

const mockDispatch = jest.fn();

beforeEach(() => mockDispatch.mockReset());

describe('StringList', () => {
  it('shows "New" button', () => {
    render(
      <StringList
        strings={[]}
        activeStringId={null}
        totalPanelCount={10}
        selectedPanel={mockPanel}
        selectedInverter={mockInverter}
        tempMin={-10}
        tempMax={45}
        dispatch={mockDispatch}
      />
    );
    expect(screen.getByRole('button', { name: /new/i })).toBeInTheDocument();
  });

  it('dispatches CREATE_STRING when New is clicked', () => {
    render(
      <StringList
        strings={[]}
        activeStringId={null}
        totalPanelCount={10}
        selectedPanel={mockPanel}
        selectedInverter={mockInverter}
        tempMin={-10}
        tempMax={45}
        dispatch={mockDispatch}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /new/i }));
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'CREATE_STRING' });
  });

  it('renders a card per string with panel count', () => {
    render(
      <StringList
        strings={[
          { id: 1, panelIds: ['p1', 'p2', 'p3'] },
          { id: 2, panelIds: ['p4'] },
        ]}
        activeStringId={null}
        totalPanelCount={10}
        selectedPanel={mockPanel}
        selectedInverter={mockInverter}
        tempMin={-10}
        tempMax={45}
        dispatch={mockDispatch}
      />
    );
    expect(screen.getByText(/3 panels/i)).toBeInTheDocument();
    expect(screen.getByText(/1 panel\b/i)).toBeInTheDocument();
  });

  it('shows unassigned panel count', () => {
    render(
      <StringList
        strings={[{ id: 1, panelIds: ['p1', 'p2'] }]}
        activeStringId={null}
        totalPanelCount={5}
        selectedPanel={mockPanel}
        selectedInverter={mockInverter}
        tempMin={-10}
        tempMax={45}
        dispatch={mockDispatch}
      />
    );
    expect(screen.getByText(/3 unassigned/i)).toBeInTheDocument();
  });

  it('shows voltage validation for strings when equipment is selected', () => {
    render(
      <StringList
        strings={[{ id: 1, panelIds: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'] }]}
        activeStringId={null}
        totalPanelCount={10}
        selectedPanel={mockPanel}
        selectedInverter={mockInverter}
        tempMin={-10}
        tempMax={45}
        dispatch={mockDispatch}
      />
    );
    expect(screen.getByText(/Voc:/i)).toBeInTheDocument();
    expect(screen.getByText(/Vmp:/i)).toBeInTheDocument();
    expect(screen.getByText(/MPPT:/i)).toBeInTheDocument();
  });

  it('dispatches DELETE_STRING when delete button is clicked', () => {
    render(
      <StringList
        strings={[{ id: 1, panelIds: ['p1'] }]}
        activeStringId={null}
        totalPanelCount={5}
        selectedPanel={mockPanel}
        selectedInverter={mockInverter}
        tempMin={-10}
        tempMax={45}
        dispatch={mockDispatch}
      />
    );
    const deleteBtn = screen.getByRole('button', { name: /delete|remove/i });
    fireEvent.click(deleteBtn);
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'DELETE_STRING', stringId: 1 });
  });
});
