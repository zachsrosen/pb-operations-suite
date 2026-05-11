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
// The PE scraper report has a predictable structure:
//   <div class="project"> or similar container per project
//   - Customer name, PROJ number, stage, M1/M2 status, EPC cost in a header
//   - A <table> with 17 document rows
//   - Each row has: Tab, Document, Status, Date Submitted, Partner Comments,
//     Date Responded, Approver Notes
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
 * Parse the PE scraper HTML report into structured project data.
 *
 * Handles two HTML structures:
 * 1. Individual project containers with header info + document table
 * 2. A single large table structure
 *
 * The parser is intentionally lenient — it extracts what it can and
 * reports errors for anything it cannot parse rather than failing entirely.
 */
export function parsePeScraperReport(html: string): {
  projects: ParsedProject[];
  parseErrors: string[];
} {
  const projects: ParsedProject[] = [];
  const parseErrors: string[] = [];

  // Strategy 1: Look for project sections with headers containing PROJ numbers
  // The report groups projects under section headers (PTO, Close Out, etc.)
  // Each project has a heading/subheading with customer name + PROJ number,
  // followed by a table of documents.

  // Find all PROJ-XXXX references along with nearby context
  const projPattern = /PROJ-\d+/gi;
  const projMatches = [...html.matchAll(projPattern)];

  if (projMatches.length === 0) {
    // Try alternate project ID patterns (e.g. CO2603-WHIT17)
    parseErrors.push("No PROJ-XXXX patterns found in report");
  }

  // Find all document tables — each project should have one table
  // with document rows (Tab, Document, Status, ...)
  const tablePattern = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  const tables = [...html.matchAll(tablePattern)];

  // For each table, check if it looks like a document table
  // (has headers like "Document", "Status", "Date Submitted")
  for (const tableMatch of tables) {
    const tableHtml = tableMatch[0];
    const tableIndex = tableMatch.index ?? 0;

    // Check if this is a document status table
    const isDocTable =
      /document/i.test(tableHtml) &&
      /status/i.test(tableHtml) &&
      (/date\s*submitted/i.test(tableHtml) || /submitted/i.test(tableHtml));

    if (!isDocTable) continue;

    // Look backwards from the table to find the project header info
    // Scan the 2000 chars before the table for project identifiers
    const beforeTable = html.substring(Math.max(0, tableIndex - 3000), tableIndex);

    // Extract PROJ number
    const projMatch = beforeTable.match(/PROJ-(\d+)/i);
    const projNumber = projMatch ? `PROJ-${projMatch[1]}` : "";

    // Extract customer name — typically in a heading before the table
    // Look for patterns like "Customer: Name" or just a name near the PROJ number
    let customerName = "";
    const namePatterns = [
      // "Customer Name - PROJ-1234" or "Name (PROJ-1234)"
      /(?:customer[:\s]*)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*[-–(]\s*PROJ/i,
      // Heading tags containing the name
      /<h[1-6][^>]*>([^<]*?)\s*[-–(]\s*PROJ/i,
      /<h[1-6][^>]*>([^<]*?)<\/h[1-6]>/i,
      // Bold/strong text containing name near PROJ
      /<(?:b|strong)[^>]*>([^<]+)<\/(?:b|strong)>/i,
    ];
    for (const pat of namePatterns) {
      const m = beforeTable.match(pat);
      if (m && m[1]) {
        customerName = stripTags(m[1]).trim();
        break;
      }
    }

    // Extract stage (PTO, Close Out, etc.)
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

    // Extract M1/M2 status
    let m1Status: string | null = null;
    let m2Status: string | null = null;
    const m1Match = beforeTable.match(/M1[:\s]*(Paid|Approved|Submitted|Pending|Ready|Rejected|Not\s+Started|N\/A)/i);
    const m2Match = beforeTable.match(/M2[:\s]*(Paid|Approved|Submitted|Pending|Ready|Rejected|Not\s+Started|N\/A)/i);
    if (m1Match) m1Status = m1Match[1].trim();
    if (m2Match) m2Status = m2Match[1].trim();

    // Extract EPC cost
    let epcCost: string | null = null;
    const costMatch = beforeTable.match(/(?:EPC|Cost|Total)[:\s]*\$?([\d,]+(?:\.\d{2})?)/i);
    if (costMatch) epcCost = costMatch[1].replace(/,/g, "");

    // Parse document rows from the table
    const documents: ParsedDocument[] = [];
    const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    const rows = [...tableHtml.matchAll(rowPattern)];

    for (const rowMatch of rows) {
      const rowHtml = rowMatch[1];
      const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];

      // Skip header rows (which use <th>) or rows with too few cells
      if (cells.length < 3) continue;

      // Expected columns: Tab, Document, Status, Date Submitted,
      // Partner Comments, Date Responded, Approver Notes
      // Some reports may omit the Tab column or reorder slightly

      let docName: string;
      let statusText: string;
      let dateSubmitted: string | null = null;
      let partnerComments: string | null = null;
      let dateResponded: string | null = null;
      let approverNotes: string | null = null;

      if (cells.length >= 7) {
        // Full 7-column layout: Tab, Document, Status, DateSubmitted, PartnerComments, DateResponded, ApproverNotes
        docName = extractCellText(cells[1][1]) ?? "";
        statusText = extractCellText(cells[2][1]) ?? "";
        dateSubmitted = extractCellText(cells[3][1]);
        partnerComments = extractCellText(cells[4][1]);
        dateResponded = extractCellText(cells[5][1]);
        approverNotes = extractCellText(cells[6][1]);
      } else if (cells.length >= 4) {
        // Compact layout: Document, Status, DateSubmitted, Notes
        docName = extractCellText(cells[0][1]) ?? "";
        statusText = extractCellText(cells[1][1]) ?? "";
        dateSubmitted = extractCellText(cells[2][1]);
        partnerComments = cells.length > 3 ? extractCellText(cells[3][1]) : null;
      } else if (cells.length === 3) {
        // Minimal: Document, Status, Date
        docName = extractCellText(cells[0][1]) ?? "";
        statusText = extractCellText(cells[1][1]) ?? "";
        dateSubmitted = extractCellText(cells[2][1]);
      } else {
        continue;
      }

      if (!docName || !statusText) continue;

      // Skip if this looks like a header row that used <td> instead of <th>
      if (docName.toLowerCase() === "document" || docName.toLowerCase() === "tab") continue;

      documents.push({
        name: normalizeDocName(docName),
        status: statusText,
        dateSubmitted,
        partnerComments,
        dateResponded,
        approverNotes,
      });
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

  // If table-based parsing found nothing, try a flat row-based approach
  // where all projects and docs are in one big table
  if (projects.length === 0 && tables.length > 0) {
    parseErrors.push("Table-based project parsing found 0 projects, attempting flat-table approach");

    for (const tableMatch of tables) {
      const tableHtml = tableMatch[0];
      const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      const rows = [...tableHtml.matchAll(rowPattern)];

      let currentProject: ParsedProject | null = null;

      for (const rowMatch of rows) {
        const rowHtml = rowMatch[1];
        const cells = [...rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)];
        if (cells.length < 2) continue;

        // Check if this row is a project header (has PROJ number or looks like a name row)
        const fullRowText = stripTags(rowHtml);
        const projInRow = fullRowText.match(/PROJ-(\d+)/i);

        if (projInRow) {
          // This is a project header row
          if (currentProject && currentProject.documents.length > 0) {
            projects.push(currentProject);
          }
          currentProject = {
            customerName: fullRowText.replace(/PROJ-\d+/i, "").trim(),
            projNumber: `PROJ-${projInRow[1]}`,
            stage: "",
            m1Status: null,
            m2Status: null,
            epcCost: null,
            documents: [],
          };
          continue;
        }

        // Otherwise, try to parse as a document row
        if (!currentProject) continue;

        const firstCell = extractCellText(cells[0][1]) ?? "";
        const secondCell = cells.length > 1 ? extractCellText(cells[1][1]) ?? "" : "";

        // Check if firstCell is a known status value (means this row has doc name in column before)
        const isStatusLike = Object.keys(SCRAPER_STATUS_MAP).some(
          (s) => secondCell.toLowerCase() === s
        );

        if (isStatusLike && firstCell) {
          currentProject.documents.push({
            name: normalizeDocName(firstCell),
            status: secondCell,
            dateSubmitted: cells.length > 2 ? extractCellText(cells[2][1]) : null,
            partnerComments: cells.length > 3 ? extractCellText(cells[3][1]) : null,
            dateResponded: cells.length > 4 ? extractCellText(cells[4][1]) : null,
            approverNotes: cells.length > 5 ? extractCellText(cells[5][1]) : null,
          });
        }
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
      const status = mapScraperStatus(doc.status);
      const notes = buildNotesString(doc, project.projNumber);

      try {
        await prisma.peDocumentReview.upsert({
          where: { dealId_docName: { dealId, docName: doc.name } },
          create: {
            dealId,
            docName: doc.name,
            status,
            notes,
            reviewedBy: "pe-scraper-sync",
            reviewedAt: new Date(),
          },
          update: {
            status,
            notes,
            reviewedBy: "pe-scraper-sync",
            reviewedAt: new Date(),
          },
        });
        result.docsUpserted++;
      } catch (err) {
        const msg = `Failed to upsert ${doc.name} for deal ${dealId}: ${err instanceof Error ? err.message : String(err)}`;
        result.errors.push(msg);
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
