/**
 * Bottleneck engine — age / volume / flow signals per pipeline stage.
 *
 * Reads the Prisma `Deal` mirror only (never the HubSpot API). Stage entry is
 * inferred from existing date-stamp columns; deals whose entry stamps are all
 * null land in an explicit "age unknown" bucket rather than being dropped.
 *
 * Spec: docs/superpowers/specs/2026-07-07-bottleneck-monitor-design.md
 */

import { prisma } from "@/lib/db";
import { isPermitActiveStatus, isICActiveStatus, isPTOPipelineStatus } from "@/lib/pi-statuses";
import { statusBucket } from "@/lib/pe-milestone-bucket";

// ── Row shape (fixture-friendly subset of the Prisma Deal model) ──

export interface BottleneckDealRow {
  hubspotDealId: string;
  dealName: string | null;
  projectNumber: string | null;
  pbLocation: string | null;
  dealOwnerName: string | null;
  hubspotOwnerId: string | null;
  stage: string | null;
  isParticipateEnergy: boolean;
  rawProperties: unknown;
  designStatus: string | null;
  permittingStatus: string | null;
  icStatus: string | null;
  installStatus: string | null;
  finalInspectionStatus: string | null;
  ptoStatus: string | null;
  siteSurveyCompletionDate: Date | null;
  designStartDate: Date | null;
  designCompletionDate: Date | null;
  permitSubmitDate: Date | null;
  permitIssueDate: Date | null;
  icSubmitDate: Date | null;
  icApprovalDate: Date | null;
  rtbDate: Date | null;
  installScheduleDate: Date | null;
  constructionCompleteDate: Date | null;
  inspectionPassDate: Date | null;
  ptoCompletionDate: Date | null;
  ptoStartDate: Date | null;
}

// ── Stage registry ──

export type BottleneckTeam = "design" | "pi" | "ops" | "precon";

export interface StageDefinition {
  key: string;
  label: string;
  team: BottleneckTeam;
  /** Is the deal currently sitting in this stage? */
  isInStage(d: BottleneckDealRow): boolean;
  /** When did it enter? First non-null wins; null → "age unknown". */
  entryDate(d: BottleneckDealRow): Date | null;
  /** When did it leave? (flow signal — null while still in stage) */
  exitDate(d: BottleneckDealRow): Date | null;
}

/**
 * Design / construction / inspection have no named active-status constant
 * (permitting/IC/PTO do — pi-statuses.ts). For them, "in stage" = status
 * present and not obviously terminal. Matches deals-pipeline.ts TERMINAL_KEYWORDS.
 */
const DONE_KEYWORDS = ["complete", "completed", "cancelled", "canceled", "not needed", "closed", "n/a"];
function isOpenStatus(status: string | null): boolean {
  if (!status || !status.trim()) return false;
  const s = status.toLowerCase();
  return !DONE_KEYWORDS.some((k) => s.includes(k));
}

function rawProp(d: BottleneckDealRow, key: string): string | null {
  const raw = d.rawProperties as Record<string, unknown> | null;
  const v = raw && typeof raw === "object" ? raw[key] : null;
  return typeof v === "string" && v.trim() ? v : null;
}

/** HubSpot dates in rawProperties are epoch-ms strings or ISO strings. */
function rawDate(d: BottleneckDealRow, key: string): Date | null {
  const v = rawProp(d, key);
  if (!v) return null;
  const t = /^\d+$/.test(v) ? Number(v) : Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t);
}

const first = (...dates: Array<Date | null>) => dates.find((x) => x != null) ?? null;
const PE_DONE = new Set(["approved", "paid"]);
const peActive = (status: string | null) => status != null && !PE_DONE.has(statusBucket(status));

