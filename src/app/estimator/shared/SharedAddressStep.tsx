"use client";

import { useState } from "react";

import { useGooglePlacesAutocomplete } from "./useGooglePlaces";

import type { AddressParts, Location } from "@/lib/estimator";

import StepLayout from "./StepLayout";

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

export type AddressValidateResult = {
  normalized: AddressParts;
  inServiceArea: boolean;
  location: Location | null;
  utilities: Array<{ id: string; displayName: string; kwhRate: number }>;
};

type Props = {
  title: string;
  subtitle?: string;
  addressInput: Partial<AddressParts>;
  setAddressInput: (patch: Partial<AddressParts>) => void;
  onValidated: (data: AddressValidateResult) => void;
  /** Called when the address is out of service area; receives the normalized zip. */
  onOutOfArea?: (zip: string) => void;
  onBack?: () => void;
  continueLabel?: string;
};

export default function SharedAddressStep({
  title,
  subtitle,
  addressInput,
  setAddressInput,
  onValidated,
  onOutOfArea,
  onBack,
  continueLabel,
}: Props) {
  const [mode, setMode] = useState<"auto" | "manual">("auto");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { attach: placesRef, error: googleError } = useGooglePlacesAutocomplete(
    (place) => {
      const parts = extractAddressFromPlace(place as PlaceResult);
      setAddressInput(parts);
    },
    { skip: mode !== "auto" },
  );

  const canSubmit = Boolean(
    addressInput.street && addressInput.city && addressInput.state && addressInput.zip,
  );

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
          street: addressInput.street,
          unit: addressInput.unit || undefined,
          city: addressInput.city,
          state: addressInput.state,
          zip: addressInput.zip,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Could not validate address. Please check and try again.");
        return;
      }
      const data = (await res.json()) as AddressValidateResult;
      if (!data.inServiceArea && onOutOfArea) {
        onOutOfArea(data.normalized.zip);
        return;
      }
      onValidated(data);
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
        title={title}
        subtitle={subtitle}
        onBack={onBack}
        footer={
          <>
            <button
              type="button"
              onClick={handleContinue}
              disabled={loading || !canSubmit}
              className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-6 py-3 text-sm font-semibold text-white shadow-card transition hover:-translate-y-0.5 hover:bg-orange-600 hover:shadow-card-lg disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
            >
              {loading ? "Checking…" : continueLabel ?? "Continue"}
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
                defaultValue={addressInput.formatted ?? ""}
                className="w-full rounded-xl border border-t-border bg-surface-2 py-3.5 pl-11 pr-4 text-base outline-none transition placeholder:text-muted/70 focus:border-orange-500 focus:bg-surface-elevated focus:ring-2 focus:ring-orange-500/20"
                onChange={(e) => {
                  setAddressInput({ formatted: e.target.value });
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
                value={addressInput.unit ?? ""}
                onChange={(e) => setAddressInput({ unit: e.target.value })}
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
          <ManualAddressFields
            addressInput={addressInput}
            setAddressInput={setAddressInput}
            onSwitch={() => setMode("auto")}
          />
        )}
      </StepLayout>
    </>
  );
}

function ManualAddressFields({
  addressInput,
  setAddressInput,
  onSwitch,
}: {
  addressInput: Partial<AddressParts>;
  setAddressInput: (patch: Partial<AddressParts>) => void;
  onSwitch: () => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field
        label="Street"
        value={addressInput.street ?? ""}
        onChange={(v) => setAddressInput({ street: v })}
      />
      <Field
        label="Unit / Apt (optional)"
        value={addressInput.unit ?? ""}
        onChange={(v) => setAddressInput({ unit: v })}
      />
      <Field
        label="City"
        value={addressInput.city ?? ""}
        onChange={(v) => setAddressInput({ city: v })}
      />
      <Field
        label="State"
        value={addressInput.state ?? ""}
        onChange={(v) => setAddressInput({ state: v.toUpperCase().slice(0, 2) })}
      />
      <Field
        label="ZIP"
        value={addressInput.zip ?? ""}
        onChange={(v) => setAddressInput({ zip: v })}
      />
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
