"use client";

/**
 * Admin Workflows — read-only canvas preview.
 *
 * Renders the workflow as a top-to-bottom vertical graph using
 * @xyflow/react. Includes the trigger as a root node and each step as
 * a child. Parallel steps fan out horizontally.
 *
 * Read-only by design: clicking a node links back to the form editor.
 * Full drag-and-drop authoring is a future phase.
 */

import { use, useEffect, useState } from "react";
import Link from "next/link";
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

export default function CanvasPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/admin/workflows/${id}`)
      .then((r) => r.json())
      .then((d) => setWorkflow(d.workflow))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  if (error) {
    return (
      <DashboardShell title="Canvas" accentColor="purple">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <div className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
        </div>
      </DashboardShell>
    );
  }
  if (!workflow) {
    return (
      <DashboardShell title="Canvas" accentColor="purple">
        <div className="max-w-4xl mx-auto px-4 py-6 text-muted text-sm">Loading…</div>
      </DashboardShell>
    );
  }

  // Build nodes + edges
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Trigger node (root)
  nodes.push({
    id: "__trigger",
    type: "default",
    position: { x: 250, y: 0 },
    data: { label: `Trigger: ${workflow.triggerType}` },
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
  const stepY = 120;

  workflow.definition.steps.forEach((step, idx) => {
    const y = (idx + 1) * stepY;
    if (step.kind === "parallel") {
      // Parallel: render children horizontally
      let children: Array<{ id: string; kind: string }> = [];
      try {
        const raw = JSON.parse(step.inputs.childrenJson ?? "[]") as Array<{ id: string; kind: string }>;
        if (Array.isArray(raw)) children = raw;
      } catch {
        // Show parallel as a single node if JSON malformed
      }

      // Header node for the parallel step
      const headerId = `step-${step.id}`;
      nodes.push({
        id: headerId,
        position: { x: 250, y },
        data: { label: `parallel: ${step.id}` },
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
      edges.push({ id: `e-${lastTopLevelId}-${headerId}`, source: lastTopLevelId, target: headerId });

      children.forEach((c, ci) => {
        const childX = 50 + ci * 220;
        const childY = y + 100;
        const childNodeId = `step-${step.id}-child-${c.id}`;
        nodes.push({
          id: childNodeId,
          position: { x: childX, y: childY },
          data: { label: `${c.id}\n${c.kind}` },
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
        edges.push({
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
    nodes.push({
      id: nodeId,
      position: { x: 250, y },
      data: { label: `${idx + 1}. ${step.id}\n${step.kind}` },
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
    edges.push({ id: `e-${lastTopLevelId}-${nodeId}`, source: lastTopLevelId, target: nodeId });
    lastTopLevelId = nodeId;
  });

  return (
    <DashboardShell title={`Canvas: ${workflow.name}`} accentColor="purple" fullWidth>
      <div className="h-[calc(100vh-120px)] flex flex-col">
        <div className="px-4 py-3 border-b border-t-border flex items-center justify-between">
          <Link href={`/dashboards/admin/workflows/${id}`} className="text-sm text-muted hover:text-foreground">
            ← Back to editor
          </Link>
          <span className="text-xs text-muted">
            Read-only preview. Click any node to jump back to the editor.
          </span>
        </div>
        <div className="flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            fitView
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            onNodeClick={() => {
              window.location.href = `/dashboards/admin/workflows/${id}`;
            }}
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