export const STAGES: StageDefinition[] = [
  {
    key: "design", label: "Design", team: "design",
    isInStage: (d) => isOpenStatus(d.designStatus),
    entryDate: (d) => first(d.designStartDate, d.siteSurveyCompletionDate),
    exitDate: (d) => d.designCompletionDate,
  },
  {
    key: "permitting", label: "Permitting", team: "pi",
    isInStage: (d) => isPermitActiveStatus(d.permittingStatus ?? ""),
    entryDate: (d) => first(d.permitSubmitDate, d.designCompletionDate),
    exitDate: (d) => d.permitIssueDate,
  },
  {
    key: "interconnection", label: "Interconnection", team: "pi",
    isInStage: (d) => isICActiveStatus(d.icStatus ?? ""),
    entryDate: (d) => first(d.icSubmitDate, d.designCompletionDate),
    exitDate: (d) => d.icApprovalDate,
  },
  {
    key: "construction", label: "Construction", team: "ops",
    isInStage: (d) => isOpenStatus(d.installStatus),
    entryDate: (d) => first(d.installScheduleDate, d.rtbDate, d.permitIssueDate),
    exitDate: (d) => d.constructionCompleteDate,
  },
  {
    key: "inspection", label: "Inspection", team: "ops",
    isInStage: (d) => isOpenStatus(d.finalInspectionStatus),
    entryDate: (d) => d.constructionCompleteDate,
    exitDate: (d) => d.inspectionPassDate,
  },
  {
    key: "pto", label: "PTO", team: "ops",
    isInStage: (d) => isPTOPipelineStatus(d.ptoStatus ?? ""),
    entryDate: (d) => first(d.ptoStartDate, d.inspectionPassDate),
    exitDate: (d) => d.ptoCompletionDate,
  },
  {
    key: "pe_m1", label: "PE M1", team: "precon",
    isInStage: (d) => d.isParticipateEnergy && peActive(rawProp(d, "pe_m1_status")),
    entryDate: (d) => d.inspectionPassDate,
    exitDate: (d) => rawDate(d, "pe_m1_remittance_date"),
  },
  {
    key: "pe_m2", label: "PE M2", team: "precon",
    isInStage: (d) => d.isParticipateEnergy && peActive(rawProp(d, "pe_m2_status")),
    entryDate: (d) => d.ptoCompletionDate,
    exitDate: (d) => rawDate(d, "pe_m2_remittance_date"),
  },
];

// ── Thresholds ──

export interface StageThreshold {
  medianDays: number | null;
  p90Days: number | null;
  thresholdDays: number | null; // null → stage never flags (insufficient history)
  source: "derived" | "manual";
}
export type ThresholdConfig = Record<string, StageThreshold>;

// ── Snapshot computation ──

export interface FlaggedDeal {
  hubspotDealId: string;
  dealName: string;
  projectNumber: string | null;
  pbLocation: string | null;
  dealOwnerName: string | null;
  hubspotOwnerId: string | null;
  dwellDays: number;
  thresholdDays: number;
}

export interface StageSnapshot {
  key: string;
  label: string;
  team: BottleneckTeam;
  totalInStage: number;
  unknownAgeCount: number;
  medianDwellDays: number | null; // median of current in-stage dwell
  /** Median daily in-stage count over the trailing 90 days, reconstructed from
   *  stamps (in-stage on day D iff entry ≤ D < exit; null exit = still in).
   *  Unknown-entry deals are excluded, so this can undercount. */
  volumeNorm90d: number | null;
  threshold: StageThreshold;
  flagged: FlaggedDeal[];
  flow: Array<{ weekStart: string; entered: number; exited: number }>;
}

export interface BottleneckSnapshot {
  computedAt: string;
  stages: StageSnapshot[];
}

const DAY_MS = 86_400_000;
const dwellDays = (entry: Date, now: number) => Math.floor((now - entry.getTime()) / DAY_MS);

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

