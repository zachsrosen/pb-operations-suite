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
import { searchWithRetry } from "@/lib/hubspot";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import { PIPELINE_IDS } from "@/lib/deals-pipeline";

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
  // Compact-format full-text labels (from portal scrape)
  "action required": PeDocStatus.ACTION_REQUIRED,
  "under review": PeDocStatus.UNDER_REVIEW,
  "uploaded": PeDocStatus.UPLOADED,
  "not yet expected": PeDocStatus.NOT_UPLOADED,
  "draft": PeDocStatus.UPLOADED,
  "not found": PeDocStatus.NOT_UPLOADED,
  "unknown": PeDocStatus.NOT_UPLOADED,
};

export function mapScraperStatus(status: string): PeDocStatus {
  const normalized = status.trim().toLowerCase();
  return SCRAPER_STATUS_MAP[normalized] ?? PeDocStatus.NOT_UPLOADED;
}

// ---------------------------------------------------------------------------
// Compact format status mapping (portal scrape codes → PeDocStatus)
// ---------------------------------------------------------------------------

const COMPACT_STATUS_MAP: Record<string, PeDocStatus> = {
  A: PeDocStatus.APPROVED,
  R: PeDocStatus.ACTION_REQUIRED,
  U: PeDocStatus.UNDER_REVIEW,
  N: PeDocStatus.NOT_UPLOADED,   // NOT YET EXPECTED → NOT_UPLOADED
  X: PeDocStatus.UPLOADED,
  D: PeDocStatus.UPLOADED,       // DRAFT → UPLOADED
  F: PeDocStatus.NOT_UPLOADED,   // NOT FOUND → NOT_UPLOADED
  K: PeDocStatus.NOT_UPLOADED,   // UNKNOWN → NOT_UPLOADED
};

const COMPACT_STATUS_LABELS: Record<string, string> = {
  A: "APPROVED",
  R: "ACTION REQUIRED",
  U: "UNDER REVIEW",
  N: "NOT YET EXPECTED",
  X: "UPLOADED",
  D: "DRAFT",
  F: "NOT FOUND",
  K: "UNKNOWN",
};

// ---------------------------------------------------------------------------
// Compact format parser
//
// Reads the compact encoding from the PE portal manual scrape:
//   projectId|customerName|milestone|docStatusCodes
//
// docStatusCodes is a 15-char string (one char per document in order).
// Milestone codes: OB=Project Onboarded, IC=Inspection Complete, PC=Project Complete
// ---------------------------------------------------------------------------

const COMPACT_DOC_NAMES = [
  "Customer Agreement (PPA/ESA)",
  "Installation Order",
  "State Disclosures",
  "Utility Bill",
  "Signed Proposal",
  "Design Plan",
  "Photos per Policy",
  "Signed Final Permit",
  "Access to Monitoring",
  "Certificate of Acceptance",
  "Attestation of Customer Payment",
  "Conditional Progress Lien Waiver",
  "Signed Interconnection Agreement",
  "Conditional Waiver — Final Payment",
  "Permission to Operate (PTO)",
];

const COMPACT_MILESTONE_MAP: Record<string, string> = {
  OB: "Project Onboarded",
  IC: "Inspection Complete",
  PC: "Project Complete",
};

export interface CompactProject {
  peProjectId: string;
  customerName: string;
  milestone: string;
  documents: ParsedDocument[];
}

/**
 * Parse the compact-format PE portal scrape.
 * Returns ParsedProject[] compatible with the existing sync pipeline.
 */
export function parseCompactPeScrape(compactText: string): {
  projects: ParsedProject[];
  parseErrors: string[];
} {
  const projects: ParsedProject[] = [];
  const parseErrors: string[] = [];

  const lines = compactText.split("\n").filter((l) => l.trim());

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const parts = line.split("|");
    if (parts.length !== 4) {
      parseErrors.push(`Line ${i + 1}: expected 4 pipe-delimited fields, got ${parts.length}`);
      continue;
    }

    const [peProjectId, customerName, milestoneCode, docCodes] = parts;

    if (docCodes.length !== 15) {
      parseErrors.push(`Line ${i + 1} (${peProjectId}): expected 15 status codes, got ${docCodes.length}`);
      continue;
    }

    const milestone = COMPACT_MILESTONE_MAP[milestoneCode] || milestoneCode;

    // Convert to ParsedDocument[] for compatibility with existing sync pipeline
    const documents: ParsedDocument[] = [];
    for (let j = 0; j < 15; j++) {
      const code = docCodes[j] || "K";
      documents.push({
        name: COMPACT_DOC_NAMES[j],
        status: COMPACT_STATUS_LABELS[code] || "UNKNOWN",
        dateSubmitted: null,
        partnerComments: null,
        dateResponded: null,
        approverNotes: null,
      });
    }

    // Map to ParsedProject shape — use peProjectId as projNumber for matching
    projects.push({
      customerName,
      projNumber: peProjectId,  // e.g. "CO2602-DIER1" — used for deal matching
      stage: milestone,
      m1Status: null,
      m2Status: null,
      epcCost: null,
      documents,
    });
  }

  return { projects, parseErrors };
}

