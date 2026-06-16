/**
 * pe-photo-package.ts
 *
 * Shared assembly helpers extracted from scripts/pe-photo-submit.ts so that
 * forthcoming web API routes can import the same logic without duplicating it.
 *
 * The CLI orchestrator (scripts/pe-photo-submit.ts) delegates to this module
 * for the pieces that are reusable across the CLI and the web API:
 *   - normalizeSystemType
 *   - DealSearchResult / searchDealsByPeCode
 *   - resolveSourceFolderId
 *   - locateSalesOrderPdf
 *   - appendImagePage (captioned, full-page PDF page)
 *   - UsableImage interface
 *   - resolveDealContext (full folder-resolution chain)
 *   - PackagePhoto / buildPhotoPdf (PDF + SO embed helper)
 */

import sharp from "sharp";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

import {
  DOC_CONFIGS,
  pickDealByAddress,
  type DocType,
  type DealLike,
} from "@/lib/pe-photo-submit";
import {
  buildFolderMap,
  type SystemType,
} from "@/lib/pe-turnover";
import { searchWithRetry } from "@/lib/hubspot";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import {
  extractFolderId,
  listDriveSubfolders,
  listDriveFilesRecursive,
  downloadDriveFile,
} from "@/lib/drive-plansets";

// ---------------------------------------------------------------------------
// normalizeSystemType
// ---------------------------------------------------------------------------

/**
 * Map the PE project `assets.systemType` string ("PV+Storage", "Storage Only",
 * "Solar Only", etc.) to the `SystemType` union used by the PE checklist.
 */
export function normalizeSystemType(raw: string | undefined): SystemType {
  const s = (raw ?? "").toLowerCase();
  const hasSolar = s.includes("solar") || s.includes("pv");
  const hasStorage = s.includes("battery") || s.includes("storage");
  if (hasStorage && !hasSolar) return "battery";
  if (hasStorage && hasSolar) return "solar+battery";
  return "solar";
}

// ---------------------------------------------------------------------------
// DealSearchResult / searchDealsByPeCode
// ---------------------------------------------------------------------------

export interface DealSearchResult {
  id: string;
  properties: Record<string, string | null | undefined>;
}

/**
 * The full set of HubSpot deal properties needed by the PE photo-package routes.
 * Used by both the PE-code filter search and the full-text PROJ/name searches so
 * every downstream consumer always has the same fields available.
 */
const DEAL_PROPERTIES = [
  "hs_object_id",
  "all_document_parent_folder_id",
  "design_documents",
  "g_drive",
  "pb_tech_ops_url",
  // Dedicated per-category folder properties (the real source folders).
  "installation_documents",
  "inspection_documents",
  "permit_documents",
  "participate_energy_documents_folder_id",
  "address_line_1",
  "city",
  "state",
  // Identification fields — needed by resolveDealByCode cascade and callers.
  "pe_project_id",
  "project_number",
  "dealname",
] as const;

/** Search HubSpot deals matching a PE project code via `pe_project_id`. */
export async function searchDealsByPeCode(code: string): Promise<DealSearchResult[]> {
  const res = await searchWithRetry({
    filterGroups: [
      {
        filters: [
          {
            propertyName: "pe_project_id",
            operator: FilterOperatorEnum.Eq,
            value: code,
          },
        ],
      },
    ],
    properties: [...DEAL_PROPERTIES],
    limit: 25,
  });
  return (res.results ?? []).map((d) => ({
    id: String(d.id),
    properties: (d.properties ?? {}) as Record<string, string | null | undefined>,
  }));
}

// ---------------------------------------------------------------------------
// resolveDealByCode — multi-strategy cascade
// ---------------------------------------------------------------------------

export interface ResolveDealByCodeResult {
  deals: DealSearchResult[];
  matchedBy: "pe_code" | "proj" | "name";
}

/**
 * Resolve a loose input string to a list of candidate deals by trying three
 * strategies in priority order:
 *
 * 1. **PE code** — exact match on `pe_project_id` via `searchDealsByPeCode`.
 * 2. **PROJ number** — if input looks like "PROJ-1234" or a bare 3-7 digit number,
 *    run a full-text search for `PROJ-<digits>` and filter results by a
 *    word-boundary regex on `dealname` (mirrors `resolveDealRef` in chat-tools.ts).
 * 3. **Customer name / address** — full-text search on the raw input, deduped by id.
 */
