// ---------------------------------------------------------------------------
// Project Pipeline Funnel — daily metrics snapshots
//
// Records the funnel's point-in-time backlog/milestone counts once per day so
// "what were these N days ago" is an exact lookup. The funnel page posts the
// counts it already computed (so snapshots match the UI by construction);
// idempotent per calendar day. Stored as a single JSON row in SystemConfig —
// low volume (one per day), no migration. Mirrors lib/pe-metrics-snapshots.ts.
// ---------------------------------------------------------------------------

import { prisma } from "@/lib/db";

const CONFIG_KEY = "funnel_metrics_snapshots";
const MAX_KEEP = 400; // ~13 months of daily snapshots

export interface FunnelMetricsSnapshot {
  date: string; // YYYY-MM-DD (UTC)
  /** Bucket/milestone key → count, e.g. { awaitingReadyToBuild: 33, ... }. */
  counts: Record<string, number>;
  recordedAt: string; // ISO timestamp of the write
}

export type FunnelMetricsInput = Omit<FunnelMetricsSnapshot, "recordedAt">;

export async function getFunnelSnapshots(): Promise<FunnelMetricsSnapshot[]> {
  if (!prisma) return [];
  const row = await prisma.systemConfig.findUnique({ where: { key: CONFIG_KEY } });
  if (!row?.value) return [];
  try {
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) ? (parsed as FunnelMetricsSnapshot[]) : [];
  } catch {
    return [];
  }
}

/**
 * Record today's snapshot. Idempotent per UTC day: the first write of the day
 * inserts; later writes the same day overwrite it (keeping the latest numbers).
 */
export async function recordFunnelSnapshot(input: FunnelMetricsInput): Promise<{ recorded: boolean }> {
  if (!prisma) return { recorded: false };
  const existing = await getFunnelSnapshots();
  const snapshot: FunnelMetricsSnapshot = { ...input, recordedAt: new Date().toISOString() };
  const others = existing.filter((s) => s.date !== input.date);
  const next = [...others, snapshot]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-MAX_KEEP);
  await prisma.systemConfig.upsert({
    where: { key: CONFIG_KEY },
    create: { key: CONFIG_KEY, value: JSON.stringify(next) },
    update: { value: JSON.stringify(next) },
  });
  return { recorded: true };
}
