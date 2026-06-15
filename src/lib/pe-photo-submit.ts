/**
 * pe-photo-submit.ts
 * Pure (no network, no FS) helpers shared by the pe-final-permit-photos and
 * pe-policy-photos skills. All exported symbols are unit-tested.
 */

import { PE_M1_CHECKLIST, filterChecklist, type SystemType } from "@/lib/pe-turnover";

// ---------------------------------------------------------------------------
// Task 1: Doc-type config
// ---------------------------------------------------------------------------

export type DocType = "final-permit" | "policy-photos";

export interface DocConfig {
  /**
   * Dedicated HubSpot deal folder properties (URL-style) to resolve the source
   * Drive folder from, in priority order. These point at the real per-category
   * folders (photos are nested in subfolders within them, so list recursively).
   */
  folderProps: string[];
  /**
   * Fallback: numbered Drive subfolder prefixes under the all-documents parent,
   * used only when none of `folderProps` is populated on the deal.
   */
  sourceFolders: string[];
  peDocKey: "signedFinalPermit" | "photos";
  embedsSalesOrder: boolean;
  outputDir: string;            // ~/Downloads subdir
}

export const DOC_CONFIGS: Record<DocType, DocConfig> = {
  "final-permit": {
    folderProps: ["inspection_documents", "permit_documents"],
    sourceFolders: ["6", "3"],
    peDocKey: "signedFinalPermit",
    embedsSalesOrder: false,
    outputDir: "pe-final-permit-pdfs",
  },
  "policy-photos": {
    folderProps: ["installation_documents"],
    sourceFolders: ["5"],
    peDocKey: "photos",
    embedsSalesOrder: true,
    outputDir: "pe-policy-photos-pdfs",
  },
};

// ---------------------------------------------------------------------------
// Task 2: Output filename derivation
// ---------------------------------------------------------------------------

const sanitize = (s: string) => s.replace(/[\/\\:*?"<>|]/g, "_").trim();

export function finalPermitFilename(projCode: string, lastName: string): string {
  return `${projCode}_${sanitize(lastName)}_Final_Permit.pdf`;
}

export function policyPhotosFilename(addr: { street?: string; city?: string }): string {
  const street = sanitize(addr.street ?? "");
  const city = sanitize(addr.city ?? "");
  if (!street && !city) return "UNKNOWN_address.pdf";
  return `${[street, city].filter(Boolean).join("_")}.pdf`;
}

// ---------------------------------------------------------------------------
// Task 3: Low-res / sliver image detection (the Torpey guard)
// ---------------------------------------------------------------------------

export interface UsableResult { ok: boolean; reason?: string; }

// Minimums chosen so real screenshots/photos pass but slivers/thumbnails fail.
const MIN_DIM = 400;        // px on the short side
const MAX_ASPECT = 4.5;     // long:short ratio

export function isUsableImage(width: number, height: number): UsableResult {
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  if (short < MIN_DIM) return { ok: false, reason: `too small (${width}x${height})` };
  if (long / short > MAX_ASPECT) return { ok: false, reason: `extreme aspect (${width}x${height})` };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Task 4: Deal disambiguation by PE address (the Bucey guard)
// ---------------------------------------------------------------------------

export interface DealLike { id: string; address: string; }
export interface PickResult { deal: DealLike | null; ambiguous: boolean; }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
// Leading street number + first street token, e.g. "1365 georgetown".
const streetKey = (s: string) => {
  const n = norm(s);
  const m = n.match(/^(\d+)\s+(\w+)/);
  return m ? `${m[1]} ${m[2]}` : n.split(" ").slice(0, 2).join(" ");
};

export function pickDealByAddress(deals: DealLike[], peAddress: string): PickResult {
  if (deals.length === 1) return { deal: deals[0], ambiguous: false };
  const target = streetKey(peAddress);
  const matches = deals.filter((d) => streetKey(d.address) === target);
  if (matches.length === 1) return { deal: matches[0], ambiguous: false };
  return { deal: null, ambiguous: true };
}

// ---------------------------------------------------------------------------
// Task 5: Shot ordering for policy photos
// ---------------------------------------------------------------------------

export interface ClassifiedPhoto { fileId: string; shotId: string; }

export function orderPolicyPhotos(photos: ClassifiedPhoto[], systemType: SystemType): ClassifiedPhoto[] {
  const applicable = filterChecklist(PE_M1_CHECKLIST.filter((i) => i.isPhoto), systemType);
  const rank = new Map(applicable.map((item, idx) => [item.id, idx]));
  return photos
    .filter((p) => rank.has(p.shotId))
    .map((p, inputIdx) => ({ p, inputIdx }))
    .sort((a, b) => (rank.get(a.p.shotId)! - rank.get(b.p.shotId)!) || (a.inputIdx - b.inputIdx))
    .map(({ p }) => p);
}

// ---------------------------------------------------------------------------
// Task 6: Target argument parsing
// ---------------------------------------------------------------------------

export type TargetRequest =
  | { mode: "single"; value: string }
  | { mode: "list"; codes: string[] }
  | { mode: "recent"; hours: number; mineOnly: boolean };

export function parseTarget(opts: { project?: string; batch?: string; hours?: number }): TargetRequest {
  if (opts.project) return { mode: "single", value: opts.project.trim() };
  if (opts.batch === "recent") return { mode: "recent", hours: opts.hours ?? 24, mineOnly: true };
  if (opts.batch) {
    const codes = opts.batch.split(",").map((c) => c.trim()).filter(Boolean);
    return { mode: "list", codes };
  }
  throw new Error("Provide a project or batch target");
}