export async function resolveDealByCode(input: string): Promise<ResolveDealByCodeResult> {
  // ── Step 1: PE code exact match ──────────────────────────────────────────
  const peDeals = await searchDealsByPeCode(input);
  if (peDeals.length > 0) {
    return { deals: peDeals, matchedBy: "pe_code" };
  }

  // ── Step 2: PROJ number ──────────────────────────────────────────────────
  const projMatch = input.match(/PROJ[-\s]?(\d{2,})/i);
  const bareNum = input.match(/^(\d{3,7})$/);
  if (projMatch || bareNum) {
    const digits = (projMatch?.[1] ?? bareNum?.[1])!;
    const token = `PROJ-${digits}`;
    const res = await searchWithRetry({
      query: token,
      properties: [...DEAL_PROPERTIES],
      limit: 25,
    });
    const boundary = new RegExp(`(^|[^0-9])PROJ-${digits}([^0-9]|$)`, "i");
    const matches = Array.from(
      new Map(
        (res.results ?? [])
          .filter((r) => boundary.test(r.properties?.dealname ?? ""))
          .map((r) => [r.id, r]),
      ).values(),
    );
    if (matches.length > 0) {
      return {
        deals: matches.map((d) => ({
          id: String(d.id),
          properties: (d.properties ?? {}) as Record<string, string | null | undefined>,
        })),
        matchedBy: "proj",
      };
    }
  }

  // ── Step 3: Name / address full-text ─────────────────────────────────────
  const res = await searchWithRetry({
    query: input.trim(),
    properties: [...DEAL_PROPERTIES],
    limit: 25,
  });
  const matches = Array.from(
    new Map((res.results ?? []).map((r) => [r.id, r])).values(),
  );
  return {
    deals: matches.map((d) => ({
      id: String(d.id),
      properties: (d.properties ?? {}) as Record<string, string | null | undefined>,
    })),
    matchedBy: "name",
  };
}

// ---------------------------------------------------------------------------
// resolveSourceFolderId
// ---------------------------------------------------------------------------

/**
 * Resolve the source Drive folder for this doc type. Prefer the dedicated
 * HubSpot folder property (e.g. `installation_documents`) — that's where the
 * real photos live (nested in subfolders). Fall back to the numbered subfolder
 * under the all-documents parent only when no dedicated property is populated.
 */
