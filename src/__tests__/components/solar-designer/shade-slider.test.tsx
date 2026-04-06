import { render, screen, fireEvent } from '@testing-library/react';
import ShadeSlider from '@/components/solar-designer/ShadeSlider';

describe('ShadeSlider', () => {
  it('renders day and time sliders', () => {
    render(<ShadeSlider onTimestepChange={jest.fn()} />);
    expect(screen.getByText(/day/i)).toBeInTheDocument();
    expect(screen.getByText(/time/i)).toBeInTheDocument();
  });

  it('shows default date as Jun 21', () => {
    render(<ShadeSlider onTimestepChange={jest.fn()} />);
    expect(screen.getByText(/jun 21/i)).toBeInTheDocument();
  });

  it('shows default time as 2:00 PM', () => {
    render(<ShadeSlider onTimestepChange={jest.fn()} />);
    expect(screen.getByText(/2:00 pm/i)).toBeInTheDocument();
  });

  it('calls onTimestepChange with correct index on day change', () => {
    const onChange = jest.fn();
    render(<ShadeSlider onTimestepChange={onChange} />);
    const daySlider = screen.getByLabelText(/day/i);
    fireEvent.change(daySlider, { target: { value: '1' } });
    expect(onChange).toHaveBeenCalledWith(28);
  });

  it('computes timestep as (day-1)*48 + timeSlot', () => {
    const onChange = jest.fn();
    render(<ShadeSlider onTimestepChange={onChange} />);
    const timeSlider = screen.getByLabelText(/time/i);
    fireEvent.change(timeSlider, { target: { value: '0' } });
    expect(onChange).toHaveBeenCalledWith(8208);
  });
});
