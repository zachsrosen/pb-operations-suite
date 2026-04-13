import type { TimelineStage } from "./types";

interface MilestoneTimelineProps {
  stages: TimelineStage[];
}

export default function MilestoneTimeline({ stages }: MilestoneTimelineProps) {
  if (stages.length === 0) return null;

  return (
    <div className="mb-4 overflow-x-auto rounded-lg bg-surface-2/30 p-3">
      <div className="flex items-center gap-0" style={{ minWidth: `${stages.length * 100}px` }}>
        {stages.map((stage, i) => {
          const isCompleted = !!stage.completedDate;
          const isCurrent = stage.isCurrent;
          const isFuture = !isCompleted && !isCurrent;

          return (
            <div key={stage.key} className="flex flex-1 items-center">
              {/* Node */}
              <div className="flex flex-col items-center">
                <div
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${
                    isCompleted
                      ? "bg-green-500 text-white"
                      : isCurrent
                        ? "bg-orange-500 text-white shadow-[0_0_8px_rgba(249,115,22,0.5)]"
                        : "border border-zinc-500 text-zinc-500"
                  }`}
                >
                  {isCompleted ? "✓" : isCurrent ? "●" : "○"}
                </div>
                <span
                  className={`mt-1 text-center text-[9px] font-medium leading-tight ${
                    isFuture ? "text-muted" : "text-foreground"
                  }`}
                >
                  {stage.label}
                </span>
                <span className="mt-0.5 text-center text-[8px] text-muted">
                  {stage.completedDate
                    ? new Date(stage.completedDate.split("T")[0] + "T00:00:00").toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })
                    : "—"}
                </span>
              </div>
              {/* Connector line */}
              {i < stages.length - 1 && (
                <div
                  className={`mx-1 h-0.5 flex-1 ${
                    isCompleted ? "bg-green-500" : "bg-zinc-600"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
