/**
 * Service Priority Scoring Engine
 *
 * Scores service deals (and later tickets) 0-100 for the priority queue.
 * Buckets: Critical (75-100), High (50-74), Medium (25-49), Low (0-24).
 */

import type { ReasonCategory } from "@/lib/service-enrichment";

export interface PriorityItem {
  id: string;
  type: "deal" | "ticket";
  title: string;
  stage: string;
  lastModified: string;
  /**
   * ISO timestamp the item entered its CURRENT stage (HubSpot
   * hs_date_entered_<stageId>). This is the reliable "time in stage" signal —
   * hs_lastmodifieddate gets re-stamped by automations/calc props, so a ticket
   * parked in a stage for a year can read "modified 10 days ago". Null when the
   * stage-entry date is unavailable (falls back to lastModified).
   */
  stageEnteredDate?: string | null;
  lastContactDate?: string | null;
  createDate: string;
  amount?: number | null;
  location?: string | null;
  url?: string;
  warrantyExpiry?: string | null;
  ownerId?: string | null;
  serviceType?: string | null;
  /** Tesla PowerHub portal URL for the associated property (System Health column). */
  teslaPortalUrl?: string | null;
  /** Count of currently-active PowerHub alerts across all sites linked to this deal/ticket. */
  activeAlertCount?: number;
  /**
   * Highest severity among active PowerHub alerts (JS-side max — Prisma _max
   * would return lexicographic). This is the field scoring reads; it must be
   * populated on the item BEFORE scoring (see priority-queue route).
   */
  highestAlertSeverity?: "INFORMATIONAL" | "PERFORMANCE" | "RMA" | "CRITICAL" | null;
}

export type PriorityTier = "critical" | "high" | "medium" | "low";

export interface PriorityScore {
  item: PriorityItem;
  score: number;
  tier: PriorityTier;
  reasons: string[];
  reasonCategories: ReasonCategory[];
  overridden?: boolean;
}

/**
 * Whole days from `dateStr` to `now`, floored at the calc site so display
 * and scoring stay in sync (display previously used Math.floor on a value
 * that scoring compared as a raw decimal — caused off-by-one drift around
 * midnight).
 *
 * Returns NaN for missing/invalid input; callers must guard.
 */
function daysBetween(dateStr: string, now: Date): number {
  if (!dateStr) return NaN;
  const ms = new Date(dateStr).getTime();
  if (!Number.isFinite(ms)) return NaN;
  return Math.floor((now.getTime() - ms) / (1000 * 60 * 60 * 24));
}