/** ISO-week Monday (UTC) for flow bucketing. */
function weekStartOf(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

const FLOW_WEEKS = 8;

/**
 * Terminal deal stages (mirrors deals-pipeline.ts TERMINAL_KEYWORDS, which is
 * module-private). Deals in these stages are done — their per-stage status
 * columns often still read "open" (e.g. an old deal whose inspection status
 * was never flipped), so without this gate historical deals count as in-stage.
 * "Close Out" deliberately does NOT match (post-PTO work, incl. PE M2, is live).
 */
const TERMINAL_STAGE_KEYWORDS = ["complete", "cancelled", "canceled", "closed won", "closed lost", "rejected"];
function isActiveDealStage(stage: string | null): boolean {
  if (!stage) return false;
  const s = stage.toLowerCase();
  if (s === "deleted" || s === "merged") return false;
  return !TERMINAL_STAGE_KEYWORDS.some((k) => s.includes(k));
}

export function computeStageSnapshots(
  rows: BottleneckDealRow[],
  thresholds: ThresholdConfig,
  nowMs: number
): BottleneckSnapshot {
  const flowCutoff = nowMs - FLOW_WEEKS * 7 * DAY_MS;

  const stages = STAGES.map((stage) => {
    const threshold: StageThreshold =
      thresholds[stage.key] ?? { medianDays: null, p90Days: null, thresholdDays: null, source: "derived" };

    // In-stage = deal is on an active pipeline stage, the stage's status
    // predicate says in-progress, AND it has no exit stamp yet. The exit-stamp
    // check catches statuses the keyword lists miss (e.g. inspection "Passed"
    // with inspectionPassDate set has left the stage regardless of status text).
    const inStage = rows.filter(
      (d) => isActiveDealStage(d.stage) && stage.isInStage(d) && stage.exitDate(d) == null
    );
    const dwells: number[] = [];
    let unknownAgeCount = 0;
    const flagged: FlaggedDeal[] = [];

    for (const d of inStage) {
      const entry = stage.entryDate(d);
      if (!entry) { unknownAgeCount++; continue; }
      const dwell = dwellDays(entry, nowMs);
      dwells.push(dwell);
      if (threshold.thresholdDays != null && dwell > threshold.thresholdDays) {
        flagged.push({
          hubspotDealId: d.hubspotDealId,
          dealName: d.dealName ?? "(unnamed)",
          projectNumber: d.projectNumber,
          pbLocation: d.pbLocation,
          dealOwnerName: d.dealOwnerName,
          hubspotOwnerId: d.hubspotOwnerId,
          dwellDays: dwell,
          thresholdDays: threshold.thresholdDays,
        });
      }
    }
    flagged.sort((a, b) => b.dwellDays - a.dwellDays);

    // Flow: entry/exit stamps over the trailing weeks — computed over ALL rows,
    // not just current in-stage deals (a deal that exited is no longer in stage).
    const flowMap = new Map<string, { entered: number; exited: number }>();
    for (const d of rows) {
      const entry = stage.entryDate(d);
      if (entry && entry.getTime() >= flowCutoff && entry.getTime() <= nowMs) {
        const wk = weekStartOf(entry);
        const b = flowMap.get(wk) ?? { entered: 0, exited: 0 };
        b.entered++; flowMap.set(wk, b);
      }
      const exit = stage.exitDate(d);
      if (exit && exit.getTime() >= flowCutoff && exit.getTime() <= nowMs) {
        const wk = weekStartOf(exit);
        const b = flowMap.get(wk) ?? { entered: 0, exited: 0 };
        b.exited++; flowMap.set(wk, b);
      }
    }
    const flow = [...flowMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekStart, v]) => ({ weekStart, ...v }));

    // Volume norm: median daily in-stage count over the trailing 90 days,
    // reconstructed from stamps. Unknown-entry deals can't participate. Deals
    // with no exit stamp only count if they're in-stage NOW — otherwise a
    // cancelled deal that never got an exit stamp inflates every day forever.
    const inStageIds = new Set(inStage.map((d) => d.hubspotDealId));
    const dailyCounts: number[] = [];
    for (let i = 1; i <= 90; i++) {
      const dayMs = nowMs - i * DAY_MS;
      let count = 0;
      for (const d of rows) {
        const entry = stage.entryDate(d);
        if (!entry || entry.getTime() > dayMs) continue;
        const exit = stage.exitDate(d);
        if (exit == null && !inStageIds.has(d.hubspotDealId)) continue;
        if (exit == null || exit.getTime() > dayMs) count++;
      }
      dailyCounts.push(count);
    }
    dailyCounts.sort((a, b) => a - b);

    dwells.sort((a, b) => a - b);
    return {
      key: stage.key,
      label: stage.label,
      team: stage.team,
      totalInStage: inStage.length,
      unknownAgeCount,
      medianDwellDays: median(dwells),
      volumeNorm90d: median(dailyCounts),
      threshold,
      flagged,
      flow,
    };
  });

  return { computedAt: new Date(nowMs).toISOString(), stages };
}

// ── Threshold derivation ──

const DERIVE_WINDOW_DAYS = 365;