/**
 * Map compact status code to PeDocStatus enum (for direct DB writes).
 */
export function mapCompactStatus(code: string): PeDocStatus {
  return COMPACT_STATUS_MAP[code] ?? PeDocStatus.NOT_UPLOADED;
}

// ---------------------------------------------------------------------------
// Document name normalization
//
// The scraper report may use slightly different document names than our
// PE_DOCUMENTS list. This map normalizes scraper names to our canonical names.
// ---------------------------------------------------------------------------

export const DOC_NAME_MAP: Record<string, string> = {
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
  "signed interconnection agreement": "Signed Interconnection Agreement",
  "conditional waiver — final payment": "Conditional Waiver — Final Payment",
  "conditional waiver - final payment": "Conditional Waiver — Final Payment",
  "permission to operate (pto)": "Permission to Operate (PTO)",
  "permission to operate": "Permission to Operate (PTO)",
};

export function normalizeDocName(raw: string): string {
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

        // Skip ghost rows — header rows with no name or PROJ number
        // (e.g. tab category separators that happen to have data-deal-stage)
        if (!projNumber && !customerName) {
          currentProject = null;
          continue;
        }

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
// HubSpot PE deal lookup — builds a name→dealId map
// ---------------------------------------------------------------------------

/**
 * Build maps for PE deal matching:
 *   - dealNameMap: lowercased deal name → deal ID
 *   - peProjectIdMap: PE project ID (e.g. "CO2602-DIER1") → deal ID
 *
 * Fetches all PE-tagged deals in the project pipeline.
 */
export async function buildPeDealMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const pipelineId = PIPELINE_IDS.project;
  if (!pipelineId) return map;

  let after: string | undefined;
  do {
    const searchRequest = {
      filterGroups: [
        {
          filters: [
            {
              propertyName: "pipeline",
              operator: FilterOperatorEnum.Eq,
              value: pipelineId,
            },
            {
              propertyName: "tags",
              operator: FilterOperatorEnum.ContainsToken,
              value: "Participate Energy",
            },
          ],
        },
      ],
      properties: ["hs_object_id", "dealname", "pe_project_id"],
      sorts: [
        { propertyName: "dealname", direction: "ASCENDING" },
      ] as unknown as string[],
      limit: 100,
      ...(after ? { after } : {}),
    } as any;

    const response = await searchWithRetry(searchRequest);

    for (const deal of response.results) {
      const id = String(deal.properties.hs_object_id);
      const name = String(deal.properties.dealname || "");
      if (id && name) {
        map.set(name.toLowerCase().trim(), id);
      }
      // Also index by PE project ID if present
      const peId = deal.properties.pe_project_id;
      if (id && peId && typeof peId === "string" && peId.trim()) {
        map.set(`pe:${peId.trim().toLowerCase()}`, id);
      }
    }

    after = response.paging?.next?.after;
  } while (after);

  return map;
}

// ---------------------------------------------------------------------------
// Deal matching — PROJ number + customer name fuzzy match
// ---------------------------------------------------------------------------

/**
 * Match projects to HubSpot deal IDs using multiple strategies:
 *   0. PE project ID match (e.g. "CO2602-DIER1") — most reliable for compact format
 *   1. PROJ number match (e.g. "PROJ-1234") — reliable for HTML scraper format
 *   2. Exact customer name match in deal names
 *   3. Last-name match
 *   4. First + last name match
 *
 * The dealMap contains:
 *   - dealName (lowercased) → dealId
 *   - "pe:projectid" → dealId (when pe_project_id property is set)
 */
