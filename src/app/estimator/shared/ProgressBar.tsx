"use client";

type Props = {
  currentIndex: number;
  total: number;
  onStartOver?: () => void;
};

export default function ProgressBar({ currentIndex, total, onStartOver }: Props) {
  const pct = Math.min(100, ((currentIndex + 1) / total) * 100);
  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div className="text-xs uppercase tracking-wide text-muted">
          Step {currentIndex + 1} of {total}
        </div>
        {onStartOver && (
          <button
            type="button"
            onClick={onStartOver}
            className="text-xs text-muted underline hover:text-foreground"
          >
            Start over
          </button>
        )}
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: "rgb(249 115 22)" }}
        />
      </div>
    </>
  );
}
