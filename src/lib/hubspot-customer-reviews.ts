// src/lib/hubspot-customer-reviews.ts

/**
 * HubSpot Customer Reviews Custom Object Data Layer
 *
 * Fetches 5-star customer reviews from the Customer Reviews custom object
 * and resolves them to canonical locations via deal associations.
 *
 * Object ID (portal 21710069):
 *   Customer Reviews → 2-35143327
 */

import { Client } from "@hubspot/api-client";
import { normalizeLocation } from "@/lib/locations";

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const hubspotClient = new Client({
  accessToken: process.env.HUBSPOT_ACCESS_TOKEN,
  numberOfApiCallRetries: 2,
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CUSTOMER_REVIEWS_OBJECT_TYPE = "2-35143327";

/** Association type ID: customer_review → deal (from schema discovery) */
const REVIEW_TO_DEAL_ASSOC_TYPE = 274;

// ---------------------------------------------------------------------------
// Rate-limit retry helper (matches hubspot-custom-objects.ts pattern)
// ---------------------------------------------------------------------------

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      const isRateLimit =
        error instanceof Error &&
        (error.message.includes("429") ||
          error.message.includes("rate") ||
          error.message.includes("secondly"));
      const statusCode = (error as { code?: number })?.code;

      if ((isRateLimit || statusCode === 429) && attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt + 1) * 550 + Math.random() * 400;
        console.log(
          `[HubSpot Customer Reviews] Rate limited (attempt ${attempt + 1}), retrying in ${Math.round(delay)}ms...`
        );
        await sleep(delay);
        continue;
      }
      throw error;
    }
  }
  throw new Error("Max retries exceeded");
}

// ---------------------------------------------------------------------------
// Fetch 5-star reviews for a month
// ---------------------------------------------------------------------------

interface ReviewWithDeal {
  reviewId: string;
  dealId: string | null;
}

/**
 * Fetch all 5-star reviews with `date_of_review` in the given month.
 * Returns review IDs paired with their associated deal IDs (if any).
 *
 * Uses the HubSpot search API with pagination (max 200 per page).
 * Reviews are associated with deals via association type 274.
 */
export async function fetchFiveStarReviewsForMonth(
  month: number,
  year: number
): Promise<ReviewWithDeal[]> {
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 1));

  const results: ReviewWithDeal[] = [];
  let after: string | undefined;

  do {
    const response = await withRetry(() =>
      hubspotClient.apiRequest({
        method: "POST",
        path: `/crm/v3/objects/${CUSTOMER_REVIEWS_OBJECT_TYPE}/search`,
        body: {
          filterGroups: [
            {
              filters: [
                { propertyName: "star_rating", operator: "EQ", value: "5" },
                { propertyName: "date_of_review", operator: "GTE", value: String(monthStart.getTime()) },
                { propertyName: "date_of_review", operator: "LT", value: String(monthEnd.getTime()) },
              ],
            },
          ],
          properties: ["review_name", "star_rating", "date_of_review"],
          limit: 200,
          ...(after ? { after } : {}),
        },
      }).then((r) => r.json())
    );

    for (const record of response.results ?? []) {
      results.push({ reviewId: record.id, dealId: null });
    }

    after = response.paging?.next?.after;
  } while (after);

  return results;
}

// ---------------------------------------------------------------------------
// Resolve review → deal → location
// ---------------------------------------------------------------------------

/**
 * For each review, resolve the associated deal and read its `pb_location`.
 * Returns a Map of reviewId → canonical location name.
 *
 * Reviews with no deal association are omitted from the result.
 */
export async function resolveReviewLocations(
  reviews: ReviewWithDeal[]
): Promise<Map<string, string>> {
  const locationMap = new Map<string, string>();
  if (!reviews.length) return locationMap;

  // Step 1: Batch-resolve review → deal associations
  // Process in chunks of 20 to avoid overwhelming the API
  const CHUNK_SIZE = 20;
  const dealIds = new Map<string, string>(); // reviewId → dealId

  for (let i = 0; i < reviews.length; i += CHUNK_SIZE) {
    const chunk = reviews.slice(i, i + CHUNK_SIZE);

    for (const review of chunk) {
      try {
        const associations = await withRetry(() =>
          hubspotClient.crm.associations.v4.basicApi.getPage(
            CUSTOMER_REVIEWS_OBJECT_TYPE,
            review.reviewId,
            "deals"
          )
        );

        // Take the first deal association
        const firstDeal = associations.results?.find((a) =>
          a.associationTypes?.some((t) => t.typeId === REVIEW_TO_DEAL_ASSOC_TYPE)
        );

        if (firstDeal) {
          dealIds.set(review.reviewId, firstDeal.toObjectId.toString());
        }
      } catch (err) {
        console.error(`[customer-reviews] Failed to resolve associations for review ${review.reviewId}:`, err);
      }
    }

    // Small delay between chunks to respect rate limits
    if (i + CHUNK_SIZE < reviews.length) {
      await sleep(120);
    }
  }

  // Step 2: Batch-read deal pb_location values
  const uniqueDealIds = [...new Set(dealIds.values())];
  const dealLocationMap = new Map<string, string>(); // dealId → canonical location

  // Batch read in groups of 100 (HubSpot batch limit)
  for (let i = 0; i < uniqueDealIds.length; i += 100) {
    const batch = uniqueDealIds.slice(i, i + 100);

    try {
      const response = await withRetry(() =>
        hubspotClient.crm.deals.batchApi.read({
          inputs: batch.map((id) => ({ id })),
          properties: ["pb_location"],
          propertiesWithHistory: [],
        })
      );

      for (const deal of response.results ?? []) {
        const canonical = normalizeLocation(deal.properties?.pb_location);
        if (canonical) {
          dealLocationMap.set(deal.id, canonical);
        }
      }
    } catch (err) {
      console.error(`[customer-reviews] Failed to batch-read deals:`, err);
    }
  }

  // Step 3: Map review → location via deal
  for (const [reviewId, dealId] of dealIds) {
    const loc = dealLocationMap.get(dealId);
    if (loc) {
      locationMap.set(reviewId, loc);
    }
  }

  return locationMap;
}
