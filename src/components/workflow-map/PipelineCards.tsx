"use client";

import type { FlowMapSnapshot, Pipeline } from "@/lib/flow-map/types";
import {
  CROSS_CUTTING_ID,
  CROSS_CUTTING_LABEL,
  flowsForPipeline,
  nonEmptyPipelines,
  pipelineDisplayLabel,
} from "./flow-map-utils";

type CardModel = {
  id: string;
  label: string;
  total: number;
  on: number;
};

function buildCard(
  id: string,
  label: string,
  snapshot: FlowMapSnapshot,
): CardModel {
  const flows = flowsForPipeline(id, snapshot);
  return {
    id,
    label,
    total: flows.length,
    on: flows.filter((f) => f.isEnabled).length,
  };
}

function PipelineCard({
  card,
  onSelect,
  hero,
}: {
  card: CardModel;
  onSelect: (id: string) => void;
  hero?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(card.id)}
      className={`text-left bg-surface-2 rounded-xl border border-t-border shadow-card hover:brightness-110 transition-all ${
        hero ? "p-6" : "p-4"
      }`}
    >
      <div
        className={`font-semibold text-foreground ${
          hero ? "text-lg" : "text-base"
        }`}
      >
        {card.label}
      </div>
      <div className="mt-1 text-sm text-muted tabular-nums">
        {card.total} {card.total === 1 ? "flow" : "flows"} · {card.on} on
      </div>
    </button>
  );
}

export default function PipelineCards({
  snapshot,
  onSelect,
}: {
  snapshot: FlowMapSnapshot;
  onSelect: (pipelineId: string) => void;
}) {
  // Only pipelines that carry flows (drop Test Pipeline, Technical Operations,
  // Company Initiatives, etc.).
  const visible = nonEmptyPipelines(snapshot);
  const salesPipeline = visible.find((p) =>
    p.label.toLowerCase().includes("sales"),
  );

  // Order downstream deal pipelines so Project (the hero) leads, then the rest.
  const downstream = visible.filter((p) => p.id !== salesPipeline?.id);
  const rank = (p: Pipeline) => {
    const l = p.label.toLowerCase();
    if (l.includes("project")) return 0;
    if (l.includes("d&r") || l.includes("d & r") || l.includes("d and r"))
      return 1;
    if (l.includes("roofing")) return 2;
    if (l.includes("service")) return 3;
    return 4;
  };
  const downstreamSorted = [...downstream].sort((a, b) => rank(a) - rank(b));

  const crossCutting = buildCard(
    CROSS_CUTTING_ID,
    CROSS_CUTTING_LABEL,
    snapshot,
  );

  return (
    <div className="space-y-6">
      {/* Sales sits at the top and branches into the downstream pipelines. */}
      {salesPipeline && (
        <div className="space-y-3">
          <PipelineCard
            card={buildCard(
              salesPipeline.id,
              pipelineDisplayLabel(salesPipeline, snapshot),
              snapshot,
            )}
            onSelect={onSelect}
            hero
          />
          <div className="flex items-center gap-2 text-sm text-muted pl-1">
            <span aria-hidden className="text-base leading-none">
              ↓
            </span>
            <span>Sales branches into the downstream pipelines</span>
          </div>
        </div>
      )}

      <div className="stagger-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {downstreamSorted.map((p, i) => (
          <PipelineCard
            key={p.id}
            card={buildCard(p.id, pipelineDisplayLabel(p, snapshot), snapshot)}
            onSelect={onSelect}
            hero={i === 0}
          />
        ))}
      </div>

      {/* Cross-cutting flows live outside any one pipeline's stages. */}
      {crossCutting.total > 0 && (
        <div className="stagger-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <PipelineCard card={crossCutting} onSelect={onSelect} />
        </div>
      )}
    </div>
  );
}
