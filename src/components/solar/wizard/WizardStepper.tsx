"use client";

interface WizardStepperProps {
  steps: string[];
  currentStep: number;
  onStepClick?: (step: number) => void;
}

export default function WizardStepper({
  steps,
  currentStep,
  onStepClick,
}: WizardStepperProps) {
  return (
    <nav aria-label="Setup wizard progress" className="overflow-x-auto -mx-1 px-1">
      <ol className="flex items-center gap-2 min-w-fit">
        {steps.map((label, i) => {
          const isCompleted = i < currentStep;
          const isCurrent = i === currentStep;
          const isClickable = isCompleted && onStepClick;

          return (
            <li key={label} className="flex items-center gap-2">
              {i > 0 && (
                <div
                  className={`h-px w-6 sm:w-10 shrink-0 ${
                    isCompleted ? "bg-green-500/50" : "bg-zinc-700"
                  }`}
                  aria-hidden="true"
                />
              )}
              <button
                type="button"
                onClick={() => isClickable && onStepClick(i)}
                disabled={!isClickable}
                aria-current={isCurrent ? "step" : undefined}
                aria-label={`Step ${i + 1}: ${label}${isCompleted ? " (completed)" : isCurrent ? " (current)" : ""}`}
                className={`flex items-center gap-1.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/50 rounded ${
                  isCurrent
                    ? "text-orange-400"
                    : isCompleted
                      ? "text-green-400 hover:text-green-300 cursor-pointer"
                      : "text-muted/50 cursor-default"
                }`}
              >
                <span
                  className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold border shrink-0 ${
                    isCurrent
                      ? "border-orange-500 bg-orange-500/20 text-orange-400"
                      : isCompleted
                        ? "border-green-500/50 bg-green-500/15 text-green-400"
                        : "border-zinc-600 bg-zinc-800 text-muted/50"
                  }`}
                  aria-hidden="true"
                >
                  {isCompleted ? "\u2713" : i + 1}
                </span>
                <span className="hidden sm:inline">{label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
