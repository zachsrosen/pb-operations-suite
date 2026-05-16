/**
 * PE Reference Library — curates approved PE submission files as few-shot
 * examples for the vision classifier.
 *
 * Finds deals with pe_m1_status or pe_m2_status = "Paid", resolves their
 * GDrive folders, and caches one exemplar file per checklist item.
 * The cached Anthropic file ID is included in classification prompts so
 * Claude sees a real approved example alongside the candidate file.
 */

import { prisma } from "@/lib/db";
import { searchWithRetry } from "@/lib/hubspot";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import {
  type ChecklistItem,
  type Milestone,
  PE_M1_CHECKLIST,
  PE_M2_CHECKLIST,
  filterChecklist,
  resolvePEDeal,
  buildFolderMap,
} from "@/lib/pe-turnover";
import {
  listDriveFiles,
  listDriveImagesRecursive,
  downloadDriveFile,
  downloadDriveImage,
  type DriveGenericFile,
} from "@/lib/drive-plansets";
import { getAnthropicClient } from "@/lib/anthropic";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReferenceExample {
  checklistItemId: string;
  anthropicFileId: string;
  driveFileName: string;
  mimeType: string;
  sourceDealName: string;
}

// ---------------------------------------------------------------------------
// Find approved PE deals from HubSpot
// ---------------------------------------------------------------------------

