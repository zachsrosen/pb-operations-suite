/**
 * Cross-Source Graph Matcher with Scoring
 *
 * Takes dedupe-cluster representatives from multiple sources, builds a
 * weighted edge graph, finds connected components above a score threshold,
 * and assigns confidence levels. Produces MatchGroup objects with stable
 * keys for persistence.
 */

import { createHash } from "crypto";
import { canonicalToken } from "@/lib/canonical";
import type { HarvestedProduct } from "@/lib/catalog-harvest";
import type { DedupeCluster } from "@/lib/catalog-dedupe";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";

export interface MatchGroup {
  matchGroupKey: string; // sha256 of sorted member IDs, first 16 chars
  confidence: ConfidenceLevel;
  score: number; // max edge score in component
  canonicalBrand: string | null;
  canonicalModel: string | null;
  category: string | null;
  memberClusters: DedupeCluster[];
  memberSources: Array<{
    source: string;
    externalId: string;
    rawName: string;
  }>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EDGE_THRESHOLD = 50;

const VPN_FIELDS = [
  "vendorPartNumber",
  "vendor_part_number",
  "part_number",
  "hs_sku",
  "product_code",
] as const;

// ---------------------------------------------------------------------------
// VPN extraction
// ---------------------------------------------------------------------------

function extractVpn(product: HarvestedProduct): string | null {
  const payload = product.rawPayload;
  if (!payload || typeof payload !== "object") return null;
  for (const field of VPN_FIELDS) {
    // Check top-level
    const val = payload[field];
    if (val != null && String(val).trim().length > 0) {
      return String(val).trim();
    }
    // Check nested properties (e.g. HubSpot rawPayload.properties.hs_sku)
    const props = payload["properties"];
    if (props && typeof props === "object" && !Array.isArray(props)) {
      const nested = (props as Record<string, unknown>)[field];
      if (nested != null && String(nested).trim().length > 0) {
        return String(nested).trim();
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Score how well two harvested products match across multiple signals.
 *
 * | Signal            | Points | Condition                                     |
 * |-------------------|--------|-----------------------------------------------|
 * | Brand+Model match | 40     | canonicalToken(brand) AND model both match    |
 * | Name match        | 20     | canonicalToken(rawName) matches               |
 * | VPN match         | 25     | vendor part number exact match                |
 * | Category match    | 10     | same category string                         |
 * | Price within 5%   | 5      | abs(a-b)/max(a,b) <= 0.05, both non-null > 0 |
 */
export function scorePair(a: HarvestedProduct, b: HarvestedProduct): number {
  let score = 0;

  // Brand + Model match (40)
  const aBrand = canonicalToken(a.rawBrand);
  const bBrand = canonicalToken(b.rawBrand);
  const aModel = canonicalToken(a.rawModel);
  const bModel = canonicalToken(b.rawModel);
  if (aBrand && bBrand && aBrand === bBrand && aModel && bModel && aModel === bModel) {
    score += 40;
  }

  // Name match (20)
  const aName = canonicalToken(a.rawName);
  const bName = canonicalToken(b.rawName);
  if (aName && bName && aName === bName) {
    score += 20;
  }

  // VPN match (25)
  const aVpn = extractVpn(a);
  const bVpn = extractVpn(b);
  if (aVpn && bVpn && aVpn === bVpn) {
    score += 25;
  }

  // Category match (10)
  if (a.category && b.category && a.category === b.category) {
    score += 10;
  }

  // Price within 5% (5)
  if (
    a.price != null &&
    b.price != null &&
    a.price > 0 &&
    b.price > 0
  ) {
    const diff = Math.abs(a.price - b.price);
    const maxPrice = Math.max(a.price, b.price);
    if (diff / maxPrice <= 0.05) {
      score += 5;
    }
  }

  return score;
}

// ---------------------------------------------------------------------------
// Union-Find
// ---------------------------------------------------------------------------

class UnionFind {
  private parent: number[];
  private rank: number[];

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Array(n).fill(0);
  }

  find(x: number): number {
    if (this.parent[x] !== x) {
      this.parent[x] = this.find(this.parent[x]);
    }
    return this.parent[x];
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    if (this.rank[ra] < this.rank[rb]) {
      this.parent[ra] = rb;
    } else if (this.rank[ra] > this.rank[rb]) {
      this.parent[rb] = ra;
    } else {
      this.parent[rb] = ra;
      this.rank[ra]++;
    }
  }
}

// ---------------------------------------------------------------------------
// Match Group Key
// ---------------------------------------------------------------------------

function buildMatchGroupKey(clusters: DedupeCluster[]): string {
  const ids = clusters
    .flatMap((c) =>
      c.members.map((m) => `${m.source}:${m.externalId}`)
    )
    .sort();
  const hash = createHash("sha256").update(ids.join("|")).digest("hex");
  return hash.slice(0, 16);
}

// ---------------------------------------------------------------------------
// Cross-Match
// ---------------------------------------------------------------------------

/**
 * Build a weighted edge graph across all cluster representatives, find
 * connected components above EDGE_THRESHOLD, and return MatchGroups
 * sorted by score descending.
 */
export function crossMatch(clusters: DedupeCluster[]): MatchGroup[] {
  const n = clusters.length;
  if (n === 0) return [];

  const uf = new UnionFind(n);

  // Track max edge score per component root
  const edgeScores = new Map<string, number>(); // "i|j" -> score

  // Build edges between ALL pairs with score >= EDGE_THRESHOLD
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = scorePair(clusters[i].representative, clusters[j].representative);
      if (s >= EDGE_THRESHOLD) {
        uf.union(i, j);
        const key = `${i}|${j}`;
        edgeScores.set(key, s);
      }
    }
  }

  // Group indices by component root
  const components = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = uf.find(i);
    if (!components.has(root)) {
      components.set(root, []);
    }
    components.get(root)!.push(i);
  }

  // Build MatchGroups with source-uniqueness enforcement.
  // A valid match group has at most one cluster per source.
  // If a connected component has duplicate sources, we split: keep the
  // best-connected cluster per source and eject the rest as singletons.
  const groups: MatchGroup[] = [];

  for (const indices of components.values()) {
    const componentClusters = indices.map((i) => clusters[i]);

    // Check for duplicate sources in this component
    const sourceMap = new Map<string, number[]>(); // source -> list of component-local indices
    for (let ci = 0; ci < componentClusters.length; ci++) {
      const src = componentClusters[ci].representative.source;
      if (!sourceMap.has(src)) sourceMap.set(src, []);
      sourceMap.get(src)!.push(ci);
    }

    const hasDuplicateSources = Array.from(sourceMap.values()).some(
      (arr) => arr.length > 1,
    );

    let finalClusters: DedupeCluster[];
    const ejected: DedupeCluster[] = [];

    if (hasDuplicateSources) {
      // For each source with duplicates, keep the one with the highest
      // total edge score to others in the component; eject the rest.
      const kept = new Set<number>();

      for (const [, localIndices] of sourceMap) {
        if (localIndices.length === 1) {
          kept.add(localIndices[0]);
        } else {
          // Score each candidate by sum of edge scores to other component members
          let bestIdx = localIndices[0];
          let bestTotal = -1;
          for (const ci of localIndices) {
            const globalI = indices[ci];
            let total = 0;
            for (let oi = 0; oi < indices.length; oi++) {
              if (oi === ci) continue;
              const globalJ = indices[oi];
              const a = Math.min(globalI, globalJ);
              const b = Math.max(globalI, globalJ);
              total += edgeScores.get(`${a}|${b}`) ?? 0;
            }
            if (total > bestTotal) {
              bestTotal = total;
              bestIdx = ci;
            }
          }
          kept.add(bestIdx);
          for (const ci of localIndices) {
            if (ci !== bestIdx) ejected.push(componentClusters[ci]);
          }
        }
      }

      finalClusters = Array.from(kept)
        .sort((a, b) => a - b)
        .map((ci) => componentClusters[ci]);
    } else {
      finalClusters = componentClusters;
    }

    // Build the main group from finalClusters
    groups.push(buildGroup(finalClusters, indices, edgeScores, clusters));

    // Ejected clusters become singleton LOW-confidence groups
    for (const ec of ejected) {
      groups.push(buildGroup([ec], [], new Map(), clusters));
    }
  }

  // Sort by score descending
  groups.sort((a, b) => b.score - a.score);

  return groups;
}

// ---------------------------------------------------------------------------
// Helper: build a MatchGroup from a set of clusters
// ---------------------------------------------------------------------------

function buildGroup(
  groupClusters: DedupeCluster[],
  originalIndices: number[],
  edgeScores: Map<string, number>,
  allClusters: DedupeCluster[],
): MatchGroup {
  // Find max edge score among members of this group
  let maxScore = 0;
  if (groupClusters.length > 1) {
    // Get global indices for each cluster in this group
    const globalIndices = groupClusters.map((gc) =>
      allClusters.indexOf(gc),
    );
    for (let ii = 0; ii < globalIndices.length; ii++) {
      for (let jj = ii + 1; jj < globalIndices.length; jj++) {
        const a = Math.min(globalIndices[ii], globalIndices[jj]);
        const b = Math.max(globalIndices[ii], globalIndices[jj]);
        const s = edgeScores.get(`${a}|${b}`) ?? 0;
        if (s > maxScore) maxScore = s;
      }
    }
  }

  // Confidence level
  let confidence: ConfidenceLevel;
  if (groupClusters.length === 1) {
    confidence = "LOW";
  } else if (maxScore >= 80) {
    confidence = "HIGH";
  } else if (maxScore >= 50) {
    confidence = "MEDIUM";
  } else {
    confidence = "LOW";
  }

  const rep = groupClusters[0].representative;

  const memberSources = groupClusters.flatMap((c) =>
    c.members.map((m) => ({
      source: m.source,
      externalId: m.externalId,
      rawName: m.rawName,
    }))
  );

  return {
    matchGroupKey: buildMatchGroupKey(groupClusters),
    confidence,
    score: maxScore,
    canonicalBrand: rep.rawBrand,
    canonicalModel: rep.rawModel,
    category: rep.category,
    memberClusters: groupClusters,
    memberSources,
  };
}
