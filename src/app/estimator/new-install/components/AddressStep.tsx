"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, type Dispatch } from "react";

import type { AddressParts } from "@/lib/estimator";

import { useGooglePlacesAutocomplete } from "@/app/estimator/shared/useGooglePlaces";
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
  const searchParams = useSearchParams();
  const embedSuffix = searchParams?.get("embed") === "1" ? "&embed=1" : "";
  const [mode, setMode] = useState<"auto" | "manual">("auto");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ref-callback-based Places loader — fires reliably when the input mounts,
  // unlike a useEffect gate which raced with the ref assignment.
  const { attach: placesRef, error: googleError } = useGooglePlacesAutocomplete(
    (place) => {
      const parts = extractAddressFromPlace(place as PlaceResult);
      dispatch({ type: "setAddressInput", value: parts });
    },
    { skip: mode !== "auto" },
  );

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
        router.push(`/estimator/out-of-area?zip=${encodeURIComponent(data.normalized.zip)}${embedSuffix}`);
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
      <StepLayout
        eyebrow="Let's get started"
        title="Where's home?"
        subtitle="We'll pull satellite imagery of your roof and check which utility serves you. This takes about a minute."
        footer={
          <>
            <button
              type="button"
              onClick={handleContinue}
              disabled={loading || !canSubmit}
              className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-6 py-3 text-sm font-semibold text-white shadow-card transition hover:-translate-y-0.5 hover:bg-orange-600 hover:shadow-card-lg disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
            >
              {loading ? "Checking…" : "Continue"}
              {!loading && <span aria-hidden>→</span>}
            </button>
            {error && <span className="text-sm text-red-500">{error}</span>}
          </>
        }
      >
        {mode === "auto" ? (
          <div className="flex flex-col gap-3">
            <label htmlFor="address" className="text-sm font-medium">
              Street address
            </label>
            <div className="group relative">
              <span
                aria-hidden
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted transition group-focus-within:text-orange-500"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z" />
                  <circle cx="12" cy="9" r="2.5" />
                </svg>
              </span>
              <input
                id="address"
                ref={placesRef}
                type="text"
                autoComplete="off"
                placeholder="123 Main Street, Denver, CO"
                defaultValue={input.formatted ?? ""}
                className="w-full rounded-xl border border-t-border bg-surface-2 py-3.5 pl-11 pr-4 text-base outline-none ring-0 transition placeholder:text-muted/70 focus:border-orange-500 focus:bg-surface-elevated focus:ring-2 focus:ring-orange-500/20"
                onChange={(e) => {
                  dispatch({ type: "setAddressInput", value: { formatted: e.target.value } });
                }}
              />
            </div>
            <div className="mt-2 flex flex-col gap-2">
              <label htmlFor="unit" className="text-sm font-medium">
                Unit or apt <span className="font-normal text-muted">(optional)</span>
              </label>
              <input
                id="unit"
                type="text"
                placeholder="Apt 4B"
                value={input.unit ?? ""}
                onChange={(e) =>
                  dispatch({ type: "setAddressInput", value: { unit: e.target.value } })
                }
                className="w-full rounded-xl border border-t-border bg-surface-2 px-4 py-3 text-sm outline-none transition placeholder:text-muted/70 focus:border-orange-500 focus:bg-surface-elevated focus:ring-2 focus:ring-orange-500/20"
              />
            </div>
            <button
              type="button"
              onClick={() => setMode("manual")}
              className="mt-1 self-start text-xs font-medium text-muted underline-offset-4 hover:text-foreground hover:underline"
            >
              Enter address manually
            </button>
            {googleError && (
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
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-t-border bg-surface-2 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-surface-elevated focus:ring-2 focus:ring-orange-500/20"
      />
    </label>
  );
}
