"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useReducer, useRef, useState } from "react";

import ProgressBar from "../shared/ProgressBar";
import SharedAddressStep from "../shared/SharedAddressStep";
import SharedContactStep from "../shared/SharedContactStep";
import StepLayout from "../shared/StepLayout";
import {
  clearDraft,
  INITIAL_STATE,
  loadDraft,
  parseStep,
  reducer,
  saveDraft,
  STEPS,
  stepIndex,
  type EvChargerStep,
} from "./state";

export default function EvChargerWizardPage() {
  return (
    <Suspense fallback={<Fallback />}>
      <Inner />
    </Suspense>
  );
}

function Fallback() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <div className="h-1 w-full animate-pulse rounded-full bg-surface-2" />
    </div>
  );
}

function Inner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const step = parseStep(searchParams.get("step"));
  const embedSuffix = searchParams.get("embed") === "1" ? "&embed=1" : "";
  const embedOnlySuffix = searchParams.get("embed") === "1" ? "?embed=1" : "";
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const hydratedRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const draft = loadDraft();
    if (draft) dispatch({ type: "hydrate", value: draft });
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    saveDraft(state);
  }, [state]);

  const goToStep = useCallback(
    (next: EvChargerStep) => {
      router.push(`/estimator/ev-charger?step=${next}${embedSuffix}`);
    },
    [router, embedSuffix],
  );

  const onStartOver = useCallback(() => {
    clearDraft();
    dispatch({ type: "reset" });
    router.push(`/estimator/ev-charger?step=address${embedSuffix}`);
  }, [router, embedSuffix]);

  useEffect(() => {
    if (step === "details" && !state.normalizedAddress) {
      router.replace(`/estimator/ev-charger?step=address${embedSuffix}`);
      return;
    }
    if (step === "contact" && !state.normalizedAddress) {
      router.replace(`/estimator/ev-charger?step=address${embedSuffix}`);
    }
  }, [step, state.normalizedAddress, router, embedSuffix]);

  async function handleSubmit(recaptchaToken: string | undefined): Promise<void> {
    if (!state.normalizedAddress || !state.location) {
      setSubmitError("Missing address. Please start over.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/estimator/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "ev_charger",
          quote: {
            quoteType: "ev_charger",
            address: state.normalizedAddress,
            location: state.location,
            extraConduitFeet: state.extraConduitFeet,
          },
          contact: {
            firstName: state.contact.firstName,
            lastName: state.contact.lastName,
            email: state.contact.email,
            phone: state.contact.phone,
            referredBy: state.contact.referredBy || undefined,
            notes: state.contact.notes || undefined,
          },
          recaptchaToken,
        }),
      });
      if (res.status === 429) {
        setSubmitError("Too many submissions. Please try again later.");
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setSubmitError(data.error ?? "Could not submit your request. Please try again.");
        return;
      }
      const data = (await res.json()) as { token: string };
      clearDraft();
      router.push(`/estimator/results/${data.token}${embedOnlySuffix}`);
    } catch (err) {
      console.error(err);
      setSubmitError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const currentIndex = stepIndex(step);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      <ProgressBar
        currentIndex={currentIndex}
        total={STEPS.length}
        onStartOver={onStartOver}
      />
      <div className="mt-6">
        {step === "address" && (
          <SharedAddressStep
            title="Where's the EV charger going?"
            subtitle="We use this to check service area and route your estimate to the right shop."
            addressInput={state.addressInput}
            setAddressInput={(value) => dispatch({ type: "setAddressInput", value })}
            onValidated={(data) => {
              dispatch({
                type: "setValidatedAddress",
                address: data.normalized,
                location: data.location,
              });
              goToStep("details");
            }}
            onOutOfArea={(zip) => {
              router.push(`/estimator/out-of-area?zip=${encodeURIComponent(zip)}${embedSuffix}`);
            }}
          />
        )}
        {step === "details" && (
          <StepLayout
            title="How long is the conduit run?"
            subtitle="Our standard install includes 10 ft of conduit from your panel to the charger."
            onBack={() => goToStep("address")}
            footer={
              <button
                type="button"
                onClick={() => goToStep("contact")}
                className="rounded-lg bg-orange-500 px-5 py-2.5 text-sm font-medium text-white shadow-card transition hover:bg-orange-600"
              >
                Continue
              </button>
            }
          >
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium">
                Extra conduit beyond a standard 10 ft run (feet)
              </span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={500}
                value={state.extraConduitFeet}
                onChange={(e) => {
                  const n = Math.max(0, Math.min(500, Math.floor(Number(e.target.value) || 0)));
                  dispatch({ type: "setExtraConduitFeet", value: n });
                }}
                className="w-full rounded-lg border border-t-border bg-surface-2 px-4 py-2.5 text-sm outline-none focus:border-orange-500"
              />
              <p className="text-xs text-muted">
                Leave at 0 if unsure — we&apos;ll confirm during install.
              </p>
            </label>
          </StepLayout>
        )}
        {step === "contact" && (
          <SharedContactStep
            title="Where should we send your estimate?"
            subtitle="We'll email your results and follow up to schedule install."
            contact={state.contact}
            setContact={(patch) =>
              dispatch({ type: "setContact", value: { ...state.contact, ...patch } })
            }
            onBack={() => goToStep("details")}
            onSubmit={handleSubmit}
            submitting={submitting}
            error={submitError}
            submitLabel="See my estimate"
          />
        )}
      </div>
    </div>
  );
}