export function matchProjectToDeal(
  project: ParsedProject,
  dealMap: Map<string, string>,
): string | null {
  // 0. PE project ID match — check if projNumber is a PE ID (e.g. "CO2602-DIER1")
  if (project.projNumber && /^C[AO]\d{4}-[A-Z]+\d*$/i.test(project.projNumber)) {
    const peKey = `pe:${project.projNumber.toLowerCase()}`;
    const peMatch = dealMap.get(peKey);
    if (peMatch) return peMatch;
  }

  // 1. PROJ number match — HubSpot deal names contain "PROJ-XXXX"
  if (project.projNumber) {
    const projLower = project.projNumber.toLowerCase();
    for (const [dealName, dealId] of dealMap) {
      if (!dealName.startsWith("pe:") && dealName.includes(projLower)) return dealId;
    }
  }

  const custLower = project.customerName.toLowerCase().trim();
  if (!custLower) return null;

  // 2. Exact match: customer name appears in a deal name
  for (const [dealName, dealId] of dealMap) {
    if (!dealName.startsWith("pe:") && dealName.includes(custLower)) return dealId;
  }

  // 3. Last name match (skip suffixes like "jr", "sr", "ii", "iii")
  const parts = custLower.split(/\s+/);
  const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);
  const meaningfulParts = parts.filter((p) => !SUFFIXES.has(p));
  const lastName = meaningfulParts[meaningfulParts.length - 1];
  if (lastName && lastName.length >= 3) {
    for (const [dealName, dealId] of dealMap) {
      if (!dealName.startsWith("pe:") && dealName.includes(lastName)) return dealId;
    }
  }

  // 4. First + last name match (independently)
  if (meaningfulParts.length >= 2) {
    const firstName = meaningfulParts[0];
    for (const [dealName, dealId] of dealMap) {
      if (!dealName.startsWith("pe:") && dealName.includes(firstName) && dealName.includes(lastName)) {
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

// ---------------------------------------------------------------------------
// PE Portal CSV Import
//
// The PE portal CSV export contains project-level summary data including
// overall Doc Review Status, milestone, financials, and dates. It does NOT
// contain per-document detail (that comes from the HTML scraper).
//
// This import supplements the scraper by:
//   - Updating M1/M2 payment amounts from CSV financials
//   - For projects with no scraper doc data, creating a synthetic
//     "Portal Summary" doc review row so the dashboard shows *something*
//   - Storing the PE portal project ID for cross-reference
// ---------------------------------------------------------------------------

export interface CsvProject {
  peProjectId: string;      // e.g. "CO2602-DIER1"
  customerName: string;
  milestone: string;        // e.g. "Project Onboarded", "Inspection Complete"
  docReviewStatus: string;  // e.g. "Action Required (Installer)", "Under Review (PE)", "Approved"
  installerEpc: number | null;
  netAmountDue: number | null;
  finalInspectionPayment: number | null;
  projectCompletionPayment: number | null;
  contractSigned: string | null;
  permitApproved: string | null;
  installationComplete: string | null;
  pto: string | null;
  actionItems: string | null;
}

export interface CsvSyncResult {
  projectsFound: number;
  projectsMatched: number;
  projectsUpdated: number;
  projectsSkippedHasScraperData: number;
  errors: string[];
  unmatchedProjects: string[];
}

/**
 * Parse a PE portal CSV export into structured project data.
 * Handles quoted fields with commas (e.g. "$30,015.80").
 */
export function parsePePortalCsv(csvText: string): {
  projects: CsvProject[];
  parseErrors: string[];
} {
  const parseErrors: string[] = [];
  const projects: CsvProject[] = [];

  // Simple RFC 4180 CSV parser that handles quoted fields
  const rows = parseCsvRows(csvText);
  if (rows.length < 2) {
    parseErrors.push("CSV has fewer than 2 rows (expected header + data)");
    return { projects, parseErrors };
  }

  const header = rows[0].map((h) => h.trim());
  const colIdx = (name: string): number => {
    const idx = header.indexOf(name);
    if (idx === -1) parseErrors.push(`Missing expected column: "${name}"`);
    return idx;
  };

  // Map expected columns
  const iProjectId = colIdx("Project ID");
  const iCustomerName = colIdx("Customer Name");
  const iMilestone = colIdx("Milestone");
  const iDocReview = colIdx("Doc Review Status");
  const iInstallerEpc = colIdx("Installer EPC");
  const iNetAmountDue = colIdx("Net Amount Due");
  const iFinalInspection = colIdx("Final Inspection Payment");
  const iProjectCompletion = colIdx("Project Completion Payment");
  const iContractSigned = colIdx("Contract Signed");
  const iPermitApproved = colIdx("Permit Approved");
  const iInstallComplete = colIdx("Installation Complete");
  const iPto = colIdx("PTO");
  const iActionItems = colIdx("Action Items");

  if (iProjectId === -1 || iCustomerName === -1) {
    parseErrors.push("Cannot parse CSV without Project ID and Customer Name columns");
    return { projects, parseErrors };
  }

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length < header.length) {
      // Skip obviously short rows (empty trailing lines)
      if (row.length <= 1 && !row[0]?.trim()) continue;
      parseErrors.push(`Row ${r + 1}: expected ${header.length} columns, got ${row.length}`);
      continue;
    }

    const cell = (idx: number): string => (idx >= 0 && idx < row.length ? row[idx].trim() : "");
    const parseMoney = (idx: number): number | null => {
      const raw = cell(idx).replace(/[$,]/g, "");
      if (!raw) return null;
      const n = parseFloat(raw);
      return isNaN(n) ? null : n;
    };

    const projectId = cell(iProjectId);
    const customerName = cell(iCustomerName);
    if (!projectId && !customerName) continue;

    projects.push({
      peProjectId: projectId,
      customerName,
      milestone: cell(iMilestone),
      docReviewStatus: cell(iDocReview),
      installerEpc: parseMoney(iInstallerEpc),
      netAmountDue: parseMoney(iNetAmountDue),
      finalInspectionPayment: parseMoney(iFinalInspection),
      projectCompletionPayment: parseMoney(iProjectCompletion),
      contractSigned: cell(iContractSigned) || null,
      permitApproved: cell(iPermitApproved) || null,
      installationComplete: cell(iInstallComplete) || null,
      pto: cell(iPto) || null,
      actionItems: cell(iActionItems) || null,
    });
  }

  return { projects, parseErrors };
}

/**
 * Map CSV Doc Review Status to PeDocStatus enum.
 */
function mapCsvDocReviewStatus(status: string): PeDocStatus {
  const s = status.toLowerCase().trim();
  if (s.includes("approved")) return PeDocStatus.APPROVED;
  if (s.includes("under review")) return PeDocStatus.UNDER_REVIEW;
  if (s.includes("action required")) return PeDocStatus.ACTION_REQUIRED;
  return PeDocStatus.NOT_UPLOADED;
}

/**
 * Match a CSV project to a HubSpot deal ID.
 * Uses the same deal map as the HTML scraper sync.
 */
export function matchCsvProjectToDeal(
  project: CsvProject,
  dealMap: Map<string, string>,
): string | null {
  const custLower = project.customerName.toLowerCase().trim();
  if (!custLower) return null;

  // 1. Exact customer name match in deal names
  for (const [dealName, dealId] of dealMap) {
    if (dealName.includes(custLower)) return dealId;
  }

  // 2. Last-name match (skip suffixes)
  const parts = custLower.split(/\s+/);
  const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);
  const meaningfulParts = parts.filter((p) => !SUFFIXES.has(p));
  const lastName = meaningfulParts[meaningfulParts.length - 1];
  if (lastName && lastName.length >= 3) {
    // Only match if first name also present (avoid false positives like "Smith")
    if (meaningfulParts.length >= 2) {
      const firstName = meaningfulParts[0];
      for (const [dealName, dealId] of dealMap) {
        if (dealName.includes(firstName) && dealName.includes(lastName)) {
          return dealId;
        }
      }
    }
    // Single last-name match as fallback
    for (const [dealName, dealId] of dealMap) {
      if (dealName.includes(lastName)) return dealId;
    }
  }

  return null;
}

