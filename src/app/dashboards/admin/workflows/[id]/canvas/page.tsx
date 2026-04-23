"use client";

/**
 * Admin Workflows — canvas preview with drag-to-reorder.
 *
 * Renders the workflow as a top-to-bottom graph using @xyflow/react.
 * Admins can drag nodes up/down to change step order and save. Full
 * field editing still lives in the form editor — clicking a node
 * without dragging navigates there.
 *
 * Parallel children remain nested visually but aren't independently
 * reorderable at the top level — you edit them via the parallel step's
 * childrenJson in the form editor.
 */

import type React from "react";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import DashboardShell from "@/components/DashboardShell";

interface Step {
  id: string;
  kind: string;
  inputs: Record<string, string>;
}

interface Workflow {
  id: string;
  name: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  triggerType: string;
  definition: { steps: Step[] };
}

const KIND_COLORS: Record<string, string> = {
  "send-email": "#818cf8",
  "ai-compose": "#f59e0b",
  delay: "#64748b",
  "stop-if": "#ef4444",
  parallel: "#a78bfa",
  "for-each": "#a78bfa",
  "run-bom-pipeline": "#10b981",
  "log-activity": "#64748b",
  "http-request": "#06b6d4",
};

function nodeColor(kind: string): string {
  if (KIND_COLORS[kind]) return KIND_COLORS[kind];
  if (kind.startsWith("update-hubspot")) return "#f97316";
  if (kind.startsWith("add-hubspot") || kind.startsWith("create-hubspot") || kind === "find-hubspot-contact" || kind === "fetch-hubspot-deal") return "#f97316";
  if (kind.startsWith("update-zuper") || kind === "fetch-zuper-job") return "#8b5cf6";
  return "#71717a";
}

const STEP_Y = 120;

