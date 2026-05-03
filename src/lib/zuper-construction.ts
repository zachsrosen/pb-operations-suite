import type { ZuperJobCache } from "@/generated/prisma/client";
import * as Sentry from "@sentry/nextjs";
import {
  CONSTRUCTION_CATEGORY_NAMES,
  CONSTRUCTION_CATEGORY_UIDS,
  JOB_CATEGORIES,
  JOB_CATEGORY_UIDS,
} from "./zuper";

export type SystemType = "solar" | "battery" | "ev" | "legacy";

export type DealConstructionAggregate = {
  dealId: string;
  jobs: ZuperJobCache[];
  systemTypes: SystemType[];
  earliestStart: Date | null;
  latestEnd: Date | null;
  assignedCrewsByType: Partial<Record<SystemType, string[]>>;
};

/** True if a Zuper category UID counts as construction work. Use for raw API responses. */
export function isConstructionCategoryUid(uid: string | null | undefined): boolean {
  if (!uid) return false;
  return CONSTRUCTION_CATEGORY_UIDS.includes(uid);
}

/** True if a category display name counts as construction. Use for ZuperJobCache.jobCategory. */
export function isConstructionCategoryName(name: string | null | undefined): boolean {
  if (!name) return false;
  return CONSTRUCTION_CATEGORY_NAMES.includes(name);
}

/** Map a UID OR display name to its system type. Defensive default: "legacy". */
export function categoryToSystemType(uidOrName: string): SystemType {
  if (uidOrName === JOB_CATEGORIES.SOLAR_INSTALL) return "solar";
  if (uidOrName === JOB_CATEGORIES.BATTERY_INSTALL) return "battery";
  if (uidOrName === JOB_CATEGORIES.EV_INSTALL) return "ev";
  if (uidOrName === JOB_CATEGORIES.CONSTRUCTION) return "legacy";

  if (JOB_CATEGORY_UIDS.SOLAR_INSTALL && uidOrName === JOB_CATEGORY_UIDS.SOLAR_INSTALL) return "solar";
  if (JOB_CATEGORY_UIDS.BATTERY_INSTALL && uidOrName === JOB_CATEGORY_UIDS.BATTERY_INSTALL) return "battery";
  if (JOB_CATEGORY_UIDS.EV_INSTALL && uidOrName === JOB_CATEGORY_UIDS.EV_INSTALL) return "ev";
  if (uidOrName === JOB_CATEGORY_UIDS.CONSTRUCTION) return "legacy";

  return "legacy";
}

/**
 * Group ZuperJobCache rows by hubspotDealId. Jobs without a dealId are
 * dropped (with a Sentry breadcrumb so we can spot data quality issues).
 *
 * Pure function — no I/O, no mutation of inputs.
 */
export function groupConstructionJobsByDeal(jobs: ZuperJobCache[]): DealConstructionAggregate[] {
  const byDeal = new Map<string, ZuperJobCache[]>();
  let droppedCount = 0;

  for (const job of jobs) {
    if (!job.hubspotDealId) {
      droppedCount++;
      continue;
    }
    const existing = byDeal.get(job.hubspotDealId) ?? [];
    existing.push(job);
    byDeal.set(job.hubspotDealId, existing);
  }

  if (droppedCount > 0) {
    Sentry.addBreadcrumb({
      category: "zuper-construction",
      message: `Dropped ${droppedCount} construction job(s) without hubspotDealId`,
      level: "info",
    });
  }

  const aggregates: DealConstructionAggregate[] = [];
  for (const [dealId, dealJobs] of byDeal.entries()) {
    aggregates.push(buildAggregate(dealId, dealJobs));
  }
  return aggregates;
}

/**
 * Equal-split a deal value across its sub-jobs. Returns 0 for jobCount=0
 * to avoid divide-by-zero. Mirrors the existing D&R 50/50 pattern in
 * src/app/api/zuper/revenue-calendar/route.ts:471-501, generalized.
 */
export function allocateDealValueAcrossJobs(dealAmount: number, jobCount: number): number {
  if (jobCount <= 0) return 0;
  if (!dealAmount) return 0;
  return dealAmount / jobCount;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function buildAggregate(dealId: string, jobs: ZuperJobCache[]): DealConstructionAggregate {
  const systemTypes: SystemType[] = jobs.map((j) => categoryToSystemType(j.jobCategory ?? ""));

  let earliestStart: Date | null = null;
  let latestEnd: Date | null = null;
  for (const job of jobs) {
    if (job.scheduledStart) {
      if (!earliestStart || job.scheduledStart < earliestStart) earliestStart = job.scheduledStart;
    }
    if (job.scheduledEnd) {
      if (!latestEnd || job.scheduledEnd > latestEnd) latestEnd = job.scheduledEnd;
    }
  }

  const assignedCrewsByType: Partial<Record<SystemType, string[]>> = {};
  for (const job of jobs) {
    const sysType = categoryToSystemType(job.jobCategory ?? "");
    const users = extractAssignedUserNames(job.assignedUsers);
    if (users.length === 0) continue;
    const existing = assignedCrewsByType[sysType] ?? [];
    assignedCrewsByType[sysType] = [...existing, ...users];
  }

  return {
    dealId,
    jobs,
    systemTypes,
    earliestStart,
    latestEnd,
    assignedCrewsByType,
  };
}

function extractAssignedUserNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const names: string[] = [];
  for (const entry of raw) {
    if (entry && typeof entry === "object" && "user_name" in entry) {
      const name = String((entry as { user_name?: unknown }).user_name ?? "").trim();
      if (name) names.push(name);
    }
  }
  return names;
}
