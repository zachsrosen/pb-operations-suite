/**
 * PowerHub Auto-Link: Match Tesla sites to HubSpot properties/deals
 *
 * Tesla API returns NO address data for sites — only internal STE IDs,
 * equipment details, and device serial numbers. This module matches
 * unlinked Tesla sites to HubSpot properties using multi-signal scoring:
 *
 *   1. Install date proximity — STE date (from site name) vs property firstInstallDate
 *   2. Equipment fingerprint — battery presence/count match
 *   3. Already-linked exclusion — skip properties already linked to another site
 *
 * PB operates only in CO + CA, so the candidate pool is manageable.
 * The algorithm is conservative: only auto-links when confidence is HIGH
 * (single strong match with good separation from runner-up). Everything
 * else becomes a ranked suggestion for admin review.
 */

import { prisma } from "./db";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AutoLinkResult {
  autoLinked: number;
  suggestions: AutoLinkSuggestion[];
  skipped: number;
  errors: string[];
  /** Total unlinked provisioned sites considered */
  totalConsidered: number;
}

export interface AutoLinkSuggestion {
  siteId: string;
  siteName: string;
  steDate: string | null;
  batteryCount: number;
  gatewayCount: number;
  candidates: ScoredCandidate[];
}

export interface ScoredCandidate {
  propertyId: string;
  dealId: string | null;
  address: string;
  city: string;
  state: string;
  firstInstallDate: string | null;
  hasBattery: boolean;
  score: number;
  signals: string[];
}

// ─── STE Date Parser ─────────────────────────────────────────────────────────

/**
 * Parse commissioning date from Tesla site name.
 * Format: STE{YYYYMMDD}-{NNNNN}  e.g. "STE20201012-00251"
 * Returns null for non-STE names (some sites use UUIDs as names).
 */
