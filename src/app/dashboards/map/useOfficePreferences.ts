"use client";

import { useEffect, useState } from "react";
import { getOfficeByPbLocation, getOfficeById, OFFICES, type OfficeLocation } from "@/lib/map-offices";

const STORAGE_KEY_OFFICE = "map.dispatcherOfficeId";
const STORAGE_KEY_RADIUS = "map.nearMeRadiusMiles";
const DEFAULT_RADIUS_MILES = 15;

export interface OfficePreferences {
  office: OfficeLocation | null;
  radiusMiles: number;
  setOfficeId: (id: string | null) => void;
  setRadiusMiles: (miles: number) => void;
}

/**
 * Resolve the dispatcher's office + "near me" radius.
 *
 * Priority:
 *   1. Explicit user preference in localStorage (set via the UI)
 *   2. Auto-detect from the logged-in user's `allowedLocations[0]` (server-provided)
 *   3. null → user is prompted to pick one
 */
export function useOfficePreferences(initialPbLocation?: string | null): OfficePreferences {
  const [officeId, setOfficeIdState] = useState<string | null>(null);
  const [radiusMiles, setRadiusMilesState] = useState<number>(DEFAULT_RADIUS_MILES);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage on mount.
  useEffect(() => {
    try {
      const storedOffice = window.localStorage.getItem(STORAGE_KEY_OFFICE);
      const storedRadius = window.localStorage.getItem(STORAGE_KEY_RADIUS);
      if (storedOffice) {
        setOfficeIdState(storedOffice);
      } else if (initialPbLocation) {
        const detected = getOfficeByPbLocation(initialPbLocation);
        if (detected) setOfficeIdState(detected.id);
      }
      if (storedRadius) {
        const n = Number(storedRadius);
        if (!Number.isNaN(n) && n > 0) setRadiusMilesState(n);
      }
    } catch {
      // localStorage can throw in some privacy modes — ignore
    } finally {
      setHydrated(true);
    }
  }, [initialPbLocation]);

  const setOfficeId = (id: string | null) => {
    setOfficeIdState(id);
    try {
      if (id) window.localStorage.setItem(STORAGE_KEY_OFFICE, id);
      else window.localStorage.removeItem(STORAGE_KEY_OFFICE);
    } catch {}
  };

  const setRadiusMiles = (miles: number) => {
    setRadiusMilesState(miles);
    try {
      window.localStorage.setItem(STORAGE_KEY_RADIUS, String(miles));
    } catch {}
  };

  const office = hydrated && officeId ? getOfficeById(officeId) : null;

  return {
    office,
    radiusMiles,
    setOfficeId,
    setRadiusMiles,
  };
}

export { DEFAULT_RADIUS_MILES, OFFICES };
