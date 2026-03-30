// src/lib/eod-summary/milestones.ts
//
// Milestone detection and enrichment for the EOD summary email.
// Detects when a StatusChange crosses a defined milestone threshold, then
// enriches with the HubSpot property history to find who made the change.

import * as Sentry from "@sentry/nextjs";
import { hubspotClient } from "@/lib/hubspot";
import { MILESTONES, MILESTONE_VALUES, FIELD_TO_HS_PROPERTY } from "./config";
import type { StatusChange } from "./snapshot";

// Re-export for consumers
export type { StatusChange } from "./snapshot";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface MilestoneHit {
  change: StatusChange;
  displayLabel: string;
  department: string;
  changedBy: string | null;
  changedAt: string | null;      // Denver-localized display string
  changedAtIso: string | null;   // Raw ISO timestamp for sorting
}

// ── Constants ──────────────────────────────────────────────────────────────────

const MAX_HISTORY_CALLS = 20;

// ── Module-level cache ─────────────────────────────────────────────────────────

let _userIdMapCache: Map<string, string> | null = null;

export function clearUserIdMapCache(): void {
  _userIdMapCache = null;
}

// ── User ID Map ────────────────────────────────────────────────────────────────

/**
 * Build a map from HubSpot owner ID / userId → full name.
 * Cached at module level; cleared by clearUserIdMapCache().
 */
export async function buildUserIdMap(): Promise<Map<string, string>> {
  if (_userIdMapCache) return _userIdMapCache;

  const map = new Map<string, string>();

  try {
    const response = await hubspotClient.crm.owners.ownersApi.getPage(
      undefined,
      undefined,
      500,
      false
    );

    for (const owner of response.results ?? []) {
      const fullName = [owner.firstName, owner.lastName]
        .filter(Boolean)
        .join(" ")
        .trim();

      if (owner.id) {
        map.set(owner.id, fullName || owner.email || owner.id);
      }
      if (owner.userId != null) {
        map.set(String(owner.userId), fullName || owner.email || String(owner.userId));
      }
    }
  } catch (err) {
    console.error("[eod-milestones] Failed to build user ID map:", err);
    Sentry.captureException(err, { tags: { module: "eod-milestones" } });
  }

  _userIdMapCache = map;
  return map;
}

// ── Property History ───────────────────────────────────────────────────────────

type PropertyHistoryEntry = {
  value?: string;
  timestamp?: string;
  sourceType?: string;
  sourceId?: string | null;
  updatedByUserId?: number | null;
};

type PropertiesWithHistoryMap = Record<string, PropertyHistoryEntry[]>;

/**
 * Fetch deal property history for the given properties.
 * Retries on 429 / rate-limit errors with exponential backoff.
 * Returns propertiesWithHistory cast to a plain object map, or null on failure.
 */
async function getPropertyHistory(
  dealId: string,
  properties: string[],
  maxRetries = 3
): Promise<PropertiesWithHistoryMap | null> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await hubspotClient.crm.deals.basicApi.getById(
        dealId,
        properties,
        properties,
        undefined,
        false
      );

      return (response as unknown as { propertiesWithHistory?: PropertiesWithHistoryMap })
        .propertiesWithHistory ?? null;
    } catch (err: unknown) {
      const isRateLimit =
        (err instanceof Error && err.message.toLowerCase().includes("rate")) ||
        (typeof err === "object" &&
          err !== null &&
          "code" in err &&
          (err as { code?: number }).code === 429);

      if (isRateLimit && attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1100 + Math.random() * 400;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      console.error(
        `[eod-milestones] Failed to fetch property history for deal ${dealId}:`,
        err
      );
      return null;
    }
  }

  return null;
}

// ── Date helpers ───────────────────────────────────────────────────────────────

function getTodayDenver(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Denver" });
}

