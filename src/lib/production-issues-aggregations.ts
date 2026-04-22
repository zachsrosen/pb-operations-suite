/**
 * Pure aggregation helpers for the Production Issues dashboard.
 * Standalone of forecast-ghosts.ts:mapStage because that helper does not
 * recognize PTO or service-pipeline stage names (spec decision).
 */

export type StageBucket = "pto" | "service" | "active" | "other";

// First-match-wins. Order matters — keep most-specific buckets first.
const BUCKET_RULES: Array<{ bucket: StageBucket; needles: string[] }> = [
  { bucket: "pto", needles: ["pto", "permission to operate", "operating", "complete"] },
  { bucket: "service", needles: ["service", "ticket", "in progress", "open"] },
  {
    bucket: "active",
    needles: [
      "survey", "rtb", "ready to build", "design", "permit", "interconnect",
      "construction", "inspection", "install", "blocked",
    ],
  },
];

export function bucketStage(stageRaw: string | null | undefined): StageBucket {
  const stage = (stageRaw || "").trim().toLowerCase();
  if (!stage) return "other";
  for (const rule of BUCKET_RULES) {
    if (rule.needles.some((n) => stage.includes(n))) return rule.bucket;
  }
  return "other";
}

export interface TopEntry {
  key: string;
  count: number;
}

/**
 * Count by key function and return the top-N entries sorted by count desc,
 * ties broken by natural key order. Missing/empty keys collapse into "Unassigned".
 */
export function topByKey<T>(
  rows: T[],
  keyFn: (row: T) => string | null | undefined,
  limit: number
): TopEntry[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const raw = keyFn(row);
    const key = raw && raw.trim() ? raw.trim() : "Unassigned";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => (b.count - a.count) || a.key.localeCompare(b.key))
    .slice(0, limit);
}
