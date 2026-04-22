"use client";

type Props = {
  currentIndex: number;
  total: number;
  onStartOver?: () => void;
};

export default function ProgressBar({ currentIndex, total, onStartOver }: Props) {
  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wider text-muted">
          Step <span className="text-foreground">{currentIndex + 1}</span>
          <span className="mx-1 opacity-40">/</span>
          {total}
        </div>
        {onStartOver && (
          <button
            type="button"
            onClick={onStartOver}
            className="text-xs font-medium text-muted transition hover:text-foreground"
          >
            Start over
          </button>
        )}
      </div>
      <div
        className="flex gap-1.5"
        role="progressbar"
        aria-valuenow={currentIndex + 1}
        aria-valuemin={1}
        aria-valuemax={total}
      >
        {Array.from({ length: total }).map((_, i) => {
          const completed = i < currentIndex;
          const active = i === currentIndex;
          return (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-full transition-all duration-500 ${
                completed
                  ? "bg-orange-500"
                  : active
                    ? "bg-gradient-to-r from-orange-500 to-orange-400 shadow-[0_0_12px_rgba(249,115,22,0.5)]"
                    : "bg-surface-2"
              }`}
            />
          );
        })}
      </div>
    </>
  );
}
