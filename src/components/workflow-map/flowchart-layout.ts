/**
 * Pure layout helpers for the Workflow Map flowchart.
 *
 * Kept free of React Flow / React so the depth math can be unit-tested in
 * isolation. The flowchart component consumes `layeredDepths` to place Level-3
 * flow nodes into columns by BFS depth over status hand-off edges.
 */

export type HandoffEdge = { source: string; target: string };

/**
 * Classify a flow by its workflow "family" from its (clone-collapsed) name.
 *
 * The Level-3 stage view groups flows into horizontal swim-lanes by family so a
 * busy stage reads as a handful of labelled bands rather than a wall of nodes.
 * Patterns are checked in priority order; the first match wins. Anything that
 * matches nothing lands in "Other".
 *
 * Pure + side-effect free so it can be unit-tested in isolation.
 */
export function flowFamily(name: string): string {
  const n = name || "";
  if (/date stamp/i.test(n)) return "Date Stamp";
  if (/revision|in design for revision/i.test(n)) return "Revisions";
  if (/\bda flow\b/i.test(n)) return "DA Flow";
  if (/design flow/i.test(n)) return "Design Flow";
  if (/permit(ting)? flow/i.test(n)) return "Permit Flow";
  if (/utility flow/i.test(n)) return "Utility Flow";
  if (/interconnection flow/i.test(n)) return "Interconnection Flow";
  if (/site survey flow/i.test(n)) return "Site Survey Flow";
  if (/construction flow/i.test(n)) return "Construction Flow";
  if (/inspection flow/i.test(n)) return "Inspection Flow";
  if (/pto flow/i.test(n)) return "PTO Flow";
  if (/quality flow/i.test(n)) return "Quality Flow";
  if (/transition/i.test(n)) return "Transitions";
  if (/bot hook|bot comms/i.test(n)) return "Bots";
  return "Other";
}

/**
 * Fixed lane ordering for the Level-3 family swim-lanes. Primary process
 * families lead, supporting families (revisions, transitions, bots, other) come
 * next, and the Date Stamp plumbing lane always sorts last. Families not listed
 * here fall after the listed ones (before Date Stamp) in alpha order; the
 * caller only renders lanes that actually have flows.
 */
export const FLOW_FAMILY_ORDER: readonly string[] = [
  "Design Flow",
  "DA Flow",
  "Permit Flow",
  "Utility Flow",
  "Interconnection Flow",
  "Site Survey Flow",
  "Construction Flow",
  "Inspection Flow",
  "PTO Flow",
  "Quality Flow",
  "Revisions",
  "Transitions",
  "Bots",
  "Other",
  "Date Stamp",
];

/**
 * Order a set of present family names by FLOW_FAMILY_ORDER. Unlisted families
 * sort after listed ones (alpha), but always before "Date Stamp" which is
 * pinned last as plumbing.
 */
export function orderFamilies(families: Iterable<string>): string[] {
  const present = Array.from(new Set(families));
  const rank = (f: string): number => {
    if (f === "Date Stamp") return Number.MAX_SAFE_INTEGER;
    const i = FLOW_FAMILY_ORDER.indexOf(f);
    return i === -1 ? FLOW_FAMILY_ORDER.length - 1 : i;
  };
  return present.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    return ra !== rb ? ra - rb : a.localeCompare(b);
  });
}

/**
 * Parse a leading numbered prefix like "01", "12a", "3b" from a flow name for
 * left-to-right ordering within a lane. Returns a sortable tuple
 * [num, suffix, lowerName]; names without a numbered prefix sort after numbered
 * ones, then alpha by name.
 */
export function flowSortKey(name: string): [number, string, string] {
  const m = /^\s*(\d+)\s*([a-z]?)/i.exec(name || "");
  if (m) return [parseInt(m[1], 10), m[2].toLowerCase(), (name || "").toLowerCase()];
  return [Number.MAX_SAFE_INTEGER, "", (name || "").toLowerCase()];
}

/**
 * Compute a column/depth for each node id given directed hand-off edges.
 *
 * - Roots (no incoming edge) get depth 0.
 * - A target's depth is 1 + the max depth of its sources (longest-path layering),
 *   resolved by repeated relaxation so the result is deterministic regardless of
 *   edge order.
 * - Nodes with no edges at all (isolated) are returned with depth 0; the caller
 *   is responsible for laying them out in a trailing grid if it wants them
 *   separated from the connected graph.
 * - Cycles are tolerated: relaxation is capped at `nodeIds.length` passes so a
 *   cycle can't loop forever; nodes in a cycle settle at a stable finite depth.
 *
 * @param nodeIds  all flow node ids that should receive a depth
 * @param edges    directed hand-off edges (source sets a status, target fires on it)
 * @returns map of nodeId → depth (0-based column index)
 */
export function layeredDepths(
  nodeIds: string[],
  edges: HandoffEdge[],
): Record<string, number> {
  const ids = new Set(nodeIds);
  // Only keep edges whose endpoints are both in the node set.
  const valid = edges.filter((e) => ids.has(e.source) && ids.has(e.target));

  const depth: Record<string, number> = {};
  for (const id of nodeIds) depth[id] = 0;

  const incoming = new Map<string, string[]>();
  for (const id of nodeIds) incoming.set(id, []);
  for (const e of valid) incoming.get(e.target)!.push(e.source);

  // Relax up to N times (N = node count). Each pass pushes every node to at
  // least 1 + max(source depths). Stable once no value changes.
  const passes = Math.max(nodeIds.length, 1);
  for (let pass = 0; pass < passes; pass++) {
    let changed = false;
    for (const id of nodeIds) {
      const sources = incoming.get(id)!;
      if (sources.length === 0) continue;
      let best = depth[id];
      for (const src of sources) {
        const candidate = depth[src] + 1;
        if (candidate > best) best = candidate;
      }
      if (best !== depth[id]) {
        depth[id] = best;
        changed = true;
      }
    }
    if (!changed) break;
  }

  return depth;
}

/**
 * Partition node ids into "connected" (touched by at least one valid edge) and
 * "isolated" (no edges). Useful for the trailing grid layout of flows that have
 * no status hand-offs.
 */
export function partitionConnected(
  nodeIds: string[],
  edges: HandoffEdge[],
): { connected: string[]; isolated: string[] } {
  const ids = new Set(nodeIds);
  const touched = new Set<string>();
  for (const e of edges) {
    if (ids.has(e.source) && ids.has(e.target)) {
      touched.add(e.source);
      touched.add(e.target);
    }
  }
  const connected: string[] = [];
  const isolated: string[] = [];
  for (const id of nodeIds) {
    if (touched.has(id)) connected.push(id);
    else isolated.push(id);
  }
  return { connected, isolated };
}
