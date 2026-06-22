/**
 * Pure layout helpers for the Workflow Map flowchart.
 *
 * Kept free of React Flow / React so the depth math can be unit-tested in
 * isolation. The flowchart component consumes `layeredDepths` to place Level-3
 * flow nodes into columns by BFS depth over status hand-off edges.
 */

export type HandoffEdge = { source: string; target: string };

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
