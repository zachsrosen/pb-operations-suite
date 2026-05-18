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
  triagePhotoBatch,
  uploadToAnthropic,
  visionResultToEnriched,
  type VisionFileInput,
  type VisionResult,
  type EnrichedVisionResult,
  type ClassifyOptions,
} from "@/lib/pe-vision-classifier";
// Reference library disabled — classification cache is per-file (not per-item),
// so item-specific reference examples don't apply to the dedup'd workflow.
// import { populateReferenceLibrary, getReferenceExamples, type ReferenceExample } from "@/lib/pe-reference-library";
import { getAvl } from "@/lib/pe-avl";
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
import { zuper } from "@/lib/zuper";

// ---------------------------------------------------------------------------
// Unified install photo source — supports GDrive folder 5 AND Zuper job photos
// (attachments + form submissions where field techs upload their install pics)
// ---------------------------------------------------------------------------

export type InstallPhoto =
  | {
      source: "drive";
      key: string; // synthetic photoKey used by triage/lookup
      driveId: string;
      name: string;
      mimeType: string;
      modifiedTime?: string;
      size?: string;
    }
  | {
      source: "zuper";
      key: string;
      jobUid: string;
      attachmentUid: string;
      url: string; // S3 URL — fetched via zuper.downloadFile
      name: string;
      mimeType: string;
      createdAt?: string;
    };

function buildZuperPhotoKey(jobUid: string, attachmentUid: string): string {
  return `zuper:${jobUid}:${attachmentUid}`;
}

function buildDrivePhotoKey(driveId: string): string {
  return `drive:${driveId}`;
}

// ---------------------------------------------------------------------------
// SSE event types
// ---------------------------------------------------------------------------

export type AuditEvent =
  | { type: "started"; data: { milestone: string; systemType: string; totalItems: number } }
  | { type: "progress"; data: { itemId: string; label: string; status: string; file?: string; issues?: string[] } }
  | { type: "pandadoc"; data: { key: string; status: string; action: string } }
  | { type: "diagnostic"; data: { message: string } }
  | { type: "completed"; data: { auditRunId: string; summary: TurnoverAuditResult["summary"] } }
  | { type: "error"; data: { message: string } };

/**
 * Audit mode:
 * - "full": classify both docs and photos (default).
 * - "docs": skip photo pre-upload + triage. Use when waiting on PandaDoc
 *   signatures or just refreshing doc statuses. Saves ~30-90s.
 * - "photos": skip doc classification loop. Use when PM re-uploaded photos
 *   to Zuper and just wants fresh triage verdicts. Saves ~30-90s.
 *
 * Either single mode runs within its own 5-min Vercel budget. The UI's
 * "Run Full Audit" button fires `mode: "docs"` AND `mode: "photos"` in
 * parallel as two separate SSE streams for redundancy + max wall-clock
 * parallelism.
 */
export type AuditMode = "full" | "docs" | "photos";

