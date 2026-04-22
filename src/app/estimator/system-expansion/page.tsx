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
  type SystemExpansionStep,
} from "./state";

export default function SystemExpansionWizardPage() {
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
    (next: SystemExpansionStep) => {
      router.push(`/estimator/system-expansion?step=${next}${embedSuffix}`);
    },
    [router, embedSuffix],
  );

  const onStartOver = useCallback(() => {
    clearDraft();
    dispatch({ type: "reset" });
    router.push(`/estimator/system-expansion?step=address${embedSuffix}`);
  }, [router, embedSuffix]);

  useEffect(() => {
    if (step !== "address" && !state.normalizedAddress) {
      router.replace(`/estimator/system-expansion?step=address${embedSuffix}`);
      return;
    }
    if (step === "added" && state.currentSystemKwDc <= 0) {
      router.replace(`/estimator/system-expansion?step=existing${embedSuffix}`);
      return;
    }
    if (step === "contact" && (state.currentSystemKwDc <= 0 || state.addedPanelCount < 1)) {
      router.replace(`/estimator/system-expansion?step=existing${embedSuffix}`);
    }
  }, [
    step,
    state.normalizedAddress,
    state.currentSystemKwDc,
    state.addedPanelCount,
    router,
    embedSuffix,
  ]);

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
          kind: "system_expansion",
          quote: {
            quoteType: "system_expansion",
            address: state.normalizedAddress,
            location: state.location,
            currentSystemKwDc: state.currentSystemKwDc,
            addedPanelCount: state.addedPanelCount,
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
            title="Where's the system?"
            subtitle="We use this to check service area and pull satellite imagery."
            addressInput={state.addressInput}
            setAddressInput={(value) => dispatch({ type: "setAddressInput", value })}
            onValidated={(data) => {
              dispatch({
                type: "setValidatedAddress",
                address: data.normalized,
                location: data.location,
              });
              goToStep("existing");
            }}
            onOutOfArea={(zip) => {
              router.push(`/estimator/out-of-area?zip=${encodeURIComponent(zip)}${embedSuffix}`);
            }}
          />
        )}
        {step === "existing" && (
          <StepLayout
            title="How big is your current system?"
            subtitle="Your DC system size is typically listed on your interconnection agreement or monitoring app."
            onBack={() => goToStep("address")}
            footer={
              <button
                type="button"
                onClick={() => goToStep("added")}
                disabled={state.currentSystemKwDc <= 0}
                className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-6 py-3 text-sm font-semibold text-white shadow-card transition hover:-translate-y-0.5 hover:bg-orange-600 hover:shadow-card-lg disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
              >
                Continue
              </button>
            }
          >
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium">Current system size (kW DC)</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={50}
                step={0.01}
                placeholder="e.g. 6.8"
                value={state.currentSystemKwDc || ""}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  dispatch({
                    type: "setCurrentSystemKwDc",
                    value: Number.isFinite(n) ? Math.max(0, Math.min(50, n)) : 0,
                  });
                }}
                className="w-full rounded-xl border border-t-border bg-surface-2 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-surface-elevated focus:ring-2 focus:ring-orange-500/20"
              />
              <p className="text-xs text-muted">
                Not sure? It&apos;s usually on your welcome letter, inverter label, or monitoring
                app.
              </p>
            </label>
          </StepLayout>
        )}
        {step === "added" && (
          <StepLayout
            title="How many panels would you like to add?"
            onBack={() => goToStep("existing")}
            footer={
              <button
                type="button"
                onClick={() => goToStep("contact")}
                disabled={state.addedPanelCount < 1}
                className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-6 py-3 text-sm font-semibold text-white shadow-card transition hover:-translate-y-0.5 hover:bg-orange-600 hover:shadow-card-lg disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
              >
                Continue
              </button>
            }
          >
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium">Panels to add</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={60}
                step={1}
                placeholder="e.g. 6"
                value={state.addedPanelCount || ""}
                onChange={(e) => {
                  const n = Math.floor(Number(e.target.value));
                  dispatch({
                    type: "setAddedPanelCount",
                    value: Number.isFinite(n) ? Math.max(1, Math.min(60, n)) : 1,
                  });
                }}
                className="w-full rounded-xl border border-t-border bg-surface-2 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-surface-elevated focus:ring-2 focus:ring-orange-500/20"
              />
              <p className="text-xs text-muted">
                A typical expansion adds 4–10 panels. Your final count depends on roof space and
                electrical capacity.
              </p>
            </label>
          </StepLayout>
        )}
        {step === "contact" && (
          <SharedContactStep
            contact={state.contact}
            setContact={(patch) =>
              dispatch({ type: "setContact", value: { ...state.contact, ...patch } })
            }
            onBack={() => goToStep("added")}
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
