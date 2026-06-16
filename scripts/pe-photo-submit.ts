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
import { PDFDocument, StandardFonts } from "pdf-lib";

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
  normalizeSystemType,
  searchDealsByPeCode,
  resolveSourceFolderId,
  locateSalesOrderPdf,
  appendImagePage,
  type DealSearchResult,
  type UsableImage,
} from "@/lib/pe-photo-package";
import {
  listAllProjects,
  type PeProjectListItem,
} from "@/lib/pe-api";
import {
  PE_M1_CHECKLIST,
  buildFolderMap,
} from "@/lib/pe-turnover";
import {
  extractFolderId,
  listDriveImagesRecursive,
  downloadDriveImage,
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
  // Photos are nested in subfolders (e.g. "Electrical Install", "PV Install"),
  // so list recursively. Capped at 45 to keep the single-call vision triage
  // under its token budget (the classifier regresses past ~50 images) and to
  // bound cost — 45 install photos is ample to cover the required shots.
  const driveImages = await listDriveImagesRecursive(sourceFolderId, 3, 45);
  if (driveImages.length === 0) {
    return empty(
      doc === "policy-photos"
        ? "no images in the installation_documents folder"
        : "no images in the inspection/permit folder (6/3)",
    );
  }

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
  // Per-photo caption drawn on the PDF page (shot type + key detail the vision read).
  const captionByFileId = new Map<string, string>();
  const SHOT_LABEL = new Map(PE_M1_CHECKLIST.filter((i) => i.isPhoto).map((i) => [i.id, i.label]));

  if (doc === "policy-photos") {
    // Offer the vision the FULL photo shot list (not the system-type subset) so
    // every install photo can be matched to its real shot — electrical, MSP, etc.
    // apply to battery systems too. We keep ALL photos matched to a real PE shot
    // (multiple per shot is fine) and drop only the unmatched (JHA forms, random
    // progress shots) and hard fails — per "required shots, multiple each".
    const allPhotoItems = PE_M1_CHECKLIST.filter((i) => i.isPhoto);

    // Upload each usable image to Anthropic Files, then triage in one batch.
    // Anthropic caps dimensions at 2000px for many-image requests, and install
    // photos are full-res — so downscale a COPY for vision (the PDF keeps full-res).
    const batchInputs: { anthropicFileId: string; fileName: string; driveFileId: string }[] = [];
    for (const u of usable) {
      const visionBuf = await sharp(u.buffer)
        .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
      const anthropicFileId = await uploadToAnthropic(visionBuf, u.name, "image/jpeg");
      batchInputs.push({ anthropicFileId, fileName: u.name, driveFileId: u.driveId });
    }
    const triage = await triagePhotoBatch(batchInputs, allPhotoItems);

    const classified: ClassifiedPhoto[] = [];
    for (const [idx, assignment] of triage.assignments) {
      const u = usable[idx];
      if (!u) continue;
      // Drop photos the vision couldn't match to a real PE shot (forms, junk).
      if (!SHOT_LABEL.has(assignment.checklistId)) continue;
      // Drop hard fails (wrong type / unusable); keep pass + needs_review.
      if (assignment.verdict === "fail") {
        flags.push(`dropped ${u.name} (${assignment.checklistId}): ${assignment.issues[0] ?? "failed verification"}`);
        continue;
      }
      if (assignment.verdict === "needs_review") {
        flags.push(`review ${u.name} (${SHOT_LABEL.get(assignment.checklistId)}): ${assignment.issues[0] ?? "low confidence"}`);
      }
      classified.push({ fileId: u.driveId, shotId: assignment.checklistId });
      const detail = (assignment.equipmentVisible ?? []).slice(0, 2).join(", ");
      captionByFileId.set(
        u.driveId,
        `${SHOT_LABEL.get(assignment.checklistId)}${detail ? ` — ${detail}` : ""}`,
      );
    }

    const ordered = orderPolicyPhotos(classified, normalizeSystemType(project.assets.systemType));
    const byId = new Map(usable.map((u) => [u.driveId, u]));
    orderedImages = ordered.map((c) => byId.get(c.fileId)!).filter(Boolean);
    if (orderedImages.length === 0) {
      return empty("no photos matched the policy shot checklist after triage");
    }
    // Slot the Sales Order (item #6) at its canonical rank among ALL photo shots.
    const invoiceRank = allPhotoItems.findIndex((i) => i.id === "m1.photos.6_invoice_bom");
    if (invoiceRank >= 0) {
      const rankOf = new Map(allPhotoItems.map((it, idx) => [it.id, idx]));
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
        captionByFileId.set(
          u.driveId,
          `Signed Final Permit${result.classification.documentType ? ` — ${result.classification.documentType}` : ""}`,
        );
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
  const captionFont = await pdf.embedFont(StandardFonts.Helvetica);

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
    const cap = captionByFileId.get(orderedImages[i].driveId);
    await appendImagePage(pdf, orderedImages[i].buffer, cap, captionFont);
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
    // Escape for a markdown table cell: backslash first, then pipe, then flatten
    // newlines so a multi-line vision issue can't break the row.
    const note = r.flags.length
      ? r.flags.join("; ").replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
      : "";
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
