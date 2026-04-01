/**
 * Find deals with completed site surveys (last 6 months) that are missing
 * the site_surveyor field, then cross-reference Zuper to find who actually
 * completed the survey job.
 *
 * Usage: npx tsx scripts/site-survey-missing-surveyor.ts
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.production-pull" });

const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN!;
const ZUPER_API_KEY = process.env.ZUPER_API_KEY!;
const ZUPER_API_URL = process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api";

const SITE_SURVEY_CATEGORY_UID = "002bac33-84d3-4083-a35d-50626fc49288";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── HubSpot helpers ────────────────────────────────────────────────

interface HubSpotDeal {
  id: string;
  properties: Record<string, string | null>;
}

interface HubSpotSearchResponse {
  total: number;
  results: HubSpotDeal[];
  paging?: { next?: { after?: string } };
}

async function hubspotSearch(body: object): Promise<HubSpotSearchResponse> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch("https://api.hubapi.com/crm/v3/objects/deals/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HUBSPOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (res.status === 429) {
      const delay = Math.pow(2, attempt) * 1100 + Math.random() * 400;
      console.log(`  Rate limited, retrying in ${Math.round(delay)}ms...`);
      await sleep(delay);
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HubSpot ${res.status}: ${text}`);
    }
    return (await res.json()) as HubSpotSearchResponse;
  }
  throw new Error("Max retries exceeded");
}

async function fetchOwnerMap(): Promise<Record<string, string>> {
  const res = await fetch("https://api.hubapi.com/crm/v3/owners?limit=500", {
    headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` },
  });
  if (!res.ok) return {};
  const data = (await res.json()) as { results: Array<{ id: string; firstName?: string; lastName?: string; email?: string }> };
  const map: Record<string, string> = {};
  for (const o of data.results) {
    const name = [o.firstName, o.lastName].filter(Boolean).join(" ");
    map[o.id] = name || o.email || o.id;
  }
  return map;
}

// ─── Zuper helpers ──────────────────────────────────────────────────

interface ZuperJob {
  job_uid: string;
  job_title: string;
  job_tags?: string[];
  current_job_status?: { status_name?: string };
  assigned_to?: Array<{ user?: { first_name?: string; last_name?: string; user_uid?: string } }>;
  scheduled_start_time?: string;
  scheduled_end_time?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  custom_fields?: any;
}

async function zuperGet<T>(endpoint: string): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${ZUPER_API_URL}${endpoint}`, {
      headers: {
        "x-api-key": ZUPER_API_KEY,
        "Content-Type": "application/json",
      },
    });
    if (res.status === 429) {
      await sleep(Math.pow(2, attempt) * 1000);
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Zuper ${res.status}: ${text}`);
    }
    return (await res.json()) as T;
  }
  throw new Error("Zuper max retries");
}

async function fetchZuperJobByDealId(dealId: string): Promise<ZuperJob | null> {
  // Search Zuper jobs filtered to Site Survey category
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await zuperGet<any>(
    `/jobs?filter.job_category.category_uid=${SITE_SURVEY_CATEGORY_UID}&count=100&sort_by=scheduled_start_time&sort_order=DESC`
  );
  const jobs: ZuperJob[] = result?.data || [];
  // Find by hubspot deal tag
  const match = jobs.find((j) => j.job_tags?.includes(`hubspot-${dealId}`));
  return match || null;
}

async function fetchZuperJobByUid(jobUid: string): Promise<ZuperJob | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await zuperGet<any>(`/jobs/${jobUid}`);
    return result?.data ?? result ?? null;
  } catch {
    return null;
  }
}

// ─── Main ───────────────────────────────────────────────────────────

interface ReportRow {
  dealId: string;
  projectName: string;
  projectNumber: string;
  pbLocation: string;
  stage: string;
  surveyCompletionDate: string;
  siteSurveyorField: string;
  zuperJobFound: boolean;
  zuperAssignedTo: string;
  zuperJobStatus: string;
  zuperJobUid: string;
}

async function main() {
  console.log("=== Site Survey Missing Surveyor Report ===\n");

  // 6 months ago — HubSpot date properties use midnight UTC timestamps (ms)
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  sixMonthsAgo.setHours(0, 0, 0, 0);
  const cutoffMs = sixMonthsAgo.getTime();
  const cutoffDate = sixMonthsAgo.toISOString().split("T")[0];
  console.log(`Looking for deals with site_survey_date >= ${cutoffDate}\n`);

  // Fetch owner map for resolving site_surveyor IDs
  console.log("Fetching HubSpot owner map...");
  const ownerMap = await fetchOwnerMap();
  console.log(`  Found ${Object.keys(ownerMap).length} owners\n`);

  // Search for deals with site survey completed in last 6 months
  // We'll paginate through all results
  const allDeals: HubSpotDeal[] = [];
  let after: string | undefined;

  console.log("Searching HubSpot for deals with completed site surveys...");
  do {
    const searchBody: Record<string, unknown> = {
      filterGroups: [
        {
          filters: [
            {
              propertyName: "site_survey_date",
              operator: "GTE",
              value: String(cutoffMs),
            },
            {
              propertyName: "pipeline",
              operator: "EQ",
              value: "6900017", // Project Pipeline
            },
          ],
        },
      ],
      properties: [
        "dealname",
        "project_number",
        "pb_location",
        "dealstage",
        "site_survey_date",
        "site_surveyor",
        "zuper_site_survey_uid",
        "site_survey_status",
        "is_site_survey_completed_",
      ],
      sorts: [{ propertyName: "site_survey_date", direction: "DESCENDING" }],
      limit: 100,
      ...(after ? { after } : {}),
    };

    const response = await hubspotSearch(searchBody);
    allDeals.push(...response.results);
    after = response.paging?.next?.after;
    console.log(`  Fetched ${allDeals.length} / ${response.total} deals...`);
    if (after) await sleep(200);
  } while (after);

  console.log(`\nTotal deals with site_survey_date in last 6 months: ${allDeals.length}`);

  // Stage map for human-readable names
  const stageMap: Record<string, string> = {
    "20461935": "Project Rejected",
    "20461936": "Site Survey",
    "20461937": "Design & Engineering",
    "20461938": "Permitting & IC",
    "71052436": "RTB - Blocked",
    "22580871": "Ready To Build",
    "20440342": "Construction",
    "22580872": "Inspection",
    "20461940": "PTO",
    "24743347": "Close Out",
    "20440343": "Project Complete",
    "20440344": "On Hold",
    "68229433": "Cancelled",
  };

  // Filter to deals missing site_surveyor
  const missingDeals = allDeals.filter((d) => {
    const surveyor = d.properties.site_surveyor;
    return !surveyor || surveyor.trim() === "";
  });

  console.log(`Deals missing site_surveyor field: ${missingDeals.length}\n`);

  if (missingDeals.length === 0) {
    console.log("All deals have site_surveyor filled in. Nothing to report.");
    return;
  }

  // For each missing deal, look up Zuper job
  console.log("Cross-referencing with Zuper jobs...\n");
  const rows: ReportRow[] = [];

  // Pre-fetch all Site Survey jobs from Zuper (paginated) to avoid per-deal API calls
  console.log("Fetching all Zuper Site Survey jobs...");
  const allZuperJobs: ZuperJob[] = [];
  let page = 1;
  let hasMore = true;
  while (hasMore) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await zuperGet<any>(
      `/jobs?filter.job_category.category_uid=${SITE_SURVEY_CATEGORY_UID}&count=100&page=${page}&sort_by=scheduled_start_time&sort_order=DESC`
    );
    const jobs: ZuperJob[] = result?.data || [];
    allZuperJobs.push(...jobs);
    const total = result?.total_records ?? 0;
    console.log(`  Page ${page}: ${jobs.length} jobs (total so far: ${allZuperJobs.length}/${total})`);
    hasMore = jobs.length === 100 && allZuperJobs.length < total;
    page++;
    await sleep(300);
  }
  console.log(`Total Zuper Site Survey jobs fetched: ${allZuperJobs.length}\n`);

  // Build lookup: dealId → ZuperJob via job tags
  const zuperByDealId = new Map<string, ZuperJob>();
  for (const job of allZuperJobs) {
    if (job.job_tags) {
      for (const tag of job.job_tags) {
        const match = tag.match(/^hubspot-(\d+)$/);
        if (match) {
          zuperByDealId.set(match[1], job);
        }
      }
    }
  }

  for (const deal of missingDeals) {
    const dealId = deal.id;
    const props = deal.properties;
    const stageId = props.dealstage || "";
    const zuperUid = props.zuper_site_survey_uid || "";

    // Try to find Zuper job: first by stored UID, then by tag match
    let zuperJob: ZuperJob | null = null;

    // Check pre-fetched jobs by deal ID tag
    zuperJob = zuperByDealId.get(dealId) || null;

    // If not found by tag but we have a stored UID, fetch directly
    if (!zuperJob && zuperUid) {
      zuperJob = await fetchZuperJobByUid(zuperUid);
      await sleep(200);
    }

    // Extract assigned user names
    let assignedTo = "";
    if (zuperJob?.assigned_to && Array.isArray(zuperJob.assigned_to)) {
      const names = zuperJob.assigned_to
        .map((a) => {
          const u = a.user || (a as unknown as { first_name?: string; last_name?: string });
          return [u?.first_name, u?.last_name].filter(Boolean).join(" ");
        })
        .filter(Boolean);
      assignedTo = names.join(", ");
    }

    rows.push({
      dealId,
      projectName: props.dealname || "",
      projectNumber: props.project_number || "",
      pbLocation: props.pb_location || "",
      stage: stageMap[stageId] || stageId,
      surveyCompletionDate: props.site_survey_date || "",
      siteSurveyorField: props.site_surveyor || "(empty)",
      zuperJobFound: !!zuperJob,
      zuperAssignedTo: assignedTo || "(not found)",
      zuperJobStatus: zuperJob?.current_job_status?.status_name || "(unknown)",
      zuperJobUid: zuperJob?.job_uid || "",
    });
  }

  // ─── Print report ─────────────────────────────────────────────────
  console.log("\n" + "=".repeat(120));
  console.log("REPORT: Deals with Site Survey Complete but Missing Site Surveyor");
  console.log("=".repeat(120));
  console.log(`Period: ${cutoffDate} to today`);
  console.log(`Total surveyed deals: ${allDeals.length}`);
  console.log(`Missing site_surveyor: ${missingDeals.length} (${((missingDeals.length / allDeals.length) * 100).toFixed(1)}%)`);
  console.log("=".repeat(120));

  // Summary by Zuper assignee
  const bySurveyor = new Map<string, ReportRow[]>();
  for (const row of rows) {
    const key = row.zuperAssignedTo;
    if (!bySurveyor.has(key)) bySurveyor.set(key, []);
    bySurveyor.get(key)!.push(row);
  }

  console.log("\n--- SUMMARY BY ZUPER ASSIGNEE ---\n");
  const sortedSurveyors = [...bySurveyor.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [name, dealRows] of sortedSurveyors) {
    console.log(`  ${name}: ${dealRows.length} deal(s)`);
  }

  // Summary by location
  const byLocation = new Map<string, number>();
  for (const row of rows) {
    const loc = row.pbLocation || "(unknown)";
    byLocation.set(loc, (byLocation.get(loc) || 0) + 1);
  }
  console.log("\n--- SUMMARY BY LOCATION ---\n");
  for (const [loc, count] of [...byLocation.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${loc}: ${count}`);
  }

  // Detail table
  console.log("\n--- DETAIL ---\n");
  console.log(
    [
      "Deal ID".padEnd(12),
      "Project #".padEnd(12),
      "Project Name".padEnd(35),
      "Location".padEnd(14),
      "Stage".padEnd(18),
      "Survey Date".padEnd(13),
      "Zuper Assignee".padEnd(25),
      "Zuper Status".padEnd(15),
    ].join(" | ")
  );
  console.log("-".repeat(160));

  for (const row of rows) {
    console.log(
      [
        row.dealId.padEnd(12),
        row.projectNumber.padEnd(12),
        row.projectName.slice(0, 33).padEnd(35),
        row.pbLocation.padEnd(14),
        row.stage.padEnd(18),
        row.surveyCompletionDate.padEnd(13),
        row.zuperAssignedTo.slice(0, 23).padEnd(25),
        row.zuperJobStatus.padEnd(15),
      ].join(" | ")
    );
  }

  // Deals where Zuper job was not found
  const noZuper = rows.filter((r) => !r.zuperJobFound);
  if (noZuper.length > 0) {
    console.log(`\n--- DEALS WITH NO ZUPER JOB FOUND (${noZuper.length}) ---\n`);
    for (const row of noZuper) {
      console.log(`  ${row.dealId} | ${row.projectNumber} | ${row.projectName} | Survey: ${row.surveyCompletionDate}`);
    }
  }

  console.log("\n" + "=".repeat(120));
  console.log("END OF REPORT");
  console.log("=".repeat(120));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
