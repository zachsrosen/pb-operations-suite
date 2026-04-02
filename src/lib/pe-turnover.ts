// ---------------------------------------------------------------------------
// PE Turnover Readiness — Types, Checklists, Matching, Audit, Report
// ---------------------------------------------------------------------------

import type { DriveGenericFile, DriveFolder, DriveImageFile } from "@/lib/drive-plansets";
import {
  extractFolderId,
  listDriveSubfolders,
  listDriveFiles,
  listPlansetPdfs,
  pickBestPlanset,
  listDriveImagesRecursive,
  createDriveFolder,
  copyDriveFile,
  uploadDriveTextFile,
} from "@/lib/drive-plansets";
import { getDealProperties, DEAL_STAGE_MAP } from "@/lib/hubspot";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SystemType = "solar" | "battery" | "solar+battery";
export type Milestone = "m1" | "m2";
export type ChecklistStatus = "found" | "likely" | "missing" | "needs_review" | "not_applicable" | "error";

export interface ChecklistItem {
  id: string;
  label: string;
  category: string;
  milestone: Milestone;
  appliesTo: SystemType[];
  driveFolders: string[];
  searchAllFolders: boolean;
  fileHints: string[];
  combinedWith?: string[];
  isPhoto: boolean;
  pePhotoNumber?: number;
}

export interface ChecklistResult {
  item: ChecklistItem;
  status: ChecklistStatus;
  statusNote?: string;
  foundFile?: {
    name: string;
    id: string;
    url: string;
    modifiedTime: string;
    size: number;
  };
  combinedFile?: boolean;
  visionResult?: {
    status: "pass" | "fail" | "needs_review";
    notes: string;
  };
}

export interface TurnoverAuditResult {
  dealId: string;
  dealName: string;
  address: string;
  systemType: SystemType;
  milestone: Milestone;
  peStatus: string | null;
  categories: {
    name: string;
    label: string;
    items: ChecklistResult[];
    found: number;
    total: number;
  }[];
  summary: {
    totalItems: number;
    found: number;
    missing: number;
    needsReview: number;
    notApplicable: number;
    errors: number;
    ready: boolean;
  };
}

export type TurnoverAuditOutput =
  | TurnoverAuditResult
  | [TurnoverAuditResult, TurnoverAuditResult];

// ---------------------------------------------------------------------------
// HubSpot properties needed for PE turnover
// ---------------------------------------------------------------------------

export const PE_TURNOVER_PROPERTIES = [
  "hs_object_id", "dealname", "dealstage", "pipeline",
  "tags", "is_participate_energy", "participate_energy_status",
  "pe_m1_status", "pe_m2_status",
  "project_type",
  "address_line_1", "city", "state", "postal_code",
  "all_document_parent_folder_id", "design_documents",
  "site_survey_documents", "permit_documents", "g_drive",
  "pb_location",
];

// ---------------------------------------------------------------------------
// Stage-to-milestone mapping
// ---------------------------------------------------------------------------

const STAGE_TO_MILESTONE: Record<string, Milestone> = {
  "Site Survey": "m1",
  "Design & Engineering": "m1",
  "Permitting & Interconnection": "m1",
  "RTB - Blocked": "m1",
  "Ready To Build": "m1",
  "Construction": "m1",
  "Inspection": "m1",
  "Permission To Operate": "m2",
  "Close Out": "m2",
};

const TERMINAL_STAGES = new Set(["Project Complete", "Cancelled", "On Hold"]);
const TERMINAL_PE_STATUSES = new Set(["Submitted", "Approved", "Paid"]);

export function inferMilestone(stageName: string): { milestone: Milestone | null; isTerminal: boolean } {
  if (TERMINAL_STAGES.has(stageName)) return { milestone: null, isTerminal: true };
  return { milestone: STAGE_TO_MILESTONE[stageName] ?? "m1", isTerminal: false };
}

export function isMilestoneTerminal(peStatus: string | null): boolean {
  return peStatus != null && TERMINAL_PE_STATUSES.has(peStatus);
}

// ---------------------------------------------------------------------------
// System type shorthands
// ---------------------------------------------------------------------------

const ALL: SystemType[] = ["solar", "battery", "solar+battery"];
const SOLAR: SystemType[] = ["solar", "solar+battery"];
const STORAGE: SystemType[] = ["battery", "solar+battery"];

// ---------------------------------------------------------------------------
// M1 Checklist — Inspection Complete
// ---------------------------------------------------------------------------