/** "Aug 8, 2025" — the date an item entered its current stage, for the badge. */
function formatSince(dateStr: string): string | null {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function tierFromScore(score: number): PriorityTier {
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  return "low";
}

export function scorePriorityItem(item: PriorityItem, now: Date = new Date()): PriorityScore {
  let score = 0;
  const reasons: string[] = [];
  const categories = new Set<ReasonCategory>();

  // 1. Warranty expiry urgency
  if (item.warrantyExpiry) {
    const daysToExpiry = -daysBetween(item.warrantyExpiry, now); // negative = future
    if (Number.isNaN(daysToExpiry)) {
      // skip — invalid timestamp shouldn't add points or noisy reasons
    } else if (daysToExpiry <= 0) {
      // Already expired
      score += 30;
      reasons.push("Warranty expired");
      categories.add("warranty_expiring");
    } else if (daysToExpiry <= 7) {
      score += 40;
      reasons.push(`Warranty expires in ${Math.ceil(daysToExpiry)} days`);
      categories.add("warranty_expiring");
    } else if (daysToExpiry <= 30) {
      score += 15;
      reasons.push(`Warranty expires in ${Math.ceil(daysToExpiry)} days`);
      categories.add("warranty_expiring");
    }
  }

  // 2. Last contact recency
  if (item.lastContactDate) {
    const daysSinceContact = daysBetween(item.lastContactDate, now);
    // daysSinceContact is already floored at the calc site; safe to compare
    // and display the same value (no off-by-one drift around midnight).
    if (Number.isNaN(daysSinceContact)) {
      // skip — bad timestamp shouldn't penalize the deal or fabricate reasons
    } else if (daysSinceContact >= 7) {
      score += 35;
      reasons.push(`No contact in ${daysSinceContact} days`);
      categories.add("no_contact");
    } else if (daysSinceContact >= 3) {
      score += 25;
      reasons.push(`Last contact ${daysSinceContact} days ago`);
      categories.add("no_contact");
    } else if (daysSinceContact >= 1) {
      score += 5;
      categories.add("no_contact");
    }
  }

  // 3. Stage duration (time stuck) — measured from when the item ENTERED its
  // current stage, not from hs_lastmodifieddate (which automations re-stamp, so
  // a year-stuck ticket wrongly read "10 days"). Falls back to lastModified
  // only when the stage-entry date is unavailable.
  const daysSinceModified = daysBetween(item.lastModified, now);
  const daysInStage = item.stageEnteredDate
    ? daysBetween(item.stageEnteredDate, now)
    : daysSinceModified;
  const daysInStageValid = !Number.isNaN(daysInStage);
  const stageSince = item.stageEnteredDate ? formatSince(item.stageEnteredDate) : null;
  const sinceSuffix = stageSince ? ` (since ${stageSince})` : "";
  if (daysInStageValid && daysInStage >= 7) {
    score += 20;
    reasons.push(`Stuck in "${item.stage}" for ${daysInStage} days${sinceSuffix}`);
    categories.add("stuck_in_stage");
  } else if (daysInStageValid && daysInStage >= 3) {
    score += 10;
    reasons.push(`In "${item.stage}" for ${daysInStage} days${sinceSuffix}`);
    categories.add("stuck_in_stage");
  }

  // 4. Total age (time since creation) — long-open items outrank fresh ones
  // instead of tying once no-contact and stuck-in-stage plateau at 7 days
  const daysOpen = daysBetween(item.createDate, now);
  if (!Number.isNaN(daysOpen) && daysOpen >= 30) {
    if (daysOpen >= 365) {
      score += 20;
    } else if (daysOpen >= 180) {
      score += 15;
    } else if (daysOpen >= 90) {
      score += 10;
    } else {
      score += 5;
    }
    reasons.push(`Open for ${daysOpen} days`);
    categories.add("item_age");
  }

  // 5. Deal value (higher value = higher priority)
  if (item.amount && item.amount > 10000) {
    score += 10;
    reasons.push("High-value service ($" + item.amount.toLocaleString() + ")");
    categories.add("high_value");
  } else if (item.amount && item.amount > 5000) {
    score += 5;
    categories.add("high_value");
  }

  // 6. Stage-specific urgency
  const urgentStages = ["Inspection", "Invoicing"];
  const activeStages = ["Site Visit Scheduling", "Work In Progress"];
  if (urgentStages.includes(item.stage)) {
    score += 5;
    categories.add("stage_urgency");
  }
  if (activeStages.includes(item.stage) && daysInStageValid && daysInStage >= 5) {
    score += 10;
    reasons.push(`"${item.stage}" overdue`);
    categories.add("stage_urgency");
  }

  // 7. PowerHub alert severity (rank: INFORMATIONAL < PERFORMANCE < RMA < CRITICAL).
  // Reads highestAlertSeverity — the field enrichment populates — which must be
  // attached to the item before scoring.
  if (item.highestAlertSeverity === "CRITICAL") {
    score += 25;
    reasons.push("PowerHub: Critical system alert");
    categories.add("powerhub_alert");
  } else if (item.highestAlertSeverity === "RMA") {
    score += 20;
    reasons.push("PowerHub: Tesla RMA (hardware replacement)");
    categories.add("powerhub_alert");
  } else if (item.highestAlertSeverity === "PERFORMANCE") {
    score += 10;
    reasons.push("PowerHub: Performance alert");
    categories.add("powerhub_alert");
  }

  // Cap at 100
  score = Math.min(100, score);

  // Default reason if none triggered
  if (reasons.length === 0) {
    reasons.push("On track");
  }

  return {
    item,
    score,
    tier: tierFromScore(score),
    reasons,
    reasonCategories: [...categories],
  };
}

/**
 * Severity ranking used to compute the highest-severity alert per property
 * in JavaScript. Prisma's `_max` on the `PowerhubAlertSeverity` enum returns
 * a lexicographic max, which is WRONG for severity ordering — alphabetically
 * CRITICAL < INFORMATIONAL < PERFORMANCE, so a CRITICAL alert would lose to
 * a paired INFORMATIONAL alert. We rank explicitly here.
 */
export const POWERHUB_SEVERITY_RANK: Record<"INFORMATIONAL" | "PERFORMANCE" | "RMA" | "CRITICAL", number> = {
  INFORMATIONAL: 1,
  PERFORMANCE: 2,
  RMA: 3,
  CRITICAL: 4,
};

/**
 * Compact summary of PowerHub state attributed to a single deal/ticket.
 */
export interface PowerhubItemSummary {
  teslaPortalUrl: string | null;
  activeAlertCount: number;
  highestAlertSeverity: "INFORMATIONAL" | "PERFORMANCE" | "RMA" | "CRITICAL" | null;
}

/**
 * Build a complete priority queue from deals (and later tickets).
 * Applies manual overrides from the database.
 */
export function buildPriorityQueue(
  items: PriorityItem[],
  overrides: Array<{ itemId: string; itemType: string; overridePriority: PriorityTier }> = [],
  now: Date = new Date()
): PriorityScore[] {
  const overrideMap = new Map(overrides.map(o => [`${o.itemType}:${o.itemId}`, o.overridePriority]));

  const scored = items.map(item => {
    const result = scorePriorityItem(item, now);
    const overrideKey = `${item.type}:${item.id}`;
    const override = overrideMap.get(overrideKey);

    if (override) {
      const overrideScore = override === "critical" ? 90 : override === "high" ? 65 : override === "medium" ? 35 : 10;
      return {
        ...result,
        tier: override,
        score: overrideScore,
        overridden: true,
        reasons: [`Manually set to ${override}`, ...result.reasons],
        reasonCategories: result.reasonCategories,
      };
    }

    return result;
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  return scored;
}
