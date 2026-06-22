"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import type { FlowEntry, FlowMapSnapshot } from "@/lib/flow-map/types";
import PipelineCards from "./PipelineCards";
import StageTrack from "./StageTrack";
import StagePanes from "./StagePanes";
import FlowDetail from "./FlowDetail";
import SearchResults from "./SearchResults";
import {
  CROSS_CUTTING_ID,
  CROSS_CUTTING_LABEL,
  cloneBaseName,
  cloneFamilyOn,
} from "./flow-map-utils";

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
  const searching = search.trim().length > 0;
  const lastSynced = snapshot.generatedAt
    ? new Date(snapshot.generatedAt).toLocaleString()
    : null;

  // Breadcrumb labels derived from drill state. The cross-cutting group is
  // synthetic (not in snapshot.pipelines), so handle it explicitly.
  const isCrossCutting = drill.pipelineId === CROSS_CUTTING_ID;
  const pipeline =
    drill.pipelineId && !isCrossCutting
      ? snapshot.pipelines.find((p) => p.id === drill.pipelineId)
      : undefined;
  const pipelineLabel = isCrossCutting ? CROSS_CUTTING_LABEL : pipeline?.label;
  const stage =
    drill.stageId && drill.stageId !== CROSS_CUTTING_ID
      ? pipeline?.stages.find((s) => s.id === drill.stageId)
      : undefined;
  const stageLabel =
    drill.stageId === CROSS_CUTTING_ID ? CROSS_CUTTING_LABEL : stage?.label;
  const flow = drill.flowId ? snapshot.flows[drill.flowId] : undefined;

  // A search result sets the full drill path to that flow: pipeline + stage
  // derived from its first stage, flow = its own id. Flows with no stage land
  // in the cross-cutting group. Search clears so the drill view takes over.
  function openFlow(target: FlowEntry) {
    const firstStageId = target.stageIds[0];
    const lookup = firstStageId ? snapshot.stageLookup[firstStageId] : undefined;
    if (firstStageId && lookup) {
      setDrill({
        pipelineId: lookup.pipelineId,
        stageId: firstStageId,
        flowId: target.id,
      });
    } else {
      setDrill({
        pipelineId: CROSS_CUTTING_ID,
        stageId: CROSS_CUTTING_ID,
        flowId: target.id,
      });
    }
    setSearch("");
  }

  // Cross-flow navigation: open a flow identified only by its clone-base name
  // (as carried in progression links). Prefer an enabled member so we land on a
  // live flow. If no live flow matches the base name, no-op gracefully.
  function openFlowByName(name: string) {
    const matches = Object.values(snapshot.flows).filter(
      (f) => cloneBaseName(f.name) === name,
    );
    if (matches.length === 0) return;
    const target = matches.find((f) => f.isEnabled) ?? matches[0];
    const firstStageId = target.stageIds[0];
    const lookup = firstStageId
      ? snapshot.stageLookup[firstStageId]
      : undefined;
    if (firstStageId && lookup) {
      setDrill({
        pipelineId: lookup.pipelineId,
        stageId: firstStageId,
        flowId: target.id,
      });
    } else {
      setDrill({
        pipelineId: CROSS_CUTTING_ID,
        stageId: CROSS_CUTTING_ID,
        flowId: target.id,
      });
    }
    if (search) setSearch("");
  }

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
          {drill.pipelineId && pipelineLabel && (
            <>
              <span className="text-muted/50">›</span>
              <button
                type="button"
                onClick={() => setDrill({ pipelineId: drill.pipelineId })}
                className={
                  drill.stageId
                    ? "text-muted hover:text-foreground transition-colors truncate"
                    : "text-foreground font-medium truncate"
                }
              >
                {pipelineLabel}
              </button>
            </>
          )}
          {drill.stageId && stageLabel && (
            <>
              <span className="text-muted/50">›</span>
              <button
                type="button"
                onClick={() =>
                  setDrill({
                    pipelineId: drill.pipelineId,
                    stageId: drill.stageId,
                  })
                }
                className={
                  drill.flowId
                    ? "text-muted hover:text-foreground transition-colors truncate"
                    : "text-foreground font-medium truncate"
                }
              >
                {stageLabel}
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

      {lastSynced && (
        <div className="text-xs text-muted">Last synced: {lastSynced}</div>
      )}

      {/* Search overrides the drill levels with a flat, filtered flow list. */}
      {searching ? (
        <SearchResults
          snapshot={snapshot}
          query={search}
          onSelect={openFlow}
        />
      ) : !drill.pipelineId ? (
        // Level 1 — pipeline cards.
        <PipelineCards
          snapshot={snapshot}
          onSelect={(pipelineId) => setDrill({ pipelineId })}
        />
      ) : (
        // Levels 2–4 — stage track + (panes / flow detail).
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
          <div className="rounded-xl border border-t-border bg-surface p-3 shadow-card lg:self-start">
            <StageTrack
              snapshot={snapshot}
              pipelineId={drill.pipelineId}
              pipeline={pipeline}
              selectedStageId={drill.stageId}
              onSelect={(stageId) =>
                setDrill({ pipelineId: drill.pipelineId, stageId })
              }
            />
          </div>

          <div className="space-y-5">
            {drill.stageId ? (
              <StagePanes
                snapshot={snapshot}
                stageId={drill.stageId}
                selectedFlowId={drill.flowId}
                onSelectFlow={(flowId) =>
                  setDrill({ ...drill, flowId })
                }
              />
            ) : (
              <div className="rounded-xl border border-dashed border-t-border bg-surface p-6 text-sm text-muted shadow-card">
                Pick a stage to see its process and automations.
              </div>
            )}

            {flow && (
              <FlowDetail
                flow={flow}
                on={cloneFamilyOn(flow, snapshot)}
                view={view}
                canEdit={canEditSop}
                links={snapshot.links}
                onOpenFlowByName={openFlowByName}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
