/**
 * Pull a full Zuper↔HubSpot mismatch report — direct API calls, no web server needed.
 * Run: npx tsx scripts/_zuper-mismatch-report.ts
 */
import "dotenv/config";
import { ZuperClient } from "../src/lib/zuper";
import { JOB_CATEGORY_UIDS } from "../src/lib/zuper";
import { getCompletedTimeFromHistory, COMPLETED_STATUSES } from "../src/lib/compliance-helpers";

const hubspotToken = process.env.HUBSPOT_ACCESS_TOKEN;
if (!hubspotToken) {
  console.error("HUBSPOT_ACCESS_TOKEN not set");
  process.exit(1);
}

const zuper = new ZuperClient();
if (!zuper.isConfigured()) {
  console.error("Zuper not configured");
  process.exit(1);
}

const TERMINAL_STATUSES = new Set([...COMPLETED_STATUSES, "loose ends remaining"]);
const CANCELLED = new Set(["cancelled", "canceled"]);

type Category = "site_survey" | "construction" | "inspection";

interface Job {
  jobUid: string;
  projectNumber: string;
  hubspotDealId: string | null;
  zuperStatus: string;
  scheduledStart: string | null;
  completedAt: string | null;
  createdAt: string | null;
  category: Category;
  team: string | null;
  isSuperseded?: boolean;
}

function extractProjectNumber(title: string): string | null {
  const match = title.match(/PROJ-(\d+)/i);
  return match ? `PROJ-${match[1]}` : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractDealId(job: any): string | null {
  // Check custom fields
  if (job.custom_fields) {
    for (const cf of Array.isArray(job.custom_fields) ? job.custom_fields : []) {
      const label = (cf.label || "").toLowerCase();
      if (label.includes("hubspot") && label.includes("deal") && cf.value) {
        const match = String(cf.value).match(/(\d{10,})/);
        if (match) return match[1];
      }
    }
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getStatus(job: any): string {
  return job.current_job_status?.name || job.status?.name || "Unknown";
}

async function fetchJobs(categoryUid: string, category: Category): Promise<Job[]> {
  const jobs: Job[] = [];
  let page = 1;
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const fromDate = sixMonthsAgo.toISOString().split("T")[0];
  const toDate = new Date().toISOString().split("T")[0];

  while (page <= 50) {
    const result = await zuper.searchJobs({
      category: categoryUid,
      from_date: fromDate,
      to_date: toDate,
      page,
      limit: 100,
    });

    if (result.type === "error" || !result.data?.jobs?.length) break;

    for (const j of result.data.jobs) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = j as any;
      const catUid = typeof j.job_category === "string" ? j.job_category : j.job_category?.category_uid;
      if (catUid && catUid !== categoryUid) continue;

      const projectNumber = extractProjectNumber(j.job_title || "");
      if (!projectNumber) continue;

      jobs.push({
        jobUid: j.job_uid || "",
        projectNumber,
        hubspotDealId: extractDealId(raw),
        zuperStatus: getStatus(raw),
        scheduledStart: j.scheduled_start_time || null,
        completedAt: raw.completed_time || raw.completed_at || null,
        createdAt: raw.created_at || null,
        category,
        team: raw.team?.team_name || null,
      });
    }

    if (result.data.jobs.length < 100) break;
    page++;
  }

  return jobs;
}

async function enrichCompletionDates(jobs: Job[]): Promise<void> {
  const needs = jobs.filter((j) => !j.completedAt && TERMINAL_STATUSES.has(j.zuperStatus.toLowerCase()));
  if (needs.length === 0) return;

  console.log(`  Enriching ${needs.length} terminal jobs with completion dates...`);
  const CONCURRENCY = 10;
  for (let i = 0; i < needs.length; i += CONCURRENCY) {
    const batch = needs.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map((j) => zuper.getJob(j.jobUid)));
    for (let k = 0; k < batch.length; k++) {
      const r = results[k];
      if (r.status === "fulfilled" && r.value.type === "success" && r.value.data) {
        const t = getCompletedTimeFromHistory(r.value.data);
        if (t) batch[k].completedAt = t.toISOString();
      }
    }
    if (i + CONCURRENCY < needs.length) await new Promise((r) => setTimeout(r, 200));
  }
  const found = needs.filter((j) => j.completedAt).length;
  console.log(`  Found ${found}/${needs.length} completion dates`);
}

function markSuperseded(jobs: Job[]): void {
  const groups = new Map<string, Job[]>();
  for (const j of jobs) {
    if (j.category !== "inspection" || !j.hubspotDealId || CANCELLED.has(j.zuperStatus.toLowerCase())) continue;
    const key = j.hubspotDealId;
    const arr = groups.get(key) || [];
    arr.push(j);
    groups.set(key, arr);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => (b.scheduledStart || b.createdAt || "").localeCompare(a.scheduledStart || a.createdAt || ""));
    for (let i = 1; i < group.length; i++) group[i].isSuperseded = true;
  }
}

