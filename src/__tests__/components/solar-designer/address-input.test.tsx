import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AddressInput from '@/components/solar-designer/AddressInput';

// Mock fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

const mockDispatch = jest.fn();

beforeEach(() => {
  mockFetch.mockReset();
  mockDispatch.mockReset();
});

describe('AddressInput', () => {
  it('renders an input field', () => {
    render(<AddressInput dispatch={mockDispatch} formattedAddress={null} />);
    expect(screen.getByPlaceholderText(/address/i)).toBeInTheDocument();
  });

  it('dispatches SET_ADDRESS on successful geocode', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: { lat: 39.74, lng: -104.99, formattedAddress: '1234 Main St, Denver, CO' },
      }),
    });

    render(<AddressInput dispatch={mockDispatch} formattedAddress={null} />);
    const input = screen.getByPlaceholderText(/address/i);
    fireEvent.change(input, { target: { value: '1234 Main St Denver' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'SET_ADDRESS',
        address: '1234 Main St Denver',
        formattedAddress: '1234 Main St, Denver, CO',
        lat: 39.74,
        lng: -104.99,
      });
    });
  });

  it('shows formatted address after successful geocode', () => {
    render(<AddressInput dispatch={mockDispatch} formattedAddress="1234 Main St, Denver, CO" />);
    expect(screen.getByText(/1234 main st/i)).toBeInTheDocument();
  });

  it('shows error on geocode failure (HTTP error)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Server error' }),
    });

    render(<AddressInput dispatch={mockDispatch} formattedAddress={null} />);
    const input = screen.getByPlaceholderText(/address/i);
    fireEvent.change(input, { target: { value: 'invalid' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(screen.getByText(/error/i)).toBeInTheDocument();
    });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('shows error when geocode returns no results (data: null)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: null, reason: 'NO_RESULTS' }),
    });

    render(<AddressInput dispatch={mockDispatch} formattedAddress={null} />);
    const input = screen.getByPlaceholderText(/address/i);
    fireEvent.change(input, { target: { value: 'nonexistent place' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(screen.getByText(/not found/i)).toBeInTheDocument();
    });
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});
