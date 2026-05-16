import { prisma } from "@/lib/db";
import {
  type ChecklistItem,
  type ChecklistResult,
  type Milestone,
  type TurnoverAuditResult,
  PE_M1_CHECKLIST,
  PE_M2_CHECKLIST,
  filterChecklist,
  resolvePEDeal,
  buildFolderMap,
  buildAuditResult,
  resolveCombinedFiles,
} from "@/lib/pe-turnover";
import {
  classifyDocument,
  verifyPhoto,
  visionResultToEnriched,
  type VisionFileInput,
} from "@/lib/pe-vision-classifier";
import {
  discoverPeTemplateIds,
  findPeDocsForDeal,
  downloadPandaDocPdf,
  type PeTemplateKey,
  type PeTemplateStatus,
} from "@/lib/pandadoc";
import {
  downloadDriveFile,
  downloadDriveImage,
  listDriveFiles,
  listDriveSubfolders,
  listDriveImagesRecursive,
  uploadDriveBinaryFile,
  createDriveFolder,
  type DriveGenericFile,
} from "@/lib/drive-plansets";

// ---------------------------------------------------------------------------
// SSE event types
// ---------------------------------------------------------------------------

export type AuditEvent =
  | { type: "started"; data: { milestone: string; systemType: string; totalItems: number } }
  | { type: "progress"; data: { itemId: string; label: string; status: string; file?: string; issues?: string[] } }
  | { type: "pandadoc"; data: { key: string; status: string; action: string } }
  | { type: "completed"; data: { auditRunId: string; summary: TurnoverAuditResult["summary"] } }
  | { type: "error"; data: { message: string } };

export interface AuditRunOptions {
  dealId: string;
  milestone?: Milestone;
  triggeredBy: string;
  onEvent?: (event: AuditEvent) => void;
}

// ---------------------------------------------------------------------------
// PE folder resolution — find or create "Participate Energy/" folder
// ---------------------------------------------------------------------------

async function findOrCreatePeFolder(rootFolderId: string): Promise<string> {
  const subfolders = await listDriveSubfolders(rootFolderId);
  const peFolders = subfolders.filter((f) =>
    f.name.toLowerCase().includes("participate energy")
  );

  if (peFolders.length === 1) return peFolders[0].id;

  if (peFolders.length > 1) {
    return peFolders[peFolders.length - 1].id;
  }

  const folder = await createDriveFolder(rootFolderId, "Participate Energy");
  return folder.id;
}

// ---------------------------------------------------------------------------
// PandaDoc pull — download completed docs into GDrive PE folder
// ---------------------------------------------------------------------------

const PANDADOC_KEY_TO_CHECKLIST: Record<PeTemplateKey, string> = {
  attestation: "m1.post_install.attestation",
  acceptance: "m1.post_install.acceptance",
  progress_waiver: "m1.lien.conditional",
  final_waiver: "m2.lien.final",
};

const PANDADOC_FILENAMES: Record<PeTemplateKey, string> = {
  attestation: "PE_Installer_Attestation.pdf",
  acceptance: "PE_Customer_Acceptance.pdf",
  progress_waiver: "PE_Progress_Lien_Waiver.pdf",
  final_waiver: "PE_Final_Lien_Waiver.pdf",
};

interface PandaDocPullResult {
  statuses: PeTemplateStatus[];
  checklistOverrides: Map<string, ChecklistResult>;
  pulled: number;
}

async function pullPandaDocs(
  dealId: string,
  peFolderId: string,
  onEvent?: (event: AuditEvent) => void,
): Promise<PandaDocPullResult> {
  const checklistOverrides = new Map<string, ChecklistResult>();
  let pulled = 0;

  let templateIds: Record<PeTemplateKey, string | null>;
  try {
    templateIds = await discoverPeTemplateIds();
  } catch {
    onEvent?.({ type: "pandadoc", data: { key: "all", status: "error", action: "Template discovery failed" } });
    return { statuses: [], checklistOverrides, pulled };
  }

  const statuses = await findPeDocsForDeal(dealId, templateIds);

  for (const status of statuses) {
    const checklistId = PANDADOC_KEY_TO_CHECKLIST[status.key];
    if (!checklistId) continue;

    if (!status.document) {
      onEvent?.({ type: "pandadoc", data: { key: status.key, status: "missing", action: "Create PandaDoc from template" } });
      continue;
    }

    if (status.document.status === "completed") {
      try {
        const pdfBuffer = await downloadPandaDocPdf(status.document.id);
        const fileName = PANDADOC_FILENAMES[status.key];
        await uploadDriveBinaryFile(peFolderId, fileName, pdfBuffer, "application/pdf");
        pulled++;

        onEvent?.({ type: "pandadoc", data: { key: status.key, status: "downloaded", action: "Downloaded to GDrive" } });

        checklistOverrides.set(checklistId, {
          item: {} as ChecklistItem,
          status: "found",
          statusNote: `PandaDoc (downloaded ${new Date().toISOString().slice(0, 10)})`,
          foundFile: {
            name: fileName,
            id: "",
            url: `https://app.pandadoc.com/a/#/documents/${status.document.id}`,
            modifiedTime: new Date().toISOString(),
            size: pdfBuffer.length,
          },
        });
      } catch (err) {
        onEvent?.({ type: "pandadoc", data: { key: status.key, status: "error", action: `Download failed: ${err instanceof Error ? err.message : String(err)}` } });
      }
    } else {
      const friendlyStatus = status.document.status === "sent" ? "Sent, awaiting signature" : `Status: ${status.document.status}`;
      onEvent?.({ type: "pandadoc", data: { key: status.key, status: "pending", action: friendlyStatus } });
    }
  }

  return { statuses, checklistOverrides, pulled };
}

