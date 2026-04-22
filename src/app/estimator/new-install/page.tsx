"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useReducer, useRef } from "react";

import ProgressBar from "../shared/ProgressBar";
import AddressStep from "./components/AddressStep";
import ContactStep from "./components/ContactStep";
import RoofConfirmStep from "./components/RoofConfirmStep";
import UsageStep from "./components/UsageStep";
import {
  clearDraft,
  INITIAL_STATE,
  loadDraft,
  parseStep,
  saveDraft,
  STEPS,
  stepIndex,
  wizardReducer,
  type WizardStep,
} from "./state";

export default function NewInstallWizardPage() {
  return (
    <Suspense fallback={<WizardFallback />}>
      <WizardInner />
    </Suspense>
  );
}

function WizardFallback() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <div className="h-1 w-full animate-pulse rounded-full bg-surface-2" />
    </div>
  );
}

function WizardInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const step = parseStep(searchParams.get("step"));
  const embedSuffix = searchParams.get("embed") === "1" ? "&embed=1" : "";
  const [state, dispatch] = useReducer(wizardReducer, INITIAL_STATE);
  const hydratedRef = useRef(false);

  // Hydrate from sessionStorage on first mount.
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const draft = loadDraft();
    if (draft) dispatch({ type: "hydrate", value: draft });
  }, []);

  // Persist to sessionStorage on every change (after initial hydrate).
  useEffect(() => {
    if (!hydratedRef.current) return;
    saveDraft(state);
  }, [state]);

  const goToStep = useCallback(
    (next: WizardStep) => {
      router.push(`/estimator/new-install?step=${next}${embedSuffix}`);
    },
    [router],
  );

  const onStartOver = useCallback(() => {
    clearDraft();
    dispatch({ type: "reset" });
    router.push(`/estimator/new-install?step=address${embedSuffix}`);
  }, [router]);

  // Guard: don't let users jump ahead without prerequisites.
  useEffect(() => {
    if (step === "roof" && !state.normalizedAddress) {
      router.replace(`/estimator/new-install?step=address${embedSuffix}`);
      return;
    }
    if (step === "usage" && (!state.normalizedAddress || !state.inServiceArea)) {
      router.replace(`/estimator/new-install?step=address${embedSuffix}`);
      return;
    }
    if (step === "contact" && (!state.usage || !state.utilityId)) {
      router.replace(`/estimator/new-install?step=usage${embedSuffix}`);
    }
  }, [step, state.normalizedAddress, state.inServiceArea, state.usage, state.utilityId, router, embedSuffix]);

  const currentIndex = stepIndex(step);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      <ProgressBar currentIndex={currentIndex} total={STEPS.length} onStartOver={onStartOver} />
      <div className="mt-8">
        {step === "address" && (
          <AddressStep state={state} dispatch={dispatch} onContinue={() => goToStep("roof")} />
        )}
        {step === "roof" && (
          <RoofConfirmStep
            state={state}
            onBack={() => goToStep("address")}
            onContinue={() => goToStep("usage")}
          />
        )}
        {step === "usage" && (
          <UsageStep
            state={state}
            dispatch={dispatch}
            onBack={() => goToStep("roof")}
            onContinue={() => goToStep("contact")}
          />
        )}
        {step === "contact" && (
          <ContactStep state={state} dispatch={dispatch} onBack={() => goToStep("usage")} />
        )}
      </div>
    </div>
  );
}

