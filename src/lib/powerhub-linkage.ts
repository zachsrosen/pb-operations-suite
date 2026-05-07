/**
 * PowerHub Site-to-Deal Linkage
 *
 * Three-tier matching:
 *   1. Property match — address hash matches HubSpotPropertyCache
 *   2. Address match — normalized address matches HubSpot deal property_address
 *   3. Manual — admin links via UI (or left UNLINKED for admin queue)
 */

import { createHash } from "crypto";
import type { PrismaClient } from "@/generated/prisma/client";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LinkageResult {
  method: "PROPERTY" | "ADDRESS_MATCH" | "MANUAL";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  propertyId: string | null;
  dealId: string | null;
}

export interface NormalizedSiteAddress {
  street: string;
  city: string;
  state: string;
  zip: string | null;
}

export interface DealAddress {
  dealId: string;
  street: string;
  city: string;
  state: string;
  zip: string | null;
}

// ─── Address Normalization ───────────────────────────────────────────────────

/**
 * Normalize a street address for comparison:
 * - Lowercase
 * - Remove periods
 * - Strip unit/apt/suite/# suffixes
 * - Collapse whitespace
 * - Trim
 */
export function normalizeAddress(raw: string): string {
  let addr = raw.toLowerCase().trim();
  // Remove periods
  addr = addr.replace(/\./g, "");
  // Strip unit/apt/suite/# and everything after
  addr = addr.replace(/\s+(apt|suite|ste|unit|#)\s*.*/i, "");
  // Collapse whitespace
  addr = addr.replace(/\s+/g, " ").trim();
  return addr;
}

/**
 * Compute SHA-256 hash of normalized address components.
 * Matches the pattern used by HubSpotPropertyCache.addressHash.
 */
export function computeAddressHash(
  street: string,
  city: string,
  state: string,
  zip: string | null
): string {
  const input = `${street}|${city}|${state}|${zip || ""}`.toLowerCase();
  return createHash("sha256").update(input).digest("hex");
}

// ─── Tier 1: Property Match ─────────────────────────────────────────────────

/**
 * Look up HubSpotPropertyCache by addressHash.
 * Returns linkage result if found, null if no match.
 */
export async function matchSiteToProperty(
  site: { addressHash: string | null },
  prisma: PrismaClient
): Promise<LinkageResult | null> {
  if (!site.addressHash) return null;

  const property = await prisma.hubSpotPropertyCache.findFirst({
    where: { addressHash: site.addressHash },
    select: { id: true },
  });

  if (!property) return null;

  return {
    method: "PROPERTY",
    confidence: "HIGH",
    propertyId: property.id,
    dealId: null,
  };
}

// ─── Tier 2: Address Match to Deals ─────────────────────────────────────────

/**
 * Compare normalized site address against a list of deal addresses.
 * Returns the best match or null.
 */
export function matchSiteToDeals(
  site: NormalizedSiteAddress,
  deals: DealAddress[]
): LinkageResult | null {
  // First pass: exact match (street + city + state + zip)
  for (const deal of deals) {
    if (
      deal.street === site.street &&
      deal.city === site.city &&
      deal.state === site.state &&
      deal.zip === site.zip
    ) {
      return {
        method: "ADDRESS_MATCH",
        confidence: "HIGH",
        propertyId: null,
        dealId: deal.dealId,
      };
    }
  }

  // Second pass: street + city match only (zip mismatch = MEDIUM)
  for (const deal of deals) {
    if (
      deal.street === site.street &&
      deal.city === site.city &&
      deal.state === site.state
    ) {
      return {
        method: "ADDRESS_MATCH",
        confidence: "MEDIUM",
        propertyId: null,
        dealId: deal.dealId,
      };
    }
  }

  return null;
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

/**
 * Run the full three-tier linkage for a site.
 * Returns the best match or null (UNLINKED).
 */
export async function linkSite(
  siteAddress: { street: string; city: string; state: string; zip: string | null },
  dealAddresses: DealAddress[],
  prisma: PrismaClient
): Promise<LinkageResult | null> {
  const normalizedStreet = normalizeAddress(siteAddress.street);
  const addressHash = computeAddressHash(
    normalizedStreet,
    siteAddress.city.toLowerCase(),
    siteAddress.state.toLowerCase(),
    siteAddress.zip
  );

  // Tier 1: Property match
  const propertyMatch = await matchSiteToProperty({ addressHash }, prisma);
  if (propertyMatch) return propertyMatch;

  // Tier 2: Address match
  const normalizedSite: NormalizedSiteAddress = {
    street: normalizedStreet,
    city: siteAddress.city.toLowerCase(),
    state: siteAddress.state.toLowerCase(),
    zip: siteAddress.zip,
  };
  const dealMatch = matchSiteToDeals(normalizedSite, dealAddresses);
  if (dealMatch) return dealMatch;

  // Tier 3: No match — stays UNLINKED (admin handles manually)
  return null;
}
