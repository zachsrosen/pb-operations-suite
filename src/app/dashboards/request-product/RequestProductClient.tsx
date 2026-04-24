"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import ModeSelectStep from "./ModeSelectStep";
import EquipmentRequestForm from "./EquipmentRequestForm";
import AdderRequestForm from "./AdderRequestForm";
import ConfirmationScreen from "./ConfirmationScreen";
import MyRequestsTable from "./MyRequestsTable";

type Step = "mode" | "equipment" | "adder" | "confirmation";

function Inner({ userEmail }: { userEmail: string }) {
  const searchParams = useSearchParams();
  const dealIdParam = searchParams.get("dealId");
  const [step, setStep] = useState<Step>("mode");
  const [lastTitle, setLastTitle] = useState<string>("");

  const reset = () => {
    setStep("mode");
    setLastTitle("");
  };

  return (
    <div className="space-y-10">
      {step === "mode" && <ModeSelectStep onSelect={(m) => setStep(m)} />}

      {step === "equipment" && (
        <EquipmentRequestForm
          dealIdInitial={dealIdParam}
          onSubmitted={(title) => {
            setLastTitle(title);
            setStep("confirmation");
          }}
          onBack={() => setStep("mode")}
        />
      )}

      {step === "adder" && (
        <AdderRequestForm
          dealIdInitial={dealIdParam}
          onSubmitted={(title) => {
            setLastTitle(title);
            setStep("confirmation");
          }}
          onBack={() => setStep("mode")}
        />
      )}

      {step === "confirmation" && (
        <ConfirmationScreen title={lastTitle} onSubmitAnother={reset} />
      )}

      <MyRequestsTable key={step} userEmail={userEmail} />
    </div>
  );
}

export default function RequestProductClient({ userEmail }: { userEmail: string }) {
  return (
    <Suspense fallback={null}>
      <Inner userEmail={userEmail} />
    </Suspense>
  );
}
