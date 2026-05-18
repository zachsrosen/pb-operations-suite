/**
 * PE Cross-Reference — context builder.
 *
 * Runs every extractor in parallel and assembles the CrossRefContext that
 * analyzers consume. Each extractor is wrapped in try/catch — failures null
 * out their slot and the analyzer no-ops.
 *
 * In Chunk 1 (foundation) most extractors are stubs returning null. Subsequent
 * chunks (Monitoring, Hardware, SalesOrder, Planset) replace each stub with a
 * real extractor.
 */

import { resolvePEDeal } from "@/lib/pe-turnover";
import type { CrossRefContext } from "@/lib/pe-crossref/types";

export interface ContextBuildResult {
  context: CrossRefContext;
  extractorResults: Record<string, "ok" | string>;
}

export async function buildCrossRefContext(dealId: string): Promise<ContextBuildResult> {
  const deal = await resolvePEDeal(dealId);
  const extractorResults: Record<string, "ok" | string> = {};

  return {
    extractorResults,
    context: {
      deal,
      planset: null,
      salesOrder: null,
      powerHubAsset: null,
      installPhotos: [],
      nameplateExtractions: new Map(),
      monitoringFolder: null,
      latestAuditRun: null,
    },
  };
}
