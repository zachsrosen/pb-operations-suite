/**
 * Zuper ↔ HubSpot Mismatch Report
 *
 * Pulls status + date history from both systems for every mismatched record,
 * compares timelines, and groups by root cause pattern.
 *
 * Usage: npx tsx scripts/zuper-hs-mismatch-report.ts
 * Output: scripts/zuper-hs-mismatch-report.json
 */

import { config } from "dotenv";
import { writeFileSync } from "fs";
import { resolve } from "path";

config({ path: resolve(__dirname, "../.env.local") });

const HS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN!;
const ZUPER_KEY = process.env.ZUPER_API_KEY!;
const PORTAL_TZ = "America/Denver";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function zuperDateToLocal(dateStr: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PORTAL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(dateStr));
}

function hubspotDateToLocal(dateStr: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  return dateStr.slice(0, 10);
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// HubSpot: batch read with property history
// ---------------------------------------------------------------------------

const HS_STATUS_PROPS = [
  "site_survey_status",
  "install_status",
  "final_inspection_status",
];
const HS_DATE_PROPS = [
  "site_survey_schedule_date",
  "install_schedule_date",
  "inspections_schedule_date",
  "site_survey_date",
  "construction_complete_date",
  "inspections_completion_date",
];
const ALL_HS_PROPS = [...HS_STATUS_PROPS, ...HS_DATE_PROPS, "project_number", "dealname"];

interface HsHistoryEntry {
  timestamp: string;
  value: string;
  sourceType: string;
  sourceId: string;
}

interface HsDealHistory {
  dealId: string;
  projectNumber: string;
  dealName: string;
  properties: Record<string, string | null>;
  history: Record<string, HsHistoryEntry[]>;
}

async function fetchHubSpotHistory(dealIds: string[]): Promise<Map<string, HsDealHistory>> {
  const map = new Map<string, HsDealHistory>();
  const batchSize = 100;

  for (let i = 0; i < dealIds.length; i += batchSize) {
    const batch = dealIds.slice(i, i + batchSize);
    const res = await fetch("https://api.hubapi.com/crm/v3/objects/deals/batch/read", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: batch.map((id) => ({ id })),
        properties: ALL_HS_PROPS,
        propertiesWithHistory: [...HS_STATUS_PROPS, ...HS_DATE_PROPS],
      }),
    });

    if (!res.ok) {
      console.error(`HubSpot batch ${i} failed: ${res.status}`);
      continue;
    }

    const data = await res.json();
    for (const deal of data.results || []) {
      const history: Record<string, HsHistoryEntry[]> = {};
      for (const prop of [...HS_STATUS_PROPS, ...HS_DATE_PROPS]) {
        const h = deal.propertiesWithHistory?.[prop];
        if (h && h.length > 0) {
          history[prop] = h.map((e: any) => ({
            timestamp: e.timestamp,
            value: e.value || "(cleared)",
            sourceType: e.sourceType,
            sourceId: e.sourceId || "",
          }));
        }
      }

      map.set(deal.id, {
        dealId: deal.id,
        projectNumber: deal.properties.project_number || "",
        dealName: deal.properties.dealname || "",
        properties: Object.fromEntries(
          ALL_HS_PROPS.map((p) => [p, deal.properties[p] || null])
        ),
        history,
      });
    }

    if (i + batchSize < dealIds.length) await sleep(200);
  }

  return map;
}

// ---------------------------------------------------------------------------
// Zuper: fetch individual job details for status history
// ---------------------------------------------------------------------------

interface ZuperStatusEntry {
  statusName: string;
  timestamp: string;
}

interface ZuperJobHistory {
  jobUid: string;
  jobTitle: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  currentStatus: string;
  statusHistory: ZuperStatusEntry[];
}

