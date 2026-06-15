/**
 * pe-photo-submit.ts — I/O orchestrator for the PE photo-submission skills.
 *
 * Resolves a project (or batch), pulls the relevant Drive photos, verifies them
 * with Claude vision, assembles an ordered PDF, and delivers it locally + (unless
 * --no-stage) staged to the project's "Participate Energy" Drive folder.
 *
 * The PE API is READ-ONLY — this script NEVER uploads to the portal. It also
 * never regenerates the Sales Order PDF: for policy-photos it locates the
 * existing SO and embeds it, or flags its absence (plan §4 / Notes).
 *
 * Run:
 *   node --env-file=.env --import tsx scripts/pe-photo-submit.ts \
 *     --doc final-permit|policy-photos \
 *     (--project <code> | --batch recent [--hours N] | --batch <comma,list>) \
 *     [--no-stage]
 *
 * Pure logic (doc config, filename derivation, low-res guard, deal
 * disambiguation, shot ordering, target parsing) lives in
 * `@/lib/pe-photo-submit` and is unit-tested separately — this file is the thin
 * I/O wiring only.
 */

import { promises as fs } from "fs";
import os from "os";
import path from "path";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";

import {
  DOC_CONFIGS,
  parseTarget,
  finalPermitFilename,
  policyPhotosFilename,
  isUsableImage,
  pickDealByAddress,
  orderPolicyPhotos,
  type DocType,
  type DealLike,
  type ClassifiedPhoto,
} from "@/lib/pe-photo-submit";
import {
  listAllProjects,
  type PeProjectListItem,
} from "@/lib/pe-api";
import {
  PE_M1_CHECKLIST,
  filterChecklist,
  buildFolderMap,
  type SystemType,
} from "@/lib/pe-turnover";
import { searchWithRetry } from "@/lib/hubspot";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import {
  extractFolderId,
  listDriveImages,
  downloadDriveImage,
  listDriveSubfolders,
  listDriveFilesRecursive,
  downloadDriveFile,
  uploadDriveBinaryFile,
} from "@/lib/drive-plansets";
import {
  uploadToAnthropic,
  triagePhotoBatch,
  classifyDocument,
  type VisionFileInput,
} from "@/lib/pe-vision-classifier";
import { findOrCreatePeFolder } from "@/lib/pe-audit-orchestrator";

// ---------------------------------------------------------------------------
// CLI flag parsing
// ---------------------------------------------------------------------------

function getFlag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

// ---------------------------------------------------------------------------
// System-type normalization (contract finding #2: no reusable normalizer for
// PE's `assets.systemType` string). Maps "PV+Storage"/"Storage Only"/
// "Solar Only" → the `SystemType` union the checklist filters on.
// ---------------------------------------------------------------------------

function normalizeSystemType(raw: string | undefined): SystemType {
  const s = (raw ?? "").toLowerCase();
  const hasSolar = s.includes("solar") || s.includes("pv");
  const hasStorage = s.includes("battery") || s.includes("storage");
  if (hasStorage && !hasSolar) return "battery";
  if (hasStorage && hasSolar) return "solar+battery";
  return "solar";
}

// ---------------------------------------------------------------------------
// Target resolution (Task 8)
// ---------------------------------------------------------------------------

async function resolveCodes(doc: DocType, projects: PeProjectListItem[]): Promise<string[]> {
  const req = parseTarget({
    project: getFlag("project"),
    batch: getFlag("batch"),
    hours: getFlag("hours") ? Number(getFlag("hours")) : undefined,
  });
  if (req.mode === "single") return [req.value];
  if (req.mode === "list") return req.codes;
  // recent
  const me = (process.env.GMAIL_SENDER_EMAIL ?? "").toLowerCase();
  const cutoff = Date.now() - req.hours * 3600_000;
  const key = DOC_CONFIGS[doc].peDocKey;
  return projects
    .filter((p) =>
      ((p.documents as Record<string, { versions?: { uploadedAt: string; uploadedBy: string | null }[] }>)?.[key]?.versions ?? []).some((v) => {
        const t = Date.parse(v.uploadedAt);
        const mine = !req.mineOnly || (v.uploadedBy ?? "").toLowerCase() === me;
        return !Number.isNaN(t) && t >= cutoff && mine;
      }),
    )
    .map((p) => p.projectId);
}