async function findApprovedDeals(milestone: Milestone, limit = 5): Promise<string[]> {
  const statusProp = milestone === "m1" ? "pe_m1_status" : "pe_m2_status";

  const result = await searchWithRetry({
    filterGroups: [{
      filters: [
        { propertyName: "is_participate_energy", operator: FilterOperatorEnum.Eq, value: "true" },
        { propertyName: statusProp, operator: FilterOperatorEnum.Eq, value: "Paid" },
      ],
    }],
    properties: ["dealname", "all_document_parent_folder_id", "g_drive"],
    sorts: ["hs_lastmodifieddate"],
    limit,
  });

  return (result.results ?? []).map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Substring-based file matching (lightweight, no vision needed for known-good)
// ---------------------------------------------------------------------------

function matchFileToItem(file: DriveGenericFile, item: ChecklistItem): boolean {
  if (!item.fileHints || item.fileHints.length === 0) return false;
  const normalized = file.name.toLowerCase().replace(/[_\-]/g, " ");
  return item.fileHints.some((hint) => normalized.includes(hint.toLowerCase()));
}

// ---------------------------------------------------------------------------
// Build reference set for one approved deal
// ---------------------------------------------------------------------------

async function harvestReferencesFromDeal(
  dealId: string,
  milestone: Milestone,
  needed: Set<string>,
): Promise<Map<string, { file: DriveGenericFile; item: ChecklistItem }>> {
  const found = new Map<string, { file: DriveGenericFile; item: ChecklistItem }>();

  let deal;
  try {
    deal = await resolvePEDeal(dealId);
  } catch {
    return found;
  }

  if (!deal.rootFolderId) return found;

  const fm = await buildFolderMap(deal.rootFolderId);
  const checklist = filterChecklist(
    milestone === "m1" ? PE_M1_CHECKLIST : PE_M2_CHECKLIST,
    deal.systemType,
  );

  let installPhotos: DriveGenericFile[] = [];
  const installFolderId = fm.byPrefix.get("5");
  if (installFolderId) {
    try {
      const images = await listDriveImagesRecursive(installFolderId, 3, 50);
      installPhotos = images.map((img) => ({
        id: img.id,
        name: img.name,
        mimeType: img.mimeType,
        modifiedTime: img.modifiedTime,
        size: img.size,
      }));
    } catch {}
  }

  for (const item of checklist) {
    if (!needed.has(item.id)) continue;

    let candidates: DriveGenericFile[] = [];

    if (item.isPhoto) {
      candidates = installPhotos.filter((f) => f.mimeType.startsWith("image/"));
    } else if (item.searchAllFolders) {
      for (const fid of fm.allFolderIds) {
        try { candidates.push(...await listDriveFiles(fid)); } catch {}
      }
    } else {
      for (const prefix of item.driveFolders) {
        const fid = fm.byPrefix.get(prefix);
        if (fid) {
          try { candidates.push(...await listDriveFiles(fid)); } catch {}
        }
      }
    }

    const match = candidates.find((f) => matchFileToItem(f, item));
    if (match) {
      found.set(item.id, { file: match, item });
    }
  }

  return found;
}

// ---------------------------------------------------------------------------
// Upload to Anthropic Files API (with expiry tracking)
// ---------------------------------------------------------------------------

const ANTHROPIC_FILE_TTL_MS = 23 * 60 * 60 * 1000; // 23 hours (files expire in 24h)

async function ensureAnthropicFileId(ref: {
  id: string;
  driveFileId: string;
  driveFileName: string;
  mimeType: string;
  anthropicFileId: string | null;
  anthropicFileExpiry: Date | null;
}): Promise<string | null> {
  if (ref.anthropicFileId && ref.anthropicFileExpiry && ref.anthropicFileExpiry > new Date()) {
    return ref.anthropicFileId;
  }

  try {
    const isImage = ref.mimeType.startsWith("image/");
    const downloaded = isImage
      ? await downloadDriveImage(ref.driveFileId)
      : await downloadDriveFile(ref.driveFileId);

    const client = getAnthropicClient();
    const file = await client.beta.files.upload({
      file: new File(
        [new Uint8Array(downloaded.buffer)],
        ref.driveFileName,
        { type: downloaded.mimeType },
      ),
    });

    await prisma.peReferenceDoc.update({
      where: { id: ref.id },
      data: {
        anthropicFileId: file.id,
        anthropicFileExpiry: new Date(Date.now() + ANTHROPIC_FILE_TTL_MS),
      },
    });

    return file.id;
  } catch (err) {
    console.warn(`[pe-reference] Failed to upload reference ${ref.driveFileName}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Populate the reference library for a milestone by scanning approved deals.
 * Idempotent — only fills gaps where no reference exists yet.
 */
export async function populateReferenceLibrary(milestone: Milestone): Promise<number> {
  const checklist = milestone === "m1" ? PE_M1_CHECKLIST : PE_M2_CHECKLIST;

  const existing = await prisma.peReferenceDoc.findMany({
    where: { milestone },
    select: { checklistItemId: true },
  });
  const existingIds = new Set(existing.map((e) => e.checklistItemId));
  const needed = new Set(checklist.map((i) => i.id).filter((id) => !existingIds.has(id)));

  if (needed.size === 0) return 0;

  const dealIds = await findApprovedDeals(milestone);
  let populated = 0;

  for (const dealId of dealIds) {
    if (needed.size === 0) break;

    const refs = await harvestReferencesFromDeal(dealId, milestone, needed);

    let dealName = "";
    try {
      const deal = await resolvePEDeal(dealId);
      dealName = deal.dealName;
    } catch {}

    for (const [itemId, { file, item }] of refs) {
      await prisma.peReferenceDoc.upsert({
        where: { checklistItemId_milestone: { checklistItemId: itemId, milestone } },
        create: {
          checklistItemId: itemId,
          sourceDealId: dealId,
          sourceDealName: dealName,
          driveFileId: file.id,
          driveFileName: file.name,
          mimeType: file.mimeType,
          milestone,
          category: item.category,
          isPhoto: item.isPhoto,
        },
        update: {
          sourceDealId: dealId,
          sourceDealName: dealName,
          driveFileId: file.id,
          driveFileName: file.name,
          mimeType: file.mimeType,
        },
      });

      needed.delete(itemId);
      populated++;
    }
  }

  return populated;
}

/**
 * Get reference examples for vision classification.
 * Returns Anthropic file IDs for each checklist item that has a reference.
 * Uploads to Anthropic Files API on-demand (cached for ~23 hours).
 */
export async function getReferenceExamples(
  milestone: Milestone,
  checklistItemIds: string[],
): Promise<Map<string, ReferenceExample>> {
  const refs = await prisma.peReferenceDoc.findMany({
    where: {
      milestone,
      checklistItemId: { in: checklistItemIds },
    },
  });

  const result = new Map<string, ReferenceExample>();

  for (const ref of refs) {
    const anthropicFileId = await ensureAnthropicFileId(ref);
    if (!anthropicFileId) continue;

    result.set(ref.checklistItemId, {
      checklistItemId: ref.checklistItemId,
      anthropicFileId,
      driveFileName: ref.driveFileName,
      mimeType: ref.mimeType,
      sourceDealName: ref.sourceDealName,
    });
  }

  return result;
}
