#!/usr/bin/env npx tsx
/**
 * Decode PE Portal Compact Scrape → Full JSON
 *
 * Reads scripts/pe-scrape-compact.txt and outputs pe-portal-scrape-2026-05-11.json
 * with the full structured format matching ParsedProject / CsvProject shapes.
 *
 * Compact format: projectId|customerName|milestone|docStatusCodes
 *   - milestone: OB=Project Onboarded, IC=Inspection Complete, PC=Project Complete
 *   - docStatusCodes: 15-char string, one per document:
 *       A=APPROVED, R=ACTION REQUIRED, U=UNDER REVIEW, N=NOT YET EXPECTED,
 *       X=UPLOADED, D=DRAFT, F=NOT FOUND, K=UNKNOWN
 *
 * Document order (15 positions):
 *   0: Customer Agreement (PPA/ESA)
 *   1: Installation Order
 *   2: State Disclosures
 *   3: Utility Bill
 *   4: Signed Proposal
 *   5: Design Plan
 *   6: Photos per Policy
 *   7: Signed Final Permit
 *   8: Access to Monitoring
 *   9: Certificate of Acceptance
 *  10: Attestation of Customer Payment
 *  11: Conditional Progress Lien Waiver
 *  12: Signed Interconnection Agreement
 *  13: Conditional Waiver — Final Payment
 *  14: Permission to Operate (PTO)
 */

import * as fs from "fs";
import * as path from "path";

const DOC_NAMES = [
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

const STATUS_CODES: Record<string, string> = {
  A: "APPROVED",
  R: "ACTION REQUIRED",
  U: "UNDER REVIEW",
  N: "NOT YET EXPECTED",
  X: "UPLOADED",
  D: "DRAFT",
  F: "NOT FOUND",
  K: "UNKNOWN",
};

const MILESTONE_CODES: Record<string, string> = {
  OB: "Project Onboarded",
  IC: "Inspection Complete",
  PC: "Project Complete",
};

// Document sections by index range
const ONBOARDING_RANGE = [0, 4] as const;       // 0-3
const INSPECTION_RANGE = [4, 12] as const;       // 4-11
const PROJECT_COMPLETE_RANGE = [12, 15] as const; // 12-14

interface DecodedDocument {
  name: string;
  status: string;
}

interface DecodedProject {
  projectId: string;
  customerName: string;
  milestone: string;
  docReview: string; // computed: ACTION REQUIRED if any R, UNDER REVIEW if any U, else APPROVED
  documents: {
    onboarding: DecodedDocument[];
    inspectionComplete: DecodedDocument[];
    projectComplete: DecodedDocument[];
  };
}

function computeDocReview(codes: string): string {
  if (codes.includes("R")) return "ACTION REQUIRED";
  if (codes.includes("U")) return "UNDER REVIEW";
  if (codes.includes("X")) return "UNDER REVIEW";
  if (codes.includes("D")) return "UNDER REVIEW";
  return "APPROVED";
}

function decodeDocuments(codes: string, start: number, end: number): DecodedDocument[] {
  const docs: DecodedDocument[] = [];
  for (let i = start; i < end; i++) {
    const code = codes[i] || "K";
    docs.push({
      name: DOC_NAMES[i],
      status: STATUS_CODES[code] || "UNKNOWN",
    });
  }
  return docs;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const inputPath = path.join(__dirname, "pe-scrape-compact.txt");
const outputPath = path.join(__dirname, "..", "pe-portal-scrape-2026-05-11.json");

const raw = fs.readFileSync(inputPath, "utf-8");
const lines = raw.split("\n").filter((l) => l.trim());

const projects: DecodedProject[] = [];
const errors: string[] = [];

for (let lineNum = 0; lineNum < lines.length; lineNum++) {
  const line = lines[lineNum];
  const parts = line.split("|");
  if (parts.length !== 4) {
    errors.push(`Line ${lineNum + 1}: expected 4 pipe-delimited fields, got ${parts.length}`);
    continue;
  }

  const [projectId, customerName, milestoneCode, docCodes] = parts;

  if (docCodes.length !== 15) {
    errors.push(`Line ${lineNum + 1} (${projectId}): expected 15 status codes, got ${docCodes.length}`);
    continue;
  }

  const milestone = MILESTONE_CODES[milestoneCode] || milestoneCode;

  projects.push({
    projectId,
    customerName,
    milestone,
    docReview: computeDocReview(docCodes),
    documents: {
      onboarding: decodeDocuments(docCodes, ONBOARDING_RANGE[0], ONBOARDING_RANGE[1]),
      inspectionComplete: decodeDocuments(docCodes, INSPECTION_RANGE[0], INSPECTION_RANGE[1]),
      projectComplete: decodeDocuments(docCodes, PROJECT_COMPLETE_RANGE[0], PROJECT_COMPLETE_RANGE[1]),
    },
  });
}

// Summary stats
const byMilestone = {
  onboarded: projects.filter((p) => p.milestone === "Project Onboarded").length,
  inspectionComplete: projects.filter((p) => p.milestone === "Inspection Complete").length,
  projectComplete: projects.filter((p) => p.milestone === "Project Complete").length,
};

const actionRequired = projects.filter((p) => p.docReview === "ACTION REQUIRED").length;
const underReview = projects.filter((p) => p.docReview === "UNDER REVIEW").length;
const allApproved = projects.filter((p) => p.docReview === "APPROVED").length;

const output = {
  scrapeDate: "2026-05-11",
  source: "raceway.participate.energy manual scrape (compact format decoded)",
  summary: {
    totalProjects: projects.length,
    byMilestone,
    byDocReview: { actionRequired, underReview, allApproved },
  },
  projects,
};

fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

console.log(`✅ Decoded ${projects.length} projects → ${outputPath}`);
console.log(`   Milestones: OB=${byMilestone.onboarded}, IC=${byMilestone.inspectionComplete}, PC=${byMilestone.projectComplete}`);
console.log(`   Doc Review: ACTION REQUIRED=${actionRequired}, UNDER REVIEW=${underReview}, APPROVED=${allApproved}`);
if (errors.length > 0) {
  console.error(`\n⚠️  ${errors.length} errors:`);
  errors.forEach((e) => console.error(`   ${e}`));
}
