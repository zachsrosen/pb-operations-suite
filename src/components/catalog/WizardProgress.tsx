"use client";

const STEPS = [
  { key: "start", label: "Start" },
  { key: "basics", label: "Basics" },
  { key: "details", label: "Details" },
  { key: "review", label: "Review" },
] as const;

export type WizardStep = (typeof STEPS)[number]["key"];

interface WizardProgressProps {
  currentStep: WizardStep;
}

export default function WizardProgress({ currentStep }: WizardProgressProps) {
  const currentIndex = STEPS.findIndex((s) => s.key === currentStep);

  return (
    <div className="mb-8">
      {/* Desktop: full labels */}
      <div className="hidden sm:flex items-center justify-between">
        {STEPS.map((step, i) => {
          const isComplete = i < currentIndex;
          const isCurrent = i === currentIndex;
          return (
            <div key={step.key} className="flex items-center flex-1 last:flex-none">
              <div className="flex items-center gap-2">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
                    isComplete
                      ? "bg-cyan-500 text-white"
                      : isCurrent
                        ? "bg-cyan-500/20 text-cyan-400 ring-2 ring-cyan-500"
                        : "bg-surface-2 text-muted"
                  }`}
                >
                  {isComplete ? "✓" : i + 1}
                </div>
                <span
                  className={`text-sm font-medium ${
                    isCurrent ? "text-foreground" : "text-muted"
                  }`}
                >
                  {step.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={`flex-1 h-0.5 mx-4 rounded ${
                    isComplete ? "bg-cyan-500" : "bg-surface-2"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
      {/* Mobile: compact dots */}
      <div className="flex sm:hidden items-center justify-center gap-2">
        {STEPS.map((step, i) => {
          const isComplete = i < currentIndex;
          const isCurrent = i === currentIndex;
          return (
            <div
              key={step.key}
              className={`w-2.5 h-2.5 rounded-full transition-colors ${
                isComplete
                  ? "bg-cyan-500"
                  : isCurrent
                    ? "bg-cyan-400 ring-2 ring-cyan-500/50"
                    : "bg-surface-2"
              }`}
            />
          );
        })}
        <span className="ml-2 text-sm text-muted">
          {STEPS[currentIndex]?.label}
        </span>
      </div>
    </div>
  );
}