export function parseSteDate(siteName: string): Date | null {
  const match = siteName.match(/^STE(\d{4})(\d{2})(\d{2})/);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  return isNaN(date.getTime()) ? null : date;
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

/** Score a candidate property against a Tesla site */
function scoreCandidate(
  steDate: Date | null,
  siteBatteryCount: number,
  candidate: {
    firstInstallDate: Date | null;
    hasBattery: boolean;
  }
): { score: number; signals: string[] } {
  let score = 0;
  const signals: string[] = [];

  // ── Date proximity (max 40 pts) ──
  if (steDate && candidate.firstInstallDate) {
    const diffMs = Math.abs(steDate.getTime() - candidate.firstInstallDate.getTime());
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    if (diffDays <= 3) {
      score += 40;
      signals.push(`date_exact (${Math.round(diffDays)}d)`);
    } else if (diffDays <= 7) {
      score += 35;
      signals.push(`date_week (${Math.round(diffDays)}d)`);
    } else if (diffDays <= 14) {
      score += 30;
      signals.push(`date_2wk (${Math.round(diffDays)}d)`);
    } else if (diffDays <= 30) {
      score += 22;
      signals.push(`date_month (${Math.round(diffDays)}d)`);
    } else if (diffDays <= 60) {
      score += 12;
      signals.push(`date_60d (${Math.round(diffDays)}d)`);
    } else if (diffDays <= 90) {
      score += 5;
      signals.push(`date_90d (${Math.round(diffDays)}d)`);
    }
  }

  // ── Battery match (max 30 pts) ──
  const siteHasBattery = siteBatteryCount > 0;

  if (siteHasBattery && candidate.hasBattery) {
    score += 25;
    signals.push("battery_match");
  } else if (!siteHasBattery && !candidate.hasBattery) {
    score += 10;
    signals.push("no_battery_match");
  } else {
    // Mismatch — strong negative signal
    score -= 15;
    signals.push("battery_mismatch");
  }

  return { score, signals };
}

// ─── Auto-Link Engine ────────────────────────────────────────────────────────

/** Thresholds for auto-linking vs suggestion */
const AUTO_LINK_MIN_SCORE = 50;
const AUTO_LINK_MIN_GAP = 15; // Gap between #1 and #2 score
const SUGGESTION_MIN_SCORE = 20;
const MAX_SUGGESTIONS_PER_SITE = 5;
/** Date window: only consider properties with install dates within ±120 days of STE date */
const DATE_WINDOW_DAYS = 120;

/** Internal intermediate type before greedy assignment */
interface ScoredPair {
  siteIdx: number;
  siteId: string;
  siteName: string;
  steDate: Date | null;
  batteryCount: number;
  gatewayCount: number;
  propertyId: string;
  score: number;
  signals: string[];
}

/**
 * Run the auto-link process for all unlinked provisioned sites.
 *
 * Uses a two-pass greedy algorithm:
 *   Pass 1 — Score every (site, property) pair
 *   Pass 2 — Sort by score desc, greedily assign each site its best
 *            unclaimed property. This enforces 1:1 uniqueness: once a
 *            property is claimed, no other site can take it.
 *
 * @param dryRun If true, compute matches but don't write to DB
 * @param limit Max sites to process (default: all)
 */
export async function autoLinkSites(options: {
  dryRun?: boolean;
  limit?: number;
} = {}): Promise<AutoLinkResult> {
  const { dryRun = false, limit } = options;

  const result: AutoLinkResult = {
    autoLinked: 0,
    suggestions: [],
    skipped: 0,
    errors: [],
    totalConsidered: 0,
  };

  // 1. Fetch unlinked provisioned sites
  const unlinkedSites = await prisma.powerhubSite.findMany({
    where: {
      linkMethod: "UNLINKED",
      OR: [
        { totalGateways: { gt: 0 } },
        { totalBatteries: { gt: 0 } },
        { totalInverters: { gt: 0 } },
      ],
    },
    select: {
      siteId: true,
      siteName: true,
      totalBatteries: true,
      totalGateways: true,
      totalInverters: true,
      totalBatteryEnergy: true,
    },
    orderBy: { siteName: "asc" },
    ...(limit ? { take: limit } : {}),
  });

  result.totalConsidered = unlinkedSites.length;

  if (unlinkedSites.length === 0) {
    return result;
  }

  // 2. Fetch candidate properties with their deal links
  const candidateProperties = await prisma.hubSpotPropertyCache.findMany({
    where: {
      OR: [
        { hasBattery: true },
        { firstInstallDate: { not: null } },
      ],
    },
    select: {
      id: true,
      fullAddress: true,
      city: true,
      state: true,
      firstInstallDate: true,
      hasBattery: true,
      systemSizeKwDc: true,
    },
  });

  // 3. Get deal links for candidate properties
  const propertyIds = candidateProperties.map((p) => p.id);
  const dealLinks = await prisma.propertyDealLink.findMany({
    where: { propertyId: { in: propertyIds } },
    select: { propertyId: true, dealId: true },
    orderBy: { associatedAt: "desc" },
  });

  // Build property → dealId map (most recent deal per property)
  const propertyDealMap = new Map<string, string>();
  for (const link of dealLinks) {
    if (!propertyDealMap.has(link.propertyId)) {
      propertyDealMap.set(link.propertyId, link.dealId);
    }
  }

  // 4. Find properties already linked to a Tesla site (to exclude)
  const alreadyLinkedPropertyIds = new Set<string>();
  const linkedSites = await prisma.powerhubSite.findMany({
    where: {
      propertyId: { not: null },
      linkMethod: { not: "UNLINKED" },
    },
    select: { propertyId: true },
  });
  for (const s of linkedSites) {
    if (s.propertyId) alreadyLinkedPropertyIds.add(s.propertyId);
  }

  // 5. Filter to unlinked candidate properties
  const availableCandidates = candidateProperties.filter(
    (p) => !alreadyLinkedPropertyIds.has(p.id)
  );

  // Build a property lookup for fast access
  const propertyMap = new Map(availableCandidates.map((p) => [p.id, p]));

  // ─── Pass 1: Score all (site, property) pairs ─────────────────────────

  const allPairs: ScoredPair[] = [];

  for (let i = 0; i < unlinkedSites.length; i++) {
    const site = unlinkedSites[i];
    const steDate = parseSteDate(site.siteName);

    for (const prop of availableCandidates) {
      // Date window filter
      if (steDate && prop.firstInstallDate) {
        const diffMs = Math.abs(steDate.getTime() - prop.firstInstallDate.getTime());
        const diffDays = diffMs / (1000 * 60 * 60 * 24);
        if (diffDays > DATE_WINDOW_DAYS) continue;
      }

      const { score, signals } = scoreCandidate(steDate, site.totalBatteries, {
        firstInstallDate: prop.firstInstallDate,
        hasBattery: prop.hasBattery,
      });

      if (score >= SUGGESTION_MIN_SCORE) {
        allPairs.push({
          siteIdx: i,
          siteId: site.siteId,
          siteName: site.siteName,
          steDate,
          batteryCount: site.totalBatteries,
          gatewayCount: site.totalGateways,
          propertyId: prop.id,
          score,
          signals,
        });
      }
    }
  }

  // ─── Pass 2: Greedy assignment (highest score first) ──────────────────

  // Sort all pairs by score descending, then by date signal specificity
  allPairs.sort((a, b) => b.score - a.score);

  // Track claimed properties and assigned sites
  const claimedProperties = new Set<string>();
  const assignedSites = new Map<string, {
    top: ScoredPair;
    allCandidates: ScoredPair[];
  }>();

  // Group pairs by siteId for gap calculation
  const pairsBySite = new Map<string, ScoredPair[]>();
  for (const pair of allPairs) {
    const existing = pairsBySite.get(pair.siteId) || [];
    existing.push(pair);
    pairsBySite.set(pair.siteId, existing);
  }

  // Greedy: walk pairs from highest score, claim if both site and property are free
  for (const pair of allPairs) {
    if (assignedSites.has(pair.siteId)) continue; // Site already assigned
    if (claimedProperties.has(pair.propertyId)) continue; // Property already claimed

    // Get all candidates for this site (for gap calculation)
    const siteCandidates = pairsBySite.get(pair.siteId) || [];
    // Find the best unclaimed alternative for gap
    const alternatives = siteCandidates.filter(
      (p) => p.propertyId !== pair.propertyId && !claimedProperties.has(p.propertyId)
    );
    const nextBestScore = alternatives.length > 0 ? alternatives[0].score : 0;
    const gap = pair.score - nextBestScore;

    const meetsAutoLink = pair.score >= AUTO_LINK_MIN_SCORE && gap >= AUTO_LINK_MIN_GAP;

    if (meetsAutoLink) {
      claimedProperties.add(pair.propertyId);
      assignedSites.set(pair.siteId, {
        top: pair,
        allCandidates: siteCandidates,
      });
    }
  }

  // ─── Pass 3: Write auto-links and build suggestions ───────────────────

  for (const [siteId, assignment] of assignedSites) {
    try {
      const { top } = assignment;
      const property = propertyMap.get(top.propertyId);

      if (!dryRun) {
        await prisma.powerhubSite.update({
          where: { siteId },
          data: {
            propertyId: top.propertyId,
            dealId: propertyDealMap.get(top.propertyId) || null,
            linkMethod: "PROPERTY",
            linkConfidence: "HIGH",
            // Backfill address from the property
            address: property?.fullAddress || "",
            city: property?.city || "",
            state: property?.state || "",
          },
        });
      }

      result.autoLinked++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Link ${siteId}: ${msg}`);
    }
  }

  // Build suggestions for non-auto-linked sites
  for (const site of unlinkedSites) {
    if (assignedSites.has(site.siteId)) continue; // Already auto-linked

    const siteCandidates = pairsBySite.get(site.siteId) || [];
    // Filter out claimed properties for suggestion display
    const unclaimed = siteCandidates
      .filter((p) => !claimedProperties.has(p.propertyId))
      .slice(0, MAX_SUGGESTIONS_PER_SITE);

    if (unclaimed.length === 0) {
      result.skipped++;
      continue;
    }

    const steDate = parseSteDate(site.siteName);
    result.suggestions.push({
      siteId: site.siteId,
      siteName: site.siteName,
      steDate: steDate?.toISOString().split("T")[0] || null,
      batteryCount: site.totalBatteries,
      gatewayCount: site.totalGateways,
      candidates: unclaimed.map((p) => {
        const prop = propertyMap.get(p.propertyId);
        return {
          propertyId: p.propertyId,
          dealId: propertyDealMap.get(p.propertyId) || null,
          address: prop?.fullAddress || "",
          city: prop?.city || "",
          state: prop?.state || "",
          firstInstallDate: prop?.firstInstallDate?.toISOString() || null,
          hasBattery: prop?.hasBattery || false,
          score: p.score,
          signals: p.signals,
        };
      }),
    });
  }

  return result;
}

/**
 * Get summary stats for the auto-link system.
 */
export async function getAutoLinkStats() {
  const [totalSites, unlinked, linked, byMethod] = await Promise.all([
    prisma.powerhubSite.count({
      where: {
        OR: [
          { totalGateways: { gt: 0 } },
          { totalBatteries: { gt: 0 } },
          { totalInverters: { gt: 0 } },
        ],
      },
    }),
    prisma.powerhubSite.count({ where: { linkMethod: "UNLINKED" } }),
    prisma.powerhubSite.count({ where: { linkMethod: { not: "UNLINKED" } } }),
    prisma.powerhubSite.groupBy({
      by: ["linkMethod"],
      _count: true,
    }),
  ]);

  // Count candidate properties (battery + date)
  const candidateCount = await prisma.hubSpotPropertyCache.count({
    where: {
      OR: [
        { hasBattery: true },
        { firstInstallDate: { not: null } },
      ],
    },
  });

  // Count battery properties specifically
  const batteryPropertyCount = await prisma.hubSpotPropertyCache.count({
    where: { hasBattery: true },
  });

  // Count properties with install dates
  const datePropertyCount = await prisma.hubSpotPropertyCache.count({
    where: { firstInstallDate: { not: null } },
  });

  return {
    totalProvisionedSites: totalSites,
    unlinkedSites: unlinked,
    linkedSites: linked,
    byMethod: byMethod.map((m) => ({
      method: m.linkMethod,
      count: m._count,
    })),
    candidateProperties: candidateCount,
    batteryProperties: batteryPropertyCount,
    datedProperties: datePropertyCount,
  };
}