// ---------------------------------------------------------------------------
// Per-project pipeline (Task 9)
// ---------------------------------------------------------------------------

interface SummaryRow {
  code: string;
  customer: string;
  pages: number;
  flags: string[];
  portalUrl: string;
  pdfPath: string | null;
}

interface DealSearchResult {
  id: string;
  properties: Record<string, string | null | undefined>;
}

/** Search HubSpot deals matching a PE project code via `pe_project_id`. */
async function searchDealsByPeCode(code: string): Promise<DealSearchResult[]> {
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
    properties: [
      "hs_object_id",
      "all_document_parent_folder_id",
      "design_documents",
      "g_drive",
      "pb_tech_ops_url",
      "address_line_1",
      "city",
      "state",
    ],
    limit: 25,
  });
  return (res.results ?? []).map((d) => ({
    id: String(d.id),
    properties: (d.properties ?? {}) as Record<string, string | null | undefined>,
  }));
}

/** Resolve the numbered source folder for this doc type from a HubSpot deal. */
function resolveSourceFolderId(
  props: Record<string, string | null | undefined>,
  byPrefix: Map<string, string>,
  doc: DocType,
): string | null {
  for (const prefix of DOC_CONFIGS[doc].sourceFolders) {
    const id = byPrefix.get(prefix);
    if (id) return id;
  }
  return null;
}

interface UsableImage {
  driveId: string;
  name: string;
  buffer: Buffer;
  mimeType: string;
  width: number;
  height: number;
}

