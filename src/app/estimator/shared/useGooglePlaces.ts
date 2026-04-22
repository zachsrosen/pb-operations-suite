"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Reliably loads the Google Maps JS + Places library and attaches
 * Places Autocomplete to a text input via a ref callback.
 *
 * Usage:
 *   const { attach, error } = useGooglePlacesAutocomplete((place) => { ... });
 *   return <input ref={attach} ... />;
 *
 * Ref-callback pattern (not useEffect) — ref callbacks fire synchronously
 * when the DOM node mounts/unmounts, which avoids timing issues where a
 * useEffect runs before `ref.current` is populated, or fires on a stale
 * element after conditional re-render.
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
  if (existing) return pollUntilReady();

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&loading=async`;
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error("Failed to load Google Maps script"));
    script.onload = () => pollUntilReady().then(resolve, reject);
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

export interface UseGooglePlacesReturn {
  /** Ref callback to pass to <input ref={attach} />. */
  attach: (el: HTMLInputElement | null) => void;
  error: string | null;
}

export function useGooglePlacesAutocomplete(
  onPlaceChanged: (place: PlaceResult) => void,
  options?: { skip?: boolean },
): UseGooglePlacesReturn {
  const [error, setError] = useState<string | null>(null);
  const acRef = useRef<AutocompleteInstance | null>(null);
  const elRef = useRef<HTMLInputElement | null>(null);
  // Latest callback without re-binding the Places listener.
  const callbackRef = useRef(onPlaceChanged);
  callbackRef.current = onPlaceChanged;

  const attach = useCallback(
    (el: HTMLInputElement | null) => {
      if (!el) {
        elRef.current = null;
        acRef.current = null;
        return;
      }
      if (elRef.current === el && acRef.current) return;
      elRef.current = el;

      if (options?.skip) return;

      const apiKey =
        process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY ||
        process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
      if (!apiKey) {
        setError("No Google Maps API key configured");
        return;
      }

      loadGooglePlaces(apiKey)
        .then(() => {
          if (elRef.current !== el) return;
          const g = getWindowGoogle();
          if (!g?.maps?.places?.Autocomplete) {
            setError("Places library unavailable");
            return;
          }
          const ac = new g.maps.places.Autocomplete(el, {
            types: ["address"],
            componentRestrictions: { country: "us" },
            fields: ["address_components", "formatted_address", "geometry"],
          });
          acRef.current = ac;
          ac.addListener("place_changed", () => {
            const place = ac.getPlace();
            if (place && place.address_components) {
              callbackRef.current(place);
            }
          });
          setError(null);
        })
        .catch((err: Error) => {
          console.warn("[estimator] google places load failed", err);
          setError(err.message);
        });
    },
    [options?.skip],
  );

  return { attach, error };
}
