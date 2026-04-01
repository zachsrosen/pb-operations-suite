/**
 * Find deals where site_surveyor is filled but doesn't match the
 * Zuper Site Survey job assignee.
 *
 * Usage: npx tsx scripts/site-surveyor-mismatch.ts
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
    if (!res.ok) throw new Error(`HubSpot ${res.status}: ${await res.text()}`);
    return (await res.json()) as HubSpotSearchResponse;
  }
  throw new Error("Max retries exceeded");
}

interface OwnerEntry { id: string; name: string; email: string }

async function fetchOwners(): Promise<OwnerEntry[]> {
  const owners: OwnerEntry[] = [];
  let after: string | undefined;
  do {
    const url = `https://api.hubapi.com/crm/v3/owners?limit=500${after ? `&after=${after}` : ""}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` } });
    if (!res.ok) break;
    const data = (await res.json()) as {
      results: Array<{ id: string; firstName?: string; lastName?: string; email?: string }>;
      paging?: { next?: { after?: string } };
    };
    for (const o of data.results) {
      owners.push({
        id: o.id,
        name: [o.firstName, o.lastName].filter(Boolean).join(" "),
        email: o.email || "",
      });
    }
    after = data.paging?.next?.after;
  } while (after);
  return owners;
}

// ─── Zuper helpers ──────────────────────────────────────────────────

interface ZuperJob {
  job_uid: string;
  job_title: string;
  job_tags?: string[];
  current_job_status?: { status_name?: string };
  assigned_to?: Array<{ user?: { first_name?: string; last_name?: string; user_uid?: string } }>;
  scheduled_start_time?: string;
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

// ─── Name normalization ─────────────────────────────────────────────

// Known Zuper↔HubSpot name variants
const NAME_EQUIVALENCES: [string, string][] = [
  ["rolando valle", "roland valle"],
  ["nick scarpellino", "nickolas scarpellino"],
  ["samuel paro", "sam paro"],
  ["sam paro", "samuel paro"],
  ["lenny uematsu", "leonard uematsu"],
  ["tom st. denis", "thomas st. denis"],
  ["thomas st denis", "thomas st. denis"],
];

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
}

function namesMatch(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === nb) return true;
  // Check equivalences
  for (const [x, y] of NAME_EQUIVALENCES) {
    if ((na === normalizeName(x) && nb === normalizeName(y)) ||
        (na === normalizeName(y) && nb === normalizeName(x))) return true;
  }
  // Check if one contains the other (e.g. "Sam" vs "Samuel")
  const [shorter, longer] = na.length <= nb.length ? [na, nb] : [nb, na];
  const shorterParts = shorter.split(" ");
  const longerParts = longer.split(" ");
  if (shorterParts.length === longerParts.length) {
    // Check if last names match and first name is a prefix
    const lastMatch = shorterParts[shorterParts.length - 1] === longerParts[longerParts.length - 1];
    const firstPrefix = longerParts[0].startsWith(shorterParts[0]) || shorterParts[0].startsWith(longerParts[0]);
    if (lastMatch && firstPrefix) return true;
  }
  return false;
}

// ─── Main ───────────────────────────────────────────────────────────

interface MismatchRow {
  dealId: string;
  projectNumber: string;
  projectName: string;
  pbLocation: string;
  surveyDate: string;
  hubspotSurveyor: string;
  hubspotSurveyorId: string;
  zuperAssignees: string;
  zuperJobStatus: string;
}

async function main() {
  console.log("=== Site Surveyor Mismatch Report ===\n");

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  sixMonthsAgo.setHours(0, 0, 0, 0);
  const cutoffMs = sixMonthsAgo.getTime();
  const cutoffDate = sixMonthsAgo.toISOString().split("T")[0];
  console.log(`Period: ${cutoffDate} to today\n`);

  // 1. Load owners
  console.log("Loading HubSpot owners...");
  const owners = await fetchOwners();
  const ownerById = new Map<string, string>();
  for (const o of owners) ownerById.set(o.id, o.name);
  console.log(`  ${owners.length} owners\n`);

  // 2. Fetch all surveyed deals WITH site_surveyor populated
  console.log("Searching HubSpot for deals with site_surveyor filled...");
  const allDeals: HubSpotDeal[] = [];
  let after: string | undefined;
  do {
    const response = await hubspotSearch({
      filterGroups: [
        {
          filters: [
            { propertyName: "site_survey_date", operator: "GTE", value: String(cutoffMs) },
            { propertyName: "pipeline", operator: "EQ", value: "6900017" },
            { propertyName: "site_surveyor", operator: "HAS_PROPERTY" },
          ],
        },
      ],
      properties: [
        "dealname", "project_number", "pb_location", "site_survey_date",
        "site_surveyor", "zuper_site_survey_uid",
      ],
      sorts: [{ propertyName: "site_survey_date", direction: "DESCENDING" }],
      limit: 100,
      ...(after ? { after } : {}),
    });
    allDeals.push(...response.results);
    after = response.paging?.next?.after;
    console.log(`  Fetched ${allDeals.length} / ${response.total}...`);
    if (after) await sleep(200);
  } while (after);
  console.log(`\nTotal deals with site_surveyor populated: ${allDeals.length}\n`);

  // 3. Fetch all Zuper Site Survey jobs
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
  console.log(`  ${allZuperJobs.length} Zuper Site Survey jobs\n`);

  // Build dealId → ZuperJob lookup
  const zuperByDealId = new Map<string, ZuperJob>();
  for (const job of allZuperJobs) {
    if (job.job_tags) {
      for (const tag of job.job_tags) {
        const match = tag.match(/^hubspot-(\d+)$/);
        if (match) zuperByDealId.set(match[1], job);
      }
    }
  }

  // 4. Compare
  const mismatches: MismatchRow[] = [];
  let matched = 0;
  let noZuper = 0;

  for (const deal of allDeals) {
    const dealId = deal.id;
    const props = deal.properties;
    const surveyorRaw = props.site_surveyor || "";
    const zuperUid = props.zuper_site_survey_uid || "";

    // Resolve HubSpot surveyor name
    const hsName = ownerById.get(surveyorRaw) || surveyorRaw;

    // Find Zuper job
    let zuperJob: ZuperJob | null = zuperByDealId.get(dealId) || null;
    if (!zuperJob && zuperUid) {
      zuperJob = await fetchZuperJobByUid(zuperUid);
      await sleep(200);
    }

    if (!zuperJob?.assigned_to?.length) {
      noZuper++;
      continue;
    }

    // Get all Zuper assignee names
    const zuperNames = zuperJob.assigned_to
      .map((a) => {
        const u = a.user || (a as unknown as { first_name?: string; last_name?: string });
        return [u?.first_name, u?.last_name].filter(Boolean).join(" ");
      })
      .filter(Boolean);

    if (zuperNames.length === 0) {
      noZuper++;
      continue;
    }

    // Check if HubSpot surveyor matches any Zuper assignee
    const isMatch = zuperNames.some((zn) => namesMatch(hsName, zn));

    if (isMatch) {
      matched++;
    } else {
      mismatches.push({
        dealId,
        projectNumber: props.project_number || "",
        projectName: props.dealname || "",
        pbLocation: props.pb_location || "",
        surveyDate: props.site_survey_date || "",
        hubspotSurveyor: hsName,
        hubspotSurveyorId: surveyorRaw,
        zuperAssignees: zuperNames.join(", "),
        zuperJobStatus: zuperJob.current_job_status?.status_name || "(unknown)",
      });
    }
  }

  // ─── Report ─────────────────────────────────────────────────────
  console.log("=".repeat(130));
  console.log("REPORT: Site Surveyor Mismatches (HubSpot vs Zuper)");
  console.log("=".repeat(130));
  console.log(`Period: ${cutoffDate} to today`);
  console.log(`Deals with site_surveyor: ${allDeals.length}`);
  console.log(`  Matched: ${matched}`);
  console.log(`  Mismatched: ${mismatches.length}`);
  console.log(`  No Zuper job/assignee: ${noZuper}`);
  console.log("=".repeat(130));

  if (mismatches.length === 0) {
    console.log("\nAll site_surveyor values match Zuper assignees!");
    return;
  }

  // Summary by mismatch pattern
  const patterns = new Map<string, number>();
  for (const m of mismatches) {
    const key = `${m.hubspotSurveyor} -> ${m.zuperAssignees}`;
    patterns.set(key, (patterns.get(key) || 0) + 1);
  }

  console.log("\n--- MISMATCH PATTERNS ---\n");
  console.log("  HubSpot Surveyor => Zuper Assignee(s) : Count");
  console.log("  " + "-".repeat(60));
  for (const [pattern, count] of [...patterns.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pattern} : ${count}`);
  }

  // Summary by location
  const byLoc = new Map<string, number>();
  for (const m of mismatches) {
    const loc = m.pbLocation || "(unknown)";
    byLoc.set(loc, (byLoc.get(loc) || 0) + 1);
  }
  console.log("\n--- BY LOCATION ---\n");
  for (const [loc, count] of [...byLoc.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${loc}: ${count}`);
  }

  // Detail
  console.log("\n--- DETAIL ---\n");
  console.log(
    [
      "Project #".padEnd(12),
      "Project Name".padEnd(35),
      "Location".padEnd(14),
      "Survey Date".padEnd(13),
      "HubSpot Surveyor".padEnd(22),
      "Zuper Assignee(s)".padEnd(30),
      "Status".padEnd(12),
    ].join(" | ")
  );
  console.log("-".repeat(150));

  for (const m of mismatches) {
    console.log(
      [
        m.projectNumber.padEnd(12),
        m.projectName.slice(0, 33).padEnd(35),
        m.pbLocation.padEnd(14),
        m.surveyDate.padEnd(13),
        m.hubspotSurveyor.slice(0, 20).padEnd(22),
        m.zuperAssignees.slice(0, 28).padEnd(30),
        m.zuperJobStatus.padEnd(12),
      ].join(" | ")
    );
  }

  console.log("\n" + "=".repeat(130));
  console.log("END OF REPORT");
  console.log("=".repeat(130));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
