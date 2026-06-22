"use client";

import type { FlowMapSnapshot } from "@/lib/flow-map/types";
import FlowList from "./FlowList";

function PaneHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
      {children}
    </h3>
  );
}

export default function StagePanes({
  snapshot,
  stageId,
  selectedFlowId,
  onSelectFlow,
}: {
  snapshot: FlowMapSnapshot;
  stageId: string;
  selectedFlowId?: string;
  onSelectFlow: (flowId: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* Process pane — wired to SOP content in Chunk 4. Stubbed for now. */}
      <section className="space-y-3">
        <PaneHeading>Process</PaneHeading>
        <div className="rounded-lg border border-dashed border-t-border bg-surface-2/40 p-4 text-sm text-muted">
          SOP process — coming in the next step.
        </div>
      </section>

      {/* Automation pane — the flows that run at this stage. */}
      <section className="space-y-3">
        <PaneHeading>Automation</PaneHeading>
        <FlowList
          snapshot={snapshot}
          stageId={stageId}
          selectedFlowId={selectedFlowId}
          onSelect={onSelectFlow}
        />
      </section>
    </div>
  );
}
