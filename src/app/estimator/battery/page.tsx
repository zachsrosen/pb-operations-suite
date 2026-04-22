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
  type BatteryStep,
} from "./state";

export default function BatteryWizardPage() {
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
    (next: BatteryStep) => {
      router.push(`/estimator/battery?step=${next}${embedSuffix}`);
    },
    [router, embedSuffix],
  );

  const onStartOver = useCallback(() => {
    clearDraft();
    dispatch({ type: "reset" });
    router.push(`/estimator/battery?step=address${embedSuffix}`);
  }, [router, embedSuffix]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    if (step !== "address" && !state.normalizedAddress) {
      router.replace(`/estimator/battery?step=address${embedSuffix}`);
      return;
    }
    if (step === "count" && !state.utilityId) {
      router.replace(`/estimator/battery?step=utility${embedSuffix}`);
      return;
    }
    if (step === "contact" && (!state.utilityId || !state.batteryCount)) {
      router.replace(`/estimator/battery?step=utility${embedSuffix}`);
    }
  }, [step, state.normalizedAddress, state.utilityId, state.batteryCount, router, embedSuffix]);

  async function handleSubmit(recaptchaToken: string | undefined): Promise<void> {
    if (!state.normalizedAddress || !state.location || !state.utilityId) {
      setSubmitError("Missing required info. Please start over.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/estimator/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "battery",
          quote: {
            quoteType: "battery",
            address: state.normalizedAddress,
            location: state.location,
            utilityId: state.utilityId,
            batteryCount: state.batteryCount,
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
            title="Where's the battery going?"
            subtitle="We use this to check service area and look up your utility's rebate."
            addressInput={state.addressInput}
            setAddressInput={(value) => dispatch({ type: "setAddressInput", value })}
            onValidated={(data) => {
              dispatch({
                type: "setValidatedAddress",
                address: data.normalized,
                location: data.location,
                utilities: data.utilities,
              });
              goToStep("utility");
            }}
            onOutOfArea={(zip) => {
              router.push(`/estimator/out-of-area?zip=${encodeURIComponent(zip)}${embedSuffix}`);
            }}
          />
        )}
        {step === "utility" && (
          <StepLayout
            title="Who's your utility provider?"
            subtitle="Rebates vary by utility — we'll apply the right one."
            onBack={() => goToStep("address")}
            footer={
              <button
                type="button"
                onClick={() => goToStep("count")}
                disabled={!state.utilityId}
                className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-6 py-3 text-sm font-semibold text-white shadow-card transition hover:-translate-y-0.5 hover:bg-orange-600 hover:shadow-card-lg disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
              >
                Continue
              </button>
            }
          >
            <div className="flex flex-col gap-2">
              <label htmlFor="utility" className="text-sm font-medium">
                Utility provider
              </label>
              <select
                id="utility"
                value={state.utilityId ?? ""}
                onChange={(e) => dispatch({ type: "setUtility", utilityId: e.target.value })}
                className="w-full rounded-xl border border-t-border bg-surface-2 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-surface-elevated focus:ring-2 focus:ring-orange-500/20"
              >
                <option value="" disabled>
                  Select your utility…
                </option>
                {state.utilities.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName}
                  </option>
                ))}
              </select>
            </div>
          </StepLayout>
        )}
        {step === "count" && (
          <StepLayout
            title="How many batteries?"
            subtitle="More batteries = more backup runtime."
            onBack={() => goToStep("utility")}
            footer={
              <button
                type="button"
                onClick={() => goToStep("contact")}
                className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-6 py-3 text-sm font-semibold text-white shadow-card transition hover:-translate-y-0.5 hover:bg-orange-600 hover:shadow-card-lg"
              >
                Continue
              </button>
            }
          >
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => dispatch({ type: "setBatteryCount", value: state.batteryCount - 1 })}
                disabled={state.batteryCount <= 1}
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-t-border bg-surface-2 text-lg hover:bg-surface-elevated disabled:opacity-40"
                aria-label="Fewer batteries"
              >
                −
              </button>
              <div className="min-w-[4rem] text-center">
                <div className="text-3xl font-semibold">{state.batteryCount}</div>
                <div className="text-xs text-muted">
                  {state.batteryCount === 1 ? "battery" : "batteries"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => dispatch({ type: "setBatteryCount", value: state.batteryCount + 1 })}
                disabled={state.batteryCount >= 6}
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-t-border bg-surface-2 text-lg hover:bg-surface-elevated disabled:opacity-40"
                aria-label="More batteries"
              >
                +
              </button>
            </div>
            <p className="mt-4 text-xs text-muted">
              Most homes need 1–2 batteries for essential-load backup. 3+ is typical for whole-home
              backup.
            </p>
          </StepLayout>
        )}
        {step === "contact" && (
          <SharedContactStep
            contact={state.contact}
            setContact={(patch) =>
              dispatch({ type: "setContact", value: { ...state.contact, ...patch } })
            }
            onBack={() => goToStep("count")}
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