export function resolveSourceFolderId(
  props: Record<string, string | null | undefined>,
  byPrefix: Map<string, string>,
  doc: DocType,
): string | null {
  for (const prop of DOC_CONFIGS[doc].folderProps) {
    const id = extractFolderId(props[prop] || "");
    if (id) return id;
  }
  for (const prefix of DOC_CONFIGS[doc].sourceFolders) {
    const id = byPrefix.get(prefix);
    if (id) return id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// UsableImage
// ---------------------------------------------------------------------------

export interface UsableImage {
  driveId: string;
  name: string;
  buffer: Buffer;
  mimeType: string;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// locateSalesOrderPdf
// ---------------------------------------------------------------------------

/** Locate the Sales Order PDF in the project's "Participate Energy" / "0." folder. */
export async function locateSalesOrderPdf(rootFolderId: string): Promise<Buffer | null> {
  const subs = await listDriveSubfolders(rootFolderId);
  // Prefer the Participate Energy folder, then a numbered "0." folder.
  const pe = subs.find((f) => f.name.toLowerCase().includes("participate energy"));
  const zero = subs.find((f) => /^0\./.test(f.name));
  const searchRoots = [pe?.id, zero?.id].filter(Boolean) as string[];
  for (const folderId of searchRoots) {
    const files = await listDriveFilesRecursive(folderId, 2, 60);
    const so = files.find(
      (f) =>
        f.mimeType === "application/pdf" &&
        /(sales\s*order|^so[_\s-]|_so[_\s.]|order)/i.test(f.name),
    );
    if (so) {
      const { buffer } = await downloadDriveFile(so.id);
      return buffer;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// appendImagePage
// ---------------------------------------------------------------------------

/** Convert an image buffer to a single full-page PDF page appended to `doc`. */
export async function appendImagePage(
  doc: PDFDocument,
  img: Buffer,
  caption?: string,
  font?: PDFFont,
): Promise<void> {
  // Normalize to PNG so pdf-lib embeds reliably regardless of source format.
  const png = await sharp(img).rotate().png().toBuffer();
  const embedded = await doc.embedPng(png);
  const { width, height } = embedded;
  const barH = caption && font ? Math.max(34, Math.round(width * 0.04)) : 0;
  const page = doc.addPage([width, height + barH]);
  page.drawImage(embedded, { x: 0, y: barH, width, height });
  if (caption && font) {
    page.drawRectangle({ x: 0, y: 0, width, height: barH, color: rgb(0.09, 0.1, 0.13) });
    const size = Math.min(Math.round(barH * 0.42), 24);
    // Truncate to fit the page width.
    let text = caption;
    while (text.length > 4 && font.widthOfTextAtSize(text, size) > width - 24) {
      text = text.slice(0, -2);
    }
    if (text !== caption) text = text.replace(/\.\.\.$|.$/, "…");
    page.drawText(text, {
      x: 14,
      y: Math.round((barH - size) / 2) + 1,
      size,
      font,
      color: rgb(1, 1, 1),
    });
  }
}

// ---------------------------------------------------------------------------
// resolveDealContext
// ---------------------------------------------------------------------------

/** Unambiguous deal + its root Drive folder + the source photo folder + SO PDF. */
export interface DealContextResult {
  deal: DealSearchResult | null;
  ambiguous?: boolean;
  candidates?: Array<{ id: string; address: string; dealName: string }>;
  rootFolderId?: string | null;
  sourceFolderId?: string | null;
  soBuffer?: Buffer | null;
  folderMapWarnings?: string[];
  /** The matched deal's `pe_project_id` value; null when not yet linked to PE. */
  peCode?: string | null;
}

/**
 * Encapsulates the full folder-resolution chain that the CLI's `processProject`
 * does inline.  Accepts an optional `peAddress` string to disambiguate between
 * multiple deals that share the same PE project code; when omitted and exactly
 * one deal exists it is used directly.
 *
 * `doc` controls which HubSpot folder properties and subfolder prefixes are
 * consulted when resolving `sourceFolderId`; defaults to `"policy-photos"`.
 * Pass `"final-permit"` for the final-permit photo route.
 *
 * The `input` parameter may be a PE project code, a PROJ number (e.g. "PROJ-1234"
 * or bare "1234"), or a customer name / address — `resolveDealByCode` tries each
 * strategy in turn.
 */
export async function resolveDealContext(
  input: string,
  peAddress?: string,
  doc: DocType = "policy-photos",
): Promise<DealContextResult> {
  const { deals: dealResults } = await resolveDealByCode(input);
  if (dealResults.length === 0) return { deal: null };

  // Build DealLike[] for address disambiguation.
  const dealLikes: DealLike[] = dealResults.map((d) => ({
    id: d.id,
    address: [d.properties.address_line_1, d.properties.city, d.properties.state]
      .filter(Boolean)
      .join(", "),
  }));

  // Use peAddress for disambiguation when provided; if exactly one deal, skip.
  const effectivePeAddress = peAddress ?? (dealResults.length === 1 ? dealLikes[0].address : "");
  const picked = pickDealByAddress(dealLikes, effectivePeAddress);

  if (picked.ambiguous || !picked.deal) {
    return {
      deal: null,
      ambiguous: true,
      candidates: dealResults.map((d) => ({
        id: d.id,
        address: [d.properties.address_line_1, d.properties.city, d.properties.state]
          .filter(Boolean)
          .join(", "),
        dealName: (d.properties.dealname ?? "").trim() || `Deal ${d.id}`,
      })),
    };
  }

  const deal = dealResults.find((d) => d.id === picked.deal!.id)!;

  // Compute peCode once — used in both early-return and normal-return paths.
  const peCode = (deal.properties.pe_project_id ?? "").trim() || null;

  // Extract root Drive folder.
  const rootRaw =
    deal.properties.all_document_parent_folder_id ?? deal.properties.g_drive ?? "";
  const rootFolderId = extractFolderId(rootRaw);
  if (!rootFolderId) return { deal, rootFolderId: null, peCode };

  // Build folder map and resolve source folder.
  const folderMap = await buildFolderMap(rootFolderId);
  const sourceFolderId = resolveSourceFolderId(deal.properties, folderMap.byPrefix, doc);

  // Locate the Sales Order PDF.
  const soBuffer = await locateSalesOrderPdf(rootFolderId);

  return {
    deal,
    ambiguous: false,
    rootFolderId,
    sourceFolderId,
    soBuffer,
    folderMapWarnings: folderMap.warnings,
    peCode,
  };
}

// ---------------------------------------------------------------------------
// PackagePhoto / buildPhotoPdf
// ---------------------------------------------------------------------------

export interface PackagePhoto { buffer: Buffer; caption: string; }

/**
 * Build the labeled PDF, embedding `soBuffer` (if present) at `soInsertIndex`.
 * If the SO PDF is corrupt or otherwise unloadable, `onSOError` is called with
 * the error and SO pages are skipped — photo pages still assemble normally.
 */
export async function buildPhotoPdf(
  photos: PackagePhoto[],
  soBuffer: Buffer | null,
  soInsertIndex: number,
  onSOError?: (err: Error) => void,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const embedSO = async () => {
    if (!soBuffer) return;
    try {
      const so = await PDFDocument.load(soBuffer, { ignoreEncryption: true });
      const copied = await pdf.copyPages(so, so.getPageIndices());
      copied.forEach((p) => pdf.addPage(p));
    } catch (e) {
      onSOError?.(e instanceof Error ? e : new Error(String(e)));
    }
  };
  for (let i = 0; i < photos.length; i++) {
    if (i === soInsertIndex) await embedSO();           // before page i — matches the CLI
    await appendImagePage(pdf, photos[i].buffer, photos[i].caption, font);
  }
  if (soInsertIndex >= photos.length) await embedSO();  // SO ranks at/after every photo
  return pdf.save();
}
