// src/lib/idr-bom-extract.ts
//
// BOM extraction orchestration for IDR meeting items.
// Flow: folder URL -> folder ID -> planset search -> download -> Claude extraction -> save snapshot.
// Used by session prep (fire-and-forget) and on-demand (awaited).

import { extractFolderId, listPlansetPdfs, pickBestPlanset, downloadDrivePdf } from "@/lib/drive-plansets";
import { extractBomFromPdf } from "@/lib/bom-extract";
import { saveBomSnapshot, type BomData } from "@/lib/bom-snapshot";
import type { ActorContext } from "@/lib/actor-context";

export type BomExtractionStatus = "idle" | "pending" | "extracting" | "ready" | "failed";

export interface BomExtractionResult {
  status: BomExtractionStatus;
  snapshotId?: string;
  error?: string;
  itemCount?: number;
}

/**
 * Run BOM extraction for a deal: find planset in design folder, extract via Claude,
 * and save as a ProjectBomSnapshot.
 *
 * Used by:
 * - Session prep (fire-and-forget for IDR items)
 * - On-demand button (awaited for escalations)
 */
export async function extractBomForDeal(params: {
  dealId: string;
  dealName: string;
  designFolderUrl: string | null;
  actor: ActorContext;
}): Promise<BomExtractionResult> {
  const { dealId, dealName, designFolderUrl, actor } = params;

  // Step 1: Validate folder URL
  if (!designFolderUrl) {
    return { status: "failed", error: "No design folder linked to deal" };
  }

  const folderId = extractFolderId(designFolderUrl);
  if (!folderId) {
    return { status: "failed", error: "Cannot parse folder ID from design folder URL" };
  }

  // Step 2: Find planset PDF
  let files;
  try {
    files = await listPlansetPdfs(folderId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("403") || msg.includes("forbidden")) {
      return { status: "failed", error: "Drive access denied - check service account permissions" };
    }
    return { status: "failed", error: `Failed to list drive files: ${msg.slice(0, 200)}` };
  }

  const planset = pickBestPlanset(files);
  if (!planset) {
    return { status: "failed", error: "No planset PDF found in design folder" };
  }

  // Step 3: Download
  let buffer: Buffer;
  let filename: string;
  try {
    const downloaded = await downloadDrivePdf(planset.id);
    buffer = downloaded.buffer;
    filename = downloaded.filename;
  } catch (err) {
    return { status: "failed", error: `Failed to download planset: ${(err as Error).message?.slice(0, 200)}` };
  }

  // Step 4: Extract BOM via Claude
  let bomResult;
  try {
    bomResult = await extractBomFromPdf(buffer, filename, actor);
  } catch (err) {
    return { status: "failed", error: `BOM extraction failed: ${(err as Error).message?.slice(0, 200)}` };
  }

  // Cast the untyped bom record to BomData
  const bomPayload = bomResult?.bom as BomData | undefined;
  if (!bomPayload?.items || bomPayload.items.length === 0) {
    return { status: "failed", error: "Extraction returned no items" };
  }

  // Step 5: Save snapshot
  const bomData: BomData = {
    project: bomPayload.project ?? {},
    items: bomPayload.items,
    validation: bomPayload.validation,
  };

  try {
    const snapshot = await saveBomSnapshot({
      dealId,
      dealName,
      bomData,
      sourceFile: filename,
      actor,
    });

    return {
      status: "ready",
      snapshotId: snapshot.id,
      itemCount: bomPayload.items.length,
    };
  } catch (err) {
    return { status: "failed", error: `Failed to save snapshot: ${(err as Error).message?.slice(0, 200)}` };
  }
}