async function fetchZuperJobHistory(jobUid: string): Promise<ZuperJobHistory | null> {
  try {
    const res = await fetch(`https://api.zuper.co/v1/jobs/${jobUid}`, {
      headers: {
        "x-api-key": ZUPER_KEY,
        "x-account-region": "us",
      },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const job = json.data || json;

    const statusHistory: ZuperStatusEntry[] = [];
    if (Array.isArray(job.job_status)) {
      for (const entry of job.job_status) {
        statusHistory.push({
          statusName: entry.status_name || entry.name || "Unknown",
          timestamp: entry.created_at || entry.updated_at || "",
        });
      }
    }

    return {
      jobUid,
      jobTitle: job.job_title || "",
      scheduledStart: job.scheduled_start_time || null,
      scheduledEnd: job.scheduled_end_time || null,
      currentStatus: job.current_job_status?.status_name || "Unknown",
      statusHistory,
    };
  } catch (e) {
    console.error(`Zuper job ${jobUid} failed:`, e);
    return null;
  }
}

async function fetchAllZuperHistories(jobUids: string[]): Promise<Map<string, ZuperJobHistory>> {
  const map = new Map<string, ZuperJobHistory>();
  const CONCURRENCY = 10;

  for (let i = 0; i < jobUids.length; i += CONCURRENCY) {
    const batch = jobUids.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map((uid) => fetchZuperJobHistory(uid)));

    for (let j = 0; j < batch.length; j++) {
      const result = results[j];
      if (result.status === "fulfilled" && result.value) {
        map.set(batch[j], result.value);
      }
    }

    if (i + CONCURRENCY < jobUids.length) await sleep(200);
    if ((i + CONCURRENCY) % 50 === 0) {
      console.log(`  Zuper: ${Math.min(i + CONCURRENCY, jobUids.length)}/${jobUids.length} jobs fetched`);
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// Classification: group mismatches by root cause
// ---------------------------------------------------------------------------

interface MismatchRecord {
  projectNumber: string;
  dealId: string;
  category: string;
  jobUid: string;

  // Current state
  zuperStatus: string;
  hubspotStatus: string | null;
  zuperScheduledDate: string | null; // converted to local
  hubspotScheduledDate: string | null;
  zuperCompletedDate: string | null;
  hubspotCompletedDate: string | null;

  // Mismatch flags
  statusMismatch: boolean;
  scheduleMismatch: boolean;
  completionMismatch: boolean;

  // History
  zuperStatusHistory: ZuperStatusEntry[];
  hubspotStatusHistory: HsHistoryEntry[];
  hubspotDateHistory: Record<string, HsHistoryEntry[]>;

  // Analysis
  rootCause: string;
  details: string;
}

type CategoryProps = {
  statusProp: string;
  schedProp: string;
  complProp: string;
};

const CAT_PROPS: Record<string, CategoryProps> = {
  site_survey: {
    statusProp: "site_survey_status",
    schedProp: "site_survey_schedule_date",
    complProp: "site_survey_date",
  },
  construction: {
    statusProp: "install_status",
    schedProp: "install_schedule_date",
    complProp: "construction_complete_date",
  },
  inspection: {
    statusProp: "final_inspection_status",
    schedProp: "inspections_schedule_date",
    complProp: "inspections_completion_date",
  },
};

function classifyMismatch(rec: MismatchRecord): void {
  const causes: string[] = [];
  const details: string[] = [];

  // --- Status mismatch analysis ---
  if (rec.statusMismatch) {
    const zStatus = rec.zuperStatus.toLowerCase();
    const hStatus = (rec.hubspotStatus || "").toLowerCase();

    // Zuper is ahead (completed/passed but HubSpot still shows scheduled/in-progress)
    const zuperTerminal = ["passed", "failed", "completed", "construction complete", "partial pass"].includes(zStatus);
    const hsInProgress = ["scheduled", "ready to schedule", "ready for inspection", "in progress", "ready to build"].includes(hStatus);

    if (zuperTerminal && hsInProgress) {
      causes.push("ZUPER_AHEAD");
      details.push(`Zuper reached "${rec.zuperStatus}" but HubSpot still shows "${rec.hubspotStatus}" — sync didn't push terminal status`);
    }
    // HubSpot is ahead
    else if (hsInProgress === false && zStatus === "scheduled") {
      causes.push("HUBSPOT_AHEAD");
      details.push(`HubSpot shows "${rec.hubspotStatus}" but Zuper still shows "Scheduled" — Zuper job wasn't progressed`);
    }
    // Failed vs different status
    else if (zStatus === "failed" && hStatus !== "failed") {
      causes.push("FAILED_NOT_SYNCED");
      details.push(`Zuper shows "Failed" but HubSpot shows "${rec.hubspotStatus}" — failure not reflected in CRM`);
    }
    // Status is null in HubSpot
    else if (!rec.hubspotStatus) {
      causes.push("HUBSPOT_STATUS_MISSING");
      details.push(`HubSpot has no status value for this category`);
    }
    // Other
    else {
      causes.push("STATUS_DIVERGED");
      details.push(`"${rec.zuperStatus}" vs "${rec.hubspotStatus}" — statuses diverged`);
    }

    // Check if HubSpot status was manually changed
    if (rec.hubspotStatusHistory.length > 1) {
      const manualChanges = rec.hubspotStatusHistory.filter((e) => e.sourceType === "CRM_UI");
      if (manualChanges.length > 0) {
        causes.push("HS_MANUAL_STATUS_CHANGE");
        details.push(`HubSpot status was manually changed ${manualChanges.length}x in CRM UI`);
      }
    }
  }

  // --- Schedule date mismatch analysis ---
  if (rec.scheduleMismatch && rec.zuperScheduledDate && rec.hubspotScheduledDate) {
    const diffDays = Math.round(
      (new Date(rec.zuperScheduledDate).getTime() - new Date(rec.hubspotScheduledDate).getTime()) /
        (1000 * 60 * 60 * 24)
    );

    // Check if Zuper was rescheduled (multiple "Scheduled" in history)
    const schedCount = rec.zuperStatusHistory.filter(
      (e) => e.statusName.toLowerCase() === "scheduled"
    ).length;

    const schedProp = CAT_PROPS[rec.category]?.schedProp;
    const hsSchedHistory = schedProp ? rec.hubspotDateHistory[schedProp] || [] : [];
    const hsSchedChanges = hsSchedHistory.length;

    if (schedCount > 1 && hsSchedChanges <= 1) {
      causes.push("ZUPER_RESCHEDULED_HS_NOT_UPDATED");
      details.push(`Zuper rescheduled ${schedCount}x but HubSpot date only set ${hsSchedChanges}x (${diffDays}d drift)`);
    } else if (hsSchedChanges > 1) {
      const manualHsChanges = hsSchedHistory.filter((e) => e.sourceType === "CRM_UI");
      if (manualHsChanges.length > 0) {
        causes.push("HS_MANUAL_DATE_OVERRIDE");
        details.push(`HubSpot date manually changed in CRM UI (${diffDays}d drift)`);
      } else {
        causes.push("BOTH_DATES_CHANGED");
        details.push(`Both systems had date changes — HubSpot changed ${hsSchedChanges}x (${diffDays}d drift)`);
      }
    } else if (Math.abs(diffDays) === 1) {
      causes.push("ONE_DAY_DRIFT");
      details.push(`1-day difference — likely timezone handling in Zapier integration`);
    } else {
      causes.push("INITIAL_DATE_MISMATCH");
      details.push(`Dates set differently from the start — ${diffDays}d apart. HS set by ${hsSchedHistory[0]?.sourceType || "unknown"}/${hsSchedHistory[0]?.sourceId || "?"}`);
    }
  }

  // --- Completion date mismatch analysis ---
  if (rec.completionMismatch && rec.zuperCompletedDate && rec.hubspotCompletedDate) {
    const diffDays = Math.round(
      (new Date(rec.zuperCompletedDate).getTime() - new Date(rec.hubspotCompletedDate).getTime()) /
        (1000 * 60 * 60 * 24)
    );

    if (Math.abs(diffDays) <= 1) {
      causes.push("COMPLETION_TIMEZONE_DRIFT");
      details.push(`Completion dates 1 day apart — timezone conversion issue`);
    } else {
      causes.push("COMPLETION_DATE_MISMATCH");
      details.push(`Completion dates ${diffDays}d apart`);
    }
  }

  rec.rootCause = causes.join(" + ");
  rec.details = details.join("; ");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== Zuper ↔ HubSpot Mismatch Report ===\n");

  // Step 1: Fetch the comparison data from our API
  // We'll reconstruct it directly from both APIs instead
  // First, let's get the mismatch list from a local fetch
  console.log("Step 1: Reading comparison data from dashboard API...");

  // We need to load the comparison data. Since we can't hit localhost easily,
  // let's reconstruct from what we know. We'll read the deal IDs and job UIDs
  // from stdin or a pre-saved file. For now, fetch directly.

  // Actually, let's just fetch both APIs directly and do the comparison ourselves.
  // We already have the Zuper job data and HubSpot deal data patterns.

  // For efficiency, let's use the mismatch list we already identified.
  // Load it from the browser output we saved earlier.

  // APPROACH: Use the status-comparison API through localhost
  console.log("  Fetching from localhost:3000...");
  let comparisonData: any;
  try {
    const res = await fetch("http://localhost:3000/api/zuper/status-comparison", {
      headers: { Cookie: "" }, // Won't work without session
    });
    if (res.ok) {
      comparisonData = await res.json();
    }
  } catch {
    // Expected — needs auth
  }

  if (!comparisonData) {
    console.log("  Can't fetch from localhost (needs auth). Using direct API approach.\n");
    console.log("  Tip: Export the mismatch data from the browser console and save to");
    console.log("  scripts/zuper-hs-mismatch-input.json, then re-run this script.\n");

    // Fallback: fetch ALL data directly from both APIs
    // This is the slower but more complete approach
    console.log("  Fetching directly from Zuper + HubSpot APIs...\n");
  }

  // Step 2: We need the list of mismatched records. Let's read from a JSON file
  // that the browser exports.
  let mismatchInput: any[];
  try {
    const raw = require("./zuper-hs-mismatch-input.json");
    mismatchInput = raw;
    console.log(`  Loaded ${mismatchInput.length} mismatch records from input file.\n`);
  } catch {
    console.log("  No input file found. Exporting from browser first...\n");
    console.log("  Run this in the browser console on the Zuper Status Comparison page:\n");
    console.log(`    fetch('/api/zuper/status-comparison').then(r=>r.json()).then(d=>{`);
    console.log(`      const m = d.records.filter(r => !r.isSuperseded && r.dealId &&`);
    console.log(`        (r.isMismatch || r.scheduleDateMatch===false || r.completionDateMatch===false));`);
    console.log(`      const blob = new Blob([JSON.stringify(m,null,2)], {type:'application/json'});`);
    console.log(`      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);`);
    console.log(`      a.download = 'zuper-hs-mismatch-input.json'; a.click();`);
    console.log(`    });\n`);
    process.exit(1);
  }

  // Step 3: Fetch HubSpot property history
  const dealIds = [...new Set(mismatchInput.map((r: any) => r.dealId))];
  console.log(`Step 2: Fetching HubSpot history for ${dealIds.length} deals...`);
  const hsHistory = await fetchHubSpotHistory(dealIds);
  console.log(`  Got history for ${hsHistory.size} deals.\n`);

  // Step 4: Fetch Zuper job status history
  const jobUids = [...new Set(mismatchInput.map((r: any) => r.zuperJobUid))];
  console.log(`Step 3: Fetching Zuper history for ${jobUids.length} jobs...`);
  const zuperHistory = await fetchAllZuperHistories(jobUids);
  console.log(`  Got history for ${zuperHistory.size} jobs.\n`);

  // Step 5: Build full mismatch records with history
  console.log("Step 4: Analyzing and classifying mismatches...\n");
  const records: MismatchRecord[] = [];

  for (const input of mismatchInput) {
    const hs = hsHistory.get(input.dealId);
    const zj = zuperHistory.get(input.zuperJobUid);
    const catProps = CAT_PROPS[input.category];
    if (!catProps) continue;

    const rec: MismatchRecord = {
      projectNumber: input.projectNumber,
      dealId: input.dealId,
      category: input.category,
      jobUid: input.zuperJobUid,
      zuperStatus: input.zuperStatus,
      hubspotStatus: input.hubspotStatus,
      zuperScheduledDate: input.zuperScheduledStart
        ? zuperDateToLocal(input.zuperScheduledStart)
        : null,
      hubspotScheduledDate: input.hubspotScheduleDate
        ? hubspotDateToLocal(input.hubspotScheduleDate)
        : null,
      zuperCompletedDate: input.zuperCompletedAt
        ? zuperDateToLocal(input.zuperCompletedAt)
        : null,
      hubspotCompletedDate: input.hubspotCompletionDate
        ? hubspotDateToLocal(input.hubspotCompletionDate)
        : null,
      statusMismatch: input.isMismatch,
      scheduleMismatch: input.scheduleDateMatch === false,
      completionMismatch: input.completionDateMatch === false,
      zuperStatusHistory: zj?.statusHistory || [],
      hubspotStatusHistory: hs?.history[catProps.statusProp] || [],
      hubspotDateHistory: {
        [catProps.schedProp]: hs?.history[catProps.schedProp] || [],
        [catProps.complProp]: hs?.history[catProps.complProp] || [],
      },
      rootCause: "",
      details: "",
    };

    classifyMismatch(rec);
    records.push(rec);
  }

  // Step 6: Group by root cause
  const groups: Record<string, MismatchRecord[]> = {};
  for (const rec of records) {
    const causes = rec.rootCause.split(" + ");
    for (const cause of causes) {
      if (!groups[cause]) groups[cause] = [];
      groups[cause].push(rec);
    }
  }

  // Step 7: Print summary
  console.log("=== ROOT CAUSE SUMMARY ===\n");
  const sortedGroups = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  for (const [cause, recs] of sortedGroups) {
    console.log(`${cause}: ${recs.length} records`);
    // Show 2 examples
    for (const r of recs.slice(0, 2)) {
      console.log(`  ${r.projectNumber} (${r.category}): ${r.details}`);
    }
    console.log();
  }

  // Step 8: Write full report
  const report = {
    generatedAt: new Date().toISOString(),
    summary: {
      totalRecords: records.length,
      statusMismatches: records.filter((r) => r.statusMismatch).length,
      scheduleMismatches: records.filter((r) => r.scheduleMismatch).length,
      completionMismatches: records.filter((r) => r.completionMismatch).length,
      rootCauses: Object.fromEntries(sortedGroups.map(([k, v]) => [k, v.length])),
    },
    groups: Object.fromEntries(
      sortedGroups.map(([cause, recs]) => [
        cause,
        recs.map((r) => ({
          projectNumber: r.projectNumber,
          dealId: r.dealId,
          category: r.category,
          zuperStatus: r.zuperStatus,
          hubspotStatus: r.hubspotStatus,
          zuperScheduledDate: r.zuperScheduledDate,
          hubspotScheduledDate: r.hubspotScheduledDate,
          zuperCompletedDate: r.zuperCompletedDate,
          hubspotCompletedDate: r.hubspotCompletedDate,
          details: r.details,
          zuperStatusTimeline: r.zuperStatusHistory.map(
            (e) => `${e.timestamp.slice(0, 16)} → ${e.statusName}`
          ),
          hubspotStatusTimeline: r.hubspotStatusHistory.map(
            (e) => `${e.timestamp.slice(0, 16)} → ${e.value} (${e.sourceType})`
          ),
        })),
      ])
    ),
  };

  const outPath = resolve(__dirname, "zuper-hs-mismatch-report.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nFull report written to: ${outPath}`);
}

main().catch(console.error);
