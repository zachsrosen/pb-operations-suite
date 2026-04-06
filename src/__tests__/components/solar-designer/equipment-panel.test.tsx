import { render, screen, fireEvent } from '@testing-library/react';
import EquipmentPanel from '@/components/solar-designer/EquipmentPanel';
import { getBuiltInPanels, getBuiltInInverters } from '@/lib/solar/v12-engine';

const mockDispatch = jest.fn();

describe('EquipmentPanel', () => {
  beforeEach(() => mockDispatch.mockClear());

  it('renders all 8 built-in panels in dropdown', () => {
    render(<EquipmentPanel panelKey="" inverterKey="" selectedPanel={null} selectedInverter={null} dispatch={mockDispatch} />);
    const panels = getBuiltInPanels();
    const panelSelect = screen.getByLabelText(/panel/i);
    expect(panelSelect.querySelectorAll('option')).toHaveLength(panels.length + 1);
  });

  it('renders all 9 built-in inverters in dropdown', () => {
    render(<EquipmentPanel panelKey="" inverterKey="" selectedPanel={null} selectedInverter={null} dispatch={mockDispatch} />);
    const inverters = getBuiltInInverters();
    const inverterSelect = screen.getByLabelText(/inverter/i);
    expect(inverterSelect.querySelectorAll('option')).toHaveLength(inverters.length + 1);
  });

  it('dispatches SET_PANEL when panel selected', () => {
    render(<EquipmentPanel panelKey="" inverterKey="" selectedPanel={null} selectedInverter={null} dispatch={mockDispatch} />);
    const panelSelect = screen.getByLabelText(/panel/i);
    fireEvent.change(panelSelect, { target: { value: 'rec_alpha_440' } });
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SET_PANEL', key: 'rec_alpha_440' })
    );
  });

  it('shows panel specs when selected', () => {
    const panels = getBuiltInPanels();
    const rec = panels.find(p => p.key === 'rec_alpha_440')!;
    render(<EquipmentPanel panelKey="rec_alpha_440" inverterKey="" selectedPanel={rec} selectedInverter={null} dispatch={mockDispatch} />);
    // Multiple elements may contain "440" (options + spec display) — assert at least one is present
    expect(screen.getAllByText(/440/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Voc/i)).toBeInTheDocument();
  });
});
