/**
 * DA Rework Flags — scans HubSpot `layout_status` property history per deal
 * to derive whether the deal required customer / sales / ops rework during
 * its design-approval lifecycle.
 *
 * Used by the D&E Metrics dashboard to split "first-try" into:
 *  - Customer Approval First-Try (no "Design Rejected" in history)
 *  - Design First-Try             (da_revision_counter === 0, elsewhere)
 *  - Needed Sales Changes          (history hit "Pending Sales Changes")
 *  - Needed Ops Changes            (history hit "Pending Ops Changes")
 *
 * Results cached in `appCache` keyed by dealId + revisionCounter + approvalDate
 * so the cache self-invalidates when either changes.
 */

import { hubspotClient } from "@/lib/hubspot";
import { appCache } from "@/lib/cache";

export type DaReworkFlags = {
  hadRejection: boolean;
  hadSalesChanges: boolean;
  hadOpsChanges: boolean;
};

const REJECTED_VALUE = "Design Rejected";
const SALES_CHANGES_VALUE = "Pending Sales Changes";
const OPS_CHANGES_VALUE = "Pending Ops Changes";

const EMPTY_FLAGS: DaReworkFlags = {
  hadRejection: false,
  hadSalesChanges: false,
  hadOpsChanges: false,
};

type PropertyHistoryEntry = { value?: string };

function cacheKey(
  dealId: string,
  revisionCounter: number | null,
  approvalDate: string | null
): string {
  return `da-rework:${dealId}:${revisionCounter ?? "x"}:${approvalDate ?? "x"}`;
}

async function fetchLayoutStatusHistory(dealId: string): Promise<PropertyHistoryEntry[] | null> {
  const maxRetries = 3;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const resp = await hubspotClient.crm.deals.basicApi.getById(
        dealId,
        ["layout_status"],
        ["layout_status"],
        undefined,
        false
      );
      const history = (resp as unknown as {
        propertiesWithHistory?: Record<string, PropertyHistoryEntry[]>;
      }).propertiesWithHistory?.layout_status;
      return history ?? [];
    } catch (err: unknown) {
      const isRateLimit =
        (err instanceof Error && err.message.toLowerCase().includes("rate")) ||
        (typeof err === "object" &&
          err !== null &&
          "code" in err &&
          (err as { code?: number }).code === 429);
      if (isRateLimit && attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1100 + Math.random() * 400));
        continue;
      }
      console.error(`[da-rework-flags] history fetch failed for ${dealId}:`, err);
      return null;
    }
  }
  return null;
}

function flagsFromHistory(history: PropertyHistoryEntry[]): DaReworkFlags {
  let hadRejection = false;
  let hadSalesChanges = false;
  let hadOpsChanges = false;
  for (const entry of history) {
    if (entry.value === REJECTED_VALUE) hadRejection = true;
    else if (entry.value === SALES_CHANGES_VALUE) hadSalesChanges = true;
    else if (entry.value === OPS_CHANGES_VALUE) hadOpsChanges = true;
  }
  return { hadRejection, hadSalesChanges, hadOpsChanges };
}

/**
 * Compute rework flags for one deal. Returns EMPTY_FLAGS (all false) if the
 * history fetch fails — callers can distinguish by checking logs but the
 * dashboard treats failure as "no rework" conservatively.
 *
 * Failure path is intentionally uncached: fetcher throws, `appCache` skips
 * the `.set` on rejection, wrapper returns EMPTY_FLAGS without poisoning
 * the cache. Next call retries.
 */
export async function getDaReworkFlags(
  dealId: string,
  revisionCounter: number | null,
  approvalDate: string | null
): Promise<DaReworkFlags> {
  const key = cacheKey(dealId, revisionCounter, approvalDate);
  try {
    const { data } = await appCache.getOrFetch<DaReworkFlags>(key, async () => {
      const history = await fetchLayoutStatusHistory(dealId);
      if (!history) throw new Error(`da-rework-flags: history fetch returned null for ${dealId}`);
      return flagsFromHistory(history);
    });
    return data;
  } catch {
    return EMPTY_FLAGS;
  }
}

/**
 * Batch helper: computes flags for many deals with bounded concurrency so we
 * don't burst the HubSpot rate limiter. Returns a map keyed by dealId.
 */
export async function getDaReworkFlagsBatch(
  deals: Array<{ dealId: string; revisionCounter: number | null; approvalDate: string | null }>,
  concurrency = 10
): Promise<Record<string, DaReworkFlags>> {
  const out: Record<string, DaReworkFlags> = {};
  for (let i = 0; i < deals.length; i += concurrency) {
    const batch = deals.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map((d) =>
        getDaReworkFlags(d.dealId, d.revisionCounter, d.approvalDate).then((flags) => ({
          dealId: d.dealId,
          flags,
        }))
      )
    );
    for (const { dealId, flags } of results) {
      out[dealId] = flags;
    }
    // Small inter-batch pause to smooth out sustained load
    if (i + concurrency < deals.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return out;
}