function formatDenverTime(isoTimestamp: string): string {
  try {
    return new Date(isoTimestamp).toLocaleString("en-US", {
      timeZone: "America/Denver",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return isoTimestamp;
  }
}

// ── Core Detection (pure, sync) ────────────────────────────────────────────────

/**
 * Given a list of StatusChanges, returns a MilestoneHit for each change whose
 * `to` value is in MILESTONE_VALUES for the associated HubSpot property.
 *
 * changedBy / changedAt are null until enrichMilestones() is called.
 */
export function detectMilestones(changes: StatusChange[]): MilestoneHit[] {
  const hits: MilestoneHit[] = [];

  for (const change of changes) {
    if (change.to === null || change.to === undefined) continue;

    const hsProperty = FIELD_TO_HS_PROPERTY[change.field];
    if (!hsProperty) continue;

    const milestoneValues = MILESTONE_VALUES.get(hsProperty);
    if (!milestoneValues || !milestoneValues.has(change.to)) continue;

    // Find the milestone definition for display label + department
    const milestoneDef = MILESTONES.find(
      (m) => m.statusProperty === hsProperty && m.rawValue === change.to
    );
    if (!milestoneDef) continue;

    hits.push({
      change,
      displayLabel: milestoneDef.displayLabel,
      department: milestoneDef.department,
      changedBy: null,
      changedAt: null,
      changedAtIso: null,
    });
  }

  return hits;
}

// ── Enrichment ────────────────────────────────────────────────────────────────

/**
 * Enrich MilestoneHits with changedBy + changedAt by fetching HubSpot property
 * history for each deal (up to MAX_HISTORY_CALLS total).
 */
export async function enrichMilestones(
  hits: MilestoneHit[]
): Promise<MilestoneHit[]> {
  if (hits.length === 0) return hits;

  const userMap = await buildUserIdMap();
  const todayDenver = getTodayDenver(); // "YYYY-MM-DD"

  // Group hits by dealId to batch history calls
  const dealIds = [...new Set(hits.map((h) => h.change.dealId))];
  const limitedDealIds = dealIds.slice(0, MAX_HISTORY_CALLS);

  // Collect all HS properties we need per deal
  const dealPropertiesNeeded = new Map<string, Set<string>>();
  for (const hit of hits) {
    const dealId = hit.change.dealId;
    if (!limitedDealIds.includes(dealId)) continue;
    const hsProperty = FIELD_TO_HS_PROPERTY[hit.change.field];
    if (!hsProperty) continue;
    if (!dealPropertiesNeeded.has(dealId)) {
      dealPropertiesNeeded.set(dealId, new Set());
    }
    dealPropertiesNeeded.get(dealId)!.add(hsProperty);
  }

  // Fetch history for each deal
  const historyCache = new Map<string, PropertiesWithHistoryMap | null>();
  for (const dealId of limitedDealIds) {
    const properties = [...(dealPropertiesNeeded.get(dealId) ?? [])];
    if (properties.length === 0) continue;
    const history = await getPropertyHistory(dealId, properties);
    historyCache.set(dealId, history);
  }

  // Enrich each hit
  return hits.map((hit) => {
    const hsProperty = FIELD_TO_HS_PROPERTY[hit.change.field];
    if (!hsProperty) return hit;

    const history = historyCache.get(hit.change.dealId);
    if (!history) return hit;

    const propertyHistory: PropertyHistoryEntry[] = history[hsProperty] ?? [];

    // Find the entry that matches the milestone value on today's date
    // Accept CRM_UI or INTEGRATION source types
    const matchingEntry = propertyHistory.find((entry) => {
      if (entry.value !== hit.change.to) return false;
      if (
        entry.sourceType !== "CRM_UI" &&
        entry.sourceType !== "INTEGRATION"
      ) {
        return false;
      }
      if (!entry.timestamp) return false;

      // Check that the timestamp falls within today (Denver timezone)
      const entryDateDenver = new Date(entry.timestamp).toLocaleDateString(
        "en-CA",
        { timeZone: "America/Denver" }
      );
      return entryDateDenver === todayDenver;
    });

    if (!matchingEntry) return hit;

    // Resolve user name from history entry
    let changedBy: string | null = null;
    if (matchingEntry.updatedByUserId != null) {
      const userId = String(matchingEntry.updatedByUserId);
      changedBy = userMap.get(userId) ?? null;
    } else if (matchingEntry.sourceId) {
      changedBy = userMap.get(matchingEntry.sourceId) ?? null;
    }

    // HubSpot SDK may return timestamp as a Date object at runtime despite string types — coerce
    const rawTs = matchingEntry.timestamp as unknown;
    const changedAtIso = rawTs ? (rawTs instanceof Date ? rawTs.toISOString() : String(rawTs)) : null;
    const changedAt = changedAtIso ? formatDenverTime(changedAtIso) : null;

    return {
      ...hit,
      changedBy,
      changedAt,
      changedAtIso,
    };
  });
}
