#!/usr/bin/env npx tsx
/**
 * PE Document Upload Task List — Layla
 *
 * Generates a tiered, actionable task list for PE deals at payment stages
 * (PTO, Close Out, Project Complete). Ignores anything below PTO.
 *
 * Cross-references PE portal scrape data with HubSpot deal data.
 *
 * Structure:
 *   - The Big Picture ($ owed by stage, doc status breakdown)
 *   - Fastest Path to Money table
 *   - Tier 1: URGENT — Response Needed (PE rejected docs)
 *   - Tier 2: QUICK WINS — 1 Doc Missing
 *   - Tier 3: ALMOST THERE — 2-3 Docs Missing
 *   - Tier 4: SYSTEMIC GAPS — aggregated missing doc patterns
 *   - Tier 5: NO DOC TRACKING — zero docs on portal
 *   - Recommended Priority Order
 *
 * Outputs:
 *   - pe-task-list-{date}.html  — printable HTML (Cmd+P → Save as PDF)
 *   - pe-task-list-{date}.json  — structured data for dashboard
 *
 * Usage:
 *   npx tsx scripts/pe-task-list.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

// Load env
const envCandidates = [
  path.resolve(__dirname, "../.env"),
  path.resolve(__dirname, "../../../.env"),
  "/Users/zach/Downloads/Dev Projects/PB-Operations-Suite/.env",
];
for (const p of envCandidates) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p });
    break;
  }
}

import { Client as HubSpotClient } from "@hubspot/api-client";

const HUBSPOT_PORTAL_ID = process.env.HUBSPOT_PORTAL_ID || "24585182";
const PROJECT_PIPELINE_ID = process.env.HUBSPOT_PIPELINE_PROJECT || "6900017";
const PE_PORTAL_BASE = "https://raceway.participate.energy";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Doc {
  name: string;
  status: string;
}

interface ScrapedProject {
  projectId: string;
  customerName: string;
  milestone: string;
  docReview: string;
  documents: {
    onboarding: Doc[];
    inspectionComplete: Doc[];
    projectComplete: Doc[];
  };
}

interface HsDeal {
  id: string;
  dealname: string;
  dealstage: string;
  amount: number;
  pe_payment_ic: number;
  pe_payment_pc: number;
  pe_m1_status: string;
  pe_m2_status: string;
  pe_project_id: string | null;
}

interface EnrichedProject extends ScrapedProject {
  dealId: string;
  dealName: string;
  dealStage: string;
  dealStageLabel: string;
  dealAmount: number;
  pePaymentIC: number;
  pePaymentPC: number;
  pePaymentBlocked: number; // stage-aware: IC at PTO, IC+PC at Close Out/Complete
  m1Status: string;
  m2Status: string;
  hubspotUrl: string;
  portalUrl: string;
  // Computed doc stats (stage-aware: PTO = M1 docs only)
  approved: number;
  rejected: number;
  underReview: number;
  uploaded: number;
  notExpected: number;
  totalDocs: number;
  rejectedDocs: Doc[];
  notExpectedDocs: Doc[];
  underReviewDocs: Doc[];
}

// ---------------------------------------------------------------------------
// Stage config
// ---------------------------------------------------------------------------

const STAGE_LABELS: Record<string, string> = {
  "20461940": "PTO",
  "24743347": "Close Out",
  "20440343": "Project Complete",
};

const STAGE_PRIORITY: Record<string, number> = {
  "20440343": 0,  // Project Complete — closest to done
  "24743347": 1,  // Close Out
  "20461940": 2,  // PTO
};

// Payment stages only — PTO, Close Out, Project Complete
const PAYMENT_STAGES = new Set(["20461940", "24743347", "20440343"]);

// PTO stage IDs — only IC (M1) docs relevant
const PTO_STAGE_IDS = new Set(["20461940"]);

// ---------------------------------------------------------------------------
// Load scraped data
// ---------------------------------------------------------------------------

const jsonPath = path.join(__dirname, "..", "pe-portal-scrape-2026-05-11.json");
const data = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
const scraped: ScrapedProject[] = data.projects;

// ---------------------------------------------------------------------------
// HubSpot fetch with retry
// ---------------------------------------------------------------------------

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchPeDeals(): Promise<HsDeal[]> {
  const hsClient = new HubSpotClient({ accessToken: process.env.HUBSPOT_ACCESS_TOKEN });
  const deals: HsDeal[] = [];
  let after: string | undefined;

  do {
    let resp: any;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        resp = await hsClient.crm.deals.searchApi.doSearch({
          filterGroups: [{
            filters: [
              { propertyName: "pipeline", operator: "EQ", value: PROJECT_PIPELINE_ID },
              { propertyName: "tags", operator: "CONTAINS_TOKEN", value: "Participate Energy" },
            ],
          }],
          properties: ["hs_object_id", "dealname", "dealstage", "pe_project_id", "amount", "pe_payment_ic", "pe_payment_pc", "pe_m1_status", "pe_m2_status"],
          sorts: [{ propertyName: "dealname", direction: "ASCENDING" }] as any,
          limit: 100,
          ...(after ? { after } : {}),
        } as any);
        break;
      } catch (err: any) {
        if (err?.code === 429 && attempt < 4) {
          const delay = Math.pow(2, attempt) * 1000;
          console.log(`   ⏳ Rate limited, retrying in ${delay}ms...`);
          await sleep(delay);
          continue;
        }
        throw err;
      }
    }

    for (const d of resp.results) {
      deals.push({
        id: String(d.properties.hs_object_id),
        dealname: String(d.properties.dealname || ""),
        dealstage: String(d.properties.dealstage || ""),
        amount: parseFloat(d.properties.amount || "0") || 0,
        pe_payment_ic: parseFloat(d.properties.pe_payment_ic || "0") || 0,
        pe_payment_pc: parseFloat(d.properties.pe_payment_pc || "0") || 0,
        pe_m1_status: String(d.properties.pe_m1_status || ""),
        pe_m2_status: String(d.properties.pe_m2_status || ""),
        pe_project_id: d.properties.pe_project_id || null,
      });
    }
    after = resp.paging?.next?.after;
  } while (after);

  return deals;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
}

function matchDeal(project: ScrapedProject, peIdMap: Map<string, HsDeal>, deals: HsDeal[]): HsDeal | null {
  const byId = peIdMap.get(project.projectId.toLowerCase());
  if (byId) return byId;

  const custNorm = normalize(project.customerName);
  const candidates = deals.filter(d => normalize(d.dealname).includes(custNorm));
  if (candidates.length === 1) return candidates[0];

  const lastName = custNorm.split(/\s+/).pop() || "";
  if (lastName.length >= 4) {
    const lastCandidates = deals.filter(d => normalize(d.dealname).includes(lastName));
    if (lastCandidates.length === 1) return lastCandidates[0];
  }

  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DONE_STATUSES = new Set(["Paid", "Approved"]);

// Which docs are relevant given stage AND milestone payment status?
//   PTO → M1 docs only (onboarding + IC)
//   Close Out/Complete with M1 already done → M2 docs only (PC)
//   Close Out/Complete with M1 not done → all docs
function getRelevantDocs(p: ScrapedProject, dealStage: string, m1Status: string): Doc[] {
  if (PTO_STAGE_IDS.has(dealStage)) {
    return [...p.documents.onboarding, ...p.documents.inspectionComplete];
  }
  // Close Out / Project Complete
  if (DONE_STATUSES.has(m1Status)) {
    // M1 already paid/approved — only PC docs are actionable
    return [...p.documents.projectComplete];
  }
  return [...p.documents.onboarding, ...p.documents.inspectionComplete, ...p.documents.projectComplete];
}

// What PE payment is blocked given stage + milestone status?
//   PTO → IC only
//   Close Out/Complete with M1 done → PC only
//   Close Out/Complete with M1 not done → IC + PC
function blockedPayment(dealStage: string, m1Status: string, ic: number, pc: number): number {
  if (PTO_STAGE_IDS.has(dealStage)) return ic;
  if (DONE_STATUSES.has(m1Status)) return pc; // M1 done, only M2 blocked
  return ic + pc;
}

// Is this deal fully done (nothing blocked)?
function isFullyDone(dealStage: string, m1Status: string, m2Status: string): boolean {
  if (PTO_STAGE_IDS.has(dealStage)) return DONE_STATUSES.has(m1Status);
  return DONE_STATUSES.has(m1Status) && DONE_STATUSES.has(m2Status);
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtDollars(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

function projNum(dealId: string): string {
  return `PROJ-${dealId}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`📋 Loaded ${scraped.length} scraped PE projects`);

  const allDeals = await fetchPeDeals();
  console.log(`🔗 Fetched ${allDeals.length} PE-tagged HubSpot deals`);

  // Only keep deals at payment stages (PTO, Close Out, Project Complete)
  const deals = allDeals.filter(d => PAYMENT_STAGES.has(d.dealstage));
  console.log(`💰 ${deals.length} deals at payment stages (PTO / Close Out / Project Complete)`);

  // Build PE ID map from payment-stage deals only
  const peIdMap = new Map<string, HsDeal>();
  for (const d of deals) {
    if (d.pe_project_id) peIdMap.set(d.pe_project_id.toLowerCase(), d);
  }

  // Enrich and filter: payment-stage deals that still have money blocked
  const enriched: EnrichedProject[] = [];
  let matchCount = 0;
  let skippedDone = 0;

  for (const p of scraped) {
    const deal = matchDeal(p, peIdMap, deals);
    if (!deal) continue; // skip — not at a payment stage
    matchCount++;

    // Skip deals where relevant milestones are already Paid/Approved
    if (isFullyDone(deal.dealstage, deal.pe_m1_status, deal.pe_m2_status)) {
      skippedDone++;
      continue;
    }

    const relevantDocs = getRelevantDocs(p, deal.dealstage, deal.pe_m1_status);
    const approved = relevantDocs.filter(d => d.status === "APPROVED").length;
    const rejected = relevantDocs.filter(d => d.status === "ACTION REQUIRED").length;
    const underReview = relevantDocs.filter(d => d.status === "UNDER REVIEW").length;
    const uploaded = relevantDocs.filter(d => d.status === "UPLOADED").length;
    const notExpected = relevantDocs.filter(d => d.status === "NOT YET EXPECTED").length;
    const blocked = blockedPayment(deal.dealstage, deal.pe_m1_status, deal.pe_payment_ic, deal.pe_payment_pc);

    enriched.push({
      ...p,
      dealId: deal.id,
      dealName: deal.dealname,
      dealStage: deal.dealstage,
      dealStageLabel: STAGE_LABELS[deal.dealstage] || deal.dealstage,
      dealAmount: deal.amount,
      pePaymentIC: deal.pe_payment_ic,
      pePaymentPC: deal.pe_payment_pc,
      pePaymentBlocked: blocked,
      m1Status: deal.pe_m1_status,
      m2Status: deal.pe_m2_status,
      hubspotUrl: `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/deal/${deal.id}`,
      portalUrl: `${PE_PORTAL_BASE}/projects/${p.projectId}`,
      approved,
      rejected,
      underReview,
      uploaded,
      notExpected,
      totalDocs: relevantDocs.length,
      rejectedDocs: relevantDocs.filter(d => d.status === "ACTION REQUIRED"),
      notExpectedDocs: relevantDocs.filter(d => d.status === "NOT YET EXPECTED"),
      underReviewDocs: relevantDocs.filter(d => d.status === "UNDER REVIEW"),
    });
  }

  console.log(`✅ Matched to payment-stage deals: ${matchCount}`);
  console.log(`   Skipped ${skippedDone} already Paid/Approved`);
  console.log(`   ${enriched.length} deals with money still blocked\n`);

  // Sort helper — Close Out first, then PTO, then Project Complete
  const sortByStage = (a: EnrichedProject, b: EnrichedProject) => {
    return (STAGE_PRIORITY[a.dealStage] ?? 99) - (STAGE_PRIORITY[b.dealStage] ?? 99);
  };

  // ---------------------------------------------------------------------------
  // Tier classification
  // ---------------------------------------------------------------------------

  // Tier 1: PE rejected docs (ACTION REQUIRED)
  const tier1 = enriched.filter(p => p.rejected > 0).sort(sortByStage);

  // Non-rejected
  const nonRejected = enriched.filter(p => p.rejected === 0);

  // Tier 5: Zero docs on portal
  const tier5 = nonRejected.filter(p => p.approved === 0 && p.underReview === 0 && p.uploaded === 0).sort(sortByStage);

  // Projects with some docs
  const partialDocs = nonRejected.filter(p => !(p.approved === 0 && p.underReview === 0 && p.uploaded === 0));

  // All approved (relevant docs for their stage)
  const allApproved = partialDocs.filter(p => p.notExpected === 0 && p.rejected === 0 && p.underReview === 0).sort(sortByStage);

  // Projects with missing docs
  const withMissing = partialDocs.filter(p => p.notExpected > 0);

  // Tier 2: 1 doc missing
  const tier2 = withMissing.filter(p => p.notExpected === 1).sort(sortByStage);

  // Tier 3: 2-3 docs missing
  const tier3 = withMissing.filter(p => p.notExpected >= 2 && p.notExpected <= 3).sort(sortByStage);

  // Tier 4: 4+ docs missing
  const tier4 = withMissing.filter(p => p.notExpected >= 4).sort(sortByStage);

  // Under review only
  const underReviewOnly = partialDocs.filter(p => p.notExpected === 0 && p.rejected === 0 && p.underReview > 0);

  // ---------------------------------------------------------------------------
  // Big Picture stats
  // ---------------------------------------------------------------------------

  const ptoProjects = enriched.filter(p => PTO_STAGE_IDS.has(p.dealStage));
  const closeOutProjects = enriched.filter(p => p.dealStage === "24743347");
  const pcProjects = enriched.filter(p => p.dealStage === "20440343");

  const ptoTotal = ptoProjects.reduce((s, p) => s + p.pePaymentBlocked, 0);
  const closeOutTotal = closeOutProjects.reduce((s, p) => s + p.pePaymentBlocked, 0);
  const pcTotal = pcProjects.reduce((s, p) => s + p.pePaymentBlocked, 0);
  const totalOwed = ptoTotal + closeOutTotal + pcTotal;

  const hasAllApproved = allApproved.length;
  const hasAllSubmitted = enriched.filter(p => p.notExpected === 0 && p.rejected === 0 && p.approved < p.totalDocs).length;
  const hasRejected = tier1.length;
  const hasMissing = withMissing.length;
  const hasZeroDocs = tier5.length;

  // ---------------------------------------------------------------------------
  // Fastest Path to Money
  // ---------------------------------------------------------------------------

  const tier1Amount = tier1.reduce((s, p) => s + p.pePaymentBlocked, 0);
  const tier2Amount = tier2.reduce((s, p) => s + p.pePaymentBlocked, 0);
  const tier3Amount = tier3.reduce((s, p) => s + p.pePaymentBlocked, 0);
  const fastPathTotal = tier1Amount + tier2Amount + tier3Amount;
  const fastPathProjects = tier1.length + tier2.length + tier3.length;

  // ---------------------------------------------------------------------------
  // Group by stage helper
  // ---------------------------------------------------------------------------

  function groupByStage(projects: EnrichedProject[]): Map<string, EnrichedProject[]> {
    const groups = new Map<string, EnrichedProject[]>();
    for (const p of projects) {
      if (!groups.has(p.dealStageLabel)) groups.set(p.dealStageLabel, []);
      groups.get(p.dealStageLabel)!.push(p);
    }
    return groups;
  }

  // ---------------------------------------------------------------------------
  // Systemic gap analysis
  // ---------------------------------------------------------------------------

  const docMissingCounts: Record<string, number> = {};
  for (const p of enriched) {
    for (const d of p.notExpectedDocs) {
      docMissingCounts[d.name] = (docMissingCounts[d.name] || 0) + 1;
    }
  }
  const sortedMissingDocs = Object.entries(docMissingCounts)
    .sort(([, a], [, b]) => b - a)
    .filter(([, count]) => count >= 3);

  // ---------------------------------------------------------------------------
  // HTML generation
  // ---------------------------------------------------------------------------

  function links(p: EnrichedProject): string {
    const parts: string[] = [];
    parts.push(`<a href="${p.hubspotUrl}" target="_blank">HS</a>`);
    parts.push(`<a href="${p.portalUrl}" target="_blank">Portal</a>`);
    return parts.join(" · ");
  }

  function tierTable(projects: EnrichedProject[], stageLabel: string, columns: "rejected" | "missing"): string {
    if (projects.length === 0) return "";
    const stageTotal = projects.reduce((s, p) => s + p.pePaymentBlocked, 0);
    return `
<h3>${stageLabel} (${projects.length} projects · ${fmtDollars(stageTotal)})</h3>
<table>
<thead><tr><th>Customer</th><th>Approved</th><th>${columns === "rejected" ? "Doc(s) Rejected" : "Missing Doc(s)"}</th><th>$ Blocked</th><th>Links</th></tr></thead>
<tbody>
${projects.map(p => {
  const docList = columns === "rejected"
    ? p.rejectedDocs.map(d => esc(d.name)).join(", ")
    : p.notExpectedDocs.map(d => esc(d.name)).join(", ");
  const notExpectedNote = columns === "rejected" && p.notExpected > 0 ? ` (+${p.notExpected} NS)` : "";
  return `<tr>
  <td>${esc(p.customerName)}</td>
  <td>${p.approved}/${p.totalDocs}${notExpectedNote}</td>
  <td>${docList}</td>
  <td class="mono">${fmtDollars(p.pePaymentBlocked)}</td>
  <td class="links">${links(p)}</td>
</tr>`;
}).join("\n")}
</tbody>
</table>`;
  }

  // Build tier sections grouped by stage
  const stageOrder = ["Close Out", "PTO", "Project Complete"];

  function buildSections(projects: EnrichedProject[], columns: "rejected" | "missing"): string {
    const byStage = groupByStage(projects);
    const sections: string[] = [];
    for (const stage of stageOrder) {
      const projs = byStage.get(stage);
      if (projs) sections.push(tierTable(projs, stage, columns));
    }
    return sections.join("\n");
  }

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>PE Document Upload Task List — Layla (${data.scrapeDate})</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 2em 3em; color: #1a1a1a; background: #fff; max-width: 960px; }
  h1 { font-size: 1.6em; margin-bottom: 0.1em; }
  h2 { font-size: 1.3em; margin-top: 2.5em; margin-bottom: 0.5em; }
  h3 { font-size: 1em; margin-top: 1.5em; margin-bottom: 0.3em; }
  .subtitle { color: #666; margin-bottom: 2em; font-size: 0.9em; }
  .big-picture { margin-bottom: 2em; }
  .big-picture h2 { margin-top: 0.5em; }
  .big-picture .highlight { font-weight: 700; }
  .big-picture ul { margin: 0.5em 0; padding-left: 1.5em; }
  .big-picture li { margin: 0.3em 0; }
  .callout { font-weight: 700; margin: 1em 0; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 1em; font-size: 0.88em; }
  th { text-align: left; background: #f3f4f6; padding: 0.4em 0.6em; border-bottom: 2px solid #d1d5db; font-size: 0.85em; color: #374151; }
  td { padding: 0.4em 0.6em; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  tr:hover { background: #f9fafb; }
  .mono { font-family: 'SF Mono', 'Menlo', monospace; font-size: 0.85em; }
  .links { white-space: nowrap; }
  .links a { color: #2563eb; text-decoration: none; font-size: 0.85em; }
  .links a:hover { text-decoration: underline; }
  .fastest-path { margin: 1.5em 0; }
  .fastest-path table { max-width: 700px; }
  .fastest-path td:nth-child(2), .fastest-path td:nth-child(3) { text-align: center; }
  .fastest-path th:nth-child(2), .fastest-path th:nth-child(3) { text-align: center; }
  .fastest-path tr:last-child { font-weight: 700; border-top: 2px solid #374151; }
  .tier-header { border-bottom: 3px solid #374151; padding-bottom: 0.3em; }
  .tier-desc { color: #666; font-size: 0.9em; margin: 0.3em 0 1em; }
  .gap-table { max-width: 450px; }
  .gap-table td:nth-child(2) { text-align: center; }
  .gap-table th:nth-child(2) { text-align: center; }
  .priority-list { margin: 1em 0; padding-left: 1.5em; }
  .priority-list li { margin: 0.5em 0; }
  hr { border: none; border-top: 2px solid #374151; margin: 2em 0; }
  a { color: #2563eb; }
  @media print {
    body { margin: 0.5em; padding: 0.5em 1em; font-size: 0.82em; }
    table { font-size: 0.78em; page-break-inside: auto; }
    tr { page-break-inside: avoid; }
    td, th { padding: 0.25em 0.4em; }
    h2 { page-break-before: auto; }
    .links a { text-decoration: underline !important; }
  }
</style>
</head>
<body>

<h1>PE Document Upload Task List — Layla</h1>
<div class="subtitle"><strong>PE deals at payment stages (PTO, Close Out, Project Complete) — ${data.scrapeDate}</strong><br>
${enriched.length} projects · PTO counts M1 (IC) docs only · Close Out &amp; Complete count M1 + M2 docs</div>

<div class="big-picture">
<h2>The Big Picture</h2>

<p class="highlight">${fmtDollars(totalOwed)} in PE payments blocked at payment stages.</p>

<ul>
  <li><strong>PTO (${ptoProjects.length} projects):</strong> ${fmtDollars(ptoTotal)} — IC payment only</li>
  <li><strong>Close Out (${closeOutProjects.length} projects):</strong> ${fmtDollars(closeOutTotal)} — IC + PC payment</li>
  <li><strong>Project Complete (${pcProjects.length} projects):</strong> ${fmtDollars(pcTotal)} — IC + PC payment</li>
</ul>

<p>PE won't review ANY documents on a project until ALL docs are uploaded. Right now:</p>
<ul>
  <li><strong>${hasAllApproved} projects</strong> — all docs approved ✓</li>
  <li><strong>${hasAllSubmitted} projects</strong> — all docs submitted, waiting on PE</li>
  <li><strong>${hasRejected} projects</strong> — PE rejected docs, we need to fix and resubmit</li>
  <li><strong>${hasMissing} projects</strong> — still have docs we haven't uploaded</li>
  <li><strong>${hasZeroDocs} projects</strong> — no documents on the portal at all</li>
</ul>

<p class="callout">We are blocking ourselves on every project with missing or rejected docs.</p>
</div>

<div class="fastest-path">
<h3>Fastest Path to Money</h3>
<table>
<thead><tr><th>Action</th><th>Projects</th><th>$ Blocked</th><th>Effort</th></tr></thead>
<tbody>
<tr><td>Fix rejected docs</td><td>${tier1.length}</td><td>${fmtDollars(tier1Amount)}</td><td>Fix specific issues PE flagged</td></tr>
<tr><td>Upload 1 missing doc</td><td>${tier2.length}</td><td>${fmtDollars(tier2Amount)}</td><td>1 doc per project</td></tr>
<tr><td>Upload 2-3 missing docs</td><td>${tier3.length}</td><td>${fmtDollars(tier3Amount)}</td><td>Quick wins</td></tr>
<tr><td><strong>Total actionable</strong></td><td><strong>${fastPathProjects}</strong></td><td><strong>${fmtDollars(fastPathTotal)}</strong></td><td></td></tr>
</tbody>
</table>
</div>

<hr>

<h2 class="tier-header">TIER 1: URGENT — Response Needed (${tier1.length} projects · ${fmtDollars(tier1Amount)})</h2>
<p class="tier-desc">PE already reviewed these and told us what to fix. Closest to unlocking payments.</p>

${buildSections(tier1, "rejected")}

<hr>

<h2 class="tier-header">TIER 2: QUICK WINS — 1 Doc Missing (${tier2.length} projects · ${fmtDollars(tier2Amount)})</h2>
<p class="tier-desc">Upload ONE document to unblock PE review on each.</p>

${buildSections(tier2, "missing")}

<hr>

<h2 class="tier-header">TIER 3: ALMOST THERE — 2-3 Docs Missing (${tier3.length} projects · ${fmtDollars(tier3Amount)})</h2>

${buildSections(tier3, "missing")}

<hr>

<h2 class="tier-header">TIER 4: SYSTEMIC GAPS — ${tier4.length} Projects with 4+ Missing Docs</h2>
<p class="tier-desc">Most commonly missing documents across all ${enriched.length} payment-stage projects:</p>

${sortedMissingDocs.length > 0 ? `
<table class="gap-table">
<thead><tr><th>Document</th><th># Projects Missing It</th></tr></thead>
<tbody>
${sortedMissingDocs.map(([name, count]) => `<tr><td>${esc(name)}</td><td>${count}</td></tr>`).join("\n")}
</tbody>
</table>

<p><strong>These are all post-install projects at payment stages.</strong> The installs are done, so these should all be uploadable now. If there's a reason they can't be, flag it to Matt.</p>
` : "<p>No systemic gaps detected.</p>"}

${tier4.length > 0 ? `
${buildSections(tier4, "missing")}
` : ""}

<hr>

<h2 class="tier-header">TIER 5: NO DOC TRACKING (${tier5.length} projects at payment stages with zero docs)</h2>

${tier5.length > 0 ? `
${buildSections(tier5, "missing")}
` : "<p>None — all payment-stage projects have at least some docs tracked.</p>"}

${allApproved.length > 0 ? `
<hr>

<h2>All Docs Approved (${allApproved.length} projects)</h2>
<p class="tier-desc">These projects have all required docs approved — no action needed from us.</p>
<table>
<thead><tr><th>Customer</th><th>Stage</th><th>Docs</th><th>Links</th></tr></thead>
<tbody>
${allApproved.map(p => `<tr>
  <td>${esc(p.customerName)}</td>
  <td>${p.dealStageLabel}</td>
  <td>${p.approved}/${p.totalDocs}</td>
  <td class="links">${links(p)}</td>
</tr>`).join("\n")}
</tbody>
</table>
` : ""}

<hr>

<h2>Recommended Priority Order</h2>
<ol class="priority-list">
  <li><strong>Fix the ${tier1.length} rejected items (${fmtDollars(tier1Amount)})</strong> — PE already told us what's wrong</li>
  <li><strong>Upload 1 doc on ${tier2.length} near-complete projects (${fmtDollars(tier2Amount)})</strong> — each unlocks a full PE review</li>
  <li><strong>Upload 2-3 docs on ${tier3.length} projects (${fmtDollars(tier3Amount)})</strong></li>
  <li><strong>Tackle the ${tier4.length} projects with 4+ missing docs</strong> — ${sortedMissingDocs.length > 0 ? `"${sortedMissingDocs[0][0]}" is missing on ${sortedMissingDocs[0][1]} projects` : "systemic issue"}</li>
  <li><strong>Investigate ${tier5.length} zero-doc projects</strong> at payment stages</li>
</ol>

</body>
</html>`;

  const htmlPath = path.join(__dirname, "..", `pe-task-list-${data.scrapeDate}.html`);
  fs.writeFileSync(htmlPath, html);
  console.log(`📄 HTML: ${htmlPath}`);

  // ---------------------------------------------------------------------------
  // Plain English version
  // ---------------------------------------------------------------------------

  function plainAction(p: EnrichedProject): string[] {
    const lines: string[] = [];
    if (p.rejected > 0) {
      for (const d of p.rejectedDocs) {
        lines.push(`Fix and resubmit "${d.name}" — PE rejected it`);
      }
    }
    if (p.notExpected > 0) {
      for (const d of p.notExpectedDocs) {
        lines.push(`Upload "${d.name}"`);
      }
    }
    if (p.underReview > 0) {
      lines.push(`${p.underReview} doc${p.underReview > 1 ? "s" : ""} under PE review — no action needed`);
    }
    if (lines.length === 0 && p.approved === p.totalDocs) {
      lines.push("All docs approved — nothing to do");
    }
    if (lines.length === 0) {
      lines.push("All docs submitted — waiting on PE");
    }
    return lines;
  }

  // Sort: rejected first (highest value), then by fewest missing docs, then by $ blocked desc
  const actionable = enriched
    .filter(p => p.rejected > 0 || p.notExpected > 0)
    .sort((a, b) => {
      // Rejected first
      if (a.rejected > 0 && b.rejected === 0) return -1;
      if (a.rejected === 0 && b.rejected > 0) return 1;
      // Then fewest missing (quick wins)
      const aMissing = a.notExpected + a.rejected;
      const bMissing = b.notExpected + b.rejected;
      if (aMissing !== bMissing) return aMissing - bMissing;
      // Then highest $ blocked
      return b.pePaymentBlocked - a.pePaymentBlocked;
    });

  const waitingOnPE = enriched.filter(p => p.rejected === 0 && p.notExpected === 0);

  const plainHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>PE Tasks — Plain English (${data.scrapeDate})</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 2em 3em; color: #1a1a1a; background: #fff; max-width: 800px; line-height: 1.5; }
  h1 { font-size: 1.5em; margin-bottom: 0.2em; }
  .subtitle { color: #666; margin-bottom: 1.5em; }
  .summary { background: #f8f9fa; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1.2em 1.5em; margin-bottom: 2em; }
  .summary p { margin: 0.3em 0; }
  .summary .big { font-size: 1.3em; font-weight: 700; margin-bottom: 0.5em; }
  .project { border-bottom: 1px solid #e5e7eb; padding: 0.8em 0; }
  .project:last-child { border-bottom: none; }
  .project-header { display: flex; justify-content: space-between; align-items: baseline; }
  .customer { font-weight: 600; }
  .stage { font-size: 0.85em; color: #666; }
  .amount { font-family: 'SF Mono', Menlo, monospace; font-size: 0.85em; color: #059669; font-weight: 600; }
  .actions { margin: 0.3em 0 0 1em; }
  .actions li { margin: 0.2em 0; }
  .fix { color: #dc2626; }
  .upload { color: #d97706; }
  .waiting { color: #6b7280; font-style: italic; }
  .section-header { font-size: 1.15em; font-weight: 700; margin: 1.5em 0 0.5em; padding-bottom: 0.3em; border-bottom: 2px solid #374151; }
  .section-count { font-weight: 400; color: #666; font-size: 0.85em; }
  a { color: #2563eb; text-decoration: none; font-size: 0.85em; }
  a:hover { text-decoration: underline; }
  .links { font-size: 0.85em; }
  .waiting-section { margin-top: 2em; }
  .waiting-section .project { padding: 0.4em 0; }
  @media print {
    body { padding: 0.5em 1em; font-size: 0.85em; }
    .summary { padding: 0.8em 1em; }
    .project { padding: 0.5em 0; }
    a { text-decoration: underline !important; }
  }
</style>
</head>
<body>

<h1>PE Document Tasks for Layla</h1>
<div class="subtitle">${data.scrapeDate} — Payment-stage projects only</div>

<div class="summary">
  <p class="big">${fmtDollars(totalOwed)} blocked across ${enriched.length} projects</p>
  <p>${actionable.length} projects need action from us. ${waitingOnPE.length} are waiting on PE.</p>
  <p>PE won't review ANY docs on a project until ALL docs are uploaded.</p>
</div>

${actionable.length > 0 ? `
<div class="section-header">Projects That Need Action <span class="section-count">(${actionable.length} projects)</span></div>

${actionable.map((p, i) => {
  const actions = plainAction(p);
  return `<div class="project">
  <div class="project-header">
    <span><span class="customer">${i + 1}. ${esc(p.customerName)}</span> <span class="stage">${p.dealStageLabel}</span></span>
    <span><span class="amount">${fmtDollars(p.pePaymentBlocked)}</span> &nbsp; <span class="links"><a href="${p.hubspotUrl}" target="_blank">HubSpot</a></span></span>
  </div>
  <ul class="actions">
    ${actions.map(a => {
      const cls = a.startsWith("Fix") ? "fix" : a.startsWith("Upload") ? "upload" : "waiting";
      return `<li class="${cls}">${a}</li>`;
    }).join("\n    ")}
  </ul>
</div>`;
}).join("\n")}
` : ""}

${waitingOnPE.length > 0 ? `
<div class="waiting-section">
<div class="section-header">Waiting on PE <span class="section-count">(${waitingOnPE.length} projects — no action needed)</span></div>
${waitingOnPE.map(p => {
  const note = p.approved === p.totalDocs ? "all approved ✓" : `${p.underReview} under review`;
  return `<div class="project">
  <span class="customer">${esc(p.customerName)}</span> <span class="stage">${p.dealStageLabel}</span> — <span class="waiting">${note}</span>
</div>`;
}).join("\n")}
</div>
` : ""}

</body>
</html>`;

  const plainPath = path.join(__dirname, "..", `pe-task-list-plain-${data.scrapeDate}.html`);
  fs.writeFileSync(plainPath, plainHtml);
  console.log(`📝 Plain English: ${plainPath}`);

  // ---------------------------------------------------------------------------
  // Checkbox version (printable checklist)
  // ---------------------------------------------------------------------------

  const checkboxHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>PE Tasks Checklist — Layla (${data.scrapeDate})</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 2em 3em; color: #1a1a1a; background: #fff; max-width: 800px; line-height: 1.6; }
  h1 { font-size: 1.4em; margin-bottom: 0.2em; }
  .subtitle { color: #666; margin-bottom: 1.5em; font-size: 0.9em; }
  .summary { background: #f8f9fa; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1em 1.5em; margin-bottom: 2em; }
  .summary p { margin: 0.3em 0; }
  .summary .big { font-size: 1.2em; font-weight: 700; }
  .section-header { font-size: 1.1em; font-weight: 700; margin: 1.5em 0 0.8em; padding-bottom: 0.3em; border-bottom: 2px solid #374151; }
  .section-count { font-weight: 400; color: #666; font-size: 0.85em; }
  .project { margin-bottom: 1em; padding-bottom: 0.8em; border-bottom: 1px solid #f0f0f0; }
  .project-name { font-weight: 600; margin-bottom: 0.3em; }
  .project-meta { font-size: 0.85em; color: #666; margin-bottom: 0.3em; }
  .task { display: flex; align-items: flex-start; gap: 0.5em; margin: 0.25em 0 0.25em 0.5em; }
  .checkbox { width: 18px; height: 18px; border: 1.5px solid #9ca3af; border-radius: 3px; flex-shrink: 0; margin-top: 2px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s; user-select: none; }
  .checkbox:hover { border-color: #059669; background: #f0fdf4; }
  .checkbox.checked { background: #059669; border-color: #059669; }
  .checkbox.checked::after { content: "✓"; color: white; font-size: 13px; font-weight: 700; }
  .task.done .task-text { text-decoration: line-through; color: #9ca3af; }
  .task-text { font-size: 0.92em; }
  .fix { color: #dc2626; }
  .upload { color: #92400e; }
  .progress-bar { position: sticky; top: 0; background: #fff; border-bottom: 1px solid #e5e7eb; padding: 0.8em 0; margin-bottom: 1em; z-index: 10; }
  .progress-track { height: 8px; background: #e5e7eb; border-radius: 4px; overflow: hidden; }
  .progress-fill { height: 100%; background: #059669; border-radius: 4px; transition: width 0.3s ease; }
  .progress-text { font-size: 0.85em; color: #666; margin-top: 0.3em; }
  .progress-text span { font-weight: 600; color: #059669; }
  .project.all-done { opacity: 0.5; }
  .project.all-done .project-name { text-decoration: line-through; }
  .waiting-section { margin-top: 2em; }
  .waiting-item { display: flex; align-items: center; gap: 0.5em; margin: 0.3em 0; font-size: 0.9em; }
  .done-check { color: #059669; font-weight: 700; }
  @media print {
    body { padding: 0.5em 1em; font-size: 0.85em; }
    .summary { padding: 0.6em 1em; }
    .project { margin-bottom: 0.6em; padding-bottom: 0.5em; }
    .checkbox { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>

<h1>☐ PE Document Checklist — Layla</h1>
<div class="subtitle">${data.scrapeDate} — ${actionable.length} projects need action · ${fmtDollars(totalOwed)} blocked</div>

<div class="summary">
  <p class="big">${fmtDollars(totalOwed)} in PE payments waiting on us</p>
  <p>${actionable.length} projects need docs uploaded or fixed. ${waitingOnPE.length} are waiting on PE (no action).</p>
</div>

<div class="progress-bar">
  <div class="progress-track"><div class="progress-fill" id="progressFill" style="width:0%"></div></div>
  <div class="progress-text"><span id="progressCount">0</span> of <span id="progressTotal">0</span> tasks done</div>
</div>

${actionable.map((p, i) => {
  const actions = plainAction(p);
  const actionItems = actions.filter(a => !a.includes("no action needed") && !a.includes("waiting on PE"));
  return `<div class="project" data-project="${i}">
  <div class="project-name">${i + 1}. ${esc(p.customerName)}</div>
  <div class="project-meta">${p.dealStageLabel} · ${fmtDollars(p.pePaymentBlocked)} blocked</div>
${actionItems.map((a, j) => {
  const cls = a.startsWith("Fix") ? "fix" : "upload";
  return `  <div class="task" data-task="${i}-${j}"><div class="checkbox" onclick="toggle(this)"></div><span class="task-text ${cls}">${a}</span></div>`;
}).join("\n")}
</div>`;
}).join("\n")}

${waitingOnPE.length > 0 ? `
<div class="waiting-section">
<div class="section-header">Waiting on PE <span class="section-count">(no action needed)</span></div>
${waitingOnPE.map(p => {
  const note = p.approved === p.totalDocs ? "all approved ✓" : `${p.underReview} under review`;
  return `<div class="waiting-item"><span class="done-check">✓</span> ${esc(p.customerName)} — ${note}</div>`;
}).join("\n")}
</div>
` : ""}

<script>
const STORAGE_KEY = 'pe-checklist-${data.scrapeDate}';
let checked = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');

function updateProgress() {
  const total = document.querySelectorAll('.task').length;
  const done = document.querySelectorAll('.task.done').length;
  document.getElementById('progressFill').style.width = total ? (done/total*100)+'%' : '0%';
  document.getElementById('progressCount').textContent = done;
  document.getElementById('progressTotal').textContent = total;

  document.querySelectorAll('.project').forEach(proj => {
    const tasks = proj.querySelectorAll('.task');
    if (!tasks.length) return;
    const allDone = [...tasks].every(t => t.classList.contains('done'));
    proj.classList.toggle('all-done', allDone);
  });
}

function toggle(el) {
  const task = el.closest('.task');
  const key = task.dataset.task;
  const isDone = el.classList.toggle('checked');
  task.classList.toggle('done', isDone);
  if (isDone) checked[key] = true; else delete checked[key];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(checked));
  updateProgress();
}

// Restore state on load
document.addEventListener('DOMContentLoaded', () => {
  for (const key of Object.keys(checked)) {
    const task = document.querySelector('[data-task="'+key+'"]');
    if (task) {
      task.classList.add('done');
      task.querySelector('.checkbox').classList.add('checked');
    }
  }
  updateProgress();
});
</script>

</body>
</html>`;

  const checkboxPath = path.join(__dirname, "..", `pe-task-list-checklist-${data.scrapeDate}.html`);
  fs.writeFileSync(checkboxPath, checkboxHtml);
  console.log(`☑️  Checklist: ${checkboxPath}`);

  // ---------------------------------------------------------------------------
  // JSON output
  // ---------------------------------------------------------------------------

  const taskListJson = {
    scrapeDate: data.scrapeDate,
    generatedAt: new Date().toISOString(),
    scope: "Payment stages only (PTO, Close Out, Project Complete)",
    summary: {
      totalPaymentStageProjects: enriched.length,
      totalBlocked: totalOwed,
      pto: { count: ptoProjects.length, blocked: ptoTotal, note: "IC only" },
      closeOut: { count: closeOutProjects.length, blocked: closeOutTotal, note: "IC + PC" },
      projectComplete: { count: pcProjects.length, blocked: pcTotal, note: "IC + PC" },
      allApproved: hasAllApproved,
      allSubmitted: hasAllSubmitted,
      rejected: hasRejected,
      missing: hasMissing,
      zeroDocs: hasZeroDocs,
    },
    fastestPathToMoney: {
      fixRejected: { projects: tier1.length, blocked: tier1Amount },
      upload1Doc: { projects: tier2.length, blocked: tier2Amount },
      upload2to3Docs: { projects: tier3.length, blocked: tier3Amount },
      total: { projects: fastPathProjects, blocked: fastPathTotal },
    },
    tier1: tier1.map(p => ({
      projectId: p.projectId, customerName: p.customerName, dealId: p.dealId,
      dealStage: p.dealStageLabel, approved: p.approved, total: p.totalDocs,
      blocked: p.pePaymentBlocked,
      rejectedDocs: p.rejectedDocs.map(d => d.name),
      hubspotUrl: p.hubspotUrl, portalUrl: p.portalUrl,
    })),
    tier2: tier2.map(p => ({
      projectId: p.projectId, customerName: p.customerName, dealId: p.dealId,
      dealStage: p.dealStageLabel, blocked: p.pePaymentBlocked,
      missingDoc: p.notExpectedDocs[0]?.name,
      hubspotUrl: p.hubspotUrl, portalUrl: p.portalUrl,
    })),
    tier3: tier3.map(p => ({
      projectId: p.projectId, customerName: p.customerName, dealId: p.dealId,
      dealStage: p.dealStageLabel, blocked: p.pePaymentBlocked,
      missingDocs: p.notExpectedDocs.map(d => d.name),
      hubspotUrl: p.hubspotUrl, portalUrl: p.portalUrl,
    })),
    tier4SystemicGaps: sortedMissingDocs.map(([name, count]) => ({ document: name, projectsMissing: count })),
    tier5: tier5.map(p => ({
      projectId: p.projectId, customerName: p.customerName, dealId: p.dealId,
      dealStage: p.dealStageLabel,
      hubspotUrl: p.hubspotUrl, portalUrl: p.portalUrl,
    })),
  };

  const jsonOutPath = path.join(__dirname, "..", `pe-task-list-${data.scrapeDate}.json`);
  fs.writeFileSync(jsonOutPath, JSON.stringify(taskListJson, null, 2));
  console.log(`📊 JSON: ${jsonOutPath}`);

  // Console summary
  console.log(`\n📋 Summary (payment stages only):`);
  console.log(`   💰 Total blocked: ${fmtDollars(totalOwed)}`);
  console.log(`   🔴 Tier 1 (Rejected): ${tier1.length} — ${fmtDollars(tier1Amount)}`);
  console.log(`   🟢 Tier 2 (1 Missing): ${tier2.length} — ${fmtDollars(tier2Amount)}`);
  console.log(`   🟡 Tier 3 (2-3 Missing): ${tier3.length} — ${fmtDollars(tier3Amount)}`);
  console.log(`   📊 Tier 4 (4+ Missing): ${tier4.length}`);
  console.log(`   ⚫ Tier 5 (Zero Docs): ${tier5.length}`);
  console.log(`   ✅ All Approved: ${hasAllApproved}`);
  console.log(`   ⏳ Under Review Only: ${underReviewOnly.length}`);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