// ---------------------------------------------------------------------------
// Vision audit — classify files and photos
// ---------------------------------------------------------------------------

async function collectCandidateFiles(
  folderMap: Map<string, string>,
  allFolderIds: string[],
  item: ChecklistItem,
  installPhotos: DriveGenericFile[],
): Promise<DriveGenericFile[]> {
  if (item.isPhoto) {
    const files = [...installPhotos];
    if (item.pePhotoNumber === 6) {
      for (const prefix of item.driveFolders) {
        const fid = folderMap.get(prefix);
        if (fid) {
          try { files.push(...await listDriveFiles(fid)); } catch {}
        }
      }
    }
    return files;
  }

  if (item.searchAllFolders) {
    const allFiles: DriveGenericFile[] = [];
    for (const fid of allFolderIds) {
      try { allFiles.push(...await listDriveFiles(fid)); } catch {}
    }
    return allFiles;
  }

  const files: DriveGenericFile[] = [];
  for (const prefix of item.driveFolders) {
    const fid = folderMap.get(prefix);
    if (fid) {
      try { files.push(...await listDriveFiles(fid)); } catch {}
    }
  }
  return files;
}

async function downloadFileForVision(file: DriveGenericFile): Promise<VisionFileInput | null> {
  try {
    if (file.mimeType.startsWith("image/")) {
      const result = await downloadDriveImage(file.id);
      return {
        fileId: file.id,
        fileName: file.name,
        mimeType: result.mimeType,
        buffer: result.buffer,
      };
    }
    const result = await downloadDriveFile(file.id);
    return {
      fileId: file.id,
      fileName: result.filename,
      mimeType: result.mimeType,
      buffer: result.buffer,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main audit orchestrator
// ---------------------------------------------------------------------------

export async function runPeAudit(opts: AuditRunOptions): Promise<string> {
  const { dealId, triggeredBy, onEvent } = opts;
  const startTime = Date.now();

  const existing = await prisma.peAuditRun.findFirst({
    where: { dealId, status: "running" },
    orderBy: { startedAt: "desc" },
  });

  if (existing) {
    const age = Date.now() - existing.startedAt.getTime();
    if (age < 5 * 60 * 1000) {
      throw new Error(`Audit already running for deal ${dealId} (started ${Math.round(age / 1000)}s ago)`);
    }
    await prisma.peAuditRun.update({
      where: { id: existing.id },
      data: { status: "failed", completedAt: new Date() },
    });
  }

  const deal = await resolvePEDeal(dealId);
  const milestone = opts.milestone ?? "m1";

  const auditRun = await prisma.peAuditRun.create({
    data: {
      dealId,
      dealName: deal.dealName,
      milestone,
      systemType: deal.systemType,
      status: "running",
      triggeredBy,
    },
  });

  try {
    const checklist = filterChecklist(
      milestone === "m1" ? PE_M1_CHECKLIST : PE_M2_CHECKLIST,
      deal.systemType,
    );

    onEvent?.({
      type: "started",
      data: { milestone, systemType: deal.systemType, totalItems: checklist.length },
    });

    let folderByPrefix = new Map<string, string>();
    let allFolderIds: string[] = [];
    if (deal.rootFolderId) {
      const fm = await buildFolderMap(deal.rootFolderId);
      folderByPrefix = fm.byPrefix;
      allFolderIds = fm.allFolderIds;
    }

    let pandadocOverrides = new Map<string, ChecklistResult>();
    let pandadocPulled = 0;
    if (deal.rootFolderId && process.env.PANDADOC_PE_TEMPLATES_ENABLED === "true") {
      const peFolderId = await findOrCreatePeFolder(deal.rootFolderId);
      const pandaResult = await pullPandaDocs(dealId, peFolderId, onEvent);
      pandadocOverrides = pandaResult.checklistOverrides;
      pandadocPulled = pandaResult.pulled;
    }

    let installPhotos: DriveGenericFile[] = [];
    const installFolderId = folderByPrefix.get("5");
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

    const results: ChecklistResult[] = [];
    let visionCallCount = 0;

    const BATCH_SIZE = 5;
    for (let i = 0; i < checklist.length; i += BATCH_SIZE) {
      const batch = checklist.slice(i, i + BATCH_SIZE);

      const batchPromises = batch.map(async (item): Promise<ChecklistResult> => {
        const override = pandadocOverrides.get(item.id);
        if (override) {
          override.item = item;
          onEvent?.({
            type: "progress",
            data: { itemId: item.id, label: item.label, status: "found", file: override.foundFile?.name },
          });
          return override;
        }

        const candidates = await collectCandidateFiles(folderByPrefix, allFolderIds, item, installPhotos);
        if (candidates.length === 0) {
          onEvent?.({
            type: "progress",
            data: { itemId: item.id, label: item.label, status: "missing" },
          });
          return { item, status: "missing" as const };
        }

        if (item.isPhoto) {
          const imageCandidates = candidates
            .filter((f) => f.mimeType.startsWith("image/"))
            .slice(0, 3);

          for (const candidate of imageCandidates) {
            const input = await downloadFileForVision(candidate);
            if (!input) continue;

            visionCallCount++;
            const vResult = await verifyPhoto(input, item);
            const enriched = visionResultToEnriched(vResult);

            if (enriched && enriched.status === "pass") {
              onEvent?.({
                type: "progress",
                data: { itemId: item.id, label: item.label, status: "found", file: candidate.name },
              });
              return {
                item,
                status: "found",
                foundFile: {
                  name: candidate.name,
                  id: candidate.id,
                  url: `https://drive.google.com/file/d/${candidate.id}/view`,
                  modifiedTime: candidate.modifiedTime,
                  size: parseInt(candidate.size ?? "0", 10),
                },
                visionResult: enriched,
              };
            }
          }

          onEvent?.({
            type: "progress",
            data: { itemId: item.id, label: item.label, status: "missing" },
          });
          return { item, status: "missing" };
        }

        for (const candidate of candidates.slice(0, 8)) {
          const input = await downloadFileForVision(candidate);
          if (!input) continue;

          visionCallCount++;
          const vResult = await classifyDocument(input, checklist);
          if (vResult.kind !== "document") continue;

          const matched = vResult.classification.matchedChecklistIds.includes(item.id);
          if (!matched) continue;

          const enriched = visionResultToEnriched(vResult);
          const status = enriched?.status === "fail" ? "needs_review" as const : "found" as const;

          onEvent?.({
            type: "progress",
            data: {
              itemId: item.id,
              label: item.label,
              status,
              file: candidate.name,
              issues: enriched?.issues,
            },
          });

          return {
            item,
            status,
            foundFile: {
              name: candidate.name,
              id: candidate.id,
              url: `https://drive.google.com/file/d/${candidate.id}/view`,
              modifiedTime: candidate.modifiedTime,
              size: parseInt(candidate.size ?? "0", 10),
            },
            visionResult: enriched ?? undefined,
          };
        }

        onEvent?.({
          type: "progress",
          data: { itemId: item.id, label: item.label, status: "missing" },
        });
        return { item, status: "missing" };
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    const resolved = resolveCombinedFiles(results);

    const peStatus = milestone === "m1" ? deal.peM1Status : deal.peM2Status;
    const auditResult = buildAuditResult({
      dealId,
      dealName: deal.dealName,
      address: deal.address,
      systemType: deal.systemType,
      milestone,
      peStatus,
      results: resolved,
    });

    const durationMs = Date.now() - startTime;

    await prisma.peAuditRun.update({
      where: { id: auditRun.id },
      data: {
        status: "completed",
        completedAt: new Date(),
        durationMs,
        visionCallCount,
        pandadocPulled,
        results: JSON.parse(JSON.stringify(auditResult.categories)),
        summary: JSON.parse(JSON.stringify(auditResult.summary)),
      },
    });

    onEvent?.({
      type: "completed",
      data: { auditRunId: auditRun.id, summary: auditResult.summary },
    });

    return auditRun.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await prisma.peAuditRun.update({
      where: { id: auditRun.id },
      data: {
        status: "failed",
        completedAt: new Date(),
        durationMs: Date.now() - startTime,
        summary: { error: message },
      },
    });

    onEvent?.({ type: "error", data: { message } });
    throw err;
  }
}

export { assemblePackage } from "@/lib/pe-turnover";
