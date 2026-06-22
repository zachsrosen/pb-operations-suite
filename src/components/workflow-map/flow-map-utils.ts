import type { FlowEntry, FlowMapSnapshot } from "@/lib/flow-map/types";

/** Synthetic pipeline id for flows with no stage associations. */
export const CROSS_CUTTING_ID = "__cross_cutting__";
export const CROSS_CUTTING_LABEL = "Cross-cutting";

/**
 * Strip a trailing clone suffix like " (#2)" so clones collapse onto one base
 * name. "Stamp PE date (#3)" → "Stamp PE date".
 */
export function cloneBaseName(name: string): string {
  return name.replace(/\s*\(#\d+\)\s*$/, "").trim();
}

/**
 * The set of pipeline ids a flow belongs to, derived from its stageIds via
 * stageLookup. A flow with no stages belongs to the synthetic cross-cutting
 * group.
 */
export function pipelineIdsForFlow(
  flow: FlowEntry,
  snapshot: FlowMapSnapshot,
): string[] {
  if (flow.stageIds.length === 0) return [CROSS_CUTTING_ID];
  const ids = new Set<string>();
  for (const stageId of flow.stageIds) {
    const entry = snapshot.stageLookup[stageId];
    if (entry) ids.add(entry.pipelineId);
  }
  // Flow references only unknown stages → treat as cross-cutting so it's never
  // silently dropped from the map.
  return ids.size > 0 ? Array.from(ids) : [CROSS_CUTTING_ID];
}

/** Flows that belong to a given pipeline id (incl. the cross-cutting group). */
export function flowsForPipeline(
  pipelineId: string,
  snapshot: FlowMapSnapshot,
): FlowEntry[] {
  return Object.values(snapshot.flows).filter((flow) =>
    pipelineIdsForFlow(flow, snapshot).includes(pipelineId),
  );
}

/** Flows whose stageIds include a given stage id. */
export function flowsForStage(
  stageId: string,
  snapshot: FlowMapSnapshot,
): FlowEntry[] {
  if (stageId === CROSS_CUTTING_ID) {
    return Object.values(snapshot.flows).filter((f) => f.stageIds.length === 0);
  }
  return Object.values(snapshot.flows).filter((f) =>
    f.stageIds.includes(stageId),
  );
}

export type FlowGroup = {
  /** Representative flow used for drill-in and display. */
  rep: FlowEntry;
  base: string;
  /** Number of clones collapsed into this group. */
  count: number;
};

/**
 * Collapse clones: group flows by clone-base name, returning one entry per base
 * with a count. The representative is the first flow seen for that base.
 */
export function groupFlowClones(flows: FlowEntry[]): FlowGroup[] {
  const byBase = new Map<string, FlowGroup>();
  for (const flow of flows) {
    const base = cloneBaseName(flow.name);
    const existing = byBase.get(base);
    if (existing) {
      existing.count += 1;
    } else {
      byBase.set(base, { rep: flow, base, count: 1 });
    }
  }
  // A single flow with cloneCount>1 should still read as "×N".
  for (const group of byBase.values()) {
    if (group.count === 1 && group.rep.cloneCount > 1) {
      group.count = group.rep.cloneCount;
    }
  }
  return Array.from(byBase.values());
}
