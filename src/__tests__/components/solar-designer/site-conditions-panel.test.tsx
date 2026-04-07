import { render, screen, fireEvent } from '@testing-library/react';
import SiteConditionsPanel from '@/components/solar-designer/SiteConditionsPanel';
import { DEFAULT_SITE_CONDITIONS, DEFAULT_LOSS_PROFILE } from '@/lib/solar/v12-engine';

const mockDispatch = jest.fn();

describe('SiteConditionsPanel', () => {
  beforeEach(() => mockDispatch.mockClear());

  it('renders with default values', () => {
    render(<SiteConditionsPanel siteConditions={DEFAULT_SITE_CONDITIONS} lossProfile={DEFAULT_LOSS_PROFILE} dispatch={mockDispatch} />);
    const tempMin = screen.getByLabelText(/min temp/i) as HTMLInputElement;
    expect(tempMin.value).toBe('-10');
  });

  it('dispatches SET_SITE_CONDITIONS on temp change', () => {
    render(<SiteConditionsPanel siteConditions={DEFAULT_SITE_CONDITIONS} lossProfile={DEFAULT_LOSS_PROFILE} dispatch={mockDispatch} />);
    const tempMin = screen.getByLabelText(/min temp/i);
    fireEvent.change(tempMin, { target: { value: '-15' } });
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_SITE_CONDITIONS' }));
  });

  it('renders loss profile fields', () => {
    render(<SiteConditionsPanel siteConditions={DEFAULT_SITE_CONDITIONS} lossProfile={DEFAULT_LOSS_PROFILE} dispatch={mockDispatch} />);
    expect(screen.getByLabelText(/soiling/i)).toBeInTheDocument();
  });
});