export const PE_M1_CHECKLIST: ChecklistItem[] = [
  // --- Contract & Proposal ---
  {
    id: "m1.contract.customer_agreement",
    label: "Countersigned Customer Agreement",
    category: "contract",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: ["0"],
    searchAllFolders: false,
    fileHints: ["customer agreement", "ca_signed", "contract_package", "contract"],
    combinedWith: ["m1.contract.installation_order", "m1.contract.disclosures"],
    isPhoto: false,
  },
  {
    id: "m1.contract.installation_order",
    label: "Countersigned Installation Order",
    category: "contract",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: ["0"],
    searchAllFolders: false,
    fileHints: ["installation order", "io_signed", "contract_package"],
    combinedWith: ["m1.contract.customer_agreement", "m1.contract.disclosures"],
    isPhoto: false,
  },
  {
    id: "m1.contract.disclosures",
    label: "Required Disclosures",
    category: "contract",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: ["0"],
    searchAllFolders: false,
    fileHints: ["disclosure", "contract_package"],
    combinedWith: ["m1.contract.customer_agreement", "m1.contract.installation_order"],
    isPhoto: false,
  },
  {
    id: "m1.contract.proposal",
    label: "Signed Proposal",
    category: "contract",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: ["0"],
    searchAllFolders: false,
    fileHints: ["proposal", "quote"],
    isPhoto: false,
  },
  {
    id: "m1.contract.utility_bill",
    label: "Utility Bill (12mo usage)",
    category: "contract",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: ["0"],
    searchAllFolders: false,
    fileHints: ["utility bill", "utility_bill", "electric bill", "xcel", "usage"],
    isPhoto: false,
  },
  {
    id: "m1.contract.loan_docs",
    label: "Loan Documents (if applicable)",
    category: "contract",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: ["0"],
    searchAllFolders: false,
    fileHints: ["loan", "sunraise", "financing"],
    isPhoto: false,
  },
  {
    id: "m1.contract.incentive_forms",
    label: "Incentive Forms (if applicable)",
    category: "contract",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: ["0", "8"],
    searchAllFolders: false,
    fileHints: ["incentive", "rebate", "3ce", "xcel_rebate"],
    isPhoto: false,
  },

  // --- Design Package ---
  {
    id: "m1.design.planset",
    label: "Final Plan Set",
    category: "design",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: ["2"],
    searchAllFolders: false,
    fileHints: [], // uses pickBestPlanset() instead of hints
    isPhoto: false,
  },

  // --- Photos (PE numbered 1-11) ---
  {
    id: "m1.photos.1_site_address",
    label: "Site address + home",
    category: "photos",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: ["5"],
    searchAllFolders: false,
    fileHints: ["address", "exterior", "front", "street"],
    isPhoto: true,
    pePhotoNumber: 1,
  },
  {
    id: "m1.photos.2_pv_array",
    label: "Wide-angle PV array",
    category: "photos",
    milestone: "m1",
    appliesTo: SOLAR,
    driveFolders: ["5"],
    searchAllFolders: false,
    fileHints: ["array", "modules", "panels", "roof"],
    isPhoto: true,
    pePhotoNumber: 2,
  },
  {
    id: "m1.photos.3_module_nameplate",
    label: "Module nameplate label",
    category: "photos",
    milestone: "m1",
    appliesTo: SOLAR,
    driveFolders: ["5"],
    searchAllFolders: false,
    fileHints: ["nameplate", "label", "serial"],
    isPhoto: true,
    pePhotoNumber: 3,
  },
  {
    id: "m1.photos.4_electrical",
    label: "Wide-angle all electrical",
    category: "photos",
    milestone: "m1",
    appliesTo: SOLAR,
    driveFolders: ["5"],
    searchAllFolders: false,
    fileHints: ["electrical", "equipment", "indoor", "outdoor"],
    isPhoto: true,
    pePhotoNumber: 4,
  },
  {
    id: "m1.photos.5_msp",
    label: "Main service panel (cover off)",
    category: "photos",
    milestone: "m1",
    appliesTo: SOLAR,
    driveFolders: ["5"],
    searchAllFolders: false,
    fileHints: ["msp", "panel", "breaker", "service_panel"],
    isPhoto: true,
    pePhotoNumber: 5,
  },
  {
    id: "m1.photos.6_invoice_bom",
    label: "Invoice & BOM",
    category: "photos",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: ["5", "0"],
    searchAllFolders: false,
    fileHints: ["invoice", "bom", "bill_of_materials"],
    isPhoto: true,
    pePhotoNumber: 6,
  },
  {
    id: "m1.photos.7_inverter",
    label: "Inverter/micro/optimizer model",
    category: "photos",
    milestone: "m1",
    appliesTo: SOLAR,
    driveFolders: ["5"],
    searchAllFolders: false,
    fileHints: ["inverter", "microinverter", "optimizer", "enphase", "solaredge"],
    isPhoto: true,
    pePhotoNumber: 7,
  },
  {
    id: "m1.photos.8_racking",
    label: "Racking parts + markings",
    category: "photos",
    milestone: "m1",
    appliesTo: SOLAR,
    driveFolders: ["5"],
    searchAllFolders: false,
    fileHints: ["racking", "rail", "ironridge", "unirac", "clamp"],
    isPhoto: true,
    pePhotoNumber: 8,
  },
  {
    id: "m1.photos.9_storage_wide",
    label: "Storage wide angle",
    category: "photos",
    milestone: "m1",
    appliesTo: STORAGE,
    driveFolders: ["5"],
    searchAllFolders: false,
    fileHints: ["battery", "storage", "powerwall", "encharge"],
    isPhoto: true,
    pePhotoNumber: 9,
  },
  {
    id: "m1.photos.10_storage_nameplate",
    label: "Storage nameplate & labels",
    category: "photos",
    milestone: "m1",
    appliesTo: STORAGE,
    driveFolders: ["5"],
    searchAllFolders: false,
    fileHints: ["battery_label", "storage_nameplate", "battery_serial"],
    isPhoto: true,
    pePhotoNumber: 10,
  },
  {
    id: "m1.photos.11_storage_controller",
    label: "Storage controller/disconnect",
    category: "photos",
    milestone: "m1",
    appliesTo: STORAGE,
    driveFolders: ["5"],
    searchAllFolders: false,
    fileHints: ["controller", "gateway", "disconnect", "battery_disconnect"],
    isPhoto: true,
    pePhotoNumber: 11,
  },

  // --- Admin ---
  {
    id: "m1.admin.commissioning",
    label: "Commissioning Proof",
    category: "admin",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: ["5", "8"],
    searchAllFolders: false,
    fileHints: ["commissioning", "monitoring", "site_id", "enphase", "solaredge", "tesla_app"],
    isPhoto: false,
  },
  {
    id: "m1.admin.hoa",
    label: "HOA Approval (if applicable)",
    category: "admin",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: ["0"],
    searchAllFolders: true,
    fileHints: ["hoa", "homeowner association"],
    isPhoto: false,
  },

  // --- Post-Install ---
  {
    id: "m1.post_install.attestation",
    label: "Installer Attestation (Exhibit A)",
    category: "post_install",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: [],
    searchAllFolders: true,
    fileHints: ["attestation", "exhibit_a", "installer_attestation"],
    isPhoto: false,
  },
  {
    id: "m1.post_install.acceptance",
    label: "Customer Acceptance Certificate (Exhibit B)",
    category: "post_install",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: [],
    searchAllFolders: true,
    fileHints: ["acceptance", "exhibit_b", "customer_acceptance", "certificate_of_acceptance"],
    isPhoto: false,
  },

  // --- Inspection ---
  {
    id: "m1.inspection.ahj_permit",
    label: "AHJ Signed Final Permit",
    category: "inspection",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: ["6"],
    searchAllFolders: false,
    fileHints: ["inspection", "permit", "inspection_card", "final_inspection", "passed"],
    isPhoto: false,
  },

  // --- Lien ---
  {
    id: "m1.lien.conditional",
    label: "Conditional Progress Lien Waiver",
    category: "lien",
    milestone: "m1",
    appliesTo: ALL,
    driveFolders: [],
    searchAllFolders: true,
    fileHints: ["conditional_waiver", "progress_waiver", "conditional_lien"],
    isPhoto: false,
  },
];

