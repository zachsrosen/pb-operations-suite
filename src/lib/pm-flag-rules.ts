/**
 * PM Flag Rules — daily evaluation of the catalog.
 *
 * Each rule is a pure async function that queries the Deal mirror (+ its
 * snapshot tables) and returns a list of `RuleMatch` specs. The runner
 * (`runAllRules`) calls `createFlag` for each match — idempotent on
 * `(source=ADMIN_WORKFLOW, externalRef)`, so re-runs in the same week
 * don't duplicate.
 *
 * No HubSpot workflows in the loop. All data is local (Deal mirror,
 * DealStatusSnapshot). The cron at /api/cron/pm-flag-rules invokes this
 * once per day.
 */

import { prisma } from "@/lib/db";
import { createFlag } from "@/lib/pm-flags";
import {
  DealPipeline,
  PmFlagSeverity,
  PmFlagSource,
  PmFlagType,
} from "@/generated/prisma/enums";
import type { Deal } from "@/generated/prisma/client";

/**
 * Scope: PM flag rules only apply to **active PROJECT pipeline deals**.
 *
 * - `pipeline = PROJECT` excludes Sales, D&R, Service, Roofing — those have
 *   their own ops teams and surfaces. PMs don't own those.
 * - Terminal stages (closed/cancelled/on-hold/complete) excluded at the
 *   query level so we don't fetch them in the first place.
 *
 * Every rule query MUST spread this filter.
 */
const TERMINAL_STAGE_LIST = [
  "Closed Won",
  "Closed Lost",
  "Cancelled",
  "Cancelled Project",
  "On Hold",
  "PTO Complete",
  "Project Complete",
] as const;

const ACTIVE_PROJECT_FILTER = {
  pipeline: DealPipeline.PROJECT,
  stage: { notIn: TERMINAL_STAGE_LIST as unknown as string[] },
} as const;

// =============================================================================
// Types
// =============================================================================

export interface RuleMatch {
  hubspotDealId: string;
  dealName: string | null;
  type: PmFlagType;
  severity: PmFlagSeverity;
  reason: string;
  externalRef: string;
  metadata?: Record<string, unknown>;
  /**
   * Resolved PM user id (from Deal.projectManager → User.name match).
   * Null = couldn't resolve; createFlag falls back to round-robin.
   */
  assignedToUserId: string | null;
}

export interface RuleResult {
  rule: string;
  matches: RuleMatch[];
  durationMs: number;
}

export interface RunSummary {
  totalMatches: number;
  totalCreated: number;
  totalAlreadyExisted: number;
  totalErrors: number;
  byRule: Array<{ rule: string; matches: number; durationMs: number }>;
  errors: Array<{ rule: string; dealId?: string; error: string }>;
}

// =============================================================================
// Helpers
// =============================================================================

const STAGE_NORMALIZE: Record<string, string> = {
  "site survey": "Survey",
  "survey": "Survey",
  "design": "Design",
  "design approval": "Design",
  "permitting": "Permit",
  "permit": "Permit",
  "interconnection": "Permit", // Treated alongside Permit for stuck-stage purposes
  "ready to build": "RTB",
  "rtb": "RTB",
  "construction": "Install",
  "install": "Install",
  "installation": "Install",
  "inspection": "Inspect",
  "pto": "PTO",
};

function normalizeStage(raw: string): string {
  return STAGE_NORMALIZE[raw.toLowerCase().trim()] || raw;
}

const PRE_CONSTRUCTION_STAGES = new Set(["Design", "Permit"]);
const CONSTRUCTION_STAGES = new Set(["RTB", "Install", "Inspect"]);

const TERMINAL_STAGES = new Set<string>(TERMINAL_STAGE_LIST);

function isTerminal(stage: string): boolean {
  return TERMINAL_STAGES.has(stage);
}

/**
 * Cache of normalized PM-name → User.id mapping, built once per cron run.
 * Names compared case-insensitively after collapsing whitespace.
 */
let _pmCache: Map<string, string> | null = null;
async function getPmUserCache(): Promise<Map<string, string>> {
  if (_pmCache) return _pmCache;
  if (!prisma) return new Map();
  const users = await prisma.user.findMany({
    where: { name: { not: null } },
    select: { id: true, name: true },
  });
  const m = new Map<string, string>();
  for (const u of users) {
    if (u.name) m.set(normalizePmName(u.name), u.id);
  }
  _pmCache = m;
  return m;
}

