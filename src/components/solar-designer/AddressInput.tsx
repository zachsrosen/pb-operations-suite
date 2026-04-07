'use client';

import { useState, useCallback } from 'react';
import type { SolarDesignerAction } from './types';

interface AddressInputProps {
  dispatch: (action: SolarDesignerAction) => void;
  formattedAddress: string | null;
}

export default function AddressInput({ dispatch, formattedAddress }: AddressInputProps) {
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/solar/geocode?address=${encodeURIComponent(trimmed)}`);
      if (!res.ok) {
        let msg = 'Geocode failed';
        try {
          const body = await res.json();
          if (body.error) msg = body.error;
        } catch { /* non-JSON response */ }
        throw new Error(msg);
      }

      const body = await res.json();
      if (!body.data) {
        throw new Error(body.reason === 'NO_RESULTS' ? 'Address not found' : 'Geocode returned no results');
      }
      dispatch({
        type: 'SET_ADDRESS',
        address: trimmed,
        formattedAddress: body.data.formattedAddress,
        lat: body.data.lat,
        lng: body.data.lng,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Geocode failed');
    } finally {
      setLoading(false);
    }
  }, [value, dispatch]);

  return (
    <div className="rounded-xl bg-surface p-4 shadow-card space-y-2">
      <h3 className="text-sm font-semibold text-foreground">Site Address</h3>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Enter site address"
          className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-t-border bg-surface-2 text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-orange-500"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !value.trim()}
          className="px-3 py-1.5 text-sm font-medium rounded-lg bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? '...' : 'Go'}
        </button>
      </form>
      {formattedAddress && (
        <p className="text-xs text-green-500 truncate">{formattedAddress}</p>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