// ---------------------------------------------------------------------------
// M2 Checklist — Project Complete
// ---------------------------------------------------------------------------

export const PE_M2_CHECKLIST: ChecklistItem[] = [
  {
    id: "m2.pto.pto_letter",
    label: "PTO Letter",
    category: "pto",
    milestone: "m2",
    appliesTo: ALL,
    driveFolders: ["7"],
    searchAllFolders: false,
    fileHints: ["pto", "permission to operate", "pto_letter"],
    isPhoto: false,
  },
  {
    id: "m2.pto.interconnection",
    label: "Interconnection Agreement",
    category: "pto",
    milestone: "m2",
    appliesTo: ALL,
    driveFolders: ["7"],
    searchAllFolders: false,
    fileHints: ["interconnection", "ia_signed", "net metering", "interconnection_agreement"],
    isPhoto: false,
  },
  {
    id: "m2.warranty.assignment",
    label: "Warranty Assignment",
    category: "warranty",
    milestone: "m2",
    appliesTo: ALL,
    driveFolders: ["7"],
    searchAllFolders: false,
    fileHints: ["warranty", "warranty_assignment"],
    isPhoto: false,
  },
  {
    id: "m2.incentives.documentation",
    label: "Incentive Documentation",
    category: "incentives",
    milestone: "m2",
    appliesTo: ALL,
    driveFolders: ["7", "8"],
    searchAllFolders: false,
    fileHints: ["incentive", "rebate", "approval_letter"],
    isPhoto: false,
  },
  {
    id: "m2.lien.final",
    label: "Final Lien Waiver",
    category: "lien",
    milestone: "m2",
    appliesTo: ALL,
    driveFolders: [],
    searchAllFolders: true,
    fileHints: ["final_waiver", "unconditional_waiver", "final_lien"],
    isPhoto: false,
  },
];

// ---------------------------------------------------------------------------
// Checklist filtering
// ---------------------------------------------------------------------------