async function fetchHubspotDeals(dealIds: string[]): Promise<Map<string, Record<string, string | null>>> {
  const map = new Map<string, Record<string, string | null>>();
  const props = [
    "dealname", "pb_location",
    "zuper_site_survey_status", "zuper_construction_status", "zuper_inspection_status",
    "site_survey_date", "construction_start_date", "inspection_date",
    "site_survey_complete_date", "construction_complete_date", "inspection_pass_date",
  ];

  for (let i = 0; i < dealIds.length; i += 100) {
    const batch = dealIds.slice(i, i + 100);
    const res = await fetch("https://api.hubapi.com/crm/v3/objects/deals/batch/read", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${hubspotToken}`,
      },
      body: JSON.stringify({
        inputs: batch.map((id) => ({ id })),
        properties: props,
      }),
    });
    if (!res.ok) continue;
    const data = await res.json();
    for (const deal of data.results || []) {
      map.set(deal.id, deal.properties);
    }
  }
  return map;
}

function compareDates(d1: string | null, d2: string | null): boolean | null {
  if (!d1 || !d2) return null;
  try {
    const a = new Date(d1).toISOString().split("T")[0];
    const b = new Date(d2).toISOString().split("T")[0];
    return a === b;
  } catch {
    return null;
  }
}

function dateDiffDays(d1: string | null, d2: string | null): number | null {
  if (!d1 || !d2) return null;
  try {
    return Math.round(Math.abs(new Date(d1).getTime() - new Date(d2).getTime()) / 86400000);
  } catch {
    return null;
  }
}

// Status mapping (simplified — matches the route's isStatusMismatch logic)
const STATUS_MAP: Record<string, Record<string, string[]>> = {
  site_survey: {
    "Completed": ["Completed", "Survey Complete"],
    "Started": ["In Progress", "Survey In Progress"],
    "New": ["Scheduled", "Survey Scheduled"],
    "Scheduled": ["Scheduled", "Survey Scheduled"],
    "Ready To Schedule": ["Not Started", "Ready to Schedule"],
  },
  construction: {
    "Construction Complete": ["Construction Complete", "Completed"],
    "Started": ["In Progress", "Construction In Progress"],
    "Scheduled": ["Scheduled", "Construction Scheduled"],
    "Ready To Schedule": ["Not Started", "Ready to Schedule"],
  },
  inspection: {
    "Passed": ["Passed", "Inspection Passed", "Inspection Complete"],
    "Failed": ["Failed", "Inspection Failed"],
    "Partial Pass": ["Partial Pass"],
    "Scheduled": ["Scheduled", "Inspection Scheduled"],
    "Ready To Schedule": ["Ready to Schedule", "Not Started"],
    "New": ["Scheduled", "Inspection Scheduled"],
  },
};

function isStatusMismatch(zuperStatus: string, hubspotStatus: string | null, category: string): boolean {
  if (!hubspotStatus) return false; // Can't compare without HS status
  const catMap = STATUS_MAP[category];
  if (!catMap) return true;
  const expected = catMap[zuperStatus];
  if (!expected) return true;
  return !expected.some((e) => e.toLowerCase() === hubspotStatus.toLowerCase());
}

async function main() {
  console.log("Fetching Zuper jobs (6-month window)...");
  const [surveyJobs, constructionJobs, inspectionJobs] = await Promise.all([
    fetchJobs(JOB_CATEGORY_UIDS.SITE_SURVEY, "site_survey"),
    fetchJobs(JOB_CATEGORY_UIDS.CONSTRUCTION, "construction"),
    fetchJobs(JOB_CATEGORY_UIDS.INSPECTION, "inspection"),
  ]);
  console.log(`  Survey: ${surveyJobs.length}, Construction: ${constructionJobs.length}, Inspection: ${inspectionJobs.length}`);

  const allJobs = [...surveyJobs, ...constructionJobs, ...inspectionJobs];

  console.log("Enriching completion dates...");
  await enrichCompletionDates(allJobs);

  console.log("Marking superseded inspections...");
  markSuperseded(allJobs);

  const dealIds = [...new Set(allJobs.map((j) => j.hubspotDealId).filter((id): id is string => !!id))];
  console.log(`Fetching ${dealIds.length} HubSpot deals...`);
  const dealMap = await fetchHubspotDeals(dealIds);

  // Build comparison
  interface Mismatch {
    project: string;
    category: string;
    dealName: string;
    zuperStatus: string;
    hsStatus: string;
    statusMatch: string;
    zuperSched: string;
    hsSched: string;
    schedMatch: string;
    zuperCompl: string;
    hsCompl: string;
    complMatch: string;
    complDiff: string;
    team: string;
    isSuperseded: boolean;
  }

  const mismatches: Mismatch[] = [];
  let totalMatched = 0;
  let totalSuperseded = 0;

  for (const job of allJobs) {
    if (job.isSuperseded) { totalSuperseded++; continue; }

    const deal = job.hubspotDealId ? dealMap.get(job.hubspotDealId) : undefined;
    let hsStatus: string | null = null;
    let hsSched: string | null = null;
    let hsCompl: string | null = null;

    if (deal) {
      switch (job.category) {
        case "site_survey":
          hsStatus = deal.zuper_site_survey_status;
          hsSched = deal.site_survey_date;
          hsCompl = deal.site_survey_complete_date;
          break;
        case "construction":
          hsStatus = deal.zuper_construction_status;
          hsSched = deal.construction_start_date;
          hsCompl = deal.construction_complete_date;
          break;
        case "inspection":
          hsStatus = deal.zuper_inspection_status;
          hsSched = deal.inspection_date;
          hsCompl = deal.inspection_pass_date;
          break;
      }
    }

    const statusMismatch = isStatusMismatch(job.zuperStatus, hsStatus, job.category);
    const schedMismatch = compareDates(job.scheduledStart, hsSched) === false;
    const complMismatch = compareDates(job.completedAt, hsCompl) === false;

    if (!statusMismatch && !schedMismatch && !complMismatch) {
      totalMatched++;
      continue;
    }

    mismatches.push({
      project: job.projectNumber,
      category: job.category === "site_survey" ? "Survey" : job.category === "construction" ? "Construction" : "Inspection",
      dealName: deal?.dealname ? deal.dealname.replace(/^PROJ-\d+\s*\|\s*/, "").split("|")[0].trim() : "-",
      zuperStatus: job.zuperStatus,
      hsStatus: hsStatus || "-",
      statusMatch: statusMismatch ? "MISMATCH" : "ok",
      zuperSched: job.scheduledStart?.split("T")[0] || "-",
      hsSched: hsSched || "-",
      schedMatch: compareDates(job.scheduledStart, hsSched) === null ? "n/a" : schedMismatch ? "MISMATCH" : "ok",
      zuperCompl: job.completedAt?.split("T")[0] || "-",
      hsCompl: hsCompl || "-",
      complMatch: compareDates(job.completedAt, hsCompl) === null ? "n/a" : complMismatch ? "MISMATCH" : "ok",
      complDiff: dateDiffDays(job.completedAt, hsCompl) != null ? `${dateDiffDays(job.completedAt, hsCompl)}d` : "-",
      team: job.team || "-",
      isSuperseded: false,
    });
  }

  // Print summary
  console.log("\n════════════════════════════════════════════════════");
  console.log("  ZUPER ↔ HUBSPOT MISMATCH REPORT");
  console.log("════════════════════════════════════════════════════");
  console.log(`Total jobs:        ${allJobs.length}`);
  console.log(`Matched:           ${totalMatched}`);
  console.log(`Superseded:        ${totalSuperseded}`);
  console.log(`Mismatches:        ${mismatches.length}`);
  console.log(`  Status:          ${mismatches.filter((m) => m.statusMatch === "MISMATCH").length}`);
  console.log(`  Schedule date:   ${mismatches.filter((m) => m.schedMatch === "MISMATCH").length}`);
  console.log(`  Completion date: ${mismatches.filter((m) => m.complMatch === "MISMATCH").length}`);

  // Print by category
  for (const cat of ["Survey", "Construction", "Inspection"]) {
    const catMismatches = mismatches.filter((m) => m.category === cat);
    if (catMismatches.length === 0) continue;

    console.log(`\n──── ${cat.toUpperCase()} (${catMismatches.length} mismatches) ────`);

    const statusM = catMismatches.filter((m) => m.statusMatch === "MISMATCH");
    if (statusM.length > 0) {
      console.log(`\n  STATUS MISMATCHES (${statusM.length}):`);
      for (const m of statusM) {
        console.log(
          `    ${m.project.padEnd(12)} Zuper: ${m.zuperStatus.padEnd(25)} HS: ${m.hsStatus.padEnd(25)} ${m.dealName}`
        );
      }
    }

    const schedM = catMismatches.filter((m) => m.schedMatch === "MISMATCH");
    if (schedM.length > 0) {
      console.log(`\n  SCHEDULE DATE MISMATCHES (${schedM.length}):`);
      for (const m of schedM) {
        console.log(`    ${m.project.padEnd(12)} Zuper: ${m.zuperSched.padEnd(14)} HS: ${m.hsSched.padEnd(14)} ${m.dealName}`);
      }
    }

    const complM = catMismatches.filter((m) => m.complMatch === "MISMATCH");
    if (complM.length > 0) {
      console.log(`\n  COMPLETION DATE MISMATCHES (${complM.length}):`);
      for (const m of complM) {
        console.log(`    ${m.project.padEnd(12)} Zuper: ${m.zuperCompl.padEnd(14)} HS: ${m.hsCompl.padEnd(14)} ${m.complDiff.padEnd(6)} ${m.dealName}`);
      }
    }
  }

  // Duplicates
  const dupGroups = new Map<string, Job[]>();
  for (const j of allJobs) {
    if (CANCELLED.has(j.zuperStatus.toLowerCase())) continue;
    const key = `${j.projectNumber}::${j.category}`;
    const arr = dupGroups.get(key) || [];
    arr.push(j);
    dupGroups.set(key, arr);
  }
  const dups = [...dupGroups.entries()].filter(([, jobs]) => jobs.length > 1);
  if (dups.length > 0) {
    console.log(`\n──── DUPLICATE ACTIVE JOBS (${dups.length} groups) ────`);
    for (const [key, jobs] of dups.sort((a, b) => b[1].length - a[1].length)) {
      const [proj, cat] = key.split("::");
      const label = cat === "site_survey" ? "Survey" : cat === "construction" ? "Construction" : "Inspection";
      console.log(`  ${proj.padEnd(12)} ${label.padEnd(14)} ${jobs.length} jobs: ${jobs.map((j) => j.zuperStatus).join(", ")}`);
    }
  }

  console.log("\nDone.");
}

main().catch(console.error);
