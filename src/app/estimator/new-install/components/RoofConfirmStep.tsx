"use client";

import type { WizardState } from "../state";
import StepLayout from "./StepLayout";

type Props = {
  state: WizardState;
  onBack: () => void;
  onContinue: () => void;
};

export default function RoofConfirmStep({ state, onBack, onContinue }: Props) {
  const addr = state.normalizedAddress;
  if (!addr) return null;

  const formatted =
    addr.formatted ??
    [addr.street, addr.unit, addr.city, `${addr.state} ${addr.zip}`].filter(Boolean).join(", ");

  const hasCoords = typeof addr.lat === "number" && typeof addr.lng === "number";
  const mapSrc = hasCoords
    ? `/api/estimator/static-map?lat=${addr.lat}&lng=${addr.lng}&zoom=19&w=640&h=400`
    : null;

  return (
    <StepLayout
      title="Is this the right home?"
      subtitle="We'll size a system based on this roof."
      onBack={onBack}
      footer={
        <>
          <button
            type="button"
            onClick={onContinue}
            className="rounded-lg bg-orange-500 px-5 py-2.5 text-sm font-medium text-white shadow-card transition hover:bg-orange-600"
          >
            Yes, this is my home
          </button>
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-t-border bg-surface-2 px-5 py-2.5 text-sm font-medium hover:bg-surface-elevated"
          >
            No, edit address
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-t-border bg-surface-2 p-4 text-sm">{formatted}</div>
        {mapSrc ? (
          <div className="overflow-hidden rounded-xl border border-t-border bg-surface-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={mapSrc}
              alt={`Satellite view of ${formatted}`}
              width={640}
              height={400}
              className="h-auto w-full"
            />
          </div>
        ) : (
          <p className="text-sm text-muted">
            We couldn't pinpoint your home on the map. If the address above looks right, continue;
            otherwise go back and edit.
          </p>
        )}
      </div>
    </StepLayout>
  );
}
