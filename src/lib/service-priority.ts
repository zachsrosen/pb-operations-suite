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
  lastContactDate?: string | null;
  createDate: string;
  amount?: number | null;
  location?: string | null;
  url?: string;
  warrantyExpiry?: string | null;
  ownerId?: string | null;
  serviceType?: string | null;
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

  // 3. Stage duration (time stuck)
  const daysSinceModified = daysBetween(item.lastModified, now);
  const daysSinceModifiedValid = !Number.isNaN(daysSinceModified);
  if (daysSinceModifiedValid && daysSinceModified >= 7) {
    score += 20;
    reasons.push(`Stuck in "${item.stage}" for ${daysSinceModified} days`);
    categories.add("stuck_in_stage");
  } else if (daysSinceModifiedValid && daysSinceModified >= 3) {
    score += 10;
    reasons.push(`In "${item.stage}" for ${daysSinceModified} days`);
    categories.add("stuck_in_stage");
  }

  // 4. Deal value (higher value = higher priority)
  if (item.amount && item.amount > 10000) {
    score += 10;
    reasons.push("High-value service ($" + item.amount.toLocaleString() + ")");
    categories.add("high_value");
  } else if (item.amount && item.amount > 5000) {
    score += 5;
    categories.add("high_value");
  }

  // 5. Stage-specific urgency
  const urgentStages = ["Inspection", "Invoicing"];
  const activeStages = ["Site Visit Scheduling", "Work In Progress"];
  if (urgentStages.includes(item.stage)) {
    score += 5;
    categories.add("stage_urgency");
  }
  if (activeStages.includes(item.stage) && daysSinceModifiedValid && daysSinceModified >= 5) {
    score += 10;
    reasons.push(`"${item.stage}" overdue`);
    categories.add("stage_urgency");
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
