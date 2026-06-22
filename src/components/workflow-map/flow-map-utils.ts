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
  /**
   * Representative flow used for drill-in and display of trigger/actions.
   * Prefers an enabled member so drilling in lands on a live flow when one
   * exists.
   */
  rep: FlowEntry;
  base: string;
  /** Number of clones collapsed into this group. */
  count: number;
  /** Aggregate enabled state: true if ANY member of the family is enabled. */
  on: boolean;
};

/**
 * Collapse clones for display.
 *
 * Contract: the snapshot stores EACH clone as its own `FlowEntry` (its `name`
 * carries the ` (#N)` suffix), so this function groups them by clone-base name
 * and returns one entry per base. `count` is the number of collapsed members
 * (floored at the flow's own `cloneCount`, which is precomputed across all
 * target flows, so a subset that happens to contain a single member still reads
 * as "×N"). `on` is the family-aggregate enabled state, and `rep` prefers an
 * enabled member so drill-in lands on a live flow when one exists.
 */
export function groupFlowClones(flows: FlowEntry[]): FlowGroup[] {
  const members = new Map<string, FlowEntry[]>();
  const order: string[] = [];
  for (const flow of flows) {
    const base = cloneBaseName(flow.name);
    const list = members.get(base);
    if (list) {
      list.push(flow);
    } else {
      members.set(base, [flow]);
      order.push(base);
    }
  }

  return order.map((base) => {
    const list = members.get(base)!;
    const rep = list.find((f) => f.isEnabled) ?? list[0];
    return {
      rep,
      base,
      count: Math.max(list.length, rep.cloneCount),
      on: list.some((f) => f.isEnabled),
    };
  });
}

/**
 * Aggregate enabled state for a flow's whole clone family across the snapshot:
 * true if ANY clone sharing its base name is enabled. Used so a detail pill
 * reflects the family, not just the representative member.
 */
export function cloneFamilyOn(
  flow: FlowEntry,
  snapshot: FlowMapSnapshot,
): boolean {
  const base = cloneBaseName(flow.name);
  return Object.values(snapshot.flows).some(
    (f) => cloneBaseName(f.name) === base && f.isEnabled,
  );
}
