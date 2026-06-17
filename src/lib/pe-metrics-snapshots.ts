// ---------------------------------------------------------------------------
// PE Document Tracker — daily metrics snapshots
//
// Records the Documents-tab card numbers once per day so "what were these N
// days ago" is an exact lookup. The Documents tab posts the numbers it already
// computed (so snapshots match the cards by construction); the record is
// idempotent per calendar day. Stored as a single JSON row in SystemConfig —
// low volume (one per day), no migration.
// ---------------------------------------------------------------------------

import { prisma } from "@/lib/db";

const CONFIG_KEY = "pe_metrics_snapshots";
const MAX_KEEP = 400; // ~13 months of daily snapshots

export interface PeMetricsSnapshot {
  date: string; // YYYY-MM-DD (UTC)
  peDeals: number; // PE Deals card
  actionable: number; // Actionable (deals needing PB action)
  inReview: number; // In Review docs (waiting on PE)
  allDocsApproved: number; // deals with all docs approved
  approvalRate: number | null; // % approved of decided docs
  approved: number; // approved docs
  notUploaded: number; // not-uploaded docs
  actionRequired: number; // action-required docs (incl. rejected)
  recordedAt: string; // ISO timestamp of the write
}

export type PeMetricsInput = Omit<PeMetricsSnapshot, "recordedAt">;

export async function getMetricsSnapshots(): Promise<PeMetricsSnapshot[]> {
  if (!prisma) return [];
  const row = await prisma.systemConfig.findUnique({ where: { key: CONFIG_KEY } });
  if (!row?.value) return [];
  try {
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) ? (parsed as PeMetricsSnapshot[]) : [];
  } catch {
    return [];
  }
}

/**
 * Record today's snapshot. Idempotent per UTC day: the first write of the day
 * inserts; later writes the same day overwrite it (keeping the latest numbers).
 */
export async function recordMetricsSnapshot(input: PeMetricsInput): Promise<{ recorded: boolean }> {
  if (!prisma) return { recorded: false };
  const existing = await getMetricsSnapshots();
  const snapshot: PeMetricsSnapshot = { ...input, recordedAt: new Date().toISOString() };
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
