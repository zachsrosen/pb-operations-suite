/**
 * Intra-Source Deduplication Engine
 *
 * Groups harvested products using a key chain + union-find clustering.
 * Products matching on ANY key in the chain are transitively clustered.
 */

import { canonicalToken, buildCanonicalKey } from "@/lib/canonical";
import type { HarvestedProduct, HarvestSource } from "@/lib/catalog-harvest";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DedupeCluster {
  canonicalKey: string;
  representative: HarvestedProduct;
  members: HarvestedProduct[];
  dedupeReason: string; // "canonical_key_match" | "singleton"
  sourceIds: string[]; // all externalIds in cluster
  ambiguityCount: number; // how many members matched only on fallback keys
}

// ---------------------------------------------------------------------------
// Union-Find (disjoint-set) data structure
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
      this.parent[x] = this.find(this.parent[x]); // path compression
    }
    return this.parent[x];
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;

    // union by rank
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
// Source quality ranking (lower = better)
// ---------------------------------------------------------------------------

const SOURCE_QUALITY: Record<HarvestSource, number> = {
  zoho: 0,
  internal: 1,
  hubspot: 2,
  quickbooks: 3,
  zuper: 4,
};

// ---------------------------------------------------------------------------
// Key extraction helpers
// ---------------------------------------------------------------------------

const VPN_FIELDS = [
  "vendorPartNumber",
  "vendor_part_number",
  "part_number",
  "hs_sku",
  "product_code",
];

function extractVpn(rawPayload: Record<string, unknown>): string | null {
  for (const field of VPN_FIELDS) {
    const val = rawPayload[field];
    if (val != null && String(val).trim().length > 0) {
      return String(val).trim();
    }
    // Also check nested properties (e.g. HubSpot rawPayload.properties.hs_sku)
    const props = rawPayload["properties"];
    if (props && typeof props === "object" && !Array.isArray(props)) {
      const nested = (props as Record<string, unknown>)[field];
      if (nested != null && String(nested).trim().length > 0) {
        return String(nested).trim();
      }
    }
  }
  return null;
}

/**
 * Extract deduplication keys for a product (key chain, priority order).
 *
 * Only STRONG keys participate in automatic union-find merging:
 * 1. canonical key: category|brand|model (via buildCanonicalKey)
 * 2. cross-category fallback: brand|model (both non-empty)
 * 3. vendor part number exact match (prefixed with "vpn:")
 *
 * Name-only matching is intentionally excluded from merge keys because
 * generic names (e.g. "Conduit Box") cause unrelated products to collapse
 * via transitive union. Name similarity is used as a scoring signal in the
 * cross-source matcher instead.
 *
 * Returns [key, level] pairs where level indicates which tier matched.
 */
function extractKeys(
  p: HarvestedProduct,
): Array<{ key: string; level: number }> {
  const keys: Array<{ key: string; level: number }> = [];

  // Level 0: full canonical key (category + brand + model)
  if (p.category && p.rawBrand && p.rawModel) {
    const ck = buildCanonicalKey(p.category, p.rawBrand, p.rawModel);
    if (ck) keys.push({ key: ck, level: 0 });
  }

  // Level 1: cross-category fallback (brand + model only)
  const cb = canonicalToken(p.rawBrand);
  const cm = canonicalToken(p.rawModel);
  if (cb && cm) {
    keys.push({ key: `${cb}|${cm}`, level: 1 });
  }

  // Level 2: vendor part number
  const vpn = extractVpn(p.rawPayload);
  if (vpn) {
    keys.push({ key: `vpn:${vpn}`, level: 2 });
  }

  // NOTE: Name-only key (`name:canonicalToken(rawName)`) was intentionally
  // removed to prevent over-merge. Generic product names cause transitive
  // clustering of unrelated items.

  return keys;
}

// ---------------------------------------------------------------------------
// Representative selection
// ---------------------------------------------------------------------------

function countPopulatedFields(p: HarvestedProduct): number {
  let count = 0;
  if (p.rawName) count++;
  if (p.rawBrand) count++;
  if (p.rawModel) count++;
  if (p.category) count++;
  if (p.price != null) count++;
  if (p.description) count++;
  return count;
}