export interface AuditRunOptions {
  dealId: string;
  milestone?: Milestone;
  mode?: AuditMode;
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

// Each PandaDoc template key can override one OR MORE checklist items.
// The PE_CON contract package, for example, covers customer_agreement,
// installation_order, and disclosures all in one PDF.
const PANDADOC_KEY_TO_CHECKLIST: Record<PeTemplateKey, string[]> = {
  contract: [
    "m1.contract.customer_agreement",
    "m1.contract.installation_order",
    "m1.contract.disclosures",
  ],
  attestation: ["m1.post_install.attestation"],
  acceptance: ["m1.post_install.acceptance"],
  progress_waiver: ["m1.lien.conditional"],
  final_waiver: ["m2.lien.final"],
};

const PANDADOC_FILENAMES: Record<PeTemplateKey, string> = {
  contract: "PE_Contract_Package.pdf",
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
  customerName?: string,
  onEvent?: (event: AuditEvent) => void,
): Promise<PandaDocPullResult> {
  const checklistOverrides = new Map<string, ChecklistResult>();
  let pulled = 0;

  let templateIds: Record<PeTemplateKey, string[]>;
  try {
    templateIds = await discoverPeTemplateIds();
    const found = Object.entries(templateIds).filter(([, v]) => v.length > 0).length;
    const missing = Object.entries(templateIds).filter(([, v]) => v.length === 0).map(([k]) => k);
    const totalIds = Object.values(templateIds).reduce((sum, v) => sum + v.length, 0);
    const totalKeys = Object.keys(templateIds).length;
    onEvent?.({ type: "diagnostic", data: { message: `PandaDoc templates: ${found}/${totalKeys} keys discovered (${totalIds} total IDs)${missing.length > 0 ? `, missing: ${missing.join(", ")}` : ""}` } });
  } catch (err) {
    onEvent?.({ type: "pandadoc", data: { key: "all", status: "error", action: `Template discovery failed: ${err instanceof Error ? err.message : String(err)}` } });
    return { statuses: [], checklistOverrides, pulled };
  }

  onEvent?.({ type: "diagnostic", data: { message: `PandaDoc search: dealId=${dealId}, customerName=${customerName ?? "none"}` } });
  const statuses = await findPeDocsForDeal(dealId, templateIds, customerName);

  for (const status of statuses) {
    const checklistIds = PANDADOC_KEY_TO_CHECKLIST[status.key];
    if (!checklistIds || checklistIds.length === 0) continue;

    if (!status.document) {
      onEvent?.({ type: "pandadoc", data: { key: status.key, status: "missing", action: "Create PandaDoc from template" } });
      continue;
    }

    // Download whatever exists, regardless of status. Not every PandaDoc PE
    // template gets sent for customer signature — lien waivers, for example,
    // are completed internally and stay in `draft` forever. If a document
    // exists at all, that's a strong signal it should be included in the
    // package. Per-status nuance (signed vs. internal) is handled by the
    // existing vision verification step downstream.
    try {
      const pdfBuffer = await downloadPandaDocPdf(status.document.id);
      const fileName = PANDADOC_FILENAMES[status.key];
      await uploadDriveBinaryFile(peFolderId, fileName, pdfBuffer, "application/pdf");
      pulled++;

      const docStatus = status.document.status;
      const action = docStatus === "completed"
        ? "Downloaded to GDrive"
        : `Downloaded to GDrive (status: ${docStatus})`;
      onEvent?.({ type: "pandadoc", data: { key: status.key, status: "downloaded", action } });

      const override: ChecklistResult = {
        item: {} as ChecklistItem,
        status: "found",
        statusNote: `PandaDoc ${docStatus} (downloaded ${new Date().toISOString().slice(0, 10)})`,
        foundFile: {
          name: fileName,
          id: "",
          url: `https://app.pandadoc.com/a/#/documents/${status.document.id}`,
          source: "pandadoc",
          modifiedTime: new Date().toISOString(),
          size: pdfBuffer.length,
        },
      };

      for (const checklistId of checklistIds) {
        checklistOverrides.set(checklistId, override);
      }
    } catch (err) {
      // 400-ish "document_in_invalid_state" can happen for very early
      // statuses (e.g. `uploaded` before content is rendered). Log and
      // let the GDrive folder scan have a shot at the same item.
      onEvent?.({ type: "pandadoc", data: { key: status.key, status: "error", action: `Download failed: ${err instanceof Error ? err.message : String(err)}` } });
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

/** Download bytes for either a Drive photo or a Zuper attachment. */
async function downloadPhotoForVision(photo: InstallPhoto): Promise<VisionFileInput | null> {
  try {
    if (photo.source === "drive") {
      const result = await downloadDriveImage(photo.driveId);
      return {
        fileId: photo.key,
        fileName: photo.name,
        mimeType: result.mimeType,
        buffer: result.buffer,
      };
    }
    // Zuper S3 URL — uses the Zuper API key
    const buffer = await zuper.downloadFile(photo.url);
    return {
      fileId: photo.key,
      fileName: photo.name,
      mimeType: photo.mimeType,
      buffer,
    };
  } catch (err) {
    console.warn(`[pe-audit] Failed to download photo ${photo.name}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Enumerate install photos from every Zuper job linked to a deal.
 *
 * Pulled in parallel with GDrive folder listing during pre-work. Caps prevent
 * runaway pools — service-task forms can have 100+ photos; we only need
 * enough to populate the 11 PE photo categories.
 */
const ZUPER_PHOTOS_PER_JOB_CAP = 30;
const ZUPER_PHOTOS_TOTAL_CAP = 40;

async function enumerateZuperPhotos(
  dealId: string,
): Promise<Extract<InstallPhoto, { source: "zuper" }>[]> {
  if (!zuper.isConfigured()) return [];

  const jobs = await prisma.zuperJobCache.findMany({
    where: { hubspotDealId: dealId },
    select: { jobUid: true, jobCategory: true },
  });
  if (jobs.length === 0) return [];

  const out: Extract<InstallPhoto, { source: "zuper" }>[] = [];
  const photoArrays = await Promise.all(
    jobs.map(async (job) => {
      try {
        const photos = await zuper.getJobPhotos(job.jobUid);
        return photos.slice(0, ZUPER_PHOTOS_PER_JOB_CAP).map((p) => {
          const isImage = p.file_type?.startsWith("image/") ?? true;
          return {
            source: "zuper" as const,
            key: buildZuperPhotoKey(job.jobUid, p.attachment_uid),
            jobUid: job.jobUid,
            attachmentUid: p.attachment_uid,
            url: p.url,
            name: p.file_name ?? `zuper-${p.attachment_uid}.jpg`,
            mimeType: isImage ? (p.file_type ?? "image/jpeg") : "image/jpeg",
            createdAt: p.created_at,
          };
        });
      } catch (err) {
        console.warn(`[pe-audit] Zuper photo fetch failed for job ${job.jobUid}: ${err instanceof Error ? err.message : String(err)}`);
        return [];
      }
    }),
  );
  for (const arr of photoArrays) {
    for (const p of arr) {
      if (out.length >= ZUPER_PHOTOS_TOTAL_CAP) break;
      out.push(p);
    }
  }
  return out;
}

/** Build a ChecklistResult.foundFile shape from an InstallPhoto. */
function buildFoundFileFromPhoto(photo: InstallPhoto): NonNullable<ChecklistResult["foundFile"]> {
  if (photo.source === "drive") {
    return {
      name: photo.name,
      id: photo.driveId,
      url: `https://drive.google.com/file/d/${photo.driveId}/view`,
      thumbnailUrl: `/api/pe-prep/photo/drive/${encodeURIComponent(photo.driveId)}`,
      source: "drive",
      modifiedTime: photo.modifiedTime ?? "",
      size: parseInt(photo.size ?? "0", 10),
    };
  }
  return {
    name: photo.name,
    id: photo.attachmentUid,
    url: `/api/pe-prep/photo/zuper/${encodeURIComponent(photo.jobUid)}/${encodeURIComponent(photo.attachmentUid)}`,
    thumbnailUrl: `/api/pe-prep/photo/zuper/${encodeURIComponent(photo.jobUid)}/${encodeURIComponent(photo.attachmentUid)}`,
    source: "zuper",
    modifiedTime: photo.createdAt ?? "",
    size: 0,
  };
}

// ---------------------------------------------------------------------------
// Main audit orchestrator
// ---------------------------------------------------------------------------

export async function runPeAudit(opts: AuditRunOptions): Promise<string> {
  const { dealId, triggeredBy, onEvent } = opts;
  const mode: AuditMode = opts.mode ?? "full";
  const includePhotos = mode === "full" || mode === "photos";
  const includeDocs = mode === "full" || mode === "docs";
  const startTime = Date.now();

  const existing = await prisma.peAuditRun.findFirst({
    where: { dealId, status: "running" },
    orderBy: { startedAt: "desc" },
  });

  // Allow concurrent runs across modes (e.g. "Run Full" fires `mode=docs`
  // and `mode=photos` in parallel — neither is the "same run"). Only block
  // when there's a STILL-FRESH existing run with the SAME mode that hasn't
  // exceeded the Vercel timeout window. (Mode is stored in summary JSON.)
  if (existing) {
    const age = Date.now() - existing.startedAt.getTime();
    const existingMode = (existing.summary as { mode?: string } | null)?.mode ?? "full";
    if (age < 5 * 60 * 1000 && existingMode === (opts.mode ?? "full")) {
      throw new Error(`Audit already running for deal ${dealId} in ${existingMode} mode (${Math.round(age / 1000)}s ago)`);
    }
    if (age >= 5 * 60 * 1000) {
      await prisma.peAuditRun.update({
        where: { id: existing.id },
        data: { status: "failed", completedAt: new Date() },
      });
    }
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

    // Filter checklist by mode: photo-only run skips doc items entirely
    // (and vice versa). Means progress events only fire for what we'll
    // actually classify, so UI shows accurate denominators.
    const modeFilteredChecklist = checklist.filter((item) =>
      item.isPhoto ? includePhotos : includeDocs
    );

    onEvent?.({
      type: "started",
      data: { milestone, systemType: deal.systemType, totalItems: modeFilteredChecklist.length },
    });
    onEvent?.({ type: "diagnostic", data: { message: `Audit mode: ${mode} (${includeDocs ? "docs" : ""}${includeDocs && includePhotos ? "+" : ""}${includePhotos ? "photos" : ""})` } });

    let folderByPrefix = new Map<string, string>();
    let allFolderIds: string[] = [];
    if (deal.rootFolderId) {
      const fm = await buildFolderMap(deal.rootFolderId);
      folderByPrefix = fm.byPrefix;
      allFolderIds = fm.allFolderIds;
      console.log(`[pe-audit] Folder map: ${folderByPrefix.size} numbered folders, ${allFolderIds.length} total`);
      if (fm.warnings.length > 0) {
        console.warn(`[pe-audit] Folder warnings: ${fm.warnings.join("; ")}`);
      }
      onEvent?.({ type: "diagnostic", data: { message: `GDrive: ${folderByPrefix.size} numbered folders found (${allFolderIds.length} total)` } });
      if (folderByPrefix.size === 0) {
        onEvent?.({ type: "diagnostic", data: { message: `No numbered folders in root ${deal.rootFolderId}. ${fm.warnings.join("; ")}` } });
      }
    } else {
      console.warn(`[pe-audit] Deal ${dealId} has no rootFolderId — all items will be missing`);
      onEvent?.({ type: "diagnostic", data: { message: "Deal has no GDrive folder — all items will be missing" } });
    }

    // -------------------------------------------------------------------
    // Pre-work: run PandaDoc, photo listing, reference library, and AVL
    // in parallel. These are all independent once we have the folder map.
    // -------------------------------------------------------------------
    const installFolderId = folderByPrefix.get("5");

    // Extract customer last name once for PandaDoc name-based search
    const nameParts = deal.dealName.split("|");
    const customerName = nameParts.length >= 2 ? nameParts[1].trim().split(",")[0].trim() || undefined : undefined;

    const prework0 = Date.now();
    const [pandaResult, installPhotosRaw, avlResult, zuperPhotosRaw] = await Promise.all([
      // 1) PandaDoc pull
      (deal.rootFolderId && process.env.PANDADOC_PE_TEMPLATES_ENABLED === "true")
        ? findOrCreatePeFolder(deal.rootFolderId).then((peFolderId) =>
            pullPandaDocs(dealId, peFolderId, customerName, onEvent),
          )
        : Promise.resolve(null),

      // 2) List install photos
      installFolderId
        ? listDriveImagesRecursive(installFolderId, 3, 50).catch((err) => {
            console.warn(`[pe-audit] Failed to list install photos: ${err instanceof Error ? err.message : String(err)}`);
            onEvent?.({ type: "diagnostic", data: { message: `Failed to list install photos: ${err instanceof Error ? err.message : String(err)}` } });
            return [] as Awaited<ReturnType<typeof listDriveImagesRecursive>>;
          })
        : Promise.resolve([] as Awaited<ReturnType<typeof listDriveImagesRecursive>>),

      // 3) AVL
      getAvl().catch((err) => {
        console.warn(`[pe-audit] AVL fetch failed: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }),

      // 4) Zuper install photos (attachments + service-task form submissions)
      enumerateZuperPhotos(dealId).catch((err) => {
        console.warn(`[pe-audit] Zuper photo enumeration failed: ${err instanceof Error ? err.message : String(err)}`);
        return [] as Extract<InstallPhoto, { source: "zuper" }>[];
      }),
    ]);
    onEvent?.({ type: "diagnostic", data: { message: `Pre-work parallel block: ${((Date.now() - prework0) / 1000).toFixed(1)}s` } });

    let pandadocOverrides = new Map<string, ChecklistResult>();
    let pandadocPulled = 0;
    if (pandaResult) {
      pandadocOverrides = pandaResult.checklistOverrides;
      pandadocPulled = pandaResult.pulled;
    }

    const installPhotos: DriveGenericFile[] = installPhotosRaw.map((img) => ({
      id: img.id,
      name: img.name,
      mimeType: img.mimeType,
      modifiedTime: img.modifiedTime,
      size: img.size,
    }));
    if (installFolderId) {
      onEvent?.({ type: "diagnostic", data: { message: `Found ${installPhotos.length} install photos in folder 5` } });
    } else {
      onEvent?.({ type: "diagnostic", data: { message: "No folder 5 (Installation) found — photos will be missing" } });
    }

    if (zuperPhotosRaw.length > 0) {
      onEvent?.({ type: "diagnostic", data: { message: `Found ${zuperPhotosRaw.length} install photos in Zuper` } });
    }

    // Install-photo pool: PREFER Zuper as the source of truth (field techs
    // upload install pics into Zuper service-task forms). GDrive folder 5 is
    // a downstream sync of the same photos, so using both would just trigger
    // duplicate downloads + duplicate triage work.
    //
    // Fall back to Drive only if Zuper returned nothing (no Zuper jobs linked,
    // Zuper API down, or this deal predates the Zuper-photo workflow).
    const installPhotoPool: InstallPhoto[] = zuperPhotosRaw.length > 0
      ? zuperPhotosRaw
      : installPhotos
          .filter((f) => f.mimeType.startsWith("image/"))
          .map((f): InstallPhoto => ({
            source: "drive",
            key: buildDrivePhotoKey(f.id),
            driveId: f.id,
            name: f.name,
            mimeType: f.mimeType,
            modifiedTime: f.modifiedTime,
            size: f.size,
          }));

    if (zuperPhotosRaw.length > 0 && installPhotos.length > 0) {
      onEvent?.({ type: "diagnostic", data: { message: `Using Zuper photos (skipping ${installPhotos.length} Drive duplicates)` } });
    } else if (zuperPhotosRaw.length === 0 && installPhotos.length > 0) {
      onEvent?.({ type: "diagnostic", data: { message: `Falling back to Drive folder 5 (no Zuper photos found)` } });
    }

    let avlContext: string | undefined;
    if (avlResult && avlResult.entries.length > 0) {
      avlContext = avlResult.entries
        .map((e) => `${e.manufacturer} ${e.model} (SKU: ${e.sku}, Category: ${e.category})`)
        .join("\n");
    }

    const results: ChecklistResult[] = [];
    let visionCallCount = 0;
    let cacheHits = 0;

    // Cache: classify each Drive file ONCE, reuse results across checklist items.
    // Key = Drive file ID, Value = Promise<VisionResult> (not resolved value).
    // Using Promise ensures concurrent batch items that share the same folder
    // (e.g. 6 contract items all look at folder 0) await the SAME in-flight
    // classification instead of each firing their own redundant API call.
    const docClassificationCache = new Map<string, Promise<VisionResult>>();

    // Concurrency limiter for actual classifyDocument vision API calls.
    // The Promise cache prevents duplicate work but doesn't bound how many
    // unique-file classifications fire at once. With all 20 checklist items
    // launching concurrently, a deal with ~10 unique candidate files would
    // hit Anthropic's per-org rate limits and slow to a crawl. Cap at 6.
    const VISION_CONCURRENCY = 6;
    let visionInFlight = 0;
    const visionQueue: (() => void)[] = [];
    async function withVisionSlot<T>(fn: () => Promise<T>): Promise<T> {
      if (visionInFlight >= VISION_CONCURRENCY) {
        await new Promise<void>((resolve) => visionQueue.push(resolve));
      }
      visionInFlight++;
      try {
        return await fn();
      } finally {
        visionInFlight--;
        const next = visionQueue.shift();
        if (next) next();
      }
    }

    // Pre-download + pre-upload install photos to Anthropic Files API.
    // All 12 photo items share the same candidate pool — uploading once saves
    // ~5s per photo × 12 items = ~60s. Pool includes BOTH Drive + Zuper photos.
    const anthropicFileIdCache = new Map<string, string>(); // photoKey → anthropicFileId
    const downloadCache = new Map<string, VisionFileInput>(); // photoKey → downloaded input
    const photoByKey = new Map<string, InstallPhoto>();
    for (const p of installPhotoPool) photoByKey.set(p.key, p);

    // Skip the entire photo pipeline when mode === "docs" — caller didn't
    // ask for photo verdicts. Saves the pre-upload + multi-image triage call.
    if (includePhotos && installPhotoPool.length > 0) {
      const photoCount = checklist.filter((i) => i.isPhoto).length;
      if (photoCount > 0) {
        // Cap at 20 — multi-image triage with too many images slows Claude
        // considerably (each photo adds ~3-5s of vision processing). 20 is
        // plenty since we only need 1 best photo per of ~11 PE categories.
        const toPreload = installPhotoPool.slice(0, 20);
        const sourceLabel = toPreload[0]?.source === "zuper" ? "Zuper" : "Drive";
        onEvent?.({ type: "diagnostic", data: { message: `Pre-uploading ${toPreload.length} ${sourceLabel} photos to vision API...` } });
        const preload0 = Date.now();
        const preloadResults = await Promise.all(
          toPreload.map(async (photo) => {
            try {
              const input = await downloadPhotoForVision(photo);
              if (!input) return null;
              downloadCache.set(photo.key, input);
              const anthropicId = await uploadToAnthropic(input.buffer, input.fileName, input.mimeType);
              anthropicFileIdCache.set(photo.key, anthropicId);
              return photo.key;
            } catch (err) {
              console.warn(`[pe-audit] Pre-upload failed for ${photo.name}: ${err instanceof Error ? err.message : String(err)}`);
              return null;
            }
          }),
        );
        const uploaded = preloadResults.filter(Boolean).length;
        onEvent?.({ type: "diagnostic", data: { message: `Pre-uploaded ${uploaded}/${toPreload.length} photos in ${((Date.now() - preload0) / 1000).toFixed(1)}s` } });
      }
    }

    // -----------------------------------------------------------------------
    // Batch photo triage — classify ALL photos in ONE Claude API call.
    // Converts O(photoItems × candidates) individual calls into O(1).
    // -----------------------------------------------------------------------
    const photoItems = checklist.filter((i) => i.isPhoto);
    const photoAssignmentsByChecklist = new Map<string, {
      photoKey: string;
      verdict: "pass" | "fail" | "needs_review";
      confidence: "high" | "medium" | "low";
      issues: string[];
      equipmentVisible: string[];
    }>();

    if (includePhotos && photoItems.length > 0 && anthropicFileIdCache.size > 0) {
      const preloadedPhotos: Array<{ anthropicFileId: string; fileName: string; driveFileId: string }> = [];
      for (const photo of installPhotoPool) {
        const anthropicId = anthropicFileIdCache.get(photo.key);
        if (anthropicId) {
          preloadedPhotos.push({
            anthropicFileId: anthropicId,
            fileName: photo.name,
            driveFileId: photo.key, // triage uses driveFileId field but it's just an opaque key
          });
        }
      }

      if (preloadedPhotos.length > 0) {
        onEvent?.({ type: "diagnostic", data: { message: `Batch photo triage: ${preloadedPhotos.length} photos × ${photoItems.length} categories in 1 API call...` } });
        const triage0 = Date.now();
        const triageResult = await triagePhotoBatch(preloadedPhotos, photoItems);
        visionCallCount++; // Single batch call
        onEvent?.({ type: "diagnostic", data: { message: `Photo triage completed in ${((Date.now() - triage0) / 1000).toFixed(1)}s` } });

        // Build reverse map: checklistId → matched photo + verdict
        for (const [photoIndex, assignment] of triageResult.assignments) {
          const photo = preloadedPhotos[photoIndex];
          if (photo) {
            photoAssignmentsByChecklist.set(assignment.checklistId, {
              photoKey: photo.driveFileId,
              verdict: assignment.verdict,
              confidence: assignment.confidence,
              issues: assignment.issues,
              equipmentVisible: assignment.equipmentVisible,
            });
          }
        }

        onEvent?.({ type: "diagnostic", data: { message: `Photo triage matched ${photoAssignmentsByChecklist.size}/${photoItems.length} categories` } });
      }
    }

    const docLoop0 = Date.now();
    // Run ALL checklist items concurrently. The Promise-based doc classification
    // cache (`docClassificationCache`) dedups multiple items hitting the same
    // file, so concurrency is safe — actual vision API calls only happen once
    // per unique candidate file regardless of how many items share that folder.
    // Total wall time ≈ max(unique-file classification times) instead of
    // sum(per-item classification times).
    {
      // Iterate only the items relevant to this mode. Photos-only mode skips
      // every doc item entirely (no folder scan, no vision calls). Docs-only
      // mode skips photo items (which would just rely on triageResult anyway).
      const allItemPromises = modeFilteredChecklist.map(async (item): Promise<ChecklistResult> => {
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
          console.log(`[pe-audit] ${item.id}: 0 candidates (folders: ${item.isPhoto ? "photos" : item.searchAllFolders ? "all" : item.driveFolders.join(",")})`);
          onEvent?.({
            type: "progress",
            data: { itemId: item.id, label: item.label, status: "missing" },
          });
          return { item, status: "missing" as const };
        }

        console.log(`[pe-audit] ${item.id}: ${candidates.length} candidates found`);

        if (item.isPhoto) {
          // Use batch triage results (single API call already made above)
          const triageMatch = photoAssignmentsByChecklist.get(item.id);
          if (triageMatch) {
            const matchedPhoto = photoByKey.get(triageMatch.photoKey);
            const enriched: EnrichedVisionResult = {
              status: triageMatch.verdict,
              notes: triageMatch.issues.length > 0
                ? triageMatch.issues.join("; ")
                : "Photo verified (batch triage)",
              confidence: triageMatch.confidence,
              issues: triageMatch.issues,
              equipmentVisible: triageMatch.equipmentVisible,
            };

            // pass/needs_review → "found" (with issues noted); fail → "needs_review"
            const status = triageMatch.verdict === "fail" ? "needs_review" as const : "found" as const;

            onEvent?.({
              type: "progress",
              data: {
                itemId: item.id,
                label: item.label,
                status,
                file: matchedPhoto?.name,
                issues: triageMatch.issues.length > 0 ? triageMatch.issues : undefined,
              },
            });

            return {
              item,
              status,
              foundFile: matchedPhoto ? buildFoundFileFromPhoto(matchedPhoto) : undefined,
              visionResult: enriched,
            };
          }

          // No triage match for this category
          onEvent?.({
            type: "progress",
            data: { itemId: item.id, label: item.label, status: "missing" },
          });
          return { item, status: "missing" };
        }

        for (const candidate of candidates.slice(0, 8)) {
          // Check classification cache — stores Promises (not resolved values)
          // so concurrent batch items that share the same folder deduplicate
          // instead of each firing redundant API calls.
          let vResultPromise = docClassificationCache.get(candidate.id);
          if (vResultPromise) {
            cacheHits++;
          } else {
            // First requester: store the Promise immediately so concurrent
            // requesters for the same file await the same in-flight call.
            // The `withVisionSlot` wrapper bounds concurrent Anthropic API
            // calls so we don't trip per-org rate limits.
            vResultPromise = withVisionSlot(async () => {
              let input = downloadCache.get(candidate.id) ?? await downloadFileForVision(candidate);
              if (!input) {
                return { kind: "error" as const, error: `Failed to download ${candidate.name}` };
              }
              const cachedAnthropicId = anthropicFileIdCache.get(candidate.id);
              if (cachedAnthropicId && !input.anthropicFileId) {
                input = { ...input, anthropicFileId: cachedAnthropicId };
              }
              visionCallCount++;
              const classifyOpts: ClassifyOptions = {};
              if (avlContext) classifyOpts.avlContext = avlContext;
              return classifyDocument(input, checklist, classifyOpts);
            });
            docClassificationCache.set(candidate.id, vResultPromise);
          }

          const vResult = await vResultPromise;

          if (vResult.kind === "error") {
            console.warn(`[pe-audit] ${item.id}: vision error on ${candidate.name}: ${vResult.error}`);
            continue;
          }
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
              thumbnailUrl: candidate.mimeType.startsWith("image/")
                ? `/api/pe-prep/photo/drive/${encodeURIComponent(candidate.id)}`
                : undefined,
              source: "drive",
              modifiedTime: candidate.modifiedTime,
              size: parseInt(candidate.size ?? "0", 10),
            },
            visionResult: enriched ?? undefined,
          };
        }

        console.log(`[pe-audit] ${item.id}: checked ${Math.min(candidates.length, 8)} candidates, none matched`);
        onEvent?.({
          type: "progress",
          data: { itemId: item.id, label: item.label, status: "missing" },
        });
        return { item, status: "missing" };
      });

      const allResults = await Promise.all(allItemPromises);
      results.push(...allResults);
    }
    onEvent?.({ type: "diagnostic", data: { message: `Doc classification loop completed in ${((Date.now() - docLoop0) / 1000).toFixed(1)}s (${visionCallCount} vision calls, ${cacheHits} cache hits)` } });

    const resolved = resolveCombinedFiles(results);

    console.log(`[pe-audit] Complete: ${visionCallCount} vision calls (${cacheHits} cache hits), ${pandadocPulled} PandaDocs pulled, ${resolved.filter(r => r.status === "found").length} found, ${resolved.filter(r => r.status === "missing").length} missing`);

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

    // Tag the run with the audit mode so the UI can distinguish a "photos only"
    // refresh from a "full" audit. Stored in summary JSON (vs adding a Prisma
    // column, which would need a migration ordering step).
    const summaryWithMode = { ...auditResult.summary, mode };

    await prisma.peAuditRun.update({
      where: { id: auditRun.id },
      data: {
        status: "completed",
        completedAt: new Date(),
        durationMs,
        visionCallCount,
        pandadocPulled,
        results: JSON.parse(JSON.stringify(auditResult.categories)),
        summary: JSON.parse(JSON.stringify(summaryWithMode)),
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
