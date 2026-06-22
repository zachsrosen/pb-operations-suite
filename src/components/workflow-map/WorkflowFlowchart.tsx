"use client";

/**
 * Workflow Map — zoomable flowchart view.
 *
 * Three semantic-zoom levels driven by the SAME drill state the client holds,
 * so the breadcrumb + Plain/Technical toggle stay in sync:
 *
 *   Level 1 (no pipelineId):  one node per pipeline. Sales at the left with
 *                             directed edges to the downstream pipelines +
 *                             a Cross-cutting node. Click → setDrill({pipelineId}).
 *   Level 2 (pipelineId set): one node per stage, left→right by `order`, with
 *                             sequential edges. Click → setDrill({pipelineId, stageId}).
 *   Level 3 (stageId set):    one node per flow (clones collapsed). Edges are
 *                             status hand-offs derived from snapshot.links. Click →
 *                             setDrill({pipelineId, stageId, flowId: rep.id}).
 *
 * Positions are computed manually (no layout lib) and kept deterministic.
 */

import { useMemo } from "react";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type { FlowMapSnapshot, Pipeline } from "@/lib/flow-map/types";
import {
  CROSS_CUTTING_ID,
  CROSS_CUTTING_LABEL,
  cloneBaseName,
  flowsForPipeline,
  flowsForStage,
  groupFlowClones,
  nonEmptyPipelines,
  pipelineDisplayLabel,
} from "./flow-map-utils";
import {
  layeredDepths,
  partitionConnected,
  type HandoffEdge,
} from "./flowchart-layout";

type DrillState = {
  pipelineId?: string;
  stageId?: string;
  flowId?: string;
};

// ── Custom node payloads ──────────────────────────────────────────────────

type PipelineNodeData = {
  label: string;
  sub: string;
  hero?: boolean;
};
type StageNodeData = {
  label: string;
  sub: string;
};
type FlowNodeData = {
  label: string;
  on: boolean;
  count: number;
};

// Card-style custom nodes using theme tokens (no hardcoded colors). React Flow
// renders these inside a positioned wrapper; we only style the inner card.

