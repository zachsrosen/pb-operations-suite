"use client";

import { useEffect, useState } from "react";

/**
 * Reliably loads the Google Maps JS + Places library and attaches
 * Places Autocomplete to the given input. Returns `ready` state so
 * callers know when autocomplete is attached.
 *
 * Replaces Next.js <Script> + onLoad, which didn't fire reliably on
 * SPA client-side navigation when the script was already cached.
 *
 * Callback fires each time the user picks a place.
 */
type PlaceResult = {
  address_components?: Array<{ long_name: string; short_name: string; types: string[] }>;
  formatted_address?: string;
  geometry?: { location?: { lat: () => number; lng: () => number } };
};

type AutocompleteInstance = {
  addListener: (evt: string, cb: () => void) => void;
  getPlace: () => PlaceResult;
};

type GMaps = {
  maps?: {
    places?: {
      Autocomplete: new (
        el: HTMLInputElement,
        opts: { types?: string[]; componentRestrictions?: { country: string }; fields?: string[] },
      ) => AutocompleteInstance;
    };
  };
};

const SCRIPT_ID = "google-maps-places-script";

function getWindowGoogle(): GMaps | undefined {
  return (window as unknown as { google?: GMaps }).google;
}

function isPlacesReady(): boolean {
  return !!getWindowGoogle()?.maps?.places?.Autocomplete;
}

function loadGooglePlaces(apiKey: string): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("SSR"));
  if (isPlacesReady()) return Promise.resolve();

  const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
  if (existing) {
    // Another mount started the load; just poll.
    return pollUntilReady();
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&loading=async`;
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error("Failed to load Google Maps script"));
    script.onload = () => {
      // onload fires before async libraries have resolved — poll for readiness.
      pollUntilReady().then(resolve, reject);
    };
    document.head.appendChild(script);
  });
}

function pollUntilReady(timeoutMs = 8000, intervalMs = 100): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (isPlacesReady()) return resolve();
      if (Date.now() - start > timeoutMs) {
        return reject(new Error("Google Places library did not initialize in time"));
      }
      window.setTimeout(tick, intervalMs);
    };
    tick();
  });
}

export function useGooglePlacesAutocomplete(
  inputRef: React.RefObject<HTMLInputElement | null>,
  onPlaceChanged: (place: PlaceResult) => void,
  options?: { skip?: boolean },
): { ready: boolean; error: string | null } {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (options?.skip) return;
    if (!inputRef.current) return;

    const apiKey =
      process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY ||
      process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

    if (!apiKey) {
      setError("No Google Maps API key configured");
      return;
    }

    let cancelled = false;
    let autocomplete: AutocompleteInstance | null = null;

    loadGooglePlaces(apiKey)
      .then(() => {
        if (cancelled || !inputRef.current) return;
        const g = getWindowGoogle();
        if (!g?.maps?.places?.Autocomplete) {
          setError("Places library unavailable");
          return;
        }
        autocomplete = new g.maps.places.Autocomplete(inputRef.current, {
          types: ["address"],
          componentRestrictions: { country: "us" },
          fields: ["address_components", "formatted_address", "geometry"],
        });
        autocomplete.addListener("place_changed", () => {
          if (!autocomplete) return;
          const place = autocomplete.getPlace();
          if (place && place.address_components) {
            onPlaceChanged(place);
          }
        });
        setReady(true);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        console.warn("[estimator] google places load failed", err);
        setError(err.message);
      });

    return () => {
      cancelled = true;
      // Autocomplete has no explicit dispose; GC picks it up when the
      // input element is removed.
    };
    // onPlaceChanged is deliberately excluded — the autocomplete binds once
    // per mount and we don't want to re-bind on parent re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputRef, options?.skip]);

  return { ready, error };
}
