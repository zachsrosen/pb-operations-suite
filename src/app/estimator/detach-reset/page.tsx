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
  type DetachResetStep,
} from "./state";

export default function DetachResetWizardPage() {
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
    (next: DetachResetStep) => {
      router.push(`/estimator/detach-reset?step=${next}${embedSuffix}`);
    },
    [router, embedSuffix],
  );

  const onStartOver = useCallback(() => {
    clearDraft();
    dispatch({ type: "reset" });
    router.push(`/estimator/detach-reset?step=from-address${embedSuffix}`);
  }, [router, embedSuffix]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    if ((step === "to-address" || step === "existing" || step === "contact") && !state.fromAddress) {
      router.replace(`/estimator/detach-reset?step=from-address${embedSuffix}`);
      return;
    }
    if ((step === "existing" || step === "contact") && !state.toAddress) {
      router.replace(`/estimator/detach-reset?step=to-address${embedSuffix}`);
    }
  }, [step, state.fromAddress, state.toAddress, router, embedSuffix]);

  async function handleSubmit(recaptchaToken: string | undefined): Promise<void> {
    if (!state.fromAddress || !state.toAddress) {
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
          kind: "detach_reset",
          fromAddress: state.fromAddress,
          toAddress: state.toAddress,
          currentSystemKwDc: state.currentSystemKwDc > 0 ? state.currentSystemKwDc : undefined,
          contact: {
            firstName: state.contact.firstName,
            lastName: state.contact.lastName,
            email: state.contact.email,
            phone: state.contact.phone,
            referredBy: state.contact.referredBy || undefined,
            notes: state.contact.notes || undefined,
          },
          message: state.message || undefined,
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
        {step === "from-address" && (
          <SharedAddressStep
            title="Current home address"
            subtitle="Where is the solar system today?"
            addressInput={state.fromAddressInput}
            setAddressInput={(value) => dispatch({ type: "setFromAddressInput", value })}
            onValidated={(data) => {
              dispatch({ type: "setFromAddress", value: data.normalized });
              goToStep("to-address");
            }}
          />
        )}
        {step === "to-address" && (
          <SharedAddressStep
            title="New home address"
            subtitle="Where should we reinstall the system?"
            addressInput={state.toAddressInput}
            setAddressInput={(value) => dispatch({ type: "setToAddressInput", value })}
            onValidated={(data) => {
              dispatch({ type: "setToAddress", value: data.normalized });
              goToStep("existing");
            }}
            onBack={() => goToStep("from-address")}
          />
        )}
        {step === "existing" && (
          <StepLayout
            title="Current system size"
            subtitle="Optional — helps us scope the job."
            onBack={() => goToStep("to-address")}
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
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium">
                Current system size (kW DC, if known)
              </span>
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
                Skip this if you&apos;re not sure — we&apos;ll confirm during the site walk.
              </p>
            </label>
          </StepLayout>
        )}
        {step === "contact" && (
          <SharedContactStep
            title="Where should we reach you?"
            subtitle="Detach & reset quotes are prepared manually — we'll reach out with a tailored number within one business day."
            contact={state.contact}
            setContact={(patch) =>
              dispatch({ type: "setContact", value: { ...state.contact, ...patch } })
            }
            onBack={() => goToStep("existing")}
            onSubmit={handleSubmit}
            submitting={submitting}
            error={submitError}
            submitLabel="Request quote"
            showMessageField
            messageLabel="Anything we should know? (optional)"
            messageValue={state.message}
            onMessageChange={(v) => dispatch({ type: "setMessage", value: v })}
          />
        )}
      </div>
    </div>
  );
}
