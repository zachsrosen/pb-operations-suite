"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import type { FlowMapSnapshot } from "@/lib/flow-map/types";

type ApiResponse = FlowMapSnapshot | { empty: true };

type DrillState = {
  pipelineId?: string;
  stageId?: string;
  flowId?: string;
};

type ViewMode = "plain" | "technical";

const VIEW_STORAGE_KEY = "workflow-map-view";

function isEmpty(data: ApiResponse | undefined): data is { empty: true } {
  return !!data && "empty" in data && data.empty === true;
}

function readStoredView(): ViewMode {
  if (typeof window === "undefined") return "plain";
  try {
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
    return stored === "technical" ? "technical" : "plain";
  } catch {
    return "plain";
  }
}

export default function WorkflowMapClient({
  canEditSop,
}: {
  canEditSop: boolean;
}) {
  const { data, isLoading, isError } = useQuery<ApiResponse>({
    queryKey: queryKeys.workflowMap(),
    queryFn: () => fetch("/api/workflow-map").then((r) => r.json()),
  });

  // Drill state — which pipeline / stage / flow is currently focused.
  const [drill, setDrill] = useState<DrillState>({});

  // Edit gate threaded down from the server page; consumed by the
  // edit-in-place chunk (3.x). Held in state so later UI can read it.
  const [canEdit] = useState(canEditSop);

  // Plain vs Technical wording, persisted to localStorage. Lazy initializer
  // reads the stored preference once so there's no setState-in-effect churn.
  const [view, setView] = useState<ViewMode>(readStoredView);
  const [search, setSearch] = useState("");

  function changeView(next: ViewMode) {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // ignore persistence failures
    }
  }

  if (isLoading) {
    return (
      <div className="bg-surface border border-t-border rounded-lg p-6 text-muted shadow-card">
        Loading…
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="bg-surface border border-t-border rounded-lg p-6 text-foreground shadow-card">
        Something went wrong loading the workflow map. Try refreshing the page.
      </div>
    );
  }

  if (isEmpty(data)) {
    return (
      <div className="bg-surface border border-t-border rounded-lg p-8 text-center shadow-card">
        <h2 className="text-lg font-semibold text-foreground">
          The workflow map hasn&apos;t been synced yet.
        </h2>
        <p className="mt-2 text-sm text-muted">
          An admin can trigger a refresh to build the map from HubSpot.
        </p>
      </div>
    );
  }

  const snapshot = data;

  // Breadcrumb labels derived from drill state.
  const pipeline = drill.pipelineId
    ? snapshot.pipelines.find((p) => p.id === drill.pipelineId)
    : undefined;
  const stage =
    pipeline && drill.stageId
      ? pipeline.stages.find((s) => s.id === drill.stageId)
      : undefined;
  const flow = drill.flowId ? snapshot.flows[drill.flowId] : undefined;

  return (
    <div className="space-y-5">
      {/* Header row: breadcrumb · Plain/Technical toggle · search */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Breadcrumb — clickable segments reset deeper drill state */}
        <nav className="flex items-center gap-1.5 text-sm min-w-0">
          <button
            type="button"
            onClick={() => setDrill({})}
            className={
              drill.pipelineId
                ? "text-muted hover:text-foreground transition-colors"
                : "text-foreground font-medium"
            }
          >
            Pipelines
          </button>
          {pipeline && (
            <>
              <span className="text-muted/50">›</span>
              <button
                type="button"
                onClick={() => setDrill({ pipelineId: pipeline.id })}
                className={
                  drill.stageId
                    ? "text-muted hover:text-foreground transition-colors truncate"
                    : "text-foreground font-medium truncate"
                }
              >
                {pipeline.label}
              </button>
            </>
          )}
          {stage && (
            <>
              <span className="text-muted/50">›</span>
              <button
                type="button"
                onClick={() =>
                  setDrill({ pipelineId: pipeline!.id, stageId: stage.id })
                }
                className={
                  drill.flowId
                    ? "text-muted hover:text-foreground transition-colors truncate"
                    : "text-foreground font-medium truncate"
                }
              >
                {stage.label}
              </button>
            </>
          )}
          {flow && (
            <>
              <span className="text-muted/50">›</span>
              <span className="text-foreground font-medium truncate">
                {flow.name}
              </span>
            </>
          )}
        </nav>

        <div className="flex items-center gap-3 ml-auto">
          {/* Plain / Technical segmented control */}
          <div className="inline-flex items-center rounded-full border border-t-border bg-surface-2 p-0.5">
            {(["plain", "technical"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => changeView(mode)}
                className={`text-xs px-3 py-1 rounded-full transition-colors capitalize ${
                  view === mode
                    ? "bg-cyan-500/20 text-cyan-400"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {mode}
              </button>
            ))}
          </div>

          {/* Search */}
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="text-sm px-3 py-1.5 rounded-lg border border-t-border bg-surface-2 text-foreground placeholder:text-muted focus:outline-none focus:border-cyan-500/50 w-48"
          />
        </div>
      </div>

      {/* Drill levels (PipelineCards / StageTrack / FlowDetail) land in 3.2–3.5 */}
      <div className="bg-surface border border-t-border rounded-lg p-6 shadow-card">
        <div className="text-sm text-muted">
          Pipelines: {snapshot.pipelines.length} · Flows:{" "}
          {Object.keys(snapshot.flows).length}
          {canEdit && (
            <span className="ml-2 text-cyan-400/70">· editing enabled</span>
          )}
        </div>
        {/*
          TODO(3.2–3.5): mount drill-level views here, keyed off `drill` state:
            - no pipelineId           → <PipelineCards onSelect={(id) => setDrill({ pipelineId: id })} />
            - pipelineId, no stageId  → <StageTrack pipeline=… onSelect={(id) => setDrill({ pipelineId, stageId: id })} />
            - stageId, no flowId      → stage flow list → setDrill({ …, flowId })
            - flowId                  → <FlowDetail flow=… />
          All views read `view` (plain|technical), `search`, and `canEdit`.
        */}
      </div>
    </div>
  );
}
