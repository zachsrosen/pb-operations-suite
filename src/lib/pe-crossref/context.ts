/**
 * PE Cross-Reference — context builder.
 *
 * Runs every extractor in parallel and assembles the CrossRefContext that
 * analyzers consume. Each extractor is wrapped in try/catch — failures null
 * out their slot and the analyzer no-ops.
 *
 * In Chunk 1 most extractors are stubs. Each subsequent chunk replaces a
 * stub with a real extractor.
 */

import { resolvePEDeal, buildFolderMap } from "@/lib/pe-turnover";
import { scanM1MonitoringFolder } from "@/lib/pe-crossref/extractors/monitoring-folder";
import type { CrossRefContext } from "@/lib/pe-crossref/types";

export interface ContextBuildResult {
  context: CrossRefContext;
  extractorResults: Record<string, "ok" | string>;
}

export async function buildCrossRefContext(dealId: string): Promise<ContextBuildResult> {
  const deal = await resolvePEDeal(dealId);
  const extractorResults: Record<string, "ok" | string> = {};

  // Folder map — needed to locate Installation (folder 5) where the
  // PowerHub monitoring screenshot lives per the reference doc.
  let installFolderId: string | null = null;
  if (deal.rootFolderId) {
    try {
      const fm = await buildFolderMap(deal.rootFolderId);
      installFolderId = fm.byPrefix.get("5") ?? null;
      extractorResults.folderMap = "ok";
    } catch (err) {
      extractorResults.folderMap = `error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // Extractors that have real implementations get called here; the rest stay
  // null. Each is independent — Promise.all parallelism.
  const [monitoringFolder] = await Promise.all([
    scanM1MonitoringFolder(installFolderId)
      .then((r) => {
        extractorResults.monitoringFolder = "ok";
        return r;
      })
      .catch((err) => {
        extractorResults.monitoringFolder = `error: ${err instanceof Error ? err.message : String(err)}`;
        return null;
      }),
  ]);

  return {
    extractorResults,
    context: {
      deal,
      planset: null,
      salesOrder: null,
      powerHubAsset: null,
      installPhotos: [],
      nameplateExtractions: new Map(),
      monitoringFolder,
      latestAuditRun: null,
    },
  };
}
