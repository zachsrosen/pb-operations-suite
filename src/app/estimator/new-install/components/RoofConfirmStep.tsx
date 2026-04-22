"use client";

import { useState } from "react";

import type { WizardState } from "../state";
import StepLayout from "./StepLayout";

type Props = {
  state: WizardState;
  onBack: () => void;
  onContinue: () => void;
};

export default function RoofConfirmStep({ state, onBack, onContinue }: Props) {
  const [imgError, setImgError] = useState(false);
  const addr = state.normalizedAddress;
  if (!addr) return null;

  const formatted =
    addr.formatted ??
    [addr.street, addr.unit, addr.city, `${addr.state} ${addr.zip}`].filter(Boolean).join(", ");

  const hasCoords = typeof addr.lat === "number" && typeof addr.lng === "number";
  const mapSrc = hasCoords
    ? `/api/estimator/static-map?lat=${addr.lat}&lng=${addr.lng}&zoom=19&w=840&h=520`
    : null;

  return (
    <StepLayout
      eyebrow="Confirm your home"
      title="Does this look right?"
      subtitle="We'll size a system based on this roof. If the pin is off, jump back and re-enter."
      onBack={onBack}
      footer={
        <>
          <button
            type="button"
            onClick={onContinue}
            className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-6 py-3 text-sm font-semibold text-white shadow-card transition hover:-translate-y-0.5 hover:bg-orange-600 hover:shadow-card-lg"
          >
            Yes, this is my home
            <span aria-hidden>→</span>
          </button>
          <button
            type="button"
            onClick={onBack}
            className="rounded-xl border border-t-border bg-surface-2 px-5 py-3 text-sm font-medium transition hover:bg-surface-elevated"
          >
            No, edit address
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex items-start gap-3 rounded-2xl border border-t-border bg-surface-2 p-4">
          <span
            aria-hidden
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-orange-500/15 text-orange-500"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z" />
              <circle cx="12" cy="9" r="2.5" />
            </svg>
          </span>
          <div className="flex flex-col">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
              Your address
            </span>
            <span className="text-sm font-medium sm:text-[15px]">{formatted}</span>
          </div>
        </div>

        {mapSrc && !imgError ? (
          <figure className="group relative overflow-hidden rounded-2xl border border-t-border bg-surface-2 shadow-card-lg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={mapSrc}
              alt={`Satellite view of ${formatted}`}
              width={840}
              height={520}
              onError={() => setImgError(true)}
              className="aspect-[16/10] w-full object-cover transition duration-500 group-hover:scale-[1.02]"
            />
            {/* Corner pin marker overlay for emphasis */}
            <div
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            >
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-orange-500 ring-2 ring-white/80" />
              </span>
            </div>
            {/* subtle top/bottom vignette */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/0 via-transparent to-black/20"
            />
            <figcaption className="absolute bottom-3 left-3 right-3 flex items-center justify-between text-[11px] font-medium text-white">
              <span className="rounded-md bg-black/50 px-2 py-1 backdrop-blur-sm">Satellite imagery</span>
            </figcaption>
          </figure>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-t-border bg-surface-2 p-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-orange-500/10 text-orange-500">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-6 w-6">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 6l9-4 9 4-9 4zM3 18l9 4 9-4M3 12l9 4 9-4" />
              </svg>
            </div>
            <p className="max-w-sm text-sm text-muted">
              We couldn&apos;t pull satellite imagery for this address right now. If the address
              above looks correct, continue — we&apos;ll verify during your consult.
            </p>
          </div>
        )}
      </div>
    </StepLayout>
  );
}
