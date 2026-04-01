/**
 * Site surveyor audit for the 3-month window BEFORE the 6-month range we already fixed.
 * Period: ~June 20, 2025 to September 20, 2025
 *
 * Reports both missing site_surveyor AND mismatches vs Zuper.
 *
 * Usage: npx tsx scripts/site-surveyor-audit-extended.ts
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.production-pull" });

const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN!;
const ZUPER_API_KEY = process.env.ZUPER_API_KEY!;
const ZUPER_API_URL = process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api";
const SITE_SURVEY_CATEGORY_UID = "002bac33-84d3-4083-a35d-50626fc49288";

const NAME_ALIASES: Record<string, string> = {
  "rolando valle": "roland valle",
  "nick scarpellino": "nickolas scarpellino",
  "samuel paro": "sam paro",
  "sam paro": "samuel paro",
  "lenny uematsu": "leonard uematsu",
  "tom st. denis": "thomas st. denis",
  "thomas st denis": "thomas st. denis",
};

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
function normalizeName(s: string): string { return s.toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim(); }

function namesMatch(a: string, b: string): boolean {
  const na = normalizeName(a), nb = normalizeName(b);
  if (na === nb) return true;
  for (const [x, y] of Object.entries(NAME_ALIASES)) {
    if ((na === normalizeName(x) && nb === normalizeName(y)) || (na === normalizeName(y) && nb === normalizeName(x))) return true;
  }
  const [shorter, longer] = na.length <= nb.length ? [na, nb] : [nb, na];
  const sp = shorter.split(" "), lp = longer.split(" ");
  if (sp.length === lp.length && sp.length >= 2) {
    const lastMatch = sp[sp.length - 1] === lp[lp.length - 1];
    const firstPrefix = lp[0].startsWith(sp[0]) || sp[0].startsWith(lp[0]);
    if (lastMatch && firstPrefix) return true;
  }
  return false;
}

interface HubSpotDeal { id: string; properties: Record<string, string | null>; }
interface HubSpotSearchResponse { total: number; results: HubSpotDeal[]; paging?: { next?: { after?: string } }; }

async function hubspotSearch(body: object): Promise<HubSpotSearchResponse> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch("https://api.hubapi.com/crm/v3/objects/deals/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 429) { await sleep(Math.pow(2, attempt) * 1100 + Math.random() * 400); continue; }
    if (!res.ok) throw new Error(`HubSpot ${res.status}: ${await res.text()}`);
    return (await res.json()) as HubSpotSearchResponse;
  }
  throw new Error("Max retries");
}

interface ZuperJob {
  job_uid: string; job_title: string; job_tags?: string[];
  current_job_status?: { status_name?: string };
  assigned_to?: Array<{ user?: { first_name?: string; last_name?: string; user_uid?: string } }>;
}

async function zuperGet<T>(endpoint: string): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${ZUPER_API_URL}${endpoint}`, {
      headers: { "x-api-key": ZUPER_API_KEY, "Content-Type": "application/json" },
    });
    if (res.status === 429) { await sleep(Math.pow(2, attempt) * 1000); continue; }
    if (!res.ok) throw new Error(`Zuper ${res.status}: ${await res.text()}`);
    return (await res.json()) as T;
  }
  throw new Error("Zuper max retries");
}

async function fetchZuperJobByUid(jobUid: string): Promise<ZuperJob | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await zuperGet<any>(`/jobs/${jobUid}`);
    return result?.data ?? result ?? null;
  } catch { return null; }
}

const STAGE_MAP: Record<string, string> = {
  "20461935": "Project Rejected", "20461936": "Site Survey", "20461937": "Design & Engineering",
  "20461938": "Permitting & IC", "71052436": "RTB - Blocked", "22580871": "Ready To Build",
  "20440342": "Construction", "22580872": "Inspection", "20461940": "PTO",
  "24743347": "Close Out", "20440343": "Project Complete", "20440344": "On Hold", "68229433": "Cancelled",
};

async function main() {
  // 9 months ago to 6 months ago
  const rangeEnd = new Date();
  rangeEnd.setMonth(rangeEnd.getMonth() - 6);
  rangeEnd.setHours(0, 0, 0, 0);

  const rangeStart = new Date();
  rangeStart.setMonth(rangeStart.getMonth() - 9);
  rangeStart.setHours(0, 0, 0, 0);

  const startDate = rangeStart.toISOString().split("T")[0];
  const endDate = rangeEnd.toISOString().split("T")[0];

  console.log("=== Site Surveyor Audit (Extended Range) ===");
  console.log(`Period: ${startDate} to ${endDate}\n`);

  // Load owners
  console.log("Loading HubSpot owners...");
  const ownerRes = await fetch("https://api.hubapi.com/crm/v3/owners?limit=500", {
    headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` },
  });
  const ownerData = (await ownerRes.json()) as { results: Array<{ id: string; firstName?: string; lastName?: string }> };
  const ownerById = new Map<string, string>();
  for (const o of ownerData.results) ownerById.set(o.id, [o.firstName, o.lastName].filter(Boolean).join(" "));
  console.log(`  ${ownerById.size} owners\n`);

  // Fetch deals in this window
  console.log("Searching HubSpot...");
  const allDeals: HubSpotDeal[] = [];
  let after: string | undefined;
  do {
    const response = await hubspotSearch({
      filterGroups: [{
        filters: [
          { propertyName: "site_survey_date", operator: "GTE", value: String(rangeStart.getTime()) },
          { propertyName: "site_survey_date", operator: "LT", value: String(rangeEnd.getTime()) },
          { propertyName: "pipeline", operator: "EQ", value: "6900017" },
        ],
      }],
      properties: ["dealname", "project_number", "pb_location", "dealstage", "site_survey_date", "site_surveyor", "zuper_site_survey_uid"],
      sorts: [{ propertyName: "site_survey_date", direction: "DESCENDING" }],
      limit: 100,
      ...(after ? { after } : {}),
    });
    allDeals.push(...response.results);
    after = response.paging?.next?.after;
    console.log(`  Fetched ${allDeals.length} / ${response.total}...`);
    if (after) await sleep(200);
  } while (after);
  console.log(`\nTotal deals in range: ${allDeals.length}\n`);

  // Fetch Zuper jobs
  console.log("Fetching Zuper Site Survey jobs...");
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
    hasMore = jobs.length === 100 && allZuperJobs.length < total;
    page++;
    await sleep(300);
  }
  console.log(`  ${allZuperJobs.length} jobs\n`);

  const zuperByDealId = new Map<string, ZuperJob>();
  for (const job of allZuperJobs) {
    if (job.job_tags) {
      for (const tag of job.job_tags) {
        const m = tag.match(/^hubspot-(\d+)$/);
        if (m) zuperByDealId.set(m[1], job);
      }
    }
  }

  function getZuperAssignees(job: ZuperJob | null): string[] {
    if (!job?.assigned_to?.length) return [];
    return job.assigned_to
      .map((a) => {
        const u = a.user || (a as unknown as { first_name?: string; last_name?: string });
        return [u?.first_name, u?.last_name].filter(Boolean).join(" ");
      })
      .filter(Boolean);
  }

  // ─── Analyze ──────────────────────────────────────────────────────

  interface Row {
    dealId: string; projectNumber: string; projectName: string; pbLocation: string;
    stage: string; surveyDate: string; issue: "MISSING" | "MISMATCH";
    hubspotSurveyor: string; zuperAssignees: string; zuperStatus: string;
  }

  const issues: Row[] = [];
  let okCount = 0;
  let noZuperCount = 0;

  for (const deal of allDeals) {
    const props = deal.properties;
    const surveyorRaw = props.site_surveyor || "";
    const hsName = surveyorRaw ? (ownerById.get(surveyorRaw) || surveyorRaw) : "";
    const zuperUid = props.zuper_site_survey_uid || "";

    let zuperJob: ZuperJob | null = zuperByDealId.get(deal.id) || null;
    if (!zuperJob && zuperUid) {
      zuperJob = await fetchZuperJobByUid(zuperUid);
      await sleep(200);
    }

    const zuperNames = getZuperAssignees(zuperJob);
    const stageId = props.dealstage || "";

    if (!surveyorRaw) {
      // Missing
      issues.push({
        dealId: deal.id, projectNumber: props.project_number || "", projectName: props.dealname || "",
        pbLocation: props.pb_location || "", stage: STAGE_MAP[stageId] || stageId,
        surveyDate: props.site_survey_date || "", issue: "MISSING",
        hubspotSurveyor: "(empty)", zuperAssignees: zuperNames.join(", ") || "(no Zuper job)",
        zuperStatus: zuperJob?.current_job_status?.status_name || "(unknown)",
      });
    } else if (zuperNames.length > 0) {
      const isMatch = zuperNames.some((zn) => namesMatch(hsName, zn));
      if (!isMatch) {
        issues.push({
          dealId: deal.id, projectNumber: props.project_number || "", projectName: props.dealname || "",
          pbLocation: props.pb_location || "", stage: STAGE_MAP[stageId] || stageId,
          surveyDate: props.site_survey_date || "", issue: "MISMATCH",
          hubspotSurveyor: hsName, zuperAssignees: zuperNames.join(", "),
          zuperStatus: zuperJob?.current_job_status?.status_name || "(unknown)",
        });
      } else {
        okCount++;
      }
    } else {
      noZuperCount++;
      if (!surveyorRaw) {
        // already counted above
      } else {
        okCount++; // has surveyor, no zuper to compare — treat as OK
      }
    }
  }

  const missing = issues.filter((r) => r.issue === "MISSING");
  const mismatched = issues.filter((r) => r.issue === "MISMATCH");

  // ─── Report ───────────────────────────────────────────────────────
  console.log("=".repeat(130));
  console.log(`REPORT: Site Surveyor Audit — ${startDate} to ${endDate}`);
  console.log("=".repeat(130));
  console.log(`Total deals: ${allDeals.length}`);
  console.log(`  OK (matched or no Zuper to compare): ${okCount}`);
  console.log(`  Missing site_surveyor: ${missing.length}`);
  console.log(`  Mismatched: ${mismatched.length}`);
  console.log("=".repeat(130));

  if (missing.length > 0) {
    // Summary by zuper assignee
    const bySurveyor = new Map<string, number>();
    for (const r of missing) {
      const key = r.zuperAssignees || "(no Zuper job)";
      bySurveyor.set(key, (bySurveyor.get(key) || 0) + 1);
    }
    console.log(`\n--- MISSING SITE_SURVEYOR (${missing.length}) ---\n`);
    console.log("  By Zuper Assignee:");
    for (const [name, count] of [...bySurveyor.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${name}: ${count}`);
    }

    console.log("\n  Detail:");
    console.log("  " + ["Project #".padEnd(12), "Project Name".padEnd(35), "Location".padEnd(14), "Survey Date".padEnd(13), "Zuper Assignee".padEnd(25), "Status".padEnd(12)].join(" | "));
    console.log("  " + "-".repeat(120));
    for (const r of missing) {
      console.log("  " + [
        r.projectNumber.padEnd(12), r.projectName.slice(0, 33).padEnd(35), r.pbLocation.padEnd(14),
        r.surveyDate.padEnd(13), r.zuperAssignees.slice(0, 23).padEnd(25), r.zuperStatus.padEnd(12),
      ].join(" | "));
    }
  }

  if (mismatched.length > 0) {
    const patterns = new Map<string, number>();
    for (const r of mismatched) {
      const key = `${r.hubspotSurveyor} => ${r.zuperAssignees}`;
      patterns.set(key, (patterns.get(key) || 0) + 1);
    }
    console.log(`\n--- MISMATCHES (${mismatched.length}) ---\n`);
    console.log("  Patterns:");
    for (const [p, c] of [...patterns.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${p} : ${c}`);
    }

    console.log("\n  Detail:");
    console.log("  " + ["Project #".padEnd(12), "Project Name".padEnd(35), "Location".padEnd(14), "Survey Date".padEnd(13), "HS Surveyor".padEnd(22), "Zuper Assignee".padEnd(25)].join(" | "));
    console.log("  " + "-".repeat(130));
    for (const r of mismatched) {
      console.log("  " + [
        r.projectNumber.padEnd(12), r.projectName.slice(0, 33).padEnd(35), r.pbLocation.padEnd(14),
        r.surveyDate.padEnd(13), r.hubspotSurveyor.slice(0, 20).padEnd(22), r.zuperAssignees.slice(0, 23).padEnd(25),
      ].join(" | "));
    }
  }

  if (missing.length === 0 && mismatched.length === 0) {
    console.log("\nAll clear — no issues found in this range.");
  }

  console.log("\n" + "=".repeat(130));
  console.log("END OF REPORT");
  console.log("=".repeat(130));
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