function PipelineNode({ data }: NodeProps<Node<PipelineNodeData>>) {
  return (
    <div
      className={`rounded-xl border shadow-card text-left transition-all ${
        data.hero
          ? "bg-surface-2 border-cyan-500/50 px-5 py-4 ring-1 ring-cyan-500/30"
          : "bg-surface-2 border-t-border px-4 py-3"
      }`}
      style={{ width: data.hero ? 220 : 190 }}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div
        className={`font-semibold text-foreground ${
          data.hero ? "text-base" : "text-sm"
        }`}
      >
        {data.label}
      </div>
      <div className="mt-1 text-xs text-muted tabular-nums">{data.sub}</div>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}

function StageNode({ data }: NodeProps<Node<StageNodeData>>) {
  return (
    <div
      className="rounded-lg border border-t-border bg-surface-2 px-3 py-2 shadow-card text-left"
      style={{ width: 170 }}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div className="text-sm font-medium text-foreground leading-snug">
        {data.label}
      </div>
      <div className="mt-1 text-xs text-muted tabular-nums">{data.sub}</div>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}

function FlowNode({ data }: NodeProps<Node<FlowNodeData>>) {
  return (
    <div
      className="rounded-lg border border-t-border bg-surface-2 px-3 py-2 shadow-card text-left"
      style={{ width: 190 }}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div className="flex items-start gap-2">
        <span
          aria-hidden
          className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${
            data.on ? "bg-emerald-400" : "bg-zinc-500"
          }`}
        />
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground leading-snug">
            {data.label}
          </div>
          <div className="mt-0.5 text-[11px] text-muted">
            {data.on ? "On" : "Off"}
            {data.count > 1 ? ` · ×${data.count}` : ""}
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}

const nodeTypes = {
  pipeline: PipelineNode,
  stage: StageNode,
  flow: FlowNode,
};

// ── Layout constants ──────────────────────────────────────────────────────

const L1_COL_GAP = 360;
const L1_ROW_GAP = 110;
const L2_COL_GAP = 230;
const L3_COL_GAP = 280;
const L3_ROW_GAP = 90;

// Pipeline ordering mirrors PipelineCards: Project hero, then D&R, Roofing,
// Service, rest.
function downstreamRank(p: Pipeline): number {
  const l = p.label.toLowerCase();
  if (l.includes("project")) return 0;
  if (l.includes("d&r") || l.includes("d & r") || l.includes("d and r")) return 1;
  if (l.includes("roofing")) return 2;
  if (l.includes("service")) return 3;
  return 4;
}

function pipelineSub(id: string, snapshot: FlowMapSnapshot): string {
  const flows = flowsForPipeline(id, snapshot);
  const on = flows.filter((f) => f.isEnabled).length;
  return `${flows.length} ${flows.length === 1 ? "flow" : "flows"} · ${on} on`;
}

// ── Graph builders per level ──────────────────────────────────────────────

function buildLevel1(snapshot: FlowMapSnapshot): {
  nodes: Node[];
  edges: Edge[];
} {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Only pipelines that actually carry flows (drop Test Pipeline, Technical
  // Operations, Company Initiatives, etc.).
  const visible = nonEmptyPipelines(snapshot);
  const sales = visible.find((p) => p.label.toLowerCase().includes("sales"));
  const downstream = visible
    .filter((p) => p.id !== sales?.id)
    .sort((a, b) => downstreamRank(a) - downstreamRank(b));

  // Right-hand column: downstream pipelines + cross-cutting (if any).
  const rightItems: Array<{ id: string; label: string; hero: boolean }> =
    downstream.map((p, i) => ({
      id: p.id,
      label: pipelineDisplayLabel(p, snapshot),
      hero: i === 0,
    }));
  if (flowsForPipeline(CROSS_CUTTING_ID, snapshot).length > 0) {
    rightItems.push({
      id: CROSS_CUTTING_ID,
      label: CROSS_CUTTING_LABEL,
      hero: false,
    });
  }

  const colHeight = (rightItems.length - 1) * L1_ROW_GAP;
  const centerY = colHeight / 2;

  if (sales) {
    nodes.push({
      id: sales.id,
      type: "pipeline",
      position: { x: 0, y: centerY },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        label: pipelineDisplayLabel(sales, snapshot),
        sub: pipelineSub(sales.id, snapshot),
        hero: false,
      } satisfies PipelineNodeData,
    });
  }

  rightItems.forEach((item, i) => {
    nodes.push({
      id: item.id,
      type: "pipeline",
      position: { x: L1_COL_GAP, y: i * L1_ROW_GAP },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        label: item.label,
        sub: pipelineSub(item.id, snapshot),
        hero: item.hero,
      } satisfies PipelineNodeData,
    });
    if (sales) {
      edges.push({
        id: `e-${sales.id}-${item.id}`,
        source: sales.id,
        target: item.id,
        animated: item.hero,
      });
    }
  });

  return { nodes, edges };
}

function buildLevel2(
  snapshot: FlowMapSnapshot,
  pipelineId: string,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const pipeline = snapshot.pipelines.find((p) => p.id === pipelineId);
  const stages = pipeline
    ? [...pipeline.stages].sort((a, b) => a.order - b.order)
    : [];

  stages.forEach((stage, i) => {
    const flows = flowsForStage(stage.id, snapshot);
    nodes.push({
      id: stage.id,
      type: "stage",
      position: { x: i * L2_COL_GAP, y: 0 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        label: stage.label,
        sub: `${flows.length} ${flows.length === 1 ? "flow" : "flows"}`,
      } satisfies StageNodeData,
    });
    if (i > 0) {
      const prev = stages[i - 1];
      edges.push({
        id: `e-${prev.id}-${stage.id}`,
        source: prev.id,
        target: stage.id,
        animated: false,
      });
    }
  });

  // Append a Cross-cutting pseudo-stage when this is the cross-cutting pipeline,
  // OR when there are cross-cutting flows worth surfacing alongside this pipeline.
  if (pipelineId === CROSS_CUTTING_ID) {
    const flows = flowsForStage(CROSS_CUTTING_ID, snapshot);
    nodes.push({
      id: CROSS_CUTTING_ID,
      type: "stage",
      position: { x: 0, y: 0 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        label: CROSS_CUTTING_LABEL,
        sub: `${flows.length} ${flows.length === 1 ? "flow" : "flows"}`,
      } satisfies StageNodeData,
    });
  }

  return { nodes, edges };
}

// Truncate long task subjects so an edge label stays legible.
function truncate(s: string, max = 32): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function buildLevel3(
  snapshot: FlowMapSnapshot,
  stageId: string,
  showDisabled: boolean,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  let groups = groupFlowClones(flowsForStage(stageId, snapshot));
  // Hide disabled clone-families unless the viewer opts in. `on` is the
  // family-aggregate enabled state, so a group survives if ANY clone is live.
  if (!showDisabled) groups = groups.filter((g) => g.on);
  if (groups.length === 0) return { nodes, edges };

  // Node id = clone-base name (stable, matches the names carried in links).
  const baseNames = new Set(groups.map((g) => g.base));

  // Hand-off edges: for each progression link, if a setter base name AND a firer
  // base name are both present in this stage, draw setter → firer. Status links
  // are solid (status hand-off); task links are dashed (task completed). Dedupe
  // on (source, target, kind) and capture a label.
  const handoffs: HandoffEdge[] = [];
  const seen = new Set<string>();
  for (const link of snapshot.links) {
    const isTask = link.kind === "task";
    const setters = link.setBy.filter((n) => baseNames.has(n));
    const firers = link.firesFlows.filter((n) => baseNames.has(n));
    for (const src of setters) {
      for (const tgt of firers) {
        if (src === tgt) continue;
        const key = `${src}→${tgt}→${link.kind}`;
        if (seen.has(key)) continue;
        seen.add(key);
        handoffs.push({ source: src, target: tgt });
        edges.push({
          id: `e-${key}`,
          source: src,
          target: tgt,
          label: isTask ? `✓ ${truncate(link.label)}` : link.label,
          animated: !isTask,
          style: isTask
            ? { stroke: "var(--accent-purple, #a78bfa)", strokeDasharray: "5 4" }
            : { stroke: "var(--accent-cyan, #22d3ee)" },
          labelStyle: isTask
            ? { fill: "var(--accent-purple, #a78bfa)", fontSize: 11 }
            : { fontSize: 11 },
          labelBgStyle: { fill: "var(--surface, #18181b)", fillOpacity: 0.85 },
        });
      }
    }
  }

  const { connected, isolated } = partitionConnected(
    groups.map((g) => g.base),
    handoffs,
  );
  const depths = layeredDepths(connected, handoffs);

  // Group connected nodes by depth column, stack vertically within a column.
  const byColumn = new Map<number, string[]>();
  for (const base of connected) {
    const col = depths[base] ?? 0;
    const list = byColumn.get(col);
    if (list) list.push(base);
    else byColumn.set(col, [base]);
  }

  const repByBase = new Map(groups.map((g) => [g.base, g]));
  const pushNode = (base: string, x: number, y: number) => {
    const group = repByBase.get(base);
    if (!group) return;
    nodes.push({
      id: base,
      type: "flow",
      position: { x, y },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        label: group.base,
        on: group.on,
        count: group.count,
      } satisfies FlowNodeData,
    });
  };

  const maxCol = Math.max(0, ...Array.from(byColumn.keys()));
  for (const [col, bases] of Array.from(byColumn.entries()).sort(
    (a, b) => a[0] - b[0],
  )) {
    bases.forEach((base, row) => {
      pushNode(base, col * L3_COL_GAP, row * L3_ROW_GAP);
    });
  }

  // Isolated flows (no hand-offs) go in a trailing grid after the connected
  // columns, in a tidy 2-wide block so they stay readable.
  const trailingStartCol = connected.length > 0 ? maxCol + 1 : 0;
  const perRow = 2;
  isolated.forEach((base, i) => {
    const col = trailingStartCol + (i % perRow);
    const row = Math.floor(i / perRow);
    pushNode(base, col * L3_COL_GAP, row * L3_ROW_GAP);
  });

  return { nodes, edges };
}

// ── Component ─────────────────────────────────────────────────────────────

export default function WorkflowFlowchart({
  snapshot,
  drill,
  setDrill,
  showDisabled = false,
}: {
  snapshot: FlowMapSnapshot;
  drill: DrillState;
  setDrill: (next: DrillState) => void;
  /** When false (default), L3 omits disabled flows. */
  showDisabled?: boolean;
}) {
  const { nodes, edges, level } = useMemo(() => {
    if (!drill.pipelineId) {
      return { ...buildLevel1(snapshot), level: 1 as const };
    }
    if (!drill.stageId) {
      return { ...buildLevel2(snapshot, drill.pipelineId), level: 2 as const };
    }
    return {
      ...buildLevel3(snapshot, drill.stageId, showDisabled),
      level: 3 as const,
    };
  }, [snapshot, drill.pipelineId, drill.stageId, showDisabled]);

  // Selecting a flow node needs the group's representative id (an enabled clone
  // when one exists). Resolve lazily on click against the current stage.
  const repIdForBase = useMemo(() => {
    if (level !== 3 || !drill.stageId) return new Map<string, string>();
    const groups = groupFlowClones(flowsForStage(drill.stageId, snapshot));
    return new Map(groups.map((g) => [g.base, g.rep.id]));
  }, [level, drill.stageId, snapshot]);

  // Highlight the selected flow node (Level 3) so it tracks the breadcrumb.
  const selectedBase = useMemo(() => {
    if (level !== 3 || !drill.flowId) return undefined;
    const entry = snapshot.flows[drill.flowId];
    return entry ? cloneBaseName(entry.name) : undefined;
  }, [level, drill.flowId, snapshot]);

  const renderedNodes = useMemo(
    () =>
      nodes.map((n) => {
        const classes: string[] = [];
        if (n.id === selectedBase) classes.push("ring-2 ring-cyan-500 rounded-lg");
        // De-emphasize disabled flow nodes when they're being shown.
        if (
          level === 3 &&
          (n.data as FlowNodeData)?.on === false
        ) {
          classes.push("opacity-50");
        }
        return classes.length ? { ...n, className: classes.join(" ") } : n;
      }),
    [nodes, selectedBase, level],
  );

  // Pop one drill level: flow → stage → pipeline → top.
  function goBack() {
    if (drill.flowId) {
      setDrill({ pipelineId: drill.pipelineId, stageId: drill.stageId });
    } else if (drill.stageId) {
      setDrill({ pipelineId: drill.pipelineId });
    } else if (drill.pipelineId) {
      setDrill({});
    }
  }

  const canGoBack = Boolean(drill.pipelineId);

  function onNodeClick(_e: React.MouseEvent, node: Node) {
    if (level === 1) {
      setDrill({ pipelineId: node.id });
    } else if (level === 2) {
      setDrill({ pipelineId: drill.pipelineId, stageId: node.id });
    } else {
      const repId = repIdForBase.get(node.id);
      if (repId) {
        setDrill({
          pipelineId: drill.pipelineId,
          stageId: drill.stageId,
          flowId: repId,
        });
      }
    }
  }

  const emptyLevel3 = level === 3 && nodes.length === 0;

  return (
    <div className="min-h-[70vh] rounded-xl border border-t-border bg-surface shadow-card overflow-hidden">
      {emptyLevel3 ? (
        <div className="flex min-h-[70vh] items-center justify-center p-6 text-sm text-muted">
          No automations run in this stage.
        </div>
      ) : (
        <div className="min-h-[70vh] h-[70vh]">
          <ReactFlow
            // Force a remount per level so fitView re-runs cleanly on drill change.
            key={`${level}-${drill.pipelineId ?? ""}-${drill.stageId ?? ""}`}
            nodes={renderedNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            onNodeClick={onNodeClick}
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls showInteractive={false} />
            <MiniMap
              pannable
              zoomable
              maskColor="rgba(0,0,0,0.55)"
              bgColor="var(--surface-2, #1c1c1f)"
              nodeColor="var(--muted, #52525b)"
              nodeStrokeColor="var(--t-border, #3f3f46)"
              style={{
                backgroundColor: "var(--surface-2, #1c1c1f)",
                border: "1px solid var(--t-border, #3f3f46)",
                borderRadius: 8,
              }}
            />

            {/* Back affordance — pops one drill level (mirrors the breadcrumb). */}
            {canGoBack && (
              <Panel position="top-left">
                <button
                  type="button"
                  onClick={goBack}
                  className="rounded-lg border border-t-border bg-surface-2 px-2.5 py-1 text-xs font-medium text-foreground shadow-card transition-colors hover:text-cyan-400"
                >
                  ← Back
                </button>
              </Panel>
            )}

            {/* Legend — only meaningful at the stage (edge) level. */}
            {level === 3 && edges.length > 0 && (
              <Panel position="bottom-left">
                <div className="flex items-center gap-3 rounded-lg border border-t-border bg-surface-2/90 px-2.5 py-1.5 text-[11px] text-muted shadow-card">
                  <span className="flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className="inline-block h-0.5 w-5 rounded bg-cyan-400"
                    />
                    status hand-off
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className="inline-block h-0 w-5 border-t-2 border-dashed border-purple-400"
                    />
                    task completed
                  </span>
                </div>
              </Panel>
            )}
          </ReactFlow>
        </div>
      )}
    </div>
  );
}