/**
 * Derive median/p90 from completed transitions (both entry and exit stamps,
 * exit within the trailing 12 months). thresholdDays defaults to p90; a
 * "manual" source in `existing` keeps its thresholdDays but refreshes stats.
 * Stages with <10 completed transitions get thresholdDays null (never flag).
 */
export function deriveThresholds(
  rows: BottleneckDealRow[],
  nowMs: number,
  existing?: ThresholdConfig
): ThresholdConfig {
  const cutoff = nowMs - DERIVE_WINDOW_DAYS * DAY_MS;
  const out: ThresholdConfig = {};
  for (const stage of STAGES) {
    const durations: number[] = [];
    for (const d of rows) {
      const entry = stage.entryDate(d);
      const exit = stage.exitDate(d);
      if (!entry || !exit) continue;
      if (exit.getTime() < cutoff || exit.getTime() > nowMs) continue;
      const days = Math.floor((exit.getTime() - entry.getTime()) / DAY_MS);
      if (days >= 0) durations.push(days);
    }
    durations.sort((a, b) => a - b);
    const med = median(durations);
    const p90 = percentile(durations, 90);
    const prev = existing?.[stage.key];
    out[stage.key] = {
      medianDays: med,
      p90Days: p90,
      thresholdDays:
        prev?.source === "manual" ? prev.thresholdDays : durations.length >= 10 ? p90 : null,
      source: prev?.source === "manual" ? "manual" : "derived",
    };
  }
  return out;
}

// ── Persistence (SystemConfig) ──

const THRESHOLDS_KEY = "bottleneck_thresholds";

export async function getThresholdConfig(): Promise<ThresholdConfig | null> {
  if (!prisma) return null;
  const row = await prisma.systemConfig.findUnique({ where: { key: THRESHOLDS_KEY } });
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value) as ThresholdConfig;
  } catch {
    return null;
  }
}

export async function saveThresholdConfig(config: ThresholdConfig): Promise<void> {
  if (!prisma) return;
  await prisma.systemConfig.upsert({
    where: { key: THRESHOLDS_KEY },
    create: { key: THRESHOLDS_KEY, value: JSON.stringify(config) },
    update: { value: JSON.stringify(config) },
  });
}

// ── Prisma reader ──

/**
 * All PROJECT-pipeline deals (including completed — needed for threshold
 * derivation and flow), excluding hard-deletes. Stage membership itself is
 * decided by the per-stage status predicates, not the deal stage.
 */
export async function loadBottleneckDeals(): Promise<BottleneckDealRow[]> {
  if (!prisma) return [];
  return prisma.deal.findMany({
    where: { pipeline: "PROJECT", stage: { notIn: ["DELETED", "MERGED"] } },
    select: {
      hubspotDealId: true, dealName: true, projectNumber: true, pbLocation: true,
      dealOwnerName: true, hubspotOwnerId: true, stage: true,
      isParticipateEnergy: true, rawProperties: true,
      designStatus: true, permittingStatus: true, icStatus: true,
      installStatus: true, finalInspectionStatus: true, ptoStatus: true,
      siteSurveyCompletionDate: true, designStartDate: true, designCompletionDate: true,
      permitSubmitDate: true, permitIssueDate: true, icSubmitDate: true, icApprovalDate: true,
      rtbDate: true, installScheduleDate: true, constructionCompleteDate: true,
      inspectionPassDate: true, ptoStartDate: true, ptoCompletionDate: true,
    },
  }) as Promise<BottleneckDealRow[]>;
}

/** Snapshot with thresholds: reads config, derives+persists on first run. */
export async function computeBottleneckSnapshot(nowMs = Date.now()): Promise<BottleneckSnapshot> {
  const rows = await loadBottleneckDeals();
  let thresholds = await getThresholdConfig();
  if (!thresholds) {
    thresholds = deriveThresholds(rows, nowMs);
    await saveThresholdConfig(thresholds);
  }
  return computeStageSnapshots(rows, thresholds, nowMs);
}

/** Weekly recompute (Monday cron): refresh derived stats, keep manual overrides. */
export async function refreshThresholds(nowMs = Date.now()): Promise<ThresholdConfig> {
  const rows = await loadBottleneckDeals();
  const existing = (await getThresholdConfig()) ?? undefined;
  const next = deriveThresholds(rows, nowMs, existing);
  await saveThresholdConfig(next);
  return next;
}
