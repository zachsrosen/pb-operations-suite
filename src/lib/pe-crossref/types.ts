/**
 * PE Cross-Reference — shared types
 *
 * See docs/superpowers/specs/2026-05-18-pe-action-tasks-cross-reference-design.md
 */

import type { ResolvedPEDeal } from "@/lib/pe-turnover";

export const TASK_SEVERITY = ["critical", "major", "conditional", "monitoring"] as const;
export type TaskSeverity = (typeof TASK_SEVERITY)[number];

export const TASK_CATEGORY = ["hardware", "so", "planset", "photo", "monitoring"] as const;
export type TaskCategory = (typeof TASK_CATEGORY)[number];

export const TASK_STATUS = ["OPEN", "RESOLVED_AUTO", "RESOLVED_MANUAL", "DISMISSED"] as const;
export type TaskStatus = (typeof TASK_STATUS)[number];

/**
 * What an analyzer emits when it detects a problem. Pure data — no DB ids,
 * no state. Reconciler maps to PeActionTask rows.
 */
export interface DetectedTask {
  pCode: string;
  identityKey: string;
  severity: TaskSeverity;
  category: TaskCategory;
  analyzer: string;
  title: string;
  message: string;
  action: string;
  evidence: Record<string, unknown>;
}

/**
 * Result of running structured extractors on a deal. Analyzers consume this.
 * Any extractor may fail — its slot is null and the analyzer skips.
 */
export interface CrossRefContext {
  deal: ResolvedPEDeal;
  planset: ExtractedPlanset | null;
  salesOrder: NormalizedSalesOrder | null;
  powerHubAsset: PowerHubAssetSummary | null;
  installPhotos: InstallPhotoRef[];
  /** photoFileId -> NameplateData. Empty map = no nameplate extracted. */
  nameplateExtractions: Map<string, NameplateData>;
  monitoringFolder: MonitoringFolderScan | null;
  /** Most recent completed PE audit run — used by PhotoCritiqueAnalyzer. */
  latestAuditRun: AuditRunSummary | null;
}

export interface ExtractedPlanset {
  fileId: string;
  fileName: string;
  specsByPage: Array<{
    page: number;
    pw3Model: string | null;
    bsModel: string | null;
    expansionUnitModel: string | null;
    moduleBrand: string | null;
    moduleQty: number | null;
    inverterModel: string | null;
  }>;
}

export interface NormalizedSalesOrder {
  soNumber: string;
  customerName: string;
  lineItems: Array<{
    index: number;
    sku: string | null;
    description: string;
    qty: number;
  }>;
}

export interface PowerHubAssetSummary {
  siteId: string;
  powerwallEntries: Array<{ model: string; serial?: string }>;
}

export interface InstallPhotoRef {
  fileId: string;
  fileName: string;
  source: "drive" | "zuper";
}

export interface NameplateData {
  photoFileId: string;
  detectedModel: string | null;
  detectedSerial: string | null;
  notes: string;
}

export interface MonitoringFolderScan {
  m1FolderId: string;
  hasOriginalScreenshot: boolean;
  correctedScreenshotFile: { id: string; name: string; modifiedTime: string } | null;
}

export interface AuditRunSummary {
  runId: string;
  photoAssignments: Map<string, { photoFileId: string; checklistLabel: string }>;
}

/**
 * Analyzer interface. Pure function — no I/O, no DB writes.
 * Orchestrator runs all analyzers in parallel and feeds results to reconciler.
 */
export interface Analyzer {
  readonly name: string;
  readonly version: string;
  detectTasks(context: CrossRefContext): Promise<DetectedTask[]>;
}
