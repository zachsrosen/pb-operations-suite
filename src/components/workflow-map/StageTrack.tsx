"use client";

import type { FlowMapSnapshot, Pipeline, Stage } from "@/lib/flow-map/types";
import {
  CROSS_CUTTING_ID,
  CROSS_CUTTING_LABEL,
  flowsForStage,
} from "./flow-map-utils";

export default function StageTrack({
  snapshot,
  pipelineId,
  pipeline,
  selectedStageId,
  onSelect,
}: {
  snapshot: FlowMapSnapshot;
  pipelineId: string;
  /** The matching Pipeline, or undefined for the cross-cutting group. */
  pipeline: Pipeline | undefined;
  selectedStageId?: string;
  onSelect: (stageId: string) => void;
}) {
  const isCrossCutting = pipelineId === CROSS_CUTTING_ID;

  // Real stages (already ordered) plus a pseudo-stage for cross-cutting flows.
  const stages: Stage[] = isCrossCutting
    ? [{ id: CROSS_CUTTING_ID, label: CROSS_CUTTING_LABEL, order: 0 }]
    : pipeline?.stages ?? [];

  return (
    <ol className="relative space-y-1">
      {stages.map((stage, i) => {
        const count = flowsForStage(stage.id, snapshot).length;
        const active = stage.id === selectedStageId;
        return (
          <li key={stage.id} className="relative">
            {/* Connector line between stage dots. */}
            {i < stages.length - 1 && (
              <span
                aria-hidden
                className="absolute left-[7px] top-6 bottom-[-4px] w-px bg-t-border"
              />
            )}
            <button
              type="button"
              onClick={() => onSelect(stage.id)}
              className={`group flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors ${
                active ? "bg-surface-2" : "hover:bg-surface-2/60"
              }`}
            >
              <span
                className={`relative z-10 mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 ${
                  active
                    ? "border-cyan-400 bg-cyan-400/30"
                    : "border-t-border bg-surface"
                }`}
              />
              <span className="min-w-0 flex-1">
                <span
                  className={`block truncate text-sm ${
                    active
                      ? "text-foreground font-medium"
                      : "text-foreground/90"
                  }`}
                >
                  {stage.label}
                </span>
              </span>
              <span className="shrink-0 text-xs text-muted tabular-nums">
                {count}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
