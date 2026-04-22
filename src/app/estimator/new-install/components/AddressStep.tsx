"use client";

import Script from "next/script";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type Dispatch } from "react";

import type { AddressParts } from "@/lib/estimator";

import type { WizardAction, WizardState } from "../state";
import StepLayout from "./StepLayout";

type Props = {
  state: WizardState;
  dispatch: Dispatch<WizardAction>;
  onContinue: () => void;
};

type PlaceResult = {
  formatted_address: string;
  address_components: Array<{ long_name: string; short_name: string; types: string[] }>;
  geometry?: { location?: { lat: () => number; lng: () => number } };
};

function extractAddressFromPlace(place: PlaceResult): Partial<AddressParts> {
  const get = (type: string, short = false): string => {
    const comp = place.address_components.find((c) => c.types.includes(type));
    if (!comp) return "";
    return short ? comp.short_name : comp.long_name;
  };
  const streetNumber = get("street_number");
  const route = get("route");
  const city = get("locality") || get("sublocality") || get("administrative_area_level_3");
  const state = get("administrative_area_level_1", true);
  const zip = get("postal_code");
  const lat = place.geometry?.location?.lat();
  const lng = place.geometry?.location?.lng();
  return {
    street: [streetNumber, route].filter(Boolean).join(" "),
    city,
    state,
    zip,
    lat,
    lng,
    formatted: place.formatted_address,
  };
}

export default function AddressStep({ state, dispatch, onContinue }: Props) {
  const router = useRouter();
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY;
  const [mode, setMode] = useState<"auto" | "manual">("auto");
  const [googleReady, setGoogleReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const autoRef = useRef<unknown>(null);

  // Attach Google autocomplete once the script loads.
  useEffect(() => {
    if (mode !== "auto" || !googleReady || !inputRef.current) return;
    const g = (window as unknown as { google?: { maps?: { places?: { Autocomplete: new (el: HTMLInputElement, opts: object) => { addListener: (evt: string, cb: () => void) => void; getPlace: () => PlaceResult } } } } }).google;
    if (!g?.maps?.places) return;
    const ac = new g.maps.places.Autocomplete(inputRef.current, {
      types: ["address"],
      componentRestrictions: { country: "us" },
      fields: ["address_components", "formatted_address", "geometry"],
    });
    autoRef.current = ac;
    ac.addListener("place_changed", () => {
      const place = ac.getPlace();
      if (!place || !place.address_components) return;
      const parts = extractAddressFromPlace(place);
      dispatch({ type: "setAddressInput", value: parts });
    });
  }, [mode, googleReady, dispatch]);

  const input = state.addressInput;
  const canSubmit =
    mode === "auto"
      ? Boolean(input.street && input.city && input.state && input.zip)
      : Boolean(input.street && input.city && input.state && input.zip);

  async function handleContinue(): Promise<void> {
    if (!canSubmit) {
      setError("Please provide a complete address.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/estimator/address-validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          street: input.street,
          unit: input.unit || undefined,
          city: input.city,
          state: input.state,
          zip: input.zip,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Could not validate address. Please check and try again.");
        return;
      }
      const data = (await res.json()) as {
        normalized: AddressParts;
        inServiceArea: boolean;
        location: import("@/lib/estimator").Location | null;
        utilities: Array<{ id: string; displayName: string; kwhRate: number }>;
      };
      if (!data.inServiceArea) {
        router.push(`/estimator/out-of-area?zip=${encodeURIComponent(data.normalized.zip)}`);
        return;
      }
      dispatch({
        type: "setValidatedAddress",
        address: data.normalized,
        location: data.location,
        inServiceArea: true,
        utilities: data.utilities,
      });
      onContinue();
    } catch (err) {
      console.error(err);
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {apiKey && mode === "auto" && (
        <Script
          src={`https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&loading=async`}
          strategy="afterInteractive"
          onReady={() => setGoogleReady(true)}
          onLoad={() => setGoogleReady(true)}
        />
      )}
      <StepLayout
        title="What's your home address?"
        subtitle="We use this to pull satellite imagery and check utility coverage."
        footer={
          <>
            <button
              type="button"
              onClick={handleContinue}
              disabled={loading || !canSubmit}
              className="rounded-lg bg-orange-500 px-5 py-2.5 text-sm font-medium text-white shadow-card transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Checking…" : "Continue"}
            </button>
            {error && <span className="text-sm text-red-500">{error}</span>}
          </>
        }
      >
        {mode === "auto" ? (
          <div className="flex flex-col gap-2">
            <label htmlFor="address" className="text-sm font-medium">
              Address
            </label>
            <input
              id="address"
              ref={inputRef}
              type="text"
              autoComplete="off"
              placeholder="Start typing your address…"
              defaultValue={input.formatted ?? ""}
              className="w-full rounded-lg border border-t-border bg-surface-2 px-4 py-2.5 text-sm outline-none focus:border-orange-500"
              onChange={(e) => {
                // If user types manually, mirror to street field so submission still works.
                dispatch({ type: "setAddressInput", value: { formatted: e.target.value } });
              }}
            />
            <div className="mt-2 flex flex-col gap-2">
              <label htmlFor="unit" className="text-sm font-medium">
                Unit / Apt (optional)
              </label>
              <input
                id="unit"
                type="text"
                value={input.unit ?? ""}
                onChange={(e) =>
                  dispatch({ type: "setAddressInput", value: { unit: e.target.value } })
                }
                className="w-full rounded-lg border border-t-border bg-surface-2 px-4 py-2.5 text-sm outline-none focus:border-orange-500"
              />
            </div>
            <button
              type="button"
              onClick={() => setMode("manual")}
              className="mt-1 self-start text-xs text-muted underline hover:text-foreground"
            >
              Enter address manually
            </button>
            {!apiKey && (
              <p className="text-xs text-muted">
                Autocomplete unavailable — use manual entry below.
              </p>
            )}
          </div>
        ) : (
          <ManualAddressFields state={state} dispatch={dispatch} onSwitch={() => setMode("auto")} />
        )}
      </StepLayout>
    </>
  );
}

function ManualAddressFields({
  state,
  dispatch,
  onSwitch,
}: {
  state: WizardState;
  dispatch: Dispatch<WizardAction>;
  onSwitch: () => void;
}) {
  const { addressInput } = state;
  const update = (patch: Partial<AddressParts>) =>
    dispatch({ type: "setAddressInput", value: patch });

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Street" value={addressInput.street ?? ""} onChange={(v) => update({ street: v })} />
      <Field label="Unit / Apt (optional)" value={addressInput.unit ?? ""} onChange={(v) => update({ unit: v })} />
      <Field label="City" value={addressInput.city ?? ""} onChange={(v) => update({ city: v })} />
      <Field
        label="State"
        value={addressInput.state ?? ""}
        onChange={(v) => update({ state: v.toUpperCase().slice(0, 2) })}
      />
      <Field label="ZIP" value={addressInput.zip ?? ""} onChange={(v) => update({ zip: v })} />
      <button
        type="button"
        onClick={onSwitch}
        className="mt-1 self-start text-xs text-muted underline hover:text-foreground sm:col-span-2"
      >
        Use autocomplete instead
      </button>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-t-border bg-surface-2 px-4 py-2.5 text-sm outline-none focus:border-orange-500"
      />
    </label>
  );
}