/** Filter a checklist to only items that apply to the given system type. */
export function filterChecklist(checklist: ChecklistItem[], systemType: SystemType): ChecklistItem[] {
  return checklist.filter((item) => item.appliesTo.includes(systemType));
}

// ---------------------------------------------------------------------------
// File matching
// ---------------------------------------------------------------------------

/**
 * Match a checklist item against a list of Drive files using fileHints.
 * Returns the best match (most recently modified) or null.
 */
export function matchFileToItem(
  item: ChecklistItem,
  files: DriveGenericFile[],
): DriveGenericFile | null {
  if (item.fileHints.length === 0) return null;

  const matches = files.filter((file) => {
    const normalizedName = file.name.toLowerCase().replace(/[_-]/g, " ");
    return item.fileHints.some((hint) => {
      const normalizedHint = hint.toLowerCase().replace(/[_-]/g, " ");
      return normalizedName.includes(normalizedHint);
    });
  });

  if (matches.length === 0) return null;

  // Pick most recently modified
  matches.sort((a, b) =>
    new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime()
  );
  return matches[0];
}

// ---------------------------------------------------------------------------
// Combined file resolution
// ---------------------------------------------------------------------------

/**
 * If any item in a combinedWith group is "found", mark all others in the group
 * as "found" with combinedFile=true, sharing the same foundFile.
 */
