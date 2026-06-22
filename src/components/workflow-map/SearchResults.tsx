"use client";

import type { FlowEntry, FlowMapSnapshot } from "@/lib/flow-map/types";
import { groupFlowClones } from "./flow-map-utils";
import { FlowStatusPill } from "./FlowStatusPill";

function matchesQuery(flow: FlowEntry, q: string): boolean {
  if (flow.name.toLowerCase().includes(q)) return true;
  if (flow.trigger.toLowerCase().includes(q)) return true;
  if (flow.triggerTechnical.toLowerCase().includes(q)) return true;
  if (flow.actions.some((a) => a.toLowerCase().includes(q))) return true;
  if (flow.actionsTechnical.some((a) => a.toLowerCase().includes(q)))
    return true;
  return false;
}

export default function SearchResults({
  snapshot,
  query,
  onSelect,
}: {
  snapshot: FlowMapSnapshot;
  query: string;
  /** Receives the matched flow; caller derives the full drill path. */
  onSelect: (flow: FlowEntry) => void;
}) {
  const q = query.trim().toLowerCase();
  // Collapse clones the same way the drill list does: one row per family, with
  // a ×N badge. Clicking opens the representative flow.
  const matches = groupFlowClones(
    Object.values(snapshot.flows).filter((flow) => matchesQuery(flow, q)),
  ).sort((a, b) => a.base.localeCompare(b.base));

  if (matches.length === 0) {
    return (
      <div className="rounded-lg border border-t-border bg-surface p-6 text-sm text-muted shadow-card">
        No flows match “{query}”.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-xs text-muted">
        {matches.length} {matches.length === 1 ? "flow" : "flows"} matching “
        {query}”
      </div>
      <ul className="space-y-1.5">
        {matches.map((group) => (
          <li key={group.rep.id}>
            <button
              type="button"
              onClick={() => onSelect(group.rep)}
              className="flex w-full items-center gap-2 rounded-lg border border-t-border bg-surface px-3 py-2 text-left transition-colors hover:bg-surface-2/60"
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
        ))}
      </ul>
    </div>
  );
}