// Synthetic doc name for CSV-imported overall status
const CSV_SUMMARY_DOC_NAME = "Portal Summary (CSV)";

/**
 * Sync CSV data into the database.
 *
 * For projects that already have scraper doc data, this is a no-op (scraper
 * data is more granular). For projects with NO scraper data, it creates a
 * synthetic doc review row so the dashboard can show the overall status.
 */
export async function syncPeCsvStatuses(
  csvProjects: CsvProject[],
  dealMap: Map<string, string>,
): Promise<CsvSyncResult> {
  const result: CsvSyncResult = {
    projectsFound: csvProjects.length,
    projectsMatched: 0,
    projectsUpdated: 0,
    projectsSkippedHasScraperData: 0,
    errors: [],
    unmatchedProjects: [],
  };

  // First, find which deals already have scraper doc data
  const scraperDeals = new Set<string>();
  const existing = await prisma.peDocumentReview.findMany({
    where: { reviewedBy: "pe-scraper-sync" },
    select: { dealId: true },
    distinct: ["dealId"],
  });
  for (const row of existing) scraperDeals.add(row.dealId);

  // Build upsert operations
  interface CsvUpsertOp {
    dealId: string;
    status: PeDocStatus;
    notes: string;
  }

  const ops: CsvUpsertOp[] = [];

  for (const project of csvProjects) {
    const dealId = matchCsvProjectToDeal(project, dealMap);

    if (!dealId) {
      result.unmatchedProjects.push(
        `${project.peProjectId} (${project.customerName})`,
      );
      continue;
    }

    result.projectsMatched++;

    // Skip if this deal already has scraper doc data (more granular)
    if (scraperDeals.has(dealId)) {
      result.projectsSkippedHasScraperData++;
      continue;
    }

    // Build notes with CSV metadata
    const noteParts: string[] = [];
    noteParts.push(`PE Portal ID: ${project.peProjectId}`);
    noteParts.push(`Milestone: ${project.milestone}`);
    noteParts.push(`Doc Review: ${project.docReviewStatus}`);
    if (project.installerEpc) noteParts.push(`EPC: $${project.installerEpc.toLocaleString()}`);
    if (project.finalInspectionPayment) noteParts.push(`IC Payment: $${project.finalInspectionPayment.toLocaleString()}`);
    if (project.projectCompletionPayment) noteParts.push(`PC Payment: $${project.projectCompletionPayment.toLocaleString()}`);
    if (project.contractSigned) noteParts.push(`Contract Signed: ${project.contractSigned}`);
    if (project.installationComplete) noteParts.push(`Install Complete: ${project.installationComplete}`);
    if (project.pto) noteParts.push(`PTO: ${project.pto}`);
    if (project.actionItems) noteParts.push(`Action Items: ${project.actionItems.substring(0, 500)}`);

    ops.push({
      dealId,
      status: mapCsvDocReviewStatus(project.docReviewStatus),
      notes: noteParts.join(" | "),
    });
  }

  // Execute upserts in batches
  const BATCH_SIZE = 50;
  const now = new Date();

  for (let i = 0; i < ops.length; i += BATCH_SIZE) {
    const batch = ops.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((op) =>
        prisma.peDocumentReview.upsert({
          where: {
            dealId_docName: { dealId: op.dealId, docName: CSV_SUMMARY_DOC_NAME },
          },
          create: {
            dealId: op.dealId,
            docName: CSV_SUMMARY_DOC_NAME,
            status: op.status,
            notes: op.notes,
            reviewedBy: "pe-csv-import",
            reviewedAt: now,
          },
          update: {
            status: op.status,
            notes: op.notes,
            reviewedBy: "pe-csv-import",
            reviewedAt: now,
          },
        }),
      ),
    );

    for (let j = 0; j < results.length; j++) {
      if (results[j].status === "fulfilled") {
        result.projectsUpdated++;
      } else {
        const err = (results[j] as PromiseRejectedResult).reason;
        const op = batch[j];
        result.errors.push(
          `Failed to upsert CSV status for deal ${op.dealId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Simple CSV parser (RFC 4180 compliant)
// ---------------------------------------------------------------------------

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          // Escaped quote
          field += '"';
          i += 2;
        } else {
          // End of quoted field
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ",") {
        current.push(field);
        field = "";
        i++;
      } else if (ch === "\n" || ch === "\r") {
        current.push(field);
        field = "";
        if (ch === "\r" && i + 1 < text.length && text[i + 1] === "\n") {
          i += 2;
        } else {
          i++;
        }
        if (current.length > 1 || current[0] !== "") {
          rows.push(current);
        }
        current = [];
      } else {
        field += ch;
        i++;
      }
    }
  }

  // Last field/row
  if (field || current.length > 0) {
    current.push(field);
    if (current.length > 1 || current[0] !== "") {
      rows.push(current);
    }
  }

  return rows;
}