export function resolveCombinedFiles(results: ChecklistResult[]): ChecklistResult[] {
  const byId = new Map(results.map((r) => [r.item.id, r]));

  for (const result of results) {
    if (result.status !== "found" || !result.item.combinedWith) continue;

    for (const siblingId of result.item.combinedWith) {
      const sibling = byId.get(siblingId);
      if (sibling && sibling.status === "missing") {
        sibling.status = "found";
        sibling.combinedFile = true;
        sibling.foundFile = result.foundFile;
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Folder map — validates and maps the root Drive folder structure
// ---------------------------------------------------------------------------

interface FolderMap {
  byPrefix: Map<string, string>;
  allFolderIds: string[];
  warnings: string[];
}

export async function buildFolderMap(rootFolderId: string): Promise<FolderMap> {
  const warnings: string[] = [];
  let subfolders: DriveFolder[];

  try {
    subfolders = await listDriveSubfolders(rootFolderId);
  } catch (err) {
    return {
      byPrefix: new Map(),
      allFolderIds: [],
      warnings: [`Could not list root folder: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  const byPrefix = new Map<string, string>();
  for (const folder of subfolders) {
    const match = folder.name.match(/^(\d+)\./);
    if (match) {
      byPrefix.set(match[1], folder.id);
    }
  }

  if (byPrefix.size < 3) {
    warnings.push(
      `Non-standard Drive folder structure (found ${byPrefix.size} numbered subfolders). ` +
      `Folders: ${subfolders.map((f) => f.name).join(", ")}`
    );
  }

  return {
    byPrefix,
    allFolderIds: subfolders.map((f) => f.id),
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Drive audit — walks folders and matches files to checklist items
// ---------------------------------------------------------------------------

interface AuditOptions {
  verifyPhotos?: boolean;
}

export async function auditDriveFiles(
  checklist: ChecklistItem[],
  _rootFolderId: string,
  folderMap: FolderMap,
  designFolderId: string | null,
  _options?: AuditOptions,
): Promise<ChecklistResult[]> {
  // Cache: folder ID → files list
  const fileCache = new Map<string, DriveGenericFile[]>();

  async function getFiles(folderId: string): Promise<DriveGenericFile[]> {
    if (fileCache.has(folderId)) return fileCache.get(folderId)!;
    try {
      const files = await listDriveFiles(folderId);
      fileCache.set(folderId, files);
      return files;
    } catch {
      return [];
    }
  }

  async function getAllFiles(): Promise<DriveGenericFile[]> {
    const all: DriveGenericFile[] = [];
    for (const folderId of folderMap.allFolderIds) {
      const files = await getFiles(folderId);
      all.push(...files);
      try {
        const subs = await listDriveSubfolders(folderId);
        for (const sub of subs.slice(0, 10)) {
          const subFiles = await getFiles(sub.id);
          all.push(...subFiles);
        }
      } catch {
        // skip
      }
    }
    return all;
  }

  let allFilesCache: DriveGenericFile[] | null = null;

  // Pre-fetch recursive photo listing for the Installation folder
  let photoFiles: DriveGenericFile[] = [];
  const installFolderId = folderMap.byPrefix.get("5");
  if (installFolderId) {
    try {
      const images = await listDriveImagesRecursive(installFolderId, 3, 50);
      photoFiles = images.map((img: DriveImageFile) => ({
        id: img.id,
        name: img.name,
        mimeType: img.mimeType,
        modifiedTime: img.modifiedTime,
        size: img.size,
      }));
    } catch {
      // Will fall back to flat file listing
    }
  }

  const results: ChecklistResult[] = [];

  for (const item of checklist) {
    // Special case: planset uses dedicated logic
    if (item.id === "m1.design.planset") {
      const result = await auditPlanset(item, designFolderId);
      results.push(result);
      continue;
    }

    let candidateFiles: DriveGenericFile[] = [];

    if (item.isPhoto) {
      // Photos use recursive image listing from Installation folder
      candidateFiles = photoFiles;
      // Photo 6 (Invoice/BOM) also checks document folders
      if (item.pePhotoNumber === 6) {
        for (const prefix of item.driveFolders) {
          const folderId = folderMap.byPrefix.get(prefix);
          if (folderId) {
            const files = await getFiles(folderId);
            candidateFiles = [...candidateFiles, ...files];
          }
        }
      }
    } else if (item.searchAllFolders) {
      if (!allFilesCache) allFilesCache = await getAllFiles();
      candidateFiles = allFilesCache;
    } else {
      for (const prefix of item.driveFolders) {
        const folderId = folderMap.byPrefix.get(prefix);
        if (folderId) {
          const files = await getFiles(folderId);
          candidateFiles.push(...files);
        }
      }
    }

    const matched = matchFileToItem(item, candidateFiles);
    if (matched) {
      results.push({
        item,
        status: "found",
        foundFile: {
          name: matched.name,
          id: matched.id,
          url: `https://drive.google.com/file/d/${matched.id}/view`,
          modifiedTime: matched.modifiedTime,
          size: parseInt(matched.size ?? "0", 10),
        },
      });
    } else {
      results.push({ item, status: "missing" });
    }
  }

  // Post-pass: lien waiver disambiguation
  const allSearchedFiles = allFilesCache ?? [];
  const genericLienFile = allSearchedFiles.find((f) => {
    const n = f.name.toLowerCase();
    return n.includes("lien") && n.includes("waiver")
      && !n.includes("conditional") && !n.includes("progress")
      && !n.includes("final") && !n.includes("unconditional");
  });
  if (genericLienFile) {
    for (const r of results) {
      if (r.item.category === "lien" && r.status === "missing") {
        r.status = "needs_review";
        r.statusNote = `Generic "lien waiver" found but cannot determine if conditional or final`;
        r.foundFile = {
          name: genericLienFile.name,
          id: genericLienFile.id,
          url: `https://drive.google.com/file/d/${genericLienFile.id}/view`,
          modifiedTime: genericLienFile.modifiedTime,
          size: parseInt(genericLienFile.size ?? "0", 10),
        };
      }
    }
  }

  return resolveCombinedFiles(results);
}

async function auditPlanset(
  item: ChecklistItem,
  designFolderId: string | null,
): Promise<ChecklistResult> {
  if (!designFolderId) {
    return { item, status: "error", statusNote: "No design folder ID on deal" };
  }

  const folderId = extractFolderId(designFolderId);
  if (!folderId) {
    return { item, status: "error", statusNote: "Invalid design folder URL" };
  }

  try {
    const pdfs = await listPlansetPdfs(folderId);
    const best = pickBestPlanset(pdfs);
    if (best) {
      return {
        item,
        status: "found",
        foundFile: {
          name: best.name,
          id: best.id,
          url: `https://drive.google.com/file/d/${best.id}/view`,
          modifiedTime: best.modifiedTime,
          size: parseInt(best.size ?? "0", 10),
        },
      };
    }
    return { item, status: "missing" };
  } catch (err) {
    return { item, status: "error", statusNote: `Planset lookup failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

const CATEGORY_META: Record<string, { label: string; order: number }> = {
  contract: { label: "CONTRACT & PROPOSAL", order: 0 },
  design: { label: "DESIGN PACKAGE", order: 1 },
  photos: { label: "PHOTOS", order: 2 },
  admin: { label: "ADMIN", order: 3 },
  post_install: { label: "POST-INSTALL", order: 4 },
  inspection: { label: "INSPECTION", order: 5 },
  lien: { label: "LIEN", order: 6 },
  pto: { label: "PTO", order: 0 },
  warranty: { label: "WARRANTY & INCENTIVES", order: 1 },
  incentives: { label: "INCENTIVES", order: 2 },
};

export function buildAuditResult(params: {
  dealId: string;
  dealName: string;
  address: string;
  systemType: SystemType;
  milestone: Milestone;
  peStatus: string | null;
  results: ChecklistResult[];
}): TurnoverAuditResult {
  const catMap = new Map<string, ChecklistResult[]>();
  for (const r of params.results) {
    const key = r.item.category;
    if (!catMap.has(key)) catMap.set(key, []);
    catMap.get(key)!.push(r);
  }

  const categories = [...catMap.entries()]
    .sort(([a], [b]) => (CATEGORY_META[a]?.order ?? 99) - (CATEGORY_META[b]?.order ?? 99))
    .map(([name, items]) => ({
      name,
      label: CATEGORY_META[name]?.label ?? name.toUpperCase(),
      items,
      found: items.filter((i) => i.status === "found" || i.status === "likely").length,
      total: items.filter((i) => i.status !== "not_applicable").length,
    }));

  const all = params.results;
  const found = all.filter((r) => r.status === "found" || r.status === "likely").length;
  const missing = all.filter((r) => r.status === "missing").length;
  const needsReview = all.filter((r) => r.status === "needs_review").length;
  const notApplicable = all.filter((r) => r.status === "not_applicable").length;
  const errors = all.filter((r) => r.status === "error").length;
  const requiredTotal = all.length - notApplicable - errors;

  return {
    dealId: params.dealId,
    dealName: params.dealName,
    address: params.address,
    systemType: params.systemType,
    milestone: params.milestone,
    peStatus: params.peStatus,
    categories,
    summary: {
      totalItems: all.length,
      found,
      missing,
      needsReview,
      notApplicable,
      errors,
      ready: found >= requiredTotal,
    },
  };
}

const MILESTONE_LABELS: Record<Milestone, string> = {
  m1: "M1 (Inspection Complete)",
  m2: "M2 (Project Complete)",
};

const STATUS_ICONS: Record<ChecklistStatus, string> = {
  found: "\u2713",
  likely: "~",
  missing: "\u2717",
  needs_review: "?",
  not_applicable: "\u2014",
  error: "!",
};

export function generateTextReport(result: TurnoverAuditResult): string {
  const lines: string[] = [];

  lines.push(`PE Turnover Readiness \u2014 ${result.dealName}, ${result.address}`);
  lines.push(
    `Deal: ${result.dealId} | Type: ${result.systemType} | Milestone: ${MILESTONE_LABELS[result.milestone]}`
  );
  if (result.peStatus) {
    lines.push(`PE ${result.milestone.toUpperCase()} Status: ${result.peStatus}`);
  }
  lines.push("");

  for (const cat of result.categories) {
    lines.push(`${cat.label} (${cat.found}/${cat.total})`);

    for (const r of cat.items) {
      const icon = STATUS_ICONS[r.status];
      const label = r.item.isPhoto ? `${r.item.pePhotoNumber}. ${r.item.label}` : r.item.label;
      let detail = "";

      if (r.status === "found" || r.status === "likely") {
        detail = `\u2192 ${r.foundFile?.name ?? "found"}`;
        if (r.combinedFile) detail += " (combined)";
      } else if (r.status === "missing") {
        detail = "\u2192 MISSING";
        if (r.item.searchAllFolders) detail += " (searched all folders)";
      } else if (r.status === "not_applicable") {
        detail = `\u2192 N/A${r.statusNote ? ` (${r.statusNote})` : ""}`;
      } else if (r.status === "error") {
        detail = `\u2192 ERROR${r.statusNote ? `: ${r.statusNote}` : ""}`;
      } else if (r.status === "needs_review") {
        detail = `\u2192 ${r.foundFile?.name ?? "NEEDS REVIEW"}${r.statusNote ? ` (${r.statusNote})` : ""}`;
      }

      lines.push(`  ${icon} ${label.padEnd(35)} ${detail}`);
    }
    lines.push("");
  }

  const s = result.summary;
  const summaryParts = [
    `READY: ${s.found}/${s.totalItems - s.notApplicable - s.errors}`,
    `MISSING: ${s.missing}`,
  ];
  if (s.needsReview > 0) summaryParts.push(`NEEDS REVIEW: ${s.needsReview}`);
  if (s.notApplicable > 0) summaryParts.push(`N/A: ${s.notApplicable}`);
  if (s.errors > 0) summaryParts.push(`ERRORS: ${s.errors}`);

  lines.push("\u2501".repeat(50));
  lines.push(summaryParts.join(" | "));

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Deal resolution
// ---------------------------------------------------------------------------

function parseTags(tagsValue: unknown): string[] {
  const str = String(tagsValue ?? "");
  return str.split(";").map((t) => t.trim()).filter(Boolean);
}

export interface ResolvedPEDeal {
  dealId: string;
  dealName: string;
  address: string;
  systemType: SystemType;
  stageName: string;
  peM1Status: string | null;
  peM2Status: string | null;
  rootFolderId: string | null;
  designFolderId: string | null;
}

export async function resolvePEDeal(dealId: string): Promise<ResolvedPEDeal> {
  const props = await getDealProperties(dealId, PE_TURNOVER_PROPERTIES);
  if (!props) throw new Error(`Deal ${dealId} not found`);

  const tags = parseTags(props.tags);
  const isPE = tags.includes("Participate Energy") || props.is_participate_energy === "true";
  if (!isPE) {
    throw new Error(`Deal ${dealId} is not a Participate Energy deal (tags: ${tags.join(", ")})`);
  }

  const rawType = (props.project_type ?? "solar").toLowerCase();
  const systemType: SystemType =
    rawType === "battery" ? "battery" :
    rawType.includes("battery") || rawType.includes("storage") ? "solar+battery" :
    "solar";

  const parts = [props.address_line_1, props.city, props.state].filter(Boolean);
  const address = parts.join(", ") || "Unknown address";

  const stageId = props.dealstage ?? "";
  const stageName = DEAL_STAGE_MAP[stageId] || stageId;

  const rootFolderRaw = props.all_document_parent_folder_id ?? props.g_drive ?? "";
  const rootFolderId = extractFolderId(rootFolderRaw) ?? null;

  const designRaw = props.design_documents ?? props.all_document_parent_folder_id ?? "";
  const designFolderId = designRaw || null;

  return {
    dealId,
    dealName: props.dealname ?? "Unknown",
    address,
    systemType,
    stageName,
    peM1Status: props.pe_m1_status || null,
    peM2Status: props.pe_m2_status || null,
    rootFolderId,
    designFolderId,
  };
}

// ---------------------------------------------------------------------------
// Top-level orchestrator
// ---------------------------------------------------------------------------

export interface TurnoverAuditOptions {
  milestone?: Milestone | "both";
  verifyPhotos?: boolean;
  force?: boolean;
}

export async function runTurnoverAudit(
  dealId: string,
  options: TurnoverAuditOptions = {},
): Promise<TurnoverAuditOutput> {
  const deal = await resolvePEDeal(dealId);

  let milestones: Milestone[];
  if (options.milestone === "both") {
    milestones = ["m1", "m2"];
  } else if (options.milestone) {
    milestones = [options.milestone];
  } else {
    const inferred = inferMilestone(deal.stageName);
    if (inferred.isTerminal && !options.force) {
      throw new Error(
        `Deal is in terminal stage "${deal.stageName}". Use --force to audit anyway.`
      );
    }
    milestones = [inferred.milestone ?? "m1"];
  }

  for (const m of milestones) {
    const peStatus = m === "m1" ? deal.peM1Status : deal.peM2Status;
    if (isMilestoneTerminal(peStatus) && !options.force) {
      throw new Error(
        `PE ${m.toUpperCase()} status is "${peStatus}". Use --force to re-audit.`
      );
    }
  }

  let folderMap: FolderMap = { byPrefix: new Map(), allFolderIds: [], warnings: [] };
  if (deal.rootFolderId) {
    folderMap = await buildFolderMap(deal.rootFolderId);
  } else {
    folderMap.warnings.push("No root Drive folder ID found on deal");
  }

  const auditResults: TurnoverAuditResult[] = [];
  for (const milestone of milestones) {
    const checklist = filterChecklist(
      milestone === "m1" ? PE_M1_CHECKLIST : PE_M2_CHECKLIST,
      deal.systemType,
    );

    const peStatus = milestone === "m1" ? deal.peM1Status : deal.peM2Status;

    const rawResults = await auditDriveFiles(
      checklist,
      deal.rootFolderId ?? "",
      folderMap,
      deal.designFolderId,
      { verifyPhotos: options.verifyPhotos },
    );

    const result = buildAuditResult({
      dealId: deal.dealId,
      dealName: deal.dealName,
      address: deal.address,
      systemType: deal.systemType,
      milestone,
      peStatus,
      results: rawResults,
    });

    auditResults.push(result);
  }

  if (milestones.length === 2) {
    return auditResults as [TurnoverAuditResult, TurnoverAuditResult];
  }
  return auditResults[0];
}

// ---------------------------------------------------------------------------
// Package assembly — copies found files into a staging folder
// ---------------------------------------------------------------------------

export interface AssemblyResult {
  folderId: string;
  folderUrl: string;
  folderName: string;
  copied: number;
  skippedDuplicates: number;
  missing: string[];
  errors: string[];
}

const MILESTONE_FOLDER_NAMES: Record<Milestone, string> = {
  m1: "PE Turnover - M1",
  m2: "PE Turnover - M2",
};

/**
 * Sanitize a checklist label into a safe filename component.
 * "Countersigned Customer Agreement" → "Customer_Agreement"
 */
function sanitizeForFilename(label: string): string {
  return label
    .replace(/^(Countersigned|Signed|Approved|Final|Passed)\s+/i, "")
    .replace(/\s*\(.*?\)\s*/g, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "_")
    .trim();
}

function getFileExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(dot) : "";
}

/**
 * Build a clean destination filename for a checklist item.
 * Documents: "01_Customer_Agreement.pdf"
 * Photos: "Photo_01_Site_Address.jpg"
 */
function buildDestName(item: ChecklistItem, index: number, originalName: string): string {
  const ext = getFileExtension(originalName) || ".pdf";
  const seq = String(index + 1).padStart(2, "0");

  if (item.isPhoto && item.pePhotoNumber != null) {
    const photoNum = String(item.pePhotoNumber).padStart(2, "0");
    const cleanLabel = sanitizeForFilename(item.label);
    return `Photo_${photoNum}_${cleanLabel}${ext}`;
  }

  const cleanLabel = sanitizeForFilename(item.label);
  return `${seq}_${cleanLabel}${ext}`;
}

/**
 * Generate manifest text for the assembled package.
 */
function generateManifest(result: TurnoverAuditResult, copiedFiles: Map<string, string>): string {
  const lines: string[] = [];
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");

  lines.push(`PE TURNOVER PACKAGE MANIFEST`);
  lines.push(`Generated: ${now}`);
  lines.push(`Deal: ${result.dealName}`);
  lines.push(`Address: ${result.address}`);
  lines.push(`System Type: ${result.systemType}`);
  lines.push(`Milestone: ${result.milestone.toUpperCase()}`);
  if (result.peStatus) lines.push(`PE Status: ${result.peStatus}`);
  lines.push("");
  lines.push("=".repeat(60));
  lines.push("");

  for (const cat of result.categories) {
    lines.push(`${cat.label}`);
    lines.push("-".repeat(40));

    for (const r of cat.items) {
      const destName = copiedFiles.get(r.item.id);
      if (r.status === "found" || r.status === "likely") {
        const marker = r.combinedFile ? " (combined)" : "";
        lines.push(`  [INCLUDED] ${r.item.label}${marker}`);
        if (destName) lines.push(`             → ${destName}`);
      } else if (r.status === "not_applicable") {
        lines.push(`  [N/A]      ${r.item.label}`);
      } else if (r.status === "needs_review") {
        lines.push(`  [REVIEW]   ${r.item.label}`);
        if (r.statusNote) lines.push(`             ${r.statusNote}`);
      } else if (r.status === "missing") {
        lines.push(`  [MISSING]  ${r.item.label}`);
      } else if (r.status === "error") {
        lines.push(`  [ERROR]    ${r.item.label}: ${r.statusNote ?? "unknown error"}`);
      }
    }
    lines.push("");
  }

  lines.push("=".repeat(60));
  const s = result.summary;
  lines.push(`INCLUDED: ${s.found}  |  MISSING: ${s.missing}  |  REVIEW: ${s.needsReview}  |  N/A: ${s.notApplicable}`);

  return lines.join("\n");
}

/**
 * Find a unique folder name by appending (2), (3), etc. if the base name exists.
 */
async function findUniqueFolderName(
  parentId: string,
  baseName: string,
): Promise<string> {
  const existing = await listDriveSubfolders(parentId);
  const existingNames = new Set(existing.map((f) => f.name));

  if (!existingNames.has(baseName)) return baseName;

  let version = 2;
  while (existingNames.has(`${baseName} (${version})`)) {
    version++;
  }
  return `${baseName} (${version})`;
}

/**
 * Assemble a PE turnover package: copy found files into a staging folder in Drive.
 */
export async function assemblePackage(
  auditResult: TurnoverAuditResult,
  rootFolderId: string,
): Promise<AssemblyResult> {
  const baseName = MILESTONE_FOLDER_NAMES[auditResult.milestone];
  const folderName = await findUniqueFolderName(rootFolderId, baseName);
  const folder = await createDriveFolder(rootFolderId, folderName);

  const copiedFileIds = new Set<string>();
  const copiedFiles = new Map<string, string>(); // item ID → dest filename
  const missing: string[] = [];
  const errors: string[] = [];
  let copied = 0;
  let skippedDuplicates = 0;

  // Flatten all results in order for sequential numbering
  const allResults = auditResult.categories.flatMap((c) => c.items);

  for (let i = 0; i < allResults.length; i++) {
    const r = allResults[i];

    if (r.status === "missing") {
      missing.push(r.item.label);
      continue;
    }

    if (r.status !== "found" && r.status !== "likely") continue;
    if (!r.foundFile) continue;

    // Skip if this exact file was already copied (combined files)
    if (copiedFileIds.has(r.foundFile.id)) {
      skippedDuplicates++;
      // Still record in manifest which name it maps to
      const existingName = [...copiedFiles.entries()]
        .find(([, name]) => {
          // find by matching file ID through the already-copied results
          const prev = allResults.find((pr) => copiedFiles.get(pr.item.id) === name && pr.foundFile?.id === r.foundFile!.id);
          return !!prev;
        })?.[1];
      if (existingName) copiedFiles.set(r.item.id, existingName);
      continue;
    }

    const destName = buildDestName(r.item, i, r.foundFile.name);

    try {
      await copyDriveFile(r.foundFile.id, folder.id, destName);
      copiedFileIds.add(r.foundFile.id);
      copiedFiles.set(r.item.id, destName);
      copied++;
    } catch (err) {
      errors.push(`Failed to copy ${r.item.label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Upload manifest
  const manifest = generateManifest(auditResult, copiedFiles);
  try {
    await uploadDriveTextFile(folder.id, "_MANIFEST.txt", manifest);
  } catch (err) {
    errors.push(`Failed to upload manifest: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    folderId: folder.id,
    folderUrl: `https://drive.google.com/drive/folders/${folder.id}`,
    folderName,
    copied,
    skippedDuplicates,
    missing,
    errors,
  };
}