export default function CanvasPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [stepOrder, setStepOrder] = useState<Step[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    fetch(`/api/admin/workflows/${id}`)
      .then((r) => r.json())
      .then((d) => {
        setWorkflow(d.workflow);
        setStepOrder(d.workflow.definition.steps);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  const { nodes, edges } = useMemo(() => {
    const _nodes: Node[] = [];
    const _edges: Edge[] = [];

    if (!workflow || !stepOrder) return { nodes: _nodes, edges: _edges };

    _nodes.push({
      id: "__trigger",
      position: { x: 250, y: 0 },
      data: { label: `Trigger: ${workflow.triggerType}` },
      draggable: false,
      style: {
        background: "#1e293b",
        color: "#e2e8f0",
        border: "2px solid #a78bfa",
        borderRadius: 8,
        padding: 10,
        fontSize: 12,
        width: 220,
      },
    });

    let lastTopLevelId = "__trigger";
    stepOrder.forEach((step, idx) => {
      const y = (idx + 1) * STEP_Y;

      if (step.kind === "parallel") {
        let children: Array<{ id: string; kind: string }> = [];
        try {
          const raw = JSON.parse(step.inputs.childrenJson ?? "[]") as Array<{ id: string; kind: string }>;
          if (Array.isArray(raw)) children = raw;
        } catch {}

        const headerId = `step-${step.id}`;
        _nodes.push({
          id: headerId,
          position: { x: 250, y },
          data: { label: `parallel: ${step.id}` },
          draggable: true,
          style: {
            background: "#1e293b",
            color: "#e2e8f0",
            border: `2px solid ${nodeColor("parallel")}`,
            borderRadius: 8,
            padding: 10,
            fontSize: 12,
            width: 220,
          },
        });
        _edges.push({ id: `e-${lastTopLevelId}-${headerId}`, source: lastTopLevelId, target: headerId });

        children.forEach((c, ci) => {
          const childX = 50 + ci * 220;
          const childY = y + 70;
          const childNodeId = `step-${step.id}-child-${c.id}`;
          _nodes.push({
            id: childNodeId,
            position: { x: childX, y: childY },
            data: { label: `${c.id}\n${c.kind}` },
            draggable: false,
            style: {
              background: "#0f172a",
              color: "#cbd5e1",
              border: `1px dashed ${nodeColor(c.kind)}`,
              borderRadius: 6,
              padding: 8,
              fontSize: 11,
              width: 180,
              whiteSpace: "pre-line" as const,
            },
          });
          _edges.push({
            id: `e-${headerId}-${childNodeId}`,
            source: headerId,
            target: childNodeId,
            style: { strokeDasharray: "4 2" },
          });
        });
        lastTopLevelId = headerId;
        return;
      }

      const nodeId = `step-${step.id}`;
      _nodes.push({
        id: nodeId,
        position: { x: 250, y },
        data: { label: `${idx + 1}. ${step.id}\n${step.kind}` },
        draggable: true,
        style: {
          background: "#1e293b",
          color: "#e2e8f0",
          border: `2px solid ${nodeColor(step.kind)}`,
          borderRadius: 8,
          padding: 10,
          fontSize: 12,
          width: 220,
          whiteSpace: "pre-line" as const,
        },
      });
      _edges.push({ id: `e-${lastTopLevelId}-${nodeId}`, source: lastTopLevelId, target: nodeId });
      lastTopLevelId = nodeId;
    });

    return { nodes: _nodes, edges: _edges };
  }, [workflow, stepOrder]);

  // Drag-to-reorder: on drag stop, read the node's new y position and
  // rebuild step order by y-rank of top-level nodes.
  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent | React.TouchEvent, node: Node) => {
      setDragging(false);
      if (!stepOrder || !node.id.startsWith("step-")) return;
      // Only top-level step nodes (not parallel children)
      if (node.id.includes("-child-")) return;

      // Collect all top-level step node positions from current nodes
      const positions = nodes
        .filter((n) => n.id.startsWith("step-") && !n.id.includes("-child-"))
        .map((n) => {
          const stepId = n.id.replace(/^step-/, "");
          const nodeY = n.id === node.id ? node.position.y : n.position.y;
          return { stepId, y: nodeY };
        });

      positions.sort((a, b) => a.y - b.y);
      const reordered = positions
        .map((p) => stepOrder.find((s) => s.id === p.stepId))
        .filter((s): s is Step => !!s);

      if (reordered.length !== stepOrder.length) return; // safety
      const changed = reordered.some((s, i) => s.id !== stepOrder[i].id);
      if (changed) setStepOrder(reordered);
    },
    [nodes, stepOrder],
  );

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      // If not actively dragging, click navigates to the form editor.
      // (onNodeDragStop fires before onNodeClick when the drag moved,
      // so onNodeClick here is effectively "click without drag")
      if (dragging) return;
      if (node.id === "__trigger" || node.id.startsWith("step-")) {
        router.push(`/dashboards/admin/workflows/${id}`);
      }
    },
    [dragging, id, router],
  );

  async function saveOrder() {
    if (!workflow || !stepOrder) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/workflows/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ definition: { steps: stepOrder } }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setToast("Order saved");
      setTimeout(() => setToast(null), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (error) {
    return (
      <DashboardShell title="Canvas" accentColor="purple">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <div className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
        </div>
      </DashboardShell>
    );
  }
  if (!workflow || !stepOrder) {
    return (
      <DashboardShell title="Canvas" accentColor="purple">
        <div className="max-w-4xl mx-auto px-4 py-6 text-muted text-sm">Loading…</div>
      </DashboardShell>
    );
  }

  const originalIds = workflow.definition.steps.map((s) => s.id).join(",");
  const currentIds = stepOrder.map((s) => s.id).join(",");
  const hasChanges = originalIds !== currentIds;

  return (
    <DashboardShell title={`Canvas: ${workflow.name}`} accentColor="purple" fullWidth>
      <div className="h-[calc(100vh-120px)] flex flex-col">
        <div className="px-4 py-3 border-b border-t-border flex items-center justify-between gap-3">
          <Link href={`/dashboards/admin/workflows/${id}`} className="text-sm text-muted hover:text-foreground">
            ← Back to editor
          </Link>
          <div className="flex items-center gap-3 text-xs">
            <span className="text-muted">
              Drag nodes up/down to reorder. Click (no drag) = jump to form editor.
            </span>
            {hasChanges && !saving && (
              <button
                onClick={saveOrder}
                className="rounded-md bg-purple-600 hover:bg-purple-500 px-3 py-1.5 text-white font-medium"
              >
                Save order
              </button>
            )}
            {saving && <span className="text-muted">Saving…</span>}
            {toast && <span className="text-green-400">{toast}</span>}
          </div>
        </div>
        <div className="flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            fitView
            nodesDraggable
            nodesConnectable={false}
            elementsSelectable
            onNodeDragStart={() => setDragging(true)}
            onNodeDragStop={onNodeDragStop}
            onNodeClick={onNodeClick}
          >
            <Background />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>
      </div>
    </DashboardShell>
  );
}
