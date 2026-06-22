"use client";

import type { FlowMapSnapshot } from "@/lib/flow-map/types";
import FlowList from "./FlowList";
import ProcessPane from "./ProcessPane";
import DriftBadges from "./DriftBadges";
import { flowsForStage } from "./flow-map-utils";
import { useStageSop } from "./useStageSop";

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
  canEditSop = false,
  showDisabled = false,
}: {
  snapshot: FlowMapSnapshot;
  stageId: string;
  selectedFlowId?: string;
  onSelectFlow: (flowId: string) => void;
  /** ADMIN || EXECUTIVE — enables the Process pane's inline SOP edit affordance. */
  canEditSop?: boolean;
  /** When false (default), the Automation list omits disabled flows. */
  showDisabled?: boolean;
}) {
  // One SOP fetch for the stage, shared by the Process pane and the drift
  // badges (the badges diff the same section HTML against live flows).
  const { data, isLoading } = useStageSop(stageId);
  const sections = data?.sections ?? [];
  const projectOnly = data?.projectOnly ?? false;

  // Raw flows enrolled at this stage (clone suffixes intact) — detectDrift
  // does its own clone-collapse. Drift is only meaningful for mapped (Project)
  // stages, so non-Project stages get an empty htmls list and render no badges.
  const liveStageFlows = flowsForStage(stageId, snapshot).map((f) => ({
    name: f.name,
    isEnabled: f.isEnabled,
  }));
  const htmls = projectOnly ? sections.map((s) => s.content) : [];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* Process pane — live SOP content + drift badges. */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <PaneHeading>Process</PaneHeading>
          {projectOnly && (
            <DriftBadges htmls={htmls} liveStageFlows={liveStageFlows} />
          )}
        </div>
        <ProcessPane
          sections={sections}
          projectOnly={projectOnly}
          isLoading={isLoading}
          stageId={stageId}
          canEditSop={canEditSop}
        />
      </section>

      {/* Automation pane — the flows that run at this stage. */}
      <section className="space-y-3">
        <PaneHeading>Automation</PaneHeading>
        <FlowList
          snapshot={snapshot}
          stageId={stageId}
          selectedFlowId={selectedFlowId}
          onSelect={onSelectFlow}
          showDisabled={showDisabled}
        />
      </section>
    </div>
  );
}