function normalizePmName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Map a deal's PM (free-text from HubSpot) to a User.id.
 *
 * Returns null if no match — caller's createFlag will fall back to
 * round-robin (or leave unassigned if nobody has the PROJECT_MANAGER role).
 */
async function resolvePmUserId(projectManager: string | null | undefined): Promise<string | null> {
  if (!projectManager) return null;
  const cache = await getPmUserCache();
  return cache.get(normalizePmName(projectManager)) ?? null;
}

/** Reset PM cache between runs (test-only). */
export function _resetPmCache() { _pmCache = null; }

function isoWeekKey(d: Date = new Date()): string {
  // YYYY-Wxx — re-fires once per ISO week, surfacing flags that PMs ignored.
  const year = d.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  const days = Math.floor((d.getTime() - start) / 86_400_000);
  const week = Math.ceil((days + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function daysBetween(from: Date | null | undefined, to: Date = new Date()): number | null {
  if (!from) return null;
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

/**
 * Resolve "days in current stage" from DealStatusSnapshot.
 *
 * Returns the number of days since the deal first appeared in its current
 * stage in the snapshot timeline. If the deal has only been in the current
 * stage for the snapshot history, falls back to days since the earliest
 * snapshot. Returns null if no snapshots exist for the deal.
 */
export async function daysInCurrentStage(
  dealId: string,
  currentStage: string
): Promise<number | null> {
  if (!prisma) return null;
  // Most recent snapshot where stage was different from current.
  const lastDifferent = await prisma.dealStatusSnapshot.findFirst({
    where: { dealId, dealStage: { not: currentStage } },
    orderBy: { snapshotDate: "desc" },
    select: { snapshotDate: true },
  });
  if (lastDifferent) {
    return daysBetween(lastDifferent.snapshotDate);
  }
  // No transition recorded — fall back to oldest snapshot of any stage.
  const earliest = await prisma.dealStatusSnapshot.findFirst({
    where: { dealId },
    orderBy: { snapshotDate: "asc" },
    select: { snapshotDate: true },
  });
  return earliest ? daysBetween(earliest.snapshotDate) : null;
}

// =============================================================================
// V1 Rules
// =============================================================================

/** R1: STAGE_STUCK / HIGH — construction-phase stage > 14 days. */
export async function ruleConstructionStageStuck(): Promise<RuleResult> {
  const start = Date.now();
  if (!prisma) return { rule: "construction-stage-stuck", matches: [], durationMs: 0 };

  const deals = await prisma.deal.findMany({
    where: {
      ...ACTIVE_PROJECT_FILTER, stage: { not: "" } },
    select: { hubspotDealId: true, dealName: true, projectManager: true, stage: true },
  });

  const matches: RuleMatch[] = [];
  for (const d of deals) {
    if (!CONSTRUCTION_STAGES.has(normalizeStage(d.stage))) continue;
    if (isTerminal(d.stage)) continue;
    const days = await daysInCurrentStage(d.hubspotDealId, d.stage);
    if (days != null && days > 14) {
      matches.push({
        hubspotDealId: d.hubspotDealId,
        dealName: d.dealName,
        type: PmFlagType.STAGE_STUCK,
        severity: PmFlagSeverity.HIGH,
        reason: `Stuck in "${d.stage}" for ${days} days`,
        externalRef: `stage-stuck:${d.hubspotDealId}:${d.stage}:${isoWeekKey()}`,
        assignedToUserId: await resolvePmUserId(d.projectManager),
        metadata: { rule: "construction-stage-stuck", stage: d.stage, daysInStage: days },
      });
    }
  }
  return { rule: "construction-stage-stuck", matches, durationMs: Date.now() - start };
}

/** R2: STAGE_STUCK / MEDIUM — pre-construction stage > 21 days. */
export async function rulePreConstructionStageStuck(): Promise<RuleResult> {
  const start = Date.now();
  if (!prisma) return { rule: "pre-construction-stage-stuck", matches: [], durationMs: 0 };

  const deals = await prisma.deal.findMany({
    where: {
      ...ACTIVE_PROJECT_FILTER, stage: { not: "" } },
    select: { hubspotDealId: true, dealName: true, projectManager: true, stage: true },
  });

  const matches: RuleMatch[] = [];
  for (const d of deals) {
    if (!PRE_CONSTRUCTION_STAGES.has(normalizeStage(d.stage))) continue;
    if (isTerminal(d.stage)) continue;
    const days = await daysInCurrentStage(d.hubspotDealId, d.stage);
    if (days != null && days > 21) {
      matches.push({
        hubspotDealId: d.hubspotDealId,
        dealName: d.dealName,
        type: PmFlagType.STAGE_STUCK,
        severity: PmFlagSeverity.MEDIUM,
        reason: `Pre-construction stuck in "${d.stage}" for ${days} days`,
        externalRef: `stage-stuck-pc:${d.hubspotDealId}:${d.stage}:${isoWeekKey()}`,
        assignedToUserId: await resolvePmUserId(d.projectManager),
        metadata: { rule: "pre-construction-stage-stuck", stage: d.stage, daysInStage: days },
      });
    }
  }
  return { rule: "pre-construction-stage-stuck", matches, durationMs: Date.now() - start };
}

/** R3: PERMIT_ISSUE / HIGH — `permittingStatus` indicates rejection AND deal hasn't moved in 5 days. */
export async function rulePermitRejection(): Promise<RuleResult> {
  const start = Date.now();
  if (!prisma) return { rule: "permit-rejection", matches: [], durationMs: 0 };

  const deals = await prisma.deal.findMany({
    where: {
      ...ACTIVE_PROJECT_FILTER,
      permittingStatus: { contains: "reject", mode: "insensitive" },
    },
    select: { hubspotDealId: true, dealName: true, projectManager: true, stage: true, permittingStatus: true, updatedAt: true },
  });

  const matches: RuleMatch[] = [];
  for (const d of deals) {
    if (isTerminal(d.stage)) continue;
    const daysSinceUpdate = daysBetween(d.updatedAt);
    if (daysSinceUpdate != null && daysSinceUpdate >= 5) {
      matches.push({
        hubspotDealId: d.hubspotDealId,
        dealName: d.dealName,
        type: PmFlagType.PERMIT_ISSUE,
        severity: PmFlagSeverity.HIGH,
        reason: `Permit status "${d.permittingStatus}"; ${daysSinceUpdate} days without resolution`,
        externalRef: `permit-reject:${d.hubspotDealId}:${isoWeekKey()}`,
        assignedToUserId: await resolvePmUserId(d.projectManager),
        metadata: { rule: "permit-rejection", permittingStatus: d.permittingStatus, daysSinceUpdate },
      });
    }
  }
  return { rule: "permit-rejection", matches, durationMs: Date.now() - start };
}

/** R4: INTERCONNECT_ISSUE / HIGH — `icStatus` indicates rejection AND deal hasn't moved in 5 days. */
export async function ruleIcRejection(): Promise<RuleResult> {
  const start = Date.now();
  if (!prisma) return { rule: "ic-rejection", matches: [], durationMs: 0 };

  const deals = await prisma.deal.findMany({
    where: {
      ...ACTIVE_PROJECT_FILTER,
      icStatus: { contains: "reject", mode: "insensitive" },
    },
    select: { hubspotDealId: true, dealName: true, projectManager: true, stage: true, icStatus: true, updatedAt: true },
  });

  const matches: RuleMatch[] = [];
  for (const d of deals) {
    if (isTerminal(d.stage)) continue;
    const daysSinceUpdate = daysBetween(d.updatedAt);
    if (daysSinceUpdate != null && daysSinceUpdate >= 5) {
      matches.push({
        hubspotDealId: d.hubspotDealId,
        dealName: d.dealName,
        type: PmFlagType.INTERCONNECT_ISSUE,
        severity: PmFlagSeverity.HIGH,
        reason: `IC status "${d.icStatus}"; ${daysSinceUpdate} days without resolution`,
        externalRef: `ic-reject:${d.hubspotDealId}:${isoWeekKey()}`,
        assignedToUserId: await resolvePmUserId(d.projectManager),
        metadata: { rule: "ic-rejection", icStatus: d.icStatus, daysSinceUpdate },
      });
    }
  }
  return { rule: "ic-rejection", matches, durationMs: Date.now() - start };
}

/** R5: DESIGN_ISSUE / MEDIUM — design revision count > 3. One-shot per deal. */
export async function ruleDesignRevisions(): Promise<RuleResult> {
  const start = Date.now();
  if (!prisma) return { rule: "design-revisions", matches: [], durationMs: 0 };

  const deals = await prisma.deal.findMany({
    where: {
      ...ACTIVE_PROJECT_FILTER, daRevisionCount: { gt: 3 } },
    select: { hubspotDealId: true, dealName: true, projectManager: true, stage: true, daRevisionCount: true },
  });

  const matches: RuleMatch[] = await Promise.all(
    deals
      .filter(d => !isTerminal(d.stage))
      .map(async d => ({
        hubspotDealId: d.hubspotDealId,
        dealName: d.dealName,
        type: PmFlagType.DESIGN_ISSUE,
        severity: PmFlagSeverity.MEDIUM,
        reason: `${d.daRevisionCount} design revisions — design quality risk`,
        externalRef: `design-revisions:${d.hubspotDealId}`, // one-shot per deal
        assignedToUserId: await resolvePmUserId(d.projectManager),
        metadata: { rule: "design-revisions", daRevisionCount: d.daRevisionCount },
      }))
  );
  return { rule: "design-revisions", matches, durationMs: Date.now() - start };
}

/** R6: INSTALL_BLOCKED / CRITICAL — install scheduled date passed but no completion. */
export async function ruleInstallOverdue(): Promise<RuleResult> {
  const start = Date.now();
  if (!prisma) return { rule: "install-overdue", matches: [], durationMs: 0 };

  const today = new Date();
  const deals = await prisma.deal.findMany({
    where: {
      ...ACTIVE_PROJECT_FILTER,
      installScheduleDate: { not: null, lt: today },
      constructionCompleteDate: null,
    },
    select: {
      hubspotDealId: true, dealName: true, projectManager: true, stage: true,
      installScheduleDate: true,
    },
  });

  const matches: RuleMatch[] = [];
  for (const d of deals) {
    if (isTerminal(d.stage)) continue;
    const days = daysBetween(d.installScheduleDate);
    if (days == null || days < 1) continue;
    matches.push({
      hubspotDealId: d.hubspotDealId,
      dealName: d.dealName,
      type: PmFlagType.INSTALL_BLOCKED,
      severity: PmFlagSeverity.CRITICAL,
      reason: `Install was scheduled ${days} days ago (${d.installScheduleDate?.toISOString().slice(0, 10)}) but not marked complete`,
      externalRef: `install-overdue:${d.hubspotDealId}:${d.installScheduleDate?.toISOString().slice(0, 10)}`,
      assignedToUserId: await resolvePmUserId(d.projectManager),
        metadata: { rule: "install-overdue", installScheduleDate: d.installScheduleDate, daysOverdue: days },
    });
  }
  return { rule: "install-overdue", matches, durationMs: Date.now() - start };
}

/**
 * R7: CUSTOMER_COMPLAINT / HIGH — service ticket open on a deal still in active install/inspection.
 *
 * Skipped for v1 cron — requires HubSpot ticket fetch in the cron loop.
 * The /api/pm-flags POST endpoint + RaiseFlagButton handle this case
 * manually for now. Revisit when the ticket-deal join is materialized
 * locally.
 */

/** R8: MISSING_DATA / MEDIUM — deal in Permit stage with no AHJ AND not yet submitted. */
export async function ruleMissingAhj(): Promise<RuleResult> {
  const start = Date.now();
  if (!prisma) return { rule: "missing-ahj", matches: [], durationMs: 0 };

  const deals = await prisma.deal.findMany({
    where: {
      ...ACTIVE_PROJECT_FILTER,
      OR: [{ ahj: null }, { ahj: "" }],
      isPermitSubmitted: false,
    },
    select: { hubspotDealId: true, dealName: true, projectManager: true, stage: true },
  });

  const matches: RuleMatch[] = [];
  for (const d of deals) {
    const norm = normalizeStage(d.stage);
    if (norm !== "Permit" && norm !== "RTB") continue; // Permit-and-beyond pre-build
    if (isTerminal(d.stage)) continue;
    matches.push({
      hubspotDealId: d.hubspotDealId,
      dealName: d.dealName,
      type: PmFlagType.MISSING_DATA,
      severity: PmFlagSeverity.MEDIUM,
      reason: `Deal in "${d.stage}" stage with no AHJ assigned`,
      externalRef: `missing-ahj:${d.hubspotDealId}`, // one-shot per deal
      assignedToUserId: await resolvePmUserId(d.projectManager),
        metadata: { rule: "missing-ahj", stage: d.stage },
    });
  }
  return { rule: "missing-ahj", matches, durationMs: Date.now() - start };
}

/** R9: MISSING_DATA / MEDIUM — deal in Permit-or-beyond stage, no Utility, IC not submitted. */
export async function ruleMissingUtility(): Promise<RuleResult> {
  const start = Date.now();
  if (!prisma) return { rule: "missing-utility", matches: [], durationMs: 0 };

  const deals = await prisma.deal.findMany({
    where: {
      ...ACTIVE_PROJECT_FILTER,
      OR: [{ utility: null }, { utility: "" }],
      isIcSubmitted: false,
    },
    select: { hubspotDealId: true, dealName: true, projectManager: true, stage: true },
  });

  const matches: RuleMatch[] = [];
  for (const d of deals) {
    const norm = normalizeStage(d.stage);
    if (norm !== "Permit" && norm !== "RTB" && norm !== "Install") continue;
    if (isTerminal(d.stage)) continue;
    matches.push({
      hubspotDealId: d.hubspotDealId,
      dealName: d.dealName,
      type: PmFlagType.MISSING_DATA,
      severity: PmFlagSeverity.MEDIUM,
      reason: `Deal in "${d.stage}" stage with no Utility assigned`,
      externalRef: `missing-utility:${d.hubspotDealId}`, // one-shot per deal
      assignedToUserId: await resolvePmUserId(d.projectManager),
        metadata: { rule: "missing-utility", stage: d.stage },
    });
  }
  return { rule: "missing-utility", matches, durationMs: Date.now() - start };
}

// =============================================================================
// V2 Rules
// =============================================================================

/** R10: MILESTONE_OVERDUE / HIGH — deal closed > 7 days ago, no site survey completion. */
export async function ruleSurveyOutstanding(): Promise<RuleResult> {
  const start = Date.now();
  if (!prisma) return { rule: "survey-outstanding", matches: [], durationMs: 0 };

  const cutoff = new Date(Date.now() - 7 * 86_400_000);
  const deals = await prisma.deal.findMany({
    where: {
      ...ACTIVE_PROJECT_FILTER,
      closeDate: { not: null, lt: cutoff },
      siteSurveyCompletionDate: null,
    },
    select: { hubspotDealId: true, dealName: true, projectManager: true, stage: true, closeDate: true },
  });

  const matches: RuleMatch[] = [];
  for (const d of deals) {
    if (isTerminal(d.stage)) continue;
    const days = daysBetween(d.closeDate);
    if (days == null || days < 7) continue;
    matches.push({
      hubspotDealId: d.hubspotDealId,
      dealName: d.dealName,
      type: PmFlagType.MILESTONE_OVERDUE,
      severity: PmFlagSeverity.HIGH,
      reason: `Site survey outstanding ${days} days after deal close`,
      externalRef: `survey-overdue:${d.hubspotDealId}:${isoWeekKey()}`,
      assignedToUserId: await resolvePmUserId(d.projectManager),
        metadata: { rule: "survey-outstanding", daysSinceClose: days },
    });
  }
  return { rule: "survey-outstanding", matches, durationMs: Date.now() - start };
}

/** R11: MILESTONE_OVERDUE / MEDIUM — surveyed > 5 days ago, DA not sent. */
export async function ruleDaSendOutstanding(): Promise<RuleResult> {
  const start = Date.now();
  if (!prisma) return { rule: "da-send-outstanding", matches: [], durationMs: 0 };

  const cutoff = new Date(Date.now() - 5 * 86_400_000);
  const deals = await prisma.deal.findMany({
    where: {
      ...ACTIVE_PROJECT_FILTER,
      siteSurveyCompletionDate: { not: null, lt: cutoff },
      designApprovalSentDate: null,
    },
    select: { hubspotDealId: true, dealName: true, projectManager: true, stage: true, siteSurveyCompletionDate: true },
  });

  const matches: RuleMatch[] = [];
  for (const d of deals) {
    if (isTerminal(d.stage)) continue;
    const days = daysBetween(d.siteSurveyCompletionDate);
    if (days == null || days < 5) continue;
    matches.push({
      hubspotDealId: d.hubspotDealId,
      dealName: d.dealName,
      type: PmFlagType.MILESTONE_OVERDUE,
      severity: PmFlagSeverity.MEDIUM,
      reason: `DA not sent ${days} days after site survey`,
      externalRef: `da-send-overdue:${d.hubspotDealId}:${isoWeekKey()}`,
      assignedToUserId: await resolvePmUserId(d.projectManager),
        metadata: { rule: "da-send-outstanding", daysSinceSurvey: days },
    });
  }
  return { rule: "da-send-outstanding", matches, durationMs: Date.now() - start };
}

/** R12: MILESTONE_OVERDUE / MEDIUM — DA sent > 7 days ago, no layout approval. */
export async function ruleDaApprovalOutstanding(): Promise<RuleResult> {
  const start = Date.now();
  if (!prisma) return { rule: "da-approval-outstanding", matches: [], durationMs: 0 };

  const cutoff = new Date(Date.now() - 7 * 86_400_000);
  const deals = await prisma.deal.findMany({
    where: {
      ...ACTIVE_PROJECT_FILTER,
      designApprovalSentDate: { not: null, lt: cutoff },
      isLayoutApproved: false,
    },
    select: { hubspotDealId: true, dealName: true, projectManager: true, stage: true, designApprovalSentDate: true, layoutStatus: true },
  });

  const matches: RuleMatch[] = [];
  for (const d of deals) {
    if (isTerminal(d.stage)) continue;
    // Don't double-flag rows that the change-order rule will catch.
    if (d.layoutStatus === "Pending Sales Changes") continue;
    const days = daysBetween(d.designApprovalSentDate);
    if (days == null || days < 7) continue;
    matches.push({
      hubspotDealId: d.hubspotDealId,
      dealName: d.dealName,
      type: PmFlagType.MILESTONE_OVERDUE,
      severity: PmFlagSeverity.MEDIUM,
      reason: `DA sent ${days} days ago, customer has not approved`,
      externalRef: `da-approval-overdue:${d.hubspotDealId}:${isoWeekKey()}`,
      assignedToUserId: await resolvePmUserId(d.projectManager),
        metadata: { rule: "da-approval-outstanding", daysSinceDaSent: days },
    });
  }
  return { rule: "da-approval-outstanding", matches, durationMs: Date.now() - start };
}

/** R13: CHANGE_ORDER / MEDIUM — `layoutStatus = "Pending Sales Changes"` for > 5 days. */
export async function ruleChangeOrderPending(): Promise<RuleResult> {
  const start = Date.now();
  if (!prisma) return { rule: "change-order-pending", matches: [], durationMs: 0 };

  const deals = await prisma.deal.findMany({
    where: {
      ...ACTIVE_PROJECT_FILTER, layoutStatus: "Pending Sales Changes" },
    select: { hubspotDealId: true, dealName: true, projectManager: true, stage: true, updatedAt: true },
  });

  const matches: RuleMatch[] = [];
  for (const d of deals) {
    if (isTerminal(d.stage)) continue;
    // Use updatedAt as proxy for "how long has layoutStatus been Pending Sales Changes."
    // Imperfect (any unrelated field change resets the clock), but conservative.
    const daysSinceUpdate = daysBetween(d.updatedAt);
    if (daysSinceUpdate == null || daysSinceUpdate < 5) continue;
    matches.push({
      hubspotDealId: d.hubspotDealId,
      dealName: d.dealName,
      type: PmFlagType.CHANGE_ORDER,
      severity: PmFlagSeverity.MEDIUM,
      reason: `DA blocked on sales change for ${daysSinceUpdate}+ days`,
      externalRef: `pending-sales-change:${d.hubspotDealId}:${isoWeekKey()}`,
      assignedToUserId: await resolvePmUserId(d.projectManager),
        metadata: { rule: "change-order-pending", daysSinceUpdate },
    });
  }
  return { rule: "change-order-pending", matches, durationMs: Date.now() - start };
}

/** R14: MILESTONE_OVERDUE / HIGH — install completed > 14 days, inspection not scheduled or passed. */
export async function ruleInspectionOutstanding(): Promise<RuleResult> {
  const start = Date.now();
  if (!prisma) return { rule: "inspection-outstanding", matches: [], durationMs: 0 };

  const cutoff = new Date(Date.now() - 14 * 86_400_000);
  const deals = await prisma.deal.findMany({
    where: {
      ...ACTIVE_PROJECT_FILTER,
      constructionCompleteDate: { not: null, lt: cutoff },
      inspectionScheduleDate: null,
      inspectionPassDate: null,
    },
    select: { hubspotDealId: true, dealName: true, projectManager: true, stage: true, constructionCompleteDate: true },
  });

  const matches: RuleMatch[] = [];
  for (const d of deals) {
    if (isTerminal(d.stage)) continue;
    const days = daysBetween(d.constructionCompleteDate);
    if (days == null || days < 14) continue;
    matches.push({
      hubspotDealId: d.hubspotDealId,
      dealName: d.dealName,
      type: PmFlagType.MILESTONE_OVERDUE,
      severity: PmFlagSeverity.HIGH,
      reason: `Inspection outstanding ${days} days after install completion`,
      externalRef: `inspection-overdue:${d.hubspotDealId}:${isoWeekKey()}`,
      assignedToUserId: await resolvePmUserId(d.projectManager),
        metadata: { rule: "inspection-outstanding", daysSinceInstall: days },
    });
  }
  return { rule: "inspection-outstanding", matches, durationMs: Date.now() - start };
}

// =============================================================================
// Runner
// =============================================================================

const ALL_RULES = [
  ruleConstructionStageStuck,    // R1
  rulePreConstructionStageStuck, // R2
  rulePermitRejection,           // R3
  ruleIcRejection,               // R4
  ruleDesignRevisions,           // R5
  ruleInstallOverdue,            // R6
  // R7 (customer complaint) — manual-only for v1
  ruleMissingAhj,                // R8
  ruleMissingUtility,            // R9
  ruleSurveyOutstanding,         // R10
  ruleDaSendOutstanding,         // R11
  ruleDaApprovalOutstanding,     // R12
  ruleChangeOrderPending,        // R13
  ruleInspectionOutstanding,     // R14
] as const;

/**
 * Run every rule, persist matches via createFlag.
 * Returns a summary suitable for cron logging.
 *
 * @param options.dryRun - When true, evaluate rules and report matches but
 *   do NOT create flags or send emails. Useful for calibration before
 *   flipping PM_FLAG_RULES_ENABLED=true.
 */
export async function runAllRules(options: { dryRun?: boolean } = {}): Promise<RunSummary> {
  const { dryRun = false } = options;
  const summary: RunSummary = {
    totalMatches: 0,
    totalCreated: 0,
    totalAlreadyExisted: 0,
    totalErrors: 0,
    byRule: [],
    errors: [],
  };

  for (const rule of ALL_RULES) {
    let result: RuleResult;
    try {
      result = await rule();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.errors.push({ rule: rule.name, error: message });
      summary.totalErrors++;
      continue;
    }
    summary.byRule.push({
      rule: result.rule,
      matches: result.matches.length,
      durationMs: result.durationMs,
    });
    summary.totalMatches += result.matches.length;

    if (dryRun) continue; // Don't persist or send emails on dry run.

    for (const m of result.matches) {
      try {
        const r = await createFlag({
          hubspotDealId: m.hubspotDealId,
          dealName: m.dealName,
          type: m.type,
          severity: m.severity,
          reason: m.reason,
          source: PmFlagSource.ADMIN_WORKFLOW,
          externalRef: m.externalRef,
          metadata: m.metadata,
          assignedToUserId: m.assignedToUserId,
        });
        if (r.alreadyExisted) {
          summary.totalAlreadyExisted++;
        } else {
          summary.totalCreated++;
          // NO email send — auto-detected flags from the rules cron go
          // silently to the queue. PMs check /dashboards/pm-action-queue
          // on their own cadence. Emails are reserved for deliberate
          // human actions (manual flag raise, manual reassignment).
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        summary.errors.push({
          rule: result.rule,
          dealId: m.hubspotDealId,
          error: message,
        });
        summary.totalErrors++;
      }
    }
  }

  return summary;
}

// Re-exports for testing/debugging.
export const _rulesForTest = ALL_RULES;
export type { Deal };
