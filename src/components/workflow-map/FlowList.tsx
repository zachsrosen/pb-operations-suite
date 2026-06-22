"use client";

import type { FlowMapSnapshot } from "@/lib/flow-map/types";
import { flowsForStage, groupFlowClones } from "./flow-map-utils";
import { FlowStatusPill } from "./FlowStatusPill";

export default function FlowList({
  snapshot,
  stageId,
  selectedFlowId,
  onSelect,
}: {
  snapshot: FlowMapSnapshot;
  stageId: string;
  selectedFlowId?: string;
  /** Receives the representative flow id of the clicked group. */
  onSelect: (flowId: string) => void;
}) {
  const groups = groupFlowClones(flowsForStage(stageId, snapshot)).sort((a, b) =>
    a.base.localeCompare(b.base),
  );

  if (groups.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-t-border p-4 text-sm text-muted">
        No automations run at this stage.
      </div>
    );
  }

  return (
    <ul className="space-y-1.5">
      {groups.map((group) => {
        const active = group.rep.id === selectedFlowId;
        return (
          <li key={group.rep.id}>
            <button
              type="button"
              onClick={() => onSelect(group.rep.id)}
              className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
                active
                  ? "border-cyan-500/40 bg-surface-2"
                  : "border-t-border bg-surface hover:bg-surface-2/60"
              }`}
            >
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                {group.base}
              </span>
              {group.count > 1 && (
                <span className="shrink-0 rounded-full bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-muted tabular-nums">
                  ×{group.count}
                </span>
              )}
              <FlowStatusPill on={group.on} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
