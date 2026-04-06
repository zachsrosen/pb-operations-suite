import { render, screen, fireEvent } from '@testing-library/react';
import MapAlignmentControls from '@/components/solar-designer/MapAlignmentControls';

describe('MapAlignmentControls', () => {
  it('renders rotation and scale controls', () => {
    render(
      <MapAlignmentControls
        alignment={{ offsetX: 0, offsetY: 0, rotation: 0, scale: 1 }}
        onChange={jest.fn()}
      />
    );
    expect(screen.getByLabelText(/rotation/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/scale/i)).toBeInTheDocument();
  });

  it('calls onChange when rotation changes', () => {
    const onChange = jest.fn();
    render(
      <MapAlignmentControls
        alignment={{ offsetX: 0, offsetY: 0, rotation: 0, scale: 1 }}
        onChange={onChange}
      />
    );
    const rotationSlider = screen.getByLabelText(/rotation/i);
    fireEvent.change(rotationSlider, { target: { value: '45' } });
    expect(onChange).toHaveBeenCalledWith({ rotation: 45 });
  });

  it('calls onChange when scale changes', () => {
    const onChange = jest.fn();
    render(
      <MapAlignmentControls
        alignment={{ offsetX: 0, offsetY: 0, rotation: 0, scale: 1 }}
        onChange={onChange}
      />
    );
    const scaleSlider = screen.getByLabelText(/scale/i);
    fireEvent.change(scaleSlider, { target: { value: '1.5' } });
    expect(onChange).toHaveBeenCalledWith({ scale: 1.5 });
  });

  it('shows a reset button', () => {
    render(
      <MapAlignmentControls
        alignment={{ offsetX: 5, offsetY: 3, rotation: 30, scale: 1.2 }}
        onChange={jest.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /reset/i })).toBeInTheDocument();
  });
});
