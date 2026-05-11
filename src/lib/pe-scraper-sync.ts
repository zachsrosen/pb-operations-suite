/**
 * PE Scraper Sync
 *
 * Parses HTML reports from the PE portal scraper (GCS-hosted) and upserts
 * document statuses into the PeDocumentReview table. The scraper runs twice
 * daily and outputs HTML reports to GCS:
 *
 *   - latest_full_report.html        — ALL stages (286+ portal projects)  ← preferred
 *   - latest_pto_closeout_report.html — PTO + Close Out only (59 projects)
 *
 * Use the full report for sync to get document statuses across all stages.
 *
 * Flow:
 *   1. Fetch (or receive) HTML from GCS signed URL
 *   2. Parse structured HTML into ParsedProject[]
 *   3. Map scraper status labels → PeDocStatus enum
 *   4. Match PROJ-XXXX numbers + customer names to HubSpot deal IDs
 *   5. Upsert into PeDocumentReview
 */

import { prisma } from "@/lib/db";
import { PeDocStatus } from "@/generated/prisma/enums";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedDocument {
  name: string;
  status: string;
  dateSubmitted: string | null;
  partnerComments: string | null;
  dateResponded: string | null;
  approverNotes: string | null;
}

export interface ParsedProject {
  customerName: string;
  projNumber: string; // e.g. "PROJ-1234"
  stage: string; // e.g. "PTO" or "Close Out"
  m1Status: string | null;
  m2Status: string | null;
  epcCost: string | null;
  documents: ParsedDocument[];
}

export interface SyncResult {
  projectsFound: number;
  projectsMatched: number;
  docsUpserted: number;
  docsSkipped: number;
  errors: string[];
  unmatchedProjects: string[];
}

// ---------------------------------------------------------------------------
// Status mapping: scraper labels → PeDocStatus enum
// ---------------------------------------------------------------------------

const SCRAPER_STATUS_MAP: Record<string, PeDocStatus> = {
  "approved": PeDocStatus.APPROVED,
  "pending review": PeDocStatus.UPLOADED,
  "pending approval": PeDocStatus.UNDER_REVIEW,
  "response needed": PeDocStatus.ACTION_REQUIRED,
  "not submitted": PeDocStatus.NOT_UPLOADED,
};

export function mapScraperStatus(status: string): PeDocStatus {
  const normalized = status.trim().toLowerCase();
  return SCRAPER_STATUS_MAP[normalized] ?? PeDocStatus.NOT_UPLOADED;
}

// ---------------------------------------------------------------------------
// Document name normalization
//
// The scraper report may use slightly different document names than our
// PE_DOCUMENTS list. This map normalizes scraper names to our canonical names.
// ---------------------------------------------------------------------------

const DOC_NAME_MAP: Record<string, string> = {
  "customer agreement (ppa/esa)": "Customer Agreement (PPA/ESA)",
  "customer agreement": "Customer Agreement (PPA/ESA)",
  "installation order": "Installation Order",
  "state disclosures": "State Disclosures",
  "utility bill": "Utility Bill",
  "signed proposal": "Signed Proposal",
  "design plan": "Design Plan",
  "photos per policy": "Photos per Policy",
  "signed final permit": "Signed Final Permit",
  "access to monitoring": "Access to Monitoring",
  "certificate of acceptance": "Certificate of Acceptance",
  "attestation of customer payment": "Attestation of Customer Payment",
  "conditional progress lien waiver": "Conditional Progress Lien Waiver",
  "shading analysis": "Shading Analysis",
  "issued permit": "Issued Permit",
  "signed interconnection agreement": "Signed Interconnection Agreement",
  "conditional waiver — final payment": "Conditional Waiver — Final Payment",
  "conditional waiver - final payment": "Conditional Waiver — Final Payment",
  "permission to operate (pto)": "Permission to Operate (PTO)",
  "permission to operate": "Permission to Operate (PTO)",
};

function normalizeDocName(raw: string): string {
  const lower = raw.trim().toLowerCase();
  return DOC_NAME_MAP[lower] ?? raw.trim();
}

