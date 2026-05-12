#!/usr/bin/env npx tsx
/**
 * PE Combined Checklist — Layla
 *
 * Single interactive checklist organized by action type:
 *   1. Fix Rejections — PE rejected docs, fix and resubmit
 *   2. Missing Uploads — docs we haven't uploaded yet
 *   3. Update HubSpot — M1 status is wrong (says Submitted but portal disagrees)
 *   4. Waiting on PE — no action needed
 *
 * Includes M1 status mismatches inline (merged with doc tasks).
 *
 * Usage:
 *   npx tsx scripts/pe-checklist.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

const envCandidates = [
  path.resolve(__dirname, "../.env"),
  path.resolve(__dirname, "../../../.env"),
  "/Users/zach/Downloads/Dev Projects/PB-Operations-Suite/.env",
];
for (const p of envCandidates) {
  if (fs.existsSync(p)) { dotenv.config({ path: p }); break; }
}

import { Client as HubSpotClient } from "@hubspot/api-client";

const HUBSPOT_PORTAL_ID = process.env.HUBSPOT_PORTAL_ID || "24585182";
const PROJECT_PIPELINE_ID = process.env.HUBSPOT_PIPELINE_PROJECT || "6900017";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Doc { name: string; status: string; }

interface ScrapedProject {
  projectId: string;
  firestoreId?: string;
  portalUrl?: string;
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
  id: string; dealname: string; dealstage: string;
  pe_payment_ic: number; pe_payment_pc: number;
  pe_m1_status: string; pe_m2_status: string;
  pe_project_id: string | null;
  // Date tracking
  pe_m1_submission_date: string;
  pe_m1_approval_date: string;
  pe_m1_rejection_date: string;
  pe_m2_submission_date: string;
  pe_m2_approval_date: string;
  pe_m2_rejection_date: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STAGE_LABELS: Record<string, string> = {
  "20461940": "PTO", "24743347": "Close Out", "20440343": "Project Complete",
};
const PAYMENT_STAGES = new Set(["20461940", "24743347", "20440343"]);
const PTO_STAGE_IDS = new Set(["20461940"]);
const DONE_STATUSES = new Set(["Paid", "Approved"]);
const SUBMITTED_STATUSES = new Set(["Submitted", "Resubmitted", "Approved"]);

// ---------------------------------------------------------------------------
// Load scraped data
// ---------------------------------------------------------------------------

const jsonPath = path.join(__dirname, "..", "pe-portal-scrape-2026-05-11.json");
const data = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
const scraped: ScrapedProject[] = data.projects;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
}

function getRelevantDocs(p: ScrapedProject, stage: string, m1: string): Doc[] {
  if (PTO_STAGE_IDS.has(stage)) return [...p.documents.onboarding, ...p.documents.inspectionComplete];
  if (DONE_STATUSES.has(m1)) return [...p.documents.projectComplete];
  return [...p.documents.onboarding, ...p.documents.inspectionComplete, ...p.documents.projectComplete];
}

function blockedPayment(stage: string, m1: string, ic: number, pc: number): number {
  if (PTO_STAGE_IDS.has(stage)) return ic;
  if (DONE_STATUSES.has(m1)) return pc;
  return ic + pc;
}

function isFullyDone(stage: string, m1: string, m2: string): boolean {
  if (PTO_STAGE_IDS.has(stage)) return DONE_STATUSES.has(m1);
  return DONE_STATUSES.has(m1) && DONE_STATUSES.has(m2);
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtDollars(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`📋 Loaded ${scraped.length} scraped PE projects`);

  // Fetch deals
  const hsClient = new HubSpotClient({ accessToken: process.env.HUBSPOT_ACCESS_TOKEN });
  const allDeals: HsDeal[] = [];
  let after: string | undefined;
  do {
    let resp: any;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        resp = await hsClient.crm.deals.searchApi.doSearch({
          filterGroups: [{ filters: [
            { propertyName: "pipeline", operator: "EQ", value: PROJECT_PIPELINE_ID },
            { propertyName: "tags", operator: "CONTAINS_TOKEN", value: "Participate Energy" },
          ]}],
          properties: ["hs_object_id", "dealname", "dealstage", "pe_project_id", "pe_payment_ic", "pe_payment_pc", "pe_m1_status", "pe_m2_status", "pe_m1_submission_date", "pe_m1_approval_date", "pe_m1_rejection_date", "pe_m2_submission_date", "pe_m2_approval_date", "pe_m2_rejection_date"],
          sorts: [{ propertyName: "dealname", direction: "ASCENDING" }] as any,
          limit: 100,
          ...(after ? { after } : {}),
        } as any);
        break;
      } catch (err: any) {
        if (err?.code === 429 && attempt < 4) { await sleep(Math.pow(2, attempt) * 1000); continue; }
        throw err;
      }
    }
    for (const d of resp.results) {
      allDeals.push({
        id: String(d.properties.hs_object_id),
        dealname: String(d.properties.dealname || ""),
        dealstage: String(d.properties.dealstage || ""),
        pe_payment_ic: parseFloat(d.properties.pe_payment_ic || "0") || 0,
        pe_payment_pc: parseFloat(d.properties.pe_payment_pc || "0") || 0,
        pe_m1_status: String(d.properties.pe_m1_status || ""),
        pe_m2_status: String(d.properties.pe_m2_status || ""),
        pe_project_id: d.properties.pe_project_id || null,
        pe_m1_submission_date: d.properties.pe_m1_submission_date || "",
        pe_m1_approval_date: d.properties.pe_m1_approval_date || "",
        pe_m1_rejection_date: d.properties.pe_m1_rejection_date || "",
        pe_m2_submission_date: d.properties.pe_m2_submission_date || "",
        pe_m2_approval_date: d.properties.pe_m2_approval_date || "",
        pe_m2_rejection_date: d.properties.pe_m2_rejection_date || "",
      });
    }
    after = resp.paging?.next?.after;
  } while (after);

  const deals = allDeals.filter(d => PAYMENT_STAGES.has(d.dealstage));
  console.log(`💰 ${deals.length} deals at payment stages`);

  const peIdMap = new Map<string, HsDeal>();
  for (const d of deals) {
    if (d.pe_project_id) peIdMap.set(d.pe_project_id.toLowerCase(), d);
  }

  // ---------------------------------------------------------------------------
  // Enrich
  // ---------------------------------------------------------------------------

  interface Enriched {
    customerName: string;
    dealId: string;
    dealStage: string;
    stageLabel: string;
    blocked: number;
    m1Status: string;
    m2Status: string;
    projectId: string;
    hubspotUrl: string;
    portalUrl: string;
    rejectedDocs: Doc[];
    missingDocs: Doc[];
    underReviewCount: number;
    approvedCount: number;
    totalDocs: number;
    // M1 mismatch
    m1Stale: boolean;
    m1Current: string;
    m1Suggested: string;
    // Dates
    m1StatusDate: string; // most relevant date for current M1 status
    m2StatusDate: string; // most relevant date for current M2 status
  }

  const enriched: Enriched[] = [];
  let skippedDone = 0;

  for (const proj of scraped) {
    let deal = peIdMap.get(proj.projectId.toLowerCase()) || null;
    if (!deal) {
      const custNorm = normalize(proj.customerName);
      const candidates = deals.filter(d => normalize(d.dealname).includes(custNorm));
      if (candidates.length === 1) deal = candidates[0];
    }
    if (!deal) continue;
    if (isFullyDone(deal.dealstage, deal.pe_m1_status, deal.pe_m2_status)) { skippedDone++; continue; }

    const docs = getRelevantDocs(proj, deal.dealstage, deal.pe_m1_status);
    const rejected = docs.filter(d => d.status === "ACTION REQUIRED");
    const missing = docs.filter(d => d.status === "NOT YET EXPECTED");
    const underReview = docs.filter(d => d.status === "UNDER REVIEW").length;
    const approved = docs.filter(d => d.status === "APPROVED").length;
    const blocked = blockedPayment(deal.dealstage, deal.pe_m1_status, deal.pe_payment_ic, deal.pe_payment_pc);

    // Check M1 mismatch: HS says submitted but portal has issues
    const m1Stale = SUBMITTED_STATUSES.has(deal.pe_m1_status) && (rejected.length > 0 || missing.length > 0);
    const m1Suggested = rejected.length > 0 ? "Rejected" : "Ready to Submit";

    // Pick the most relevant date for current status
    function pickStatusDate(status: string, sub: string, app: string, rej: string): string {
      if (["Paid", "Approved"].includes(status)) return app;
      if (["Rejected", "Onboarding Rejected"].includes(status)) return rej;
      if (["Submitted", "Resubmitted", "Onboarding Submitted", "Onboarding Resubmitted"].includes(status)) return sub;
      // For "Ready to Submit" etc., show the latest date we have
      return rej || sub || app || "";
    }

    const m1StatusDate = pickStatusDate(deal.pe_m1_status, deal.pe_m1_submission_date, deal.pe_m1_approval_date, deal.pe_m1_rejection_date);
    const m2StatusDate = pickStatusDate(deal.pe_m2_status, deal.pe_m2_submission_date, deal.pe_m2_approval_date, deal.pe_m2_rejection_date);

    enriched.push({
      customerName: proj.customerName,
      dealId: deal.id,
      dealStage: deal.dealstage,
      stageLabel: STAGE_LABELS[deal.dealstage] || deal.dealstage,
      blocked,
      m1Status: deal.pe_m1_status,
      m2Status: deal.pe_m2_status,
      projectId: proj.projectId,
      hubspotUrl: `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/deal/${deal.id}`,
      portalUrl: proj.portalUrl || `https://raceway.participate.energy/projects`,
      rejectedDocs: rejected,
      missingDocs: missing,
      underReviewCount: underReview,
      approvedCount: approved,
      totalDocs: docs.length,
      m1Stale,
      m1Current: deal.pe_m1_status,
      m1Suggested,
      m1StatusDate,
      m2StatusDate,
    });
  }

  console.log(`   Skipped ${skippedDone} already Paid/Approved`);
  console.log(`   ${enriched.length} deals with money still blocked\n`);

  // ---------------------------------------------------------------------------
  // Group by action type
  // ---------------------------------------------------------------------------

  const rejections = enriched.filter(p => p.rejectedDocs.length > 0)
    .sort((a, b) => b.blocked - a.blocked);
  const missingUploads = enriched.filter(p => p.rejectedDocs.length === 0 && p.missingDocs.length > 0)
    .sort((a, b) => a.missingDocs.length - b.missingDocs.length || b.blocked - a.blocked);
  const m1StaleOnly = enriched.filter(p => p.rejectedDocs.length === 0 && p.missingDocs.length === 0 && p.m1Stale);
  const waitingOnPE = enriched.filter(p => p.rejectedDocs.length === 0 && p.missingDocs.length === 0 && !p.m1Stale);

  const rejectionTotal = rejections.reduce((s, p) => s + p.blocked, 0);
  const missingTotal = missingUploads.reduce((s, p) => s + p.blocked, 0);
  const m1StaleCount = enriched.filter(p => p.m1Stale).length; // includes ones in rejections/missing sections
  const totalBlocked = enriched.reduce((s, p) => s + p.blocked, 0);

  console.log(`   📌 Fix Rejections: ${rejections.length} (${fmtDollars(rejectionTotal)})`);
  console.log(`   📤 Missing Uploads: ${missingUploads.length} (${fmtDollars(missingTotal)})`);
  console.log(`   🔄 M1 Status Wrong: ${m1StaleCount} total (${m1StaleOnly.length} standalone)`);
  console.log(`   ⏳ Waiting on PE: ${waitingOnPE.length}`);

  // ---------------------------------------------------------------------------
  // HTML generation
  // ---------------------------------------------------------------------------

  let taskId = 0;

  function statusClass(status: string): string {
    if (!status) return "empty";
    if (status === "Paid") return "paid";
    if (status === "Approved") return "approved";
    if (["Submitted", "Resubmitted", "Onboarding Submitted", "Onboarding Resubmitted"].includes(status)) return "submitted";
    if (["Rejected", "Onboarding Rejected"].includes(status)) return "rejected";
    if (["Waiting on Information", "Ready to Submit", "Ready to Resubmit", "Ready for Onboarding"].includes(status)) return "waiting";
    return "";
  }

  function projectBlock(p: Enriched, tasks: string[]): string {
    const pid = taskId;
    const rows = tasks.map((t, j) => {
      const id = `${pid}-${j}`;
      const cls = t.startsWith("Fix") || t.startsWith("Update HubSpot") ? "fix" : "upload";
      return `  <div class="task" data-task="${id}"><div class="checkbox" onclick="toggle(this)"></div><span class="task-text ${cls}">${t}</span></div>`;
    });
    taskId += Math.max(tasks.length, 1);

    const m1Cls = statusClass(p.m1Status);
    const m2Cls = statusClass(p.m2Status);
    function fmtDate(d: string): string {
      if (!d) return "";
      const dt = new Date(d);
      if (isNaN(dt.getTime())) return "";
      return ` (${(dt.getMonth() + 1)}/${dt.getDate()})`;
    }

    const m1Display = p.m1Status ? `${p.m1Status}${fmtDate(p.m1StatusDate)}` : "—";
    const m2Display = p.m2Status ? `${p.m2Status}${fmtDate(p.m2StatusDate)}` : "—";
    const showM2 = !PTO_STAGE_IDS.has(p.dealStage); // only show M2 for Close Out / Project Complete

    const docParts: string[] = [];
    if (p.approvedCount > 0) docParts.push(`<span class="approved">${p.approvedCount} approved</span>`);
    if (p.rejectedDocs.length > 0) docParts.push(`<span class="rejected">${p.rejectedDocs.length} rejected</span>`);
    if (p.missingDocs.length > 0) docParts.push(`<span class="missing">${p.missingDocs.length} missing</span>`);
    if (p.underReviewCount > 0) docParts.push(`<span class="review">${p.underReviewCount} under review</span>`);

    return `<div class="project" data-project="${pid}">
  <div class="project-header">
    <span class="project-name">${esc(p.customerName)}</span>
    <span><span class="amount">${fmtDollars(p.blocked)}</span> <span class="stage">${p.stageLabel}</span> <a href="${p.hubspotUrl}" target="_blank">HubSpot</a> · <a href="${p.portalUrl}" target="_blank">Portal</a></span>
  </div>
  <div class="status-row">
    <span class="pe-id">${esc(p.projectId)}</span>
    <span><span class="label">M1:</span> <span class="${m1Cls}">${esc(m1Display)}</span></span>
    ${showM2 ? `<span><span class="label">M2:</span> <span class="${m2Cls}">${esc(m2Display)}</span></span>` : ""}
  </div>
  <div class="doc-bar">${docParts.join(" · ")} <span>(of ${p.totalDocs})</span></div>
${rows.join("\n")}
</div>`;
  }

  function buildSection(projects: Enriched[], buildTasks: (p: Enriched) => string[]): string {
    return projects.map(p => projectBlock(p, buildTasks(p))).join("\n");
  }

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>PE Checklist — Layla (${data.scrapeDate})</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 2em 3em; color: #1a1a1a; background: #fff; max-width: 850px; line-height: 1.6; }
  h1 { font-size: 1.4em; margin-bottom: 0.2em; }
  .subtitle { color: #666; margin-bottom: 1.5em; font-size: 0.9em; }
  .summary { background: #f8f9fa; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1em 1.5em; margin-bottom: 1.5em; }
  .summary p { margin: 0.3em 0; }
  .summary .big { font-size: 1.2em; font-weight: 700; }
  .section-header { font-size: 1.1em; font-weight: 700; margin: 2em 0 0.3em; padding-bottom: 0.3em; border-bottom: 2px solid #374151; }
  .section-desc { color: #666; font-size: 0.88em; margin: 0 0 0.8em; }
  .section-count { font-weight: 400; color: #666; font-size: 0.85em; }
  .project { margin-bottom: 0.8em; padding-bottom: 0.8em; border-bottom: 1px solid #f0f0f0; }
  .project-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.2em; flex-wrap: wrap; gap: 0.3em; }
  .project-name { font-weight: 600; }
  .status-row { display: flex; gap: 1.2em; font-size: 0.82em; margin-bottom: 0.3em; color: #666; }
  .status-row .label { font-weight: 600; color: #374151; }
  .status-row .pe-id { font-family: 'SF Mono', Menlo, monospace; font-size: 0.92em; color: #374151; }
  .status-row .paid { color: #059669; font-weight: 600; }
  .status-row .approved { color: #059669; }
  .status-row .submitted { color: #2563eb; }
  .status-row .rejected { color: #dc2626; }
  .status-row .waiting { color: #d97706; }
  .status-row .empty { color: #9ca3af; font-style: italic; }
  .doc-bar { display: flex; gap: 0.6em; font-size: 0.78em; margin-bottom: 0.3em; color: #666; }
  .doc-bar .approved { color: #059669; }
  .doc-bar .rejected { color: #dc2626; }
  .doc-bar .missing { color: #d97706; }
  .doc-bar .review { color: #2563eb; }
  .stage { font-size: 0.82em; color: #666; margin: 0 0.3em; }
  .amount { font-family: 'SF Mono', Menlo, monospace; font-size: 0.82em; color: #059669; font-weight: 600; }
  .task { display: flex; align-items: flex-start; gap: 0.5em; margin: 0.25em 0 0.25em 0.5em; }
  .checkbox { width: 18px; height: 18px; border: 1.5px solid #9ca3af; border-radius: 3px; flex-shrink: 0; margin-top: 2px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s; user-select: none; }
  .checkbox:hover { border-color: #059669; background: #f0fdf4; }
  .checkbox.checked { background: #059669; border-color: #059669; }
  .checkbox.checked::after { content: "\\2713"; color: white; font-size: 13px; font-weight: 700; }
  .task.done .task-text { text-decoration: line-through; color: #9ca3af; }
  .task-text { font-size: 0.9em; }
  .fix { color: #dc2626; }
  .upload { color: #92400e; }
  .progress-bar { position: sticky; top: 0; background: #fff; border-bottom: 1px solid #e5e7eb; padding: 0.8em 0; margin-bottom: 1em; z-index: 10; }
  .progress-track { height: 8px; background: #e5e7eb; border-radius: 4px; overflow: hidden; }
  .progress-fill { height: 100%; background: #059669; border-radius: 4px; transition: width 0.3s ease; }
  .progress-text { font-size: 0.85em; color: #666; margin-top: 0.3em; }
  .progress-text span { font-weight: 600; color: #059669; }
  .project.all-done { opacity: 0.45; }
  .project.all-done .project-name { text-decoration: line-through; }
  .waiting-section { margin-top: 2em; }
  .waiting-item { display: flex; align-items: center; gap: 0.5em; margin: 0.3em 0; font-size: 0.88em; }
  .done-check { color: #059669; font-weight: 700; }
  a { color: #2563eb; text-decoration: none; font-size: 0.82em; }
  a:hover { text-decoration: underline; }
  @media print {
    body { padding: 0.5em 1em; font-size: 0.82em; }
    .progress-bar { position: static; }
    .checkbox { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>

<h1>PE Document Checklist — Layla</h1>
<div class="subtitle">${data.scrapeDate} · ${enriched.length} payment-stage projects · ${fmtDollars(totalBlocked)} blocked</div>

<div class="summary">
  <p class="big">${fmtDollars(totalBlocked)} in PE payments waiting on us</p>
  <p><strong>${rejections.length}</strong> projects have rejected docs · <strong>${missingUploads.length}</strong> need uploads · <strong>${m1StaleCount}</strong> have wrong M1 status in HubSpot</p>
</div>

<div class="progress-bar">
  <div class="progress-track"><div class="progress-fill" id="progressFill" style="width:0%"></div></div>
  <div class="progress-text"><span id="progressCount">0</span> of <span id="progressTotal">0</span> tasks done</div>
</div>

${rejections.length > 0 ? `
<div class="section-header">Fix Rejections <span class="section-count">(${rejections.length} projects · ${fmtDollars(rejectionTotal)})</span></div>
<p class="section-desc">PE reviewed these and rejected specific docs. Fix the issues and resubmit.</p>

${buildSection(rejections, p => {
  const tasks: string[] = [];
  if (p.m1Stale) tasks.push(`Update HubSpot M1 from "${p.m1Current}" to "${p.m1Suggested}"`);
  for (const d of p.rejectedDocs) tasks.push(`Fix and resubmit "${d.name}"`);
  for (const d of p.missingDocs) tasks.push(`Upload "${d.name}"`);
  return tasks;
})}
` : ""}

${missingUploads.length > 0 ? `
<div class="section-header">Missing Uploads <span class="section-count">(${missingUploads.length} projects · ${fmtDollars(missingTotal)})</span></div>
<p class="section-desc">No rejections — just need to upload the missing documents so PE can start reviewing.</p>

${buildSection(missingUploads, p => {
  const tasks: string[] = [];
  if (p.m1Stale) tasks.push(`Update HubSpot M1 from "${p.m1Current}" to "${p.m1Suggested}"`);
  for (const d of p.missingDocs) tasks.push(`Upload "${d.name}"`);
  return tasks;
})}
` : ""}

${m1StaleOnly.length > 0 ? `
<div class="section-header">Update HubSpot M1 Status <span class="section-count">(${m1StaleOnly.length} projects)</span></div>
<p class="section-desc">Portal docs are fine but HubSpot M1 status is stale — update it.</p>

${buildSection(m1StaleOnly, p => {
  return [`Update HubSpot M1 from "${p.m1Current}" to "${p.m1Suggested}"`];
})}
` : ""}

${waitingOnPE.length > 0 ? `
<div class="waiting-section">
<div class="section-header">Waiting on PE <span class="section-count">(${waitingOnPE.length} projects — no action needed)</span></div>
${waitingOnPE.map(p => {
  const note = p.approvedCount === p.totalDocs ? "all approved ✓" : `${p.underReviewCount} under review`;
  return `<div class="waiting-item"><span class="done-check">✓</span> ${esc(p.customerName)} <span class="stage">${p.stageLabel}</span> — ${note}</div>`;
}).join("\n")}
</div>
` : ""}

<script>
var STORAGE_KEY = 'pe-checklist-combined-${data.scrapeDate}';
var checked = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');

function updateProgress() {
  var total = document.querySelectorAll('.task').length;
  var done = document.querySelectorAll('.task.done').length;
  document.getElementById('progressFill').style.width = total ? (done/total*100)+'%' : '0%';
  document.getElementById('progressCount').textContent = done;
  document.getElementById('progressTotal').textContent = total;
  document.querySelectorAll('.project').forEach(function(proj) {
    var tasks = proj.querySelectorAll('.task');
    if (!tasks.length) return;
    var allDone = Array.from(tasks).every(function(t) { return t.classList.contains('done'); });
    proj.classList.toggle('all-done', allDone);
  });
}

function toggle(el) {
  var task = el.closest('.task');
  var key = task.dataset.task;
  var isDone = el.classList.toggle('checked');
  task.classList.toggle('done', isDone);
  if (isDone) checked[key] = true; else delete checked[key];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(checked));
  updateProgress();
}

document.addEventListener('DOMContentLoaded', function() {
  Object.keys(checked).forEach(function(key) {
    var task = document.querySelector('[data-task="'+key+'"]');
    if (task) { task.classList.add('done'); task.querySelector('.checkbox').classList.add('checked'); }
  });
  updateProgress();
});
</script>

</body>
</html>`;

  const outPath = path.join(__dirname, "..", `pe-checklist-${data.scrapeDate}.html`);
  fs.writeFileSync(outPath, html);
  console.log(`\n☑️  Checklist: ${outPath}`);

  // Also copy to Downloads
  const dlPath = path.join(process.env.HOME || "~", "Downloads", `pe-checklist-${data.scrapeDate}.html`);
  fs.copyFileSync(outPath, dlPath);
  console.log(`📂 Downloads: ${dlPath}`);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
