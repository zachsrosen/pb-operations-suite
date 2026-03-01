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
    const val = payload[field];
    if (val && typeof val === "string" && val.trim()) {
      return val.trim();
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

  // Build MatchGroups
  const groups: MatchGroup[] = [];

  for (const indices of components.values()) {
    const componentClusters = indices.map((i) => clusters[i]);

    // Find max edge score in this component
    let maxScore = 0;
    for (let ii = 0; ii < indices.length; ii++) {
      for (let jj = ii + 1; jj < indices.length; jj++) {
        const a = indices[ii];
        const b = indices[jj];
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        const s = edgeScores.get(key) ?? 0;
        if (s > maxScore) maxScore = s;
      }
    }

    // Confidence level
    let confidence: ConfidenceLevel;
    if (indices.length === 1) {
      confidence = "LOW";
    } else if (maxScore >= 80) {
      confidence = "HIGH";
    } else if (maxScore >= 50) {
      confidence = "MEDIUM";
    } else {
      confidence = "LOW";
    }

    // Canonical fields from first cluster's representative
    const rep = componentClusters[0].representative;

    const memberSources = componentClusters.flatMap((c) =>
      c.members.map((m) => ({
        source: m.source,
        externalId: m.externalId,
        rawName: m.rawName,
      }))
    );

    groups.push({
      matchGroupKey: buildMatchGroupKey(componentClusters),
      confidence,
      score: maxScore,
      canonicalBrand: rep.rawBrand,
      canonicalModel: rep.rawModel,
      category: rep.category,
      memberClusters: componentClusters,
      memberSources,
    });
  }

  // Sort by score descending
  groups.sort((a, b) => b.score - a.score);

  return groups;
}