// ---------------------------------------------------------------------------
// HTML parsing — regex-based (no cheerio dependency)
//
// The PE scraper report is a single flat <table> where:
//   - Project header rows have a `data-deal-stage` attribute and 1 cell
//     containing "Customer Name (PROJ-XXXX) EPC: $X IC: $X PC: $X"
//   - Document rows have 7 cells:
//     Tab, Document, Status, DateSubmitted, PartnerComments, DateResponded, ApproverNotes
// ---------------------------------------------------------------------------

/**
 * Decode HTML entities (&#39; → ', &amp; → &, etc.)
 */
function decodeHtmlEntities(html: string): string {
  return html
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&nbsp;/g, " ");
}

/**
 * Strip all HTML tags, leaving only text content.
 */
function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, "")).trim();
}

/**
 * Extract text content from a <td> cell, handling nested elements.
 * Returns null for empty cells or cells with just whitespace/dashes.
 */
function extractCellText(td: string): string | null {
  const text = stripTags(td).trim();
  if (!text || text === "—" || text === "-" || text === "N/A") return null;
  return text;
}

/**
 * Parse document rows (shared by all strategies).
 * Extracts doc name, status, dates, and notes from a 3–7 cell row.
 */
function parseDocRow(cells: RegExpMatchArray[]): ParsedDocument | null {
  if (cells.length < 3) return null;

  let docName: string;
  let statusText: string;
  let dateSubmitted: string | null = null;
  let partnerComments: string | null = null;
  let dateResponded: string | null = null;
  let approverNotes: string | null = null;

  if (cells.length >= 7) {
    // Full 7-column: Tab, Document, Status, DateSubmitted, PartnerComments, DateResponded, ApproverNotes
    docName = extractCellText(cells[1][1]) ?? "";
    statusText = extractCellText(cells[2][1]) ?? "";
    dateSubmitted = extractCellText(cells[3][1]);
    partnerComments = extractCellText(cells[4][1]);
    dateResponded = extractCellText(cells[5][1]);
    approverNotes = extractCellText(cells[6][1]);
  } else if (cells.length >= 4) {
    // Compact: Document, Status, DateSubmitted, Notes
    docName = extractCellText(cells[0][1]) ?? "";
    statusText = extractCellText(cells[1][1]) ?? "";
    dateSubmitted = extractCellText(cells[2][1]);
    partnerComments = cells.length > 3 ? extractCellText(cells[3][1]) : null;
  } else {
    // Minimal: Document, Status, Date
    docName = extractCellText(cells[0][1]) ?? "";
    statusText = extractCellText(cells[1][1]) ?? "";
    dateSubmitted = extractCellText(cells[2][1]);
  }

  if (!docName || !statusText) return null;

  // Skip header-like rows
  if (docName.toLowerCase() === "document" || docName.toLowerCase() === "tab") return null;

  return {
    name: normalizeDocName(docName),
    status: statusText,
    dateSubmitted,
    partnerComments,
    dateResponded,
    approverNotes,
  };
}

/**
 * Parse the PE scraper HTML report into structured project data.
 *
 * Supports three strategies (tried in order):
 *
 *   Strategy 0 — Flat table with `data-deal-stage` attributes (primary format)
 *     The scraper produces a single <table> where project header rows have a
 *     `data-deal-stage` attribute and 1 cell ("Customer Name (PROJ-XXXX) ..."),
 *     followed by 7-column document rows.
 *
 *   Strategy 1 — Project-per-table: each project has its own <table>
 *   Strategy 2 — Flat table: PROJ-XXXX in row text as project separators
 *
 * The parser reports errors for anything it cannot parse rather than failing.
 */