function selectRepresentative(members: HarvestedProduct[]): HarvestedProduct {
  return members.slice().sort((a, b) => {
    // 1. Most fields populated (descending)
    const fieldDiff = countPopulatedFields(b) - countPopulatedFields(a);
    if (fieldDiff !== 0) return fieldDiff;

    // 2. Source quality (ascending — lower is better)
    const qualityDiff = SOURCE_QUALITY[a.source] - SOURCE_QUALITY[b.source];
    if (qualityDiff !== 0) return qualityDiff;

    // 3. Smallest externalId (lexicographic ascending)
    return a.externalId.localeCompare(b.externalId);
  })[0];
}

// ---------------------------------------------------------------------------
// Main deduplication function
// ---------------------------------------------------------------------------

export function dedupeProducts(products: HarvestedProduct[]): DedupeCluster[] {
  if (products.length === 0) return [];

  const n = products.length;
  const uf = new UnionFind(n);

  // Map: key -> list of product indices
  const keyToIndices = new Map<string, number[]>();

  // Track best (lowest) key level per product index for ambiguity counting
  const productKeyLevels: Map<number, number> = new Map();

  // Step 1: extract keys and build keyToIndices map
  for (let i = 0; i < n; i++) {
    const keys = extractKeys(products[i]);
    for (const { key, level } of keys) {
      let indices = keyToIndices.get(key);
      if (!indices) {
        indices = [];
        keyToIndices.set(key, indices);
      }
      indices.push(i);

      const current = productKeyLevels.get(i);
      if (current === undefined || level < current) {
        productKeyLevels.set(i, level);
      }
    }
  }

  // Step 2: union all indices sharing a key
  for (const indices of keyToIndices.values()) {
    for (let j = 1; j < indices.length; j++) {
      uf.union(indices[0], indices[j]);
    }
  }

  // Step 3: group by union-find root
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = uf.find(i);
    let group = groups.get(root);
    if (!group) {
      group = [];
      groups.set(root, group);
    }
    group.push(i);
  }

  // Step 4: determine which key level actually linked each product into its cluster
  // For each cluster, find the "best" (lowest level) key that any two members share
  function getClusterMatchLevel(memberIndices: number[]): number {
    if (memberIndices.length <= 1) return -1;
    let bestLevel = Infinity;
    for (const [key, indices] of keyToIndices.entries()) {
      if (indices.length < 2) continue;
      // Check if at least 2 indices from this cluster share this key
      const inCluster = indices.filter((i) =>
        memberIndices.includes(i),
      );
      if (inCluster.length >= 2) {
        // Determine level from key format
        let level: number;
        if (key.startsWith("vpn:")) level = 2;
        else if (key.includes("|") && key.split("|").length === 3) level = 0;
        else level = 1;
        if (level < bestLevel) bestLevel = level;
      }
    }
    return bestLevel === Infinity ? -1 : bestLevel;
  }

  // Step 5: build clusters
  const clusters: DedupeCluster[] = [];
  for (const memberIndices of groups.values()) {
    const members = memberIndices.map((i) => products[i]);
    const representative = selectRepresentative(members);

    const isSingleton = members.length === 1;
    const clusterMatchLevel = getClusterMatchLevel(memberIndices);

    // ambiguityCount: members whose best matching key in the cluster is a fallback (level > 0)
    let ambiguityCount = 0;
    if (!isSingleton) {
      for (const idx of memberIndices) {
        const bestLevel = productKeyLevels.get(idx) ?? 2;
        if (bestLevel > 0 && clusterMatchLevel > 0) {
          ambiguityCount++;
        }
      }
    }

    // canonicalKey: use the representative's canonical key if available, else fallback
    const ck =
      buildCanonicalKey(
        representative.category ?? "",
        representative.rawBrand,
        representative.rawModel,
      ) ?? canonicalToken(representative.rawName);

    clusters.push({
      canonicalKey: ck,
      representative,
      members,
      dedupeReason: isSingleton ? "singleton" : "canonical_key_match",
      sourceIds: members.map((m) => m.externalId),
      ambiguityCount,
    });
  }

  return clusters;
}
