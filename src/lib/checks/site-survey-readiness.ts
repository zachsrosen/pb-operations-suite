/**
 * Site Survey Readiness Checks
 *
 * Scans a project's Google Drive site survey folder and categorizes files
 * against the IDR (Initial Design Review) checklist. Runs as both:
 * - Deterministic checks in the check engine (webhook-triggered)
 * - On-demand via the Claude Code skill
 *
 * Three survey naming systems are handled:
 *   A) Descriptive names (current survey form): Roof_Photos0, Additional_Electrical_Panels3
 *   B) UUID filenames (3422 survey app): c86e4244-…jpg + large report PDF
 *   C) Generic camera names: LM001, DC001, DJI_0042
 */

import { registerChecks } from "./index";
import type { CheckFn } from "./types";
import { getDriveToken, extractFolderId } from "@/lib/drive-plansets";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DriveFile {
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
  parentFolder: string;
}

export type SurveySystem = "descriptive" | "uuid-3422" | "generic-camera";

export interface SurveyCheckResult {
  system: SurveySystem;
  totalFiles: number;
  files: DriveFile[];
  installLocationPhotos: DriveFile[];
  existingEquipmentPhotos: DriveFile[];
  solarviewPhotos: DriveFile[];
  cwbPhotos: DriveFile[];
  atticPhotos: DriveFile[];
  sitePlanPhotos: DriveFile[];
  surveyReportPdf: DriveFile[];
  jhaForm: DriveFile[];
  essPhotos: DriveFile[];
  hasLargeReportPdf: boolean;
}

// ---------------------------------------------------------------------------
// File listing helpers (mirrors scripts/list-drive-files.ts for server-side)
// ---------------------------------------------------------------------------

interface RawDriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
}

/** Error thrown when Drive API calls fail, so callers can distinguish API failures from empty folders. */
export class DriveApiError extends Error {
  public readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "DriveApiError";
    this.status = status;
  }
}

async function listFilesInFolder(folderId: string, token: string): Promise<RawDriveFile[]> {
  const query = `'${folderId}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed=false`;
  const fields = "files(id,name,mimeType,modifiedTime,size),nextPageToken";
  let allFiles: RawDriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const url =
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}` +
      `&fields=${encodeURIComponent(fields)}` +
      `&orderBy=${encodeURIComponent("modifiedTime desc")}` +
      `&pageSize=100` +
      `&supportsAllDrives=true&includeItemsFromAllDrives=true` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new DriveApiError(
        `Drive API ${res.status} listing files in ${folderId}: ${body.slice(0, 200)}`,
        res.status,
      );
    }
    const data = (await res.json()) as { files?: RawDriveFile[]; nextPageToken?: string };
    allFiles = allFiles.concat(data.files ?? []);
    pageToken = data.nextPageToken;
  } while (pageToken);

  return allFiles;
}

async function listSubfolders(folderId: string, token: string): Promise<Array<{ id: string; name: string }>> {
  const query = `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed=false`;
  const fields = "files(id,name)";
  const url =
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}` +
    `&fields=${encodeURIComponent(fields)}` +
    `&pageSize=50` +
    `&supportsAllDrives=true&includeItemsFromAllDrives=true`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new DriveApiError(
      `Drive API ${res.status} listing subfolders in ${folderId}: ${body.slice(0, 200)}`,
      res.status,
    );
  }
  const data = (await res.json()) as { files?: Array<{ id: string; name: string }> };
  return data.files ?? [];
}