export function parsePeScraperReport(html: string): {
  projects: ParsedProject[];
  parseErrors: string[];
} {
  const projects: ParsedProject[] = [];
  const parseErrors: string[] = [];

  // ------------------------------------------------------------------
  // Strategy 0: Flat table with data-deal-stage attribute on header rows
  //
  // This is the primary format from the PE portal scraper. The HTML is a
  // single <table> where:
  //   - Project header rows: <tr data-deal-stage="Permission To Operate">
  //       <td colspan="7">Aaron Elliott (PROJ-9483) ...</td></tr>
  //   - Document rows: 7 <td> cells
  //       Tab | Document | Status | DateSubmitted | PartnerComments | DateResponded | ApproverNotes
  // ------------------------------------------------------------------

  const hasDataDealStage = /data-deal-stage/i.test(html);

  if (hasDataDealStage) {
    // Extract all <tr> rows from the HTML (captures attributes + inner content)
    const rowPattern = /<tr([^>]*)>([\s\S]*?)<\/tr>/gi;
    const rows = [...html.matchAll(rowPattern)];

    let currentProject: ParsedProject | null = null;

    for (const rowMatch of rows) {
      const rowAttrs = rowMatch[1];
      const rowInner = rowMatch[2];

      // Check if this is a project header row (has data-deal-stage attribute)
      const stageMatch = rowAttrs.match(/data-deal-stage\s*=\s*"([^"]*)"/i);

      if (stageMatch) {
        // Save previous project
        if (currentProject && currentProject.documents.length > 0) {
          projects.push(currentProject);
        }

        const stage = stageMatch[1];
        const rowText = stripTags(rowInner).trim();

        // Extract PROJ number
        const projMatch = rowText.match(/PROJ-(\d+)/i);
        const projNumber = projMatch ? `PROJ-${projMatch[1]}` : "";

        // Extract customer name — text before (PROJ-XXXX)
        let customerName = "";
        const nameMatch = rowText.match(/^(.+?)\s*\(?\s*PROJ-/i);
        if (nameMatch) {
          customerName = nameMatch[1].trim();
        }

        // Extract EPC cost from header text
        let epcCost: string | null = null;
        const epcMatch = rowText.match(/\bEPC:\s*\$?\s*([\d,]+\.?\d*)/i);
        if (epcMatch) epcCost = epcMatch[1].replace(/,/g, "");

        // Extract M1/M2 status from header text
        let m1Status: string | null = null;
        let m2Status: string | null = null;
        const m1Match = rowText.match(/M1[:\s]*(Paid|Approved|Submitted|Pending|Ready|Rejected|Not\s+Started|N\/A)/i);
        const m2Match = rowText.match(/M2[:\s]*(Paid|Approved|Submitted|Pending|Ready|Rejected|Not\s+Started|N\/A)/i);
        if (m1Match) m1Status = m1Match[1].trim();
        if (m2Match) m2Status = m2Match[1].trim();

        currentProject = {
          customerName,
          projNumber,
          stage,
          m1Status,
          m2Status,
          epcCost,
          documents: [],
        };
        continue;
      }

      // Not a header row — parse as document row
      if (!currentProject) continue;

      const cells = [...rowInner.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
      const doc = parseDocRow(cells);
      if (doc) {
        currentProject.documents.push(doc);
      }
    }

    // Push the last project
    if (currentProject && currentProject.documents.length > 0) {
      projects.push(currentProject);
    }
  }

  // ------------------------------------------------------------------
  // Strategy 1: Project-per-table (each project has its own <table>)
  // Only attempt if Strategy 0 found nothing.
  // ------------------------------------------------------------------

  if (projects.length === 0) {
    const projPattern = /PROJ-\d+/gi;
    const projMatches = [...html.matchAll(projPattern)];

    if (projMatches.length === 0) {
      parseErrors.push("No PROJ-XXXX patterns found in report");
    }

    const tablePattern = /<table[^>]*>([\s\S]*?)<\/table>/gi;
    const tables = [...html.matchAll(tablePattern)];

    for (const tableMatch of tables) {
      const tableHtml = tableMatch[0];
      const tableIndex = tableMatch.index ?? 0;

      const isDocTable =
        /document/i.test(tableHtml) &&
        /status/i.test(tableHtml) &&
        (/date\s*submitted/i.test(tableHtml) || /submitted/i.test(tableHtml));

      if (!isDocTable) continue;

      const beforeTable = html.substring(Math.max(0, tableIndex - 3000), tableIndex);
      const projMatch = beforeTable.match(/PROJ-(\d+)/i);
      const projNumber = projMatch ? `PROJ-${projMatch[1]}` : "";

      let customerName = "";
      const namePatterns = [
        /(?:customer[:\s]*)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*[-–(]\s*PROJ/i,
        /<h[1-6][^>]*>([^<]*?)\s*[-–(]\s*PROJ/i,
        /<h[1-6][^>]*>([^<]*?)<\/h[1-6]>/i,
        /<(?:b|strong)[^>]*>([^<]+)<\/(?:b|strong)>/i,
      ];
      for (const pat of namePatterns) {
        const m = beforeTable.match(pat);
        if (m && m[1]) {
          customerName = stripTags(m[1]).trim();
          break;
        }
      }

      let stage = "";
      const stagePatterns = [
        /stage[:\s]*(PTO|Close\s*Out|Construction|Inspection|Pre-?Construction|Project\s*Complete)/i,
        /\b(PTO|Close\s*Out)\b/i,
      ];
      for (const pat of stagePatterns) {
        const m = beforeTable.match(pat);
        if (m && m[1]) {
          stage = m[1].trim();
          break;
        }
      }

      let m1Status: string | null = null;
      let m2Status: string | null = null;
      const m1Match = beforeTable.match(/M1[:\s]*(Paid|Approved|Submitted|Pending|Ready|Rejected|Not\s+Started|N\/A)/i);
      const m2Match = beforeTable.match(/M2[:\s]*(Paid|Approved|Submitted|Pending|Ready|Rejected|Not\s+Started|N\/A)/i);
      if (m1Match) m1Status = m1Match[1].trim();
      if (m2Match) m2Status = m2Match[1].trim();

      let epcCost: string | null = null;
      const costMatch = beforeTable.match(/(?:EPC|Cost|Total)[:\s]*\$?([\d,]+(?:\.\d{2})?)/i);
      if (costMatch) epcCost = costMatch[1].replace(/,/g, "");

      const documents: ParsedDocument[] = [];
      const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      const rows = [...tableHtml.matchAll(rowPattern)];

      for (const rowMatch of rows) {
        const rowHtml = rowMatch[1];
        const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
        const doc = parseDocRow(cells);
        if (doc) documents.push(doc);
      }

      if (documents.length > 0) {
        projects.push({
          customerName,
          projNumber,
          stage,
          m1Status,
          m2Status,
          epcCost,
          documents,
        });
      } else if (projNumber) {
        parseErrors.push(`${projNumber}: found table but no parseable document rows`);
      }
    }
  }

  // ------------------------------------------------------------------
  // Strategy 2: Flat table with PROJ-XXXX in row text (no data attributes)
  // Only attempt if Strategies 0 and 1 found nothing.
  // ------------------------------------------------------------------

  if (projects.length === 0) {
    parseErrors.push("Strategies 0+1 found 0 projects, attempting flat-table text approach");

    const tablePattern = /<table[^>]*>([\s\S]*?)<\/table>/gi;
    const tables = [...html.matchAll(tablePattern)];

    for (const tableMatch of tables) {
      const tableHtml = tableMatch[0];
      const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      const rows = [...tableHtml.matchAll(rowPattern)];

      let currentProject: ParsedProject | null = null;

      for (const rowMatch of rows) {
        const rowHtml = rowMatch[1];
        const cells = [...rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)];
        if (cells.length === 0) continue;

        const fullRowText = stripTags(rowHtml);
        const projInRow = fullRowText.match(/PROJ-(\d+)/i);

        if (projInRow) {
          // This is a project header row
          if (currentProject && currentProject.documents.length > 0) {
            projects.push(currentProject);
          }
          const nameText = fullRowText.replace(/\(?\s*PROJ-\d+\s*\)?/i, "").trim();
          currentProject = {
            customerName: nameText.split(/\s{2,}|\n/)[0]?.trim() || nameText,
            projNumber: `PROJ-${projInRow[1]}`,
            stage: "",
            m1Status: null,
            m2Status: null,
            epcCost: null,
            documents: [],
          };
          continue;
        }

        // Parse as document row
        if (!currentProject || cells.length < 3) continue;
        const doc = parseDocRow(cells);
        if (doc) currentProject.documents.push(doc);
      }

      // Push last project
      if (currentProject && currentProject.documents.length > 0) {
        projects.push(currentProject);
      }
    }
  }

  return { projects, parseErrors };
}

// ---------------------------------------------------------------------------
// Deal matching — PROJ number + customer name fuzzy match
// ---------------------------------------------------------------------------

/**
 * Match PROJ-XXXX numbers or customer names to HubSpot deal IDs.
 *
 * The dealMap should be pre-populated with:
 *   - dealName (lowercased) → dealId
 * for all PE-tagged deals in the project pipeline.
 */
export function matchProjectToDeal(
  project: ParsedProject,
  dealMap: Map<string, string>,
): string | null {
  const custLower = project.customerName.toLowerCase().trim();

  // 1. Exact match: customer name appears in a deal name
  for (const [dealName, dealId] of dealMap) {
    if (dealName.includes(custLower) && custLower.length > 0) return dealId;
  }

  // 2. Last name match
  const parts = custLower.split(/\s+/);
  const lastName = parts[parts.length - 1];
  if (lastName && lastName.length >= 3) {
    for (const [dealName, dealId] of dealMap) {
      if (dealName.includes(lastName)) return dealId;
    }
  }

  // 3. First + last name match (independently)
  if (parts.length >= 2) {
    const firstName = parts[0];
    for (const [dealName, dealId] of dealMap) {
      if (dealName.includes(firstName) && dealName.includes(lastName)) {
        return dealId;
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Notes formatting
// ---------------------------------------------------------------------------

function buildNotesString(doc: ParsedDocument, projNumber: string): string {
  const parts: string[] = [];
  parts.push(`Synced from PE portal scraper (${projNumber})`);
  if (doc.dateSubmitted) parts.push(`Submitted: ${doc.dateSubmitted}`);
  if (doc.partnerComments) parts.push(`Partner: ${doc.partnerComments}`);
  if (doc.approverNotes) parts.push(`Approver: ${doc.approverNotes}`);
  if (doc.dateResponded) parts.push(`Responded: ${doc.dateResponded}`);
  return parts.join(" | ");
}

// ---------------------------------------------------------------------------
// Sync to database
// ---------------------------------------------------------------------------

/**
 * Upsert parsed project documents into PeDocumentReview.
 *
 * @param projects - Parsed projects from the HTML report
 * @param dealMap  - Map of lowercased deal names → deal IDs
 * @returns Summary of the sync operation
 */
export async function syncPeDocStatuses(
  projects: ParsedProject[],
  dealMap: Map<string, string>,
): Promise<SyncResult> {
  const result: SyncResult = {
    projectsFound: projects.length,
    projectsMatched: 0,
    docsUpserted: 0,
    docsSkipped: 0,
    errors: [],
    unmatchedProjects: [],
  };

  // Build all upsert operations first, then execute in batches
  interface UpsertOp {
    dealId: string;
    docName: string;
    status: PeDocStatus;
    notes: string;
  }

  const ops: UpsertOp[] = [];

  for (const project of projects) {
    const dealId = matchProjectToDeal(project, dealMap);

    if (!dealId) {
      result.unmatchedProjects.push(
        `${project.projNumber} (${project.customerName})`,
      );
      continue;
    }

    result.projectsMatched++;

    for (const doc of project.documents) {
      ops.push({
        dealId,
        docName: doc.name,
        status: mapScraperStatus(doc.status),
        notes: buildNotesString(doc, project.projNumber),
      });
    }
  }

  // Execute upserts in parallel batches of 50 (Neon connection pool friendly)
  const BATCH_SIZE = 50;
  const now = new Date();

  for (let i = 0; i < ops.length; i += BATCH_SIZE) {
    const batch = ops.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((op) =>
        prisma.peDocumentReview.upsert({
          where: { dealId_docName: { dealId: op.dealId, docName: op.docName } },
          create: {
            dealId: op.dealId,
            docName: op.docName,
            status: op.status,
            notes: op.notes,
            reviewedBy: "pe-scraper-sync",
            reviewedAt: now,
          },
          update: {
            status: op.status,
            notes: op.notes,
            reviewedBy: "pe-scraper-sync",
            reviewedAt: now,
          },
        }),
      ),
    );

    for (let j = 0; j < results.length; j++) {
      if (results[j].status === "fulfilled") {
        result.docsUpserted++;
      } else {
        const err = (results[j] as PromiseRejectedResult).reason;
        const op = batch[j];
        result.errors.push(
          `Failed to upsert ${op.docName} for deal ${op.dealId}: ${err instanceof Error ? err.message : String(err)}`,
        );
        result.docsSkipped++;
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Fetch HTML from GCS signed URL
// ---------------------------------------------------------------------------

/**
 * Fetch the PE scraper HTML report from a URL (typically a GCS signed URL).
 * Returns the raw HTML string.
 */
export async function fetchPeScraperReport(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml,*/*",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch PE scraper report: ${response.status} ${response.statusText}`,
    );
  }

  return response.text();
}