/** Locate the Sales Order PDF in the project's "Participate Energy" / "0." folder. */
async function locateSalesOrderPdf(rootFolderId: string): Promise<Buffer | null> {
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

/** Convert an image buffer to a single full-page PDF page appended to `doc`. */
async function appendImagePage(doc: PDFDocument, img: Buffer): Promise<void> {
  // Normalize to PNG so pdf-lib embeds reliably regardless of source format.
  const png = await sharp(img).rotate().png().toBuffer();
  const embedded = await doc.embedPng(png);
  const { width, height } = embedded;
  const page = doc.addPage([width, height]);
  page.drawImage(embedded, { x: 0, y: 0, width, height });
}

async function processProject(
  code: string,
  doc: DocType,
  stage: boolean,
  project: PeProjectListItem | undefined,
): Promise<SummaryRow> {
  const flags: string[] = [];
  const cfg = DOC_CONFIGS[doc];
  const customer = project
    ? `${project.customer.firstName} ${project.customer.lastName}`.trim()
    : code;
  const portalUrl = project ? `https://raceway.participate.energy/projects/${project.id}` : "";
  const peAddress = project
    ? [project.project.street, project.project.city, project.project.state].filter(Boolean).join(", ")
    : "";

  const empty = (msg: string): SummaryRow => {
    flags.push(msg);
    return { code, customer, pages: 0, flags, portalUrl, pdfPath: null };
  };

  if (!project) return empty("no PE project record (cannot resolve address/customer)");

  // --- Deal resolution -----------------------------------------------------
  const dealResults = await searchDealsByPeCode(code);
  if (dealResults.length === 0) return empty("no HubSpot deal for pe_project_id");

  const dealLikes: DealLike[] = dealResults.map((d) => ({
    id: d.id,
    address: [d.properties.address_line_1, d.properties.city, d.properties.state]
      .filter(Boolean)
      .join(", "),
  }));
  const picked = pickDealByAddress(dealLikes, peAddress);
  if (picked.ambiguous || !picked.deal) {
    return empty(`ambiguous deal match across ${dealResults.length} deals (PE addr: ${peAddress || "?"})`);
  }
  const deal = dealResults.find((d) => d.id === picked.deal!.id)!;

  // --- Folder resolution ---------------------------------------------------
  const rootRaw =
    deal.properties.all_document_parent_folder_id ?? deal.properties.g_drive ?? "";
  const rootFolderId = extractFolderId(rootRaw ?? "");
  if (!rootFolderId) return empty("deal has no resolvable root Drive folder");

  const folderMap = await buildFolderMap(rootFolderId);
  for (const w of folderMap.warnings) flags.push(`drive: ${w}`);
  const sourceFolderId = resolveSourceFolderId(deal.properties, folderMap.byPrefix, doc);
  if (!sourceFolderId) {
    return empty(`source folder ${cfg.sourceFolders.join("/")} not found in Drive`);
  }

  // --- Pull + screen images ------------------------------------------------
  const driveImages = await listDriveImages(sourceFolderId);
  if (driveImages.length === 0) return empty(`source folder is empty (folder ${cfg.sourceFolders[0]})`);

  const usable: UsableImage[] = [];
  for (const di of driveImages) {
    const { buffer, mimeType } = await downloadDriveImage(di.id);
    let meta: sharp.Metadata;
    try {
      meta = await sharp(buffer).metadata();
    } catch {
      flags.push(`unreadable image: ${di.name}`);
      continue;
    }
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    const verdict = isUsableImage(w, h);
    if (!verdict.ok) {
      flags.push(`skipped ${di.name}: ${verdict.reason}`);
      continue;
    }
    usable.push({ driveId: di.id, name: di.name, buffer, mimeType, width: w, height: h });
  }

  if (usable.length === 0) return empty("no usable images after low-res/aspect screening");

  // --- Verify + order ------------------------------------------------------
  // NOTE (deferred, spec §6): few-shot grounding with approved-on-v1 reference
  // examples is not yet wired. `findApprovedOnV1` (pe-reference-library) is the
  // selector for it; final-permit can pass `classifyDocument`'s `referenceFileId`,
  // but policy-photos needs `triagePhotoBatch` extended to accept references —
  // a change to the shared classifier lib, tracked as a follow-up. The classifier
  // performs acceptably against the full checklist without references today.
  let orderedImages: UsableImage[];
  // Index in `orderedImages` at which the Sales Order (item #6) is inserted.
  // Defaults past the end (append last); set by rank for policy photos below.
  let soInsertIndex = Number.MAX_SAFE_INTEGER;

  if (doc === "policy-photos") {
    const systemType = normalizeSystemType(project.assets.systemType);
    const photoItems = filterChecklist(PE_M1_CHECKLIST.filter((i) => i.isPhoto), systemType);

    // Upload each usable image to Anthropic Files, then triage in one batch.
    const batchInputs: { anthropicFileId: string; fileName: string; driveFileId: string }[] = [];
    for (const u of usable) {
      const anthropicFileId = await uploadToAnthropic(u.buffer, u.name, u.mimeType);
      batchInputs.push({ anthropicFileId, fileName: u.name, driveFileId: u.driveId });
    }
    const triage = await triagePhotoBatch(batchInputs, photoItems);

    const classified: ClassifiedPhoto[] = [];
    for (const [idx, assignment] of triage.assignments) {
      const u = usable[idx];
      if (!u) continue;
      if (assignment.verdict === "fail") {
        flags.push(`failed verify ${u.name} (${assignment.checklistId}): ${assignment.issues.join("; ")}`);
        continue;
      }
      if (assignment.verdict === "needs_review") {
        flags.push(`needs review ${u.name} (${assignment.checklistId}): ${assignment.issues.join("; ") || "low confidence"}`);
      }
      classified.push({ fileId: u.driveId, shotId: assignment.checklistId });
    }

    const ordered = orderPolicyPhotos(classified, systemType);
    const byId = new Map(usable.map((u) => [u.driveId, u]));
    orderedImages = ordered.map((c) => byId.get(c.fileId)!).filter(Boolean);
    if (orderedImages.length === 0) {
      return empty("no photos matched the policy shot checklist after triage");
    }
    // Slot the Sales Order (item #6) at its canonical rank among the shots that
    // APPLY to this system type — not a fixed photo index. Storage-only systems
    // drop the solar shots, so the invoice no longer sits at literal index 5.
    const applicable = filterChecklist(PE_M1_CHECKLIST.filter((i) => i.isPhoto), systemType);
    const invoiceRank = applicable.findIndex((i) => i.id === "m1.photos.6_invoice_bom");
    if (invoiceRank >= 0) {
      const rankOf = new Map(applicable.map((it, idx) => [it.id, idx]));
      soInsertIndex = ordered.filter((c) => (rankOf.get(c.shotId) ?? Infinity) < invoiceRank).length;
    }
  } else {
    // final-permit: confirm each usable image is a signed/finaled permit or
    // inspection card; exclude rejects; order chronologically by filename.
    const permitItem =
      PE_M1_CHECKLIST.find((i) => i.id === "m1.inspection.ahj_permit") ??
      PE_M1_CHECKLIST.find((i) => /permit|inspection/.test(i.id)) ??
      PE_M1_CHECKLIST[0];
    const kept: UsableImage[] = [];
    for (const u of usable) {
      const input: VisionFileInput = {
        fileId: u.driveId,
        fileName: u.name,
        mimeType: u.mimeType,
        buffer: u.buffer,
      };
      const result = await classifyDocument(input, [permitItem]);
      if (result.kind === "error") {
        flags.push(`vision error on ${u.name}: ${result.error}`);
        continue;
      }
      if (result.kind === "document") {
        // PE accepts the "Signed Final Permit" doc in several forms: a signed/finaled
        // permit, a finaled-permit portal screenshot, OR a passed final-inspection
        // record/card (the approved-on-v1 gold set includes "Finaled Permit.pdf",
        // "Permit with inspection.pdf", "Final Inspections.pdf"). classifyDocument is
        // intentionally conservative about the strict "signed permit" checklist item,
        // so we also accept any permit- or inspection-typed document — these come from
        // the Inspections (6) / Permitting (3) folders, so that's the right scope.
        const docType = (result.classification.documentType || "").toLowerCase();
        const accepted =
          result.classification.matchedChecklistIds.length > 0 ||
          /permit|inspection/.test(docType);
        if (!accepted) {
          flags.push(`excluded ${u.name}: not a permit/inspection document (${result.classification.documentType || "unknown"})`);
          continue;
        }
        if (result.classification.issues.length > 0) {
          flags.push(`${u.name}: ${result.classification.issues.join("; ")}`);
        }
      }
      kept.push(u);
    }
    orderedImages = kept.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (orderedImages.length === 0) {
      return empty("no images recognized as a signed/final permit");
    }
  }

  // --- Assemble PDF --------------------------------------------------------
  const pdf = await PDFDocument.create();

  // Locate-or-flag the Sales Order PDF and embed its pages (never regenerate).
  const embedSalesOrder = async (): Promise<void> => {
    const soBuf = await locateSalesOrderPdf(rootFolderId);
    if (!soBuf) {
      flags.push("Sales Order PDF not found — assembled without it (locate manually)");
      return;
    }
    try {
      const soDoc = await PDFDocument.load(soBuf, { ignoreEncryption: true });
      const copied = await pdf.copyPages(soDoc, soDoc.getPageIndices());
      copied.forEach((p) => pdf.addPage(p));
    } catch (e) {
      flags.push(`Sales Order PDF found but unembeddable: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  for (let i = 0; i < orderedImages.length; i++) {
    if (cfg.embedsSalesOrder && i === soInsertIndex) await embedSalesOrder();
    await appendImagePage(pdf, orderedImages[i].buffer);
  }
  // SO ranks at or after every present photo (or there are none) — append last.
  if (cfg.embedsSalesOrder && soInsertIndex >= orderedImages.length) await embedSalesOrder();

  const pdfBytes = await pdf.save();

  // --- Filename ------------------------------------------------------------
  const filename =
    doc === "final-permit"
      ? finalPermitFilename(code, project.customer.lastName ?? "")
      : policyPhotosFilename({ street: project.project.street, city: project.project.city });

  // --- Deliver locally -----------------------------------------------------
  const outDir = path.join(os.homedir(), "Downloads", cfg.outputDir);
  await fs.mkdir(outDir, { recursive: true });
  const pdfPath = path.join(outDir, filename);
  await fs.writeFile(pdfPath, pdfBytes);

  // --- Stage to Drive ------------------------------------------------------
  if (stage) {
    try {
      const peFolderId = await findOrCreatePeFolder(rootFolderId);
      await uploadDriveBinaryFile(peFolderId, filename, Buffer.from(pdfBytes), "application/pdf");
    } catch (e) {
      flags.push(`Drive staging failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { code, customer, pages: pdf.getPageCount(), flags, portalUrl, pdfPath };
}

// ---------------------------------------------------------------------------
// UPLOAD-CHECKLIST.md writer
// ---------------------------------------------------------------------------

function checklistMarkdown(doc: DocType, rows: SummaryRow[]): string {
  const lines: string[] = [];
  lines.push(`# PE Upload Checklist — ${doc}`);
  lines.push("");
  lines.push(`Generated ${new Date().toISOString()}. PE API is read-only; upload each PDF to the portal manually.`);
  lines.push("");
  lines.push("| ☐ | Project | Customer | PDF | Portal | Note |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const r of rows) {
    const note = r.flags.length ? r.flags.join("; ").replace(/\|/g, "\\|") : "";
    const pdf = r.pdfPath ? path.basename(r.pdfPath) : "(none)";
    const portal = r.portalUrl ? `[open](${r.portalUrl})` : "";
    lines.push(`| ☐ | ${r.code} | ${r.customer} | ${pdf} (${r.pages}pp) | ${portal} | ${note} |`);
  }
  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const doc = (getFlag("doc") ?? "") as DocType;
  if (!DOC_CONFIGS[doc]) throw new Error("Pass --doc final-permit|policy-photos");
  if (!process.env.PE_FILE_PREP_ENABLED) {
    throw new Error("PE_FILE_PREP_ENABLED required for photo verification");
  }
  const stage = !hasFlag("no-stage");

  const projects = await listAllProjects();
  const byCode = new Map(projects.map((p) => [p.projectId, p]));

  const codes = await resolveCodes(doc, projects);
  console.log(`Targets (${doc}): ${codes.join(", ") || "(none)"}`);
  if (codes.length === 0) return;

  const rows: SummaryRow[] = [];
  for (const code of codes) {
    console.log(`\n--- ${code} ---`);
    try {
      const row = await processProject(code, doc, stage, byCode.get(code));
      rows.push(row);
      console.log(
        `  ${row.pdfPath ? `wrote ${path.basename(row.pdfPath)} (${row.pages}pp)` : "no PDF"}` +
          (row.flags.length ? `\n  flags:\n    - ${row.flags.join("\n    - ")}` : ""),
      );
    } catch (e) {
      console.error(`  ERR ${code}: ${e instanceof Error ? e.message : String(e)}`);
      rows.push({
        code,
        customer: byCode.get(code)
          ? `${byCode.get(code)!.customer.firstName} ${byCode.get(code)!.customer.lastName}`.trim()
          : code,
        pages: 0,
        flags: [`error: ${e instanceof Error ? e.message : String(e)}`],
        portalUrl: byCode.get(code) ? `https://raceway.participate.energy/projects/${byCode.get(code)!.id}` : "",
        pdfPath: null,
      });
    }
  }

  // Write the unified checklist alongside the PDFs.
  const outDir = path.join(os.homedir(), "Downloads", DOC_CONFIGS[doc].outputDir);
  await fs.mkdir(outDir, { recursive: true });
  const checklistPath = path.join(outDir, "UPLOAD-CHECKLIST.md");
  await fs.writeFile(checklistPath, checklistMarkdown(doc, rows));
  console.log(`\nChecklist: ${checklistPath}`);
}

main().catch((e) => {
  console.error("ERR", e?.message || e);
  process.exit(1);
});