/** Recursively list all files in a Drive folder, up to maxDepth levels. */
export async function walkDriveFolder(
  folderId: string,
  folderName: string,
  token: string,
  depth = 0,
  maxDepth = 3,
): Promise<DriveFile[]> {
  if (depth > maxDepth) return [];

  const results: DriveFile[] = [];

  const files = await listFilesInFolder(folderId, token);
  for (const f of files) {
    results.push({
      name: f.name,
      mimeType: f.mimeType,
      modifiedTime: f.modifiedTime,
      size: f.size,
      parentFolder: folderName,
    });
  }

  const subfolders = await listSubfolders(folderId, token);
  for (const sf of subfolders) {
    const subPath = folderName ? `${folderName}/${sf.name}` : sf.name;
    const subFiles = await walkDriveFolder(sf.id, subPath, token, depth + 1, maxDepth);
    results.push(...subFiles);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Survey folder resolution
// ---------------------------------------------------------------------------

/** Site survey subfolder patterns. */
const SITE_SURVEY_FOLDER_PATTERNS = [
  /site\s*survey/i,
  /^1\.\s*site\s*survey$/i,
  /^ss$/i,
];

/**
 * Find the site survey folder ID from deal properties.
 * Priority: site_survey_documents > all_document_parent_folder_id (navigate to subfolder).
 */
export async function resolveSurveyFolderId(
  properties: Record<string, string | null>,
  token: string,
): Promise<string | null> {
  // 1. Direct site_survey_documents link
  const ssDoc = properties.site_survey_documents;
  if (ssDoc) {
    const id = extractFolderId(ssDoc);
    if (id) return id;
  }

  // 2. Navigate from root project folder
  const rootFolder = properties.all_document_parent_folder_id;
  if (!rootFolder) return null;

  const rootId = extractFolderId(rootFolder);
  if (!rootId) return null;

  const subfolders = await listSubfolders(rootId, token);
  const match = subfolders.find((sf) =>
    SITE_SURVEY_FOLDER_PATTERNS.some((p) => p.test(sf.name)),
  );
  return match?.id ?? null;
}

// ---------------------------------------------------------------------------
// Survey system detection
// ---------------------------------------------------------------------------

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\./i;
const DESCRIPTIVE_PATTERN = /^[A-Z][a-z]+(_[A-Z]?[a-z]+)+\d*\./;
const CAMERA_NAME_PATTERN = /^(LM|DC|DJI|IMG|DSC|DCIM|PXL|MVIMG|BURST|Screenshot)[_\-]?\d/i;

export function detectSurveySystem(files: DriveFile[]): SurveySystem {
  const imageFiles = files.filter((f) => f.mimeType.startsWith("image/"));
  if (imageFiles.length === 0) return "generic-camera";

  let uuidCount = 0;
  let descriptiveCount = 0;
  let cameraCount = 0;

  for (const f of imageFiles) {
    if (UUID_PATTERN.test(f.name)) uuidCount++;
    else if (DESCRIPTIVE_PATTERN.test(f.name)) descriptiveCount++;
    else if (CAMERA_NAME_PATTERN.test(f.name)) cameraCount++;
  }

  const total = imageFiles.length;
  if (uuidCount > total * 0.5) return "uuid-3422";
  if (descriptiveCount > total * 0.5) return "descriptive";
  return "generic-camera";
}

// ---------------------------------------------------------------------------
// File categorization
// ---------------------------------------------------------------------------

/** System A (descriptive names) — pattern-based categorization. */
const CATEGORY_PATTERNS = {
  installLocation: [
    /Roof_Photos/i, /360_Degree_Photos/i, /All_Possible_Exterior/i,
    /ground_mount/i, /array_area/i, /^DJI/i,
  ],
  existingEquipment: [
    /Photos_of_Main_Service_Panel/i, /Utility_Meter/i, /meter_height/i,
    /MSD/i, /dead_front/i, /breakers_labels/i, /conductor_sizes/i,
    /Additional_Electrical_Panels/i, /Voltage_Readings/i, /Circuit_Run_Photos/i,
  ],
  solarview: [
    /^SolarView/i, /^solar_view/i,
  ],
  cwb: [
    /Cold_Water_Bond/i, /cwb/i, /water_bond/i,
  ],
  attic: [
    /All_Possible_Interior/i, /attic/i, /rafter/i, /truss/i,
    /sheathing/i, /roof_structure/i,
  ],
  ess: [
    /ESS_photos/i, /battery_location/i, /energy_storage/i,
  ],
  sitePlan: [
    /Upload_Overhead_Photo_With_Equipment_Locations_Site_Plan/i,
    /site_plan/i, /overhead/i,
  ],
  surveyReport: [
    /site_survey.*\.pdf$/i,
  ],
  jha: [
    /jha_form.*\.pdf$/i,
  ],
};

/**
 * Important: Upload_Overhead_Photo_With_Equipment_Locations_Site_Plan is NOT a solarview.
 * Solarviews are specifically labeled mockup images (SolarView, solar_view).
 * Site plans are overhead/layout photos — different category entirely.
 */
function matchesAny(name: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(name));
}

/** Check if a file is a large PDF report (>5 MB) — indicative of 3422 survey report. */
function isLargeReportPdf(file: DriveFile): boolean {
  if (!file.mimeType.includes("pdf")) return false;
  const sizeBytes = parseInt(file.size ?? "0", 10);
  return sizeBytes > 5 * 1024 * 1024; // > 5 MB
}

export function categorizeFiles(files: DriveFile[], system: SurveySystem): SurveyCheckResult {
  const result: SurveyCheckResult = {
    system,
    totalFiles: files.length,
    files,
    installLocationPhotos: [],
    existingEquipmentPhotos: [],
    solarviewPhotos: [],
    cwbPhotos: [],
    atticPhotos: [],
    sitePlanPhotos: [],
    surveyReportPdf: [],
    jhaForm: [],
    essPhotos: [],
    hasLargeReportPdf: false,
  };

  for (const file of files) {
    const name = file.name;

    // Large report PDF check (any system)
    if (isLargeReportPdf(file)) {
      result.hasLargeReportPdf = true;
      result.surveyReportPdf.push(file);
    }

    if (system === "descriptive") {
      // System A: match against descriptive name patterns
      if (matchesAny(name, CATEGORY_PATTERNS.installLocation)) result.installLocationPhotos.push(file);
      if (matchesAny(name, CATEGORY_PATTERNS.existingEquipment)) result.existingEquipmentPhotos.push(file);
      if (matchesAny(name, CATEGORY_PATTERNS.solarview)) result.solarviewPhotos.push(file);
      if (matchesAny(name, CATEGORY_PATTERNS.cwb)) result.cwbPhotos.push(file);
      if (matchesAny(name, CATEGORY_PATTERNS.attic)) result.atticPhotos.push(file);
      if (matchesAny(name, CATEGORY_PATTERNS.ess)) result.essPhotos.push(file);
      if (matchesAny(name, CATEGORY_PATTERNS.sitePlan)) result.sitePlanPhotos.push(file);
      if (matchesAny(name, CATEGORY_PATTERNS.surveyReport)) result.surveyReportPdf.push(file);
      if (matchesAny(name, CATEGORY_PATTERNS.jha)) result.jhaForm.push(file);
    } else {
      // System B (UUID) or System C (camera): solarviews are still named distinctly
      if (matchesAny(name, CATEGORY_PATTERNS.solarview)) result.solarviewPhotos.push(file);
      // Some descriptive files may be mixed in — catch them
      if (matchesAny(name, CATEGORY_PATTERNS.installLocation)) result.installLocationPhotos.push(file);
      if (matchesAny(name, CATEGORY_PATTERNS.existingEquipment)) result.existingEquipmentPhotos.push(file);
      if (matchesAny(name, CATEGORY_PATTERNS.cwb)) result.cwbPhotos.push(file);
      if (matchesAny(name, CATEGORY_PATTERNS.attic)) result.atticPhotos.push(file);
      if (matchesAny(name, CATEGORY_PATTERNS.surveyReport)) result.surveyReportPdf.push(file);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Project type helpers
// ---------------------------------------------------------------------------

/** Check if the project includes PV (solar panels) based on deal properties. */
export function projectIncludesPV(properties: Record<string, string | null>): boolean {
  const projectType = (properties.project_type ?? "").toLowerCase();
  if (projectType.includes("solar") || projectType.includes("pv")) return true;
  // If project_type is vague, check for module info
  const moduleCount = parseInt(properties.module_count ?? "0", 10);
  const moduleBrand = properties.module_brand ?? "";
  return moduleCount > 0 || moduleBrand.length > 0;
}

// ---------------------------------------------------------------------------
// Full scan orchestrator
// ---------------------------------------------------------------------------

/**
 * Scan a deal's site survey folder and produce categorized results.
 * This is the core function used by both the webhook and the skill.
 */
export async function scanSurveyFolder(
  properties: Record<string, string | null>,
): Promise<{ result: SurveyCheckResult; folderId: string | null; error?: string }> {
  const token = await getDriveToken();
  const folderId = await resolveSurveyFolderId(properties, token);

  if (!folderId) {
    return {
      result: {
        system: "descriptive",
        totalFiles: 0,
        files: [],
        installLocationPhotos: [],
        existingEquipmentPhotos: [],
        solarviewPhotos: [],
        cwbPhotos: [],
        atticPhotos: [],
        sitePlanPhotos: [],
        surveyReportPdf: [],
        jhaForm: [],
        essPhotos: [],
        hasLargeReportPdf: false,
      },
      folderId: null,
      error: "No site survey folder found — site_survey_documents and all_document_parent_folder_id are both empty",
    };
  }

  const files = await walkDriveFolder(folderId, "", token);
  const system = detectSurveySystem(files);
  const result = categorizeFiles(files, system);

  return { result, folderId };
}

// ---------------------------------------------------------------------------
// Check engine functions
// ---------------------------------------------------------------------------

const installLocationCheck: CheckFn = async (ctx) => {
  const scan = await scanSurveyFolder(ctx.properties);
  if (scan.error) {
    return { check: "ss-install-location", severity: "error", message: scan.error, field: "site_survey_documents" };
  }

  const { result } = scan;
  if (result.system === "descriptive") {
    if (result.installLocationPhotos.length === 0) {
      return { check: "ss-install-location", severity: "error", message: "No install location photos found (expected Roof_Photos, 360_Degree_Photos, or similar)" };
    }
  } else {
    // UUID/camera: check total photo count or report PDF
    if (result.totalFiles < 5 && !result.hasLargeReportPdf) {
      return { check: "ss-install-location", severity: "error", message: `Only ${result.totalFiles} files in survey folder — expected 20+ photos for a thorough survey` };
    }
  }
  return null;
};

const existingEquipmentCheck: CheckFn = async (ctx) => {
  const scan = await scanSurveyFolder(ctx.properties);
  if (scan.error) return null; // Already flagged by install location check

  const { result } = scan;
  if (result.system === "descriptive") {
    if (result.existingEquipmentPhotos.length === 0) {
      return { check: "ss-existing-equipment", severity: "error", message: "No existing equipment photos found (expected Main_Service_Panel, Utility_Meter, or similar)" };
    }
  }
  // For UUID/camera systems, equipment photos are covered by the report PDF or total count
  return null;
};

const solarviewCheck: CheckFn = async (ctx) => {
  const scan = await scanSurveyFolder(ctx.properties);
  if (scan.error) return null;

  if (scan.result.solarviewPhotos.length === 0) {
    return {
      check: "ss-solarviews",
      severity: "error",
      message: "No solarview mockup photos found — solarviews are specifically labeled images (e.g., SolarView (Customer Name).jpeg) showing proposed equipment on the site photo",
    };
  }
  return null;
};

const cwbCheck: CheckFn = async (ctx) => {
  const scan = await scanSurveyFolder(ctx.properties);
  if (scan.error) return null;

  const { result } = scan;
  if (result.system === "descriptive" && result.cwbPhotos.length === 0) {
    return { check: "ss-cwb-photos", severity: "warning", message: "No Cold Water Bond photos found in survey folder" };
  }
  if (result.system !== "descriptive" && result.cwbPhotos.length === 0) {
    return { check: "ss-cwb-photos", severity: "warning", message: "Unable to verify CWB photos — filenames are not descriptive. Check survey report PDF." };
  }
  return null;
};

const atticCheck: CheckFn = async (ctx) => {
  const isPV = projectIncludesPV(ctx.properties);
  if (!isPV) return null; // Attic photos not required for battery-only

  const scan = await scanSurveyFolder(ctx.properties);
  if (scan.error) return null;

  const { result } = scan;
  if (result.system === "descriptive" && result.atticPhotos.length === 0) {
    return { check: "ss-attic-photos", severity: "error", message: "No attic/interior photos found — required for PV projects (rafter spacing, sheathing, obstructions)" };
  }
  if (result.system !== "descriptive" && result.atticPhotos.length === 0) {
    return { check: "ss-attic-photos", severity: "warning", message: "Unable to verify attic photos — filenames are not descriptive. Check survey report PDF. Required for PV projects." };
  }
  return null;
};

const surveyStatusCheck: CheckFn = async (ctx) => {
  const status = ctx.properties.site_survey_status;
  const completed = ctx.properties.is_site_survey_completed_;
  if (!status && !completed) {
    return { check: "ss-survey-status", severity: "info", message: "Site survey status not set — survey may still be in progress", field: "site_survey_status" };
  }
  if (status && !["Complete", "Completed", "Done"].includes(status)) {
    return { check: "ss-survey-status", severity: "info", message: `Site survey status: "${status}" — not marked complete`, field: "site_survey_status" };
  }
  return null;
};

const photoCountCheck: CheckFn = async (ctx) => {
  const scan = await scanSurveyFolder(ctx.properties);
  if (scan.error) return null;

  const imageCount = scan.result.files.filter((f) => f.mimeType.startsWith("image/")).length;
  if (imageCount < 20 && !scan.result.hasLargeReportPdf) {
    return { check: "ss-photo-count", severity: "warning", message: `Only ${imageCount} photos in survey folder — a thorough survey typically has 30-70 photos` };
  }
  return null;
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

registerChecks("site-survey-readiness", [
  surveyStatusCheck,
  installLocationCheck,
  existingEquipmentCheck,
  solarviewCheck,
  cwbCheck,
  atticCheck,
  photoCountCheck,
]);

// ---------------------------------------------------------------------------
// Optimized scan for webhook (single Drive walk, multiple checks)
// ---------------------------------------------------------------------------

export interface SurveyReadinessReport {
  dealId: string;
  dealName: string;
  projectType: string;
  surveyor: string | null;
  surveyDate: string | null;
  surveyStatus: string | null;
  surveySystem: SurveySystem;
  folderId: string | null;
  totalFiles: number;
  checklist: Array<{
    item: string;
    status: "pass" | "missing" | "not_found" | "na" | "unable_to_verify";
    severity: "error" | "warning" | "info";
    count: number;
    note: string;
  }>;
  readyForIDR: boolean;
  actionItems: string[];
}

/**
 * Run the full readiness report in a single pass (one Drive walk).
 * Used by the webhook to avoid redundant API calls.
 */
export async function runReadinessReport(
  dealId: string,
  properties: Record<string, string | null>,
): Promise<SurveyReadinessReport> {
  const scan = await scanSurveyFolder(properties);
  const { result, folderId, error } = scan;
  const isPV = projectIncludesPV(properties);

  const dealName = properties.dealname ?? dealId;
  const projectType = properties.project_type ?? "Unknown";
  const surveyStatus = properties.site_survey_status ?? null;
  const surveyDate = properties.site_survey_date ?? null;

  const checklist: SurveyReadinessReport["checklist"] = [];
  const actionItems: string[] = [];

  if (error) {
    checklist.push({
      item: "Survey folder",
      status: "missing",
      severity: "error",
      count: 0,
      note: error,
    });
    actionItems.push("No survey folder linked — add site_survey_documents URL to deal");

    return {
      dealId,
      dealName,
      projectType,
      surveyor: properties.site_surveyor ?? null,
      surveyDate,
      surveyStatus,
      surveySystem: "descriptive",
      folderId: null,
      totalFiles: 0,
      checklist,
      readyForIDR: false,
      actionItems,
    };
  }

  // 1. Install location photos
  if (result.system === "descriptive") {
    if (result.installLocationPhotos.length > 0) {
      checklist.push({ item: "Install location photos", status: "pass", severity: "error", count: result.installLocationPhotos.length, note: `${result.installLocationPhotos.length} photos found` });
    } else {
      checklist.push({ item: "Install location photos", status: "missing", severity: "error", count: 0, note: "No install location photos found" });
      actionItems.push("Install location photos missing — need roof, ground mount, or exterior photos");
    }
  } else {
    // UUID/camera: assume covered if enough photos or report PDF
    if (result.totalFiles >= 20 || result.hasLargeReportPdf) {
      checklist.push({ item: "Install location photos", status: "pass", severity: "error", count: result.totalFiles, note: `${result.totalFiles} files in folder${result.hasLargeReportPdf ? " + survey report PDF" : ""}` });
    } else {
      checklist.push({ item: "Install location photos", status: "unable_to_verify", severity: "error", count: result.totalFiles, note: `Only ${result.totalFiles} files — filenames not descriptive` });
      actionItems.push(`Only ${result.totalFiles} files in survey folder — verify completeness manually`);
    }
  }

  // 2. Existing equipment photos
  if (result.system === "descriptive") {
    if (result.existingEquipmentPhotos.length > 0) {
      checklist.push({ item: "Existing equipment photos", status: "pass", severity: "error", count: result.existingEquipmentPhotos.length, note: `${result.existingEquipmentPhotos.length} equipment photos` });
    } else {
      checklist.push({ item: "Existing equipment photos", status: "missing", severity: "error", count: 0, note: "No panel/meter/breaker photos found" });
      actionItems.push("Existing equipment photos missing — need main service panel, utility meter, breakers");
    }
  } else {
    // Non-descriptive systems: equipment photos can't be verified by filename alone.
    // Matches check engine behavior (existingEquipmentCheck returns null/pass for these).
    if (result.hasLargeReportPdf) {
      checklist.push({ item: "Existing equipment photos", status: "pass", severity: "warning", count: 0, note: "Covered by comprehensive survey report PDF" });
    } else {
      checklist.push({ item: "Existing equipment photos", status: "unable_to_verify", severity: "warning", count: 0, note: "Cannot verify from non-descriptive filenames — check survey report" });
    }
  }

  // 3. Solarviews (required — all systems)
  if (result.solarviewPhotos.length > 0) {
    checklist.push({ item: "Solarviews", status: "pass", severity: "error", count: result.solarviewPhotos.length, note: result.solarviewPhotos.map((f) => f.name).join(", ") });
  } else {
    checklist.push({ item: "Solarviews", status: "missing", severity: "error", count: 0, note: "No solarview mockup photos found" });
    actionItems.push("Solarviews need to be created — photo mockup of proposed equipment on site");
  }

  // 4. CWB photos
  if (result.cwbPhotos.length > 0) {
    checklist.push({ item: "CWB photos", status: "pass", severity: "warning", count: result.cwbPhotos.length, note: `${result.cwbPhotos.length} Cold Water Bond photos` });
  } else if (result.system === "descriptive") {
    checklist.push({ item: "CWB photos", status: "not_found", severity: "warning", count: 0, note: "No Cold Water Bond photos found" });
    actionItems.push("No CWB photos — verify grounding documentation exists");
  } else {
    checklist.push({ item: "CWB photos", status: "unable_to_verify", severity: "warning", count: 0, note: "Cannot verify CWB from non-descriptive filenames — check survey report" });
  }

  // 5. Attic/interior photos (conditional on PV)
  if (!isPV) {
    checklist.push({ item: "Attic photos", status: "na", severity: "info", count: 0, note: "Not required for battery-only project" });
  } else if (result.system === "descriptive") {
    if (result.atticPhotos.length > 0) {
      checklist.push({ item: "Attic photos", status: "pass", severity: "error", count: result.atticPhotos.length, note: `${result.atticPhotos.length} interior/attic photos` });
    } else {
      checklist.push({ item: "Attic photos", status: "missing", severity: "error", count: 0, note: "Required for PV — need rafter spacing, sheathing, obstructions" });
      actionItems.push("Attic/interior photos missing — required for PV project");
    }
  } else {
    if (result.atticPhotos.length > 0) {
      checklist.push({ item: "Attic photos", status: "pass", severity: "error", count: result.atticPhotos.length, note: `${result.atticPhotos.length} attic photos found` });
    } else {
      checklist.push({ item: "Attic photos", status: "unable_to_verify", severity: "warning", count: 0, note: "Cannot verify attic photos from non-descriptive filenames — check survey report" });
      actionItems.push("Verify attic/rafter photos in survey report PDF — required for PV");
    }
  }

  // Determine readiness: all error-severity items must pass or be N/A
  const readyForIDR = checklist
    .filter((c) => c.severity === "error")
    .every((c) => c.status === "pass" || c.status === "na");

  return {
    dealId,
    dealName,
    projectType,
    surveyor: properties.site_surveyor ?? null,
    surveyDate,
    surveyStatus,
    surveySystem: result.system,
    folderId,
    totalFiles: result.totalFiles,
    checklist,
    readyForIDR,
    actionItems,
  };
}
