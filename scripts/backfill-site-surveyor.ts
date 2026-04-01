/**
 * Backfill site_surveyor on HubSpot deals using Zuper job assignment data.
 *
 * Reads the same deals from the missing-surveyor report, resolves Zuper assignees
 * to HubSpot owner IDs, and patches the site_surveyor property.
 *
 * Usage:
 *   npx tsx scripts/backfill-site-surveyor.ts          # dry-run (default)
 *   npx tsx scripts/backfill-site-surveyor.ts --apply   # actually write to HubSpot
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.production-pull" });

const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN!;
const ZUPER_API_KEY = process.env.ZUPER_API_KEY!;
const ZUPER_API_URL = process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api";
const SITE_SURVEY_CATEGORY_UID = "002bac33-84d3-4083-a35d-50626fc49288";

const DRY_RUN = !process.argv.includes("--apply");

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

async function hubspotPatch(dealId: string, properties: Record<string, string>): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`https://api.hubapi.com/crm/v3/objects/deals/${dealId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${HUBSPOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ properties }),
    });
    if (res.status === 429) {
      const delay = Math.pow(2, attempt) * 1100 + Math.random() * 400;
      await sleep(delay);
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      console.error(`  PATCH failed for deal ${dealId}: ${res.status} ${text}`);
      return false;
    }
    return true;
  }
  return false;
}

interface OwnerEntry {
  id: string;
  name: string;
  email: string;
}

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

async function fetchSiteSurveyorPropertyOptions(): Promise<Array<{ value: string; label: string }>> {
  const url = "https://api.hubapi.com/crm/v3/properties/deals/site_surveyor";
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}`, "Content-Type": "application/json" },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { options?: Array<{ value: string; label: string }> };
  return data.options || [];
}

// ─── Zuper helpers ──────────────────────────────────────────────────

interface ZuperJob {
  job_uid: string;
  job_title: string;
  job_tags?: string[];
  current_job_status?: { status_name?: string };
  assigned_to?: Array<{ user?: { first_name?: string; last_name?: string; user_uid?: string } }>;
}

async function zuperGet<T>(endpoint: string): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${ZUPER_API_URL}${endpoint}`, {
      headers: { "x-api-key": ZUPER_API_KEY, "Content-Type": "application/json" },
    });
    if (res.status === 429) {
      await sleep(Math.pow(2, attempt) * 1000);
      continue;
    }
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
  } catch {
    return null;
  }
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  console.log(`=== Backfill site_surveyor from Zuper ===`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (pass --apply to write)" : "LIVE — will update HubSpot"}\n`);

  // 1. Fetch HubSpot owners + site_surveyor property options
  console.log("Loading HubSpot owners and site_surveyor property options...");
  const [owners, propOptions] = await Promise.all([fetchOwners(), fetchSiteSurveyorPropertyOptions()]);
  console.log(`  ${owners.length} owners, ${propOptions.length} property options`);

  // Zuper→HubSpot name aliases (Zuper uses full names, HubSpot may differ)
  const NAME_ALIASES: Record<string, string> = {
    "rolando valle": "roland valle",
    "nick scarpellino": "nickolas scarpellino",
    "samuel paro": "sam paro",
  };

  // Build name→value lookup for the site_surveyor property
  // The property might accept owner IDs or label strings depending on how it's configured
  const nameToOwnerValue = new Map<string, string>();
  const nameNormalized = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

  // If property has enumeration options, map label → value
  for (const opt of propOptions) {
    if (opt.label && opt.value) {
      nameToOwnerValue.set(nameNormalized(opt.label), opt.value);
    }
  }

  // Also map owner name → owner ID
  const nameToOwnerId = new Map<string, string>();
  for (const o of owners) {
    if (o.name) nameToOwnerId.set(nameNormalized(o.name), o.id);
  }

  console.log(`  Name→property option mappings: ${nameToOwnerValue.size}`);
  console.log(`  Name→owner ID mappings: ${nameToOwnerId.size}\n`);

  // 2. Search HubSpot for deals with site survey completed in last 6 months, missing surveyor
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  sixMonthsAgo.setHours(0, 0, 0, 0);
  const cutoffMs = sixMonthsAgo.getTime();

  console.log("Searching HubSpot for deals...");
  const allDeals: HubSpotDeal[] = [];
  let after: string | undefined;
  do {
    const response = await hubspotSearch({
      filterGroups: [
        {
          filters: [
            { propertyName: "site_survey_date", operator: "GTE", value: String(cutoffMs) },
            { propertyName: "pipeline", operator: "EQ", value: "6900017" },
          ],
        },
      ],
      properties: ["dealname", "project_number", "site_survey_date", "site_surveyor", "zuper_site_survey_uid"],
      sorts: [{ propertyName: "site_survey_date", direction: "DESCENDING" }],
      limit: 100,
      ...(after ? { after } : {}),
    });
    allDeals.push(...response.results);
    after = response.paging?.next?.after;
    if (after) await sleep(200);
  } while (after);

  const missingDeals = allDeals.filter((d) => {
    const surveyor = d.properties.site_surveyor;
    return !surveyor || surveyor.trim() === "";
  });
  console.log(`  ${allDeals.length} surveyed deals, ${missingDeals.length} missing site_surveyor\n`);

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

  // 4. Process each deal
  let updated = 0;
  let skipped = 0;
  let noMatch = 0;
  let failed = 0;

  console.log("Processing deals...\n");

  for (const deal of missingDeals) {
    const dealId = deal.id;
    const projNum = deal.properties.project_number || dealId;
    const zuperUid = deal.properties.zuper_site_survey_uid || "";

    // Find Zuper job
    let zuperJob: ZuperJob | null = zuperByDealId.get(dealId) || null;
    if (!zuperJob && zuperUid) {
      zuperJob = await fetchZuperJobByUid(zuperUid);
      await sleep(200);
    }

    if (!zuperJob?.assigned_to?.length) {
      console.log(`  ${projNum}: No Zuper assignee found — skipping`);
      noMatch++;
      continue;
    }

    // Get primary assignee (first user)
    const firstAssignee = zuperJob.assigned_to[0];
    const user = firstAssignee.user || (firstAssignee as unknown as { first_name?: string; last_name?: string });
    const fullName = [user?.first_name, user?.last_name].filter(Boolean).join(" ");
    if (!fullName) {
      console.log(`  ${projNum}: Zuper job found but assignee name empty — skipping`);
      noMatch++;
      continue;
    }

    // Resolve to HubSpot value: try property option first, then owner ID
    // Also check aliases for name mismatches between Zuper and HubSpot
    const normalized = nameNormalized(fullName);
    const aliasName = NAME_ALIASES[fullName.toLowerCase()];
    const aliasNormalized = aliasName ? nameNormalized(aliasName) : null;
    let hsValue =
      nameToOwnerValue.get(normalized) ||
      nameToOwnerId.get(normalized) ||
      (aliasNormalized ? nameToOwnerValue.get(aliasNormalized) || nameToOwnerId.get(aliasNormalized) : null) ||
      null;

    if (!hsValue) {
      // Try partial match (first+last)
      for (const [key, val] of nameToOwnerValue) {
        if (key.includes(normalized) || normalized.includes(key)) {
          hsValue = val;
          break;
        }
      }
    }
    if (!hsValue) {
      for (const [key, val] of nameToOwnerId) {
        if (key.includes(normalized) || normalized.includes(key)) {
          hsValue = val;
          break;
        }
      }
    }

    if (!hsValue) {
      console.log(`  ${projNum}: Zuper assignee "${fullName}" not found in HubSpot owners — skipping`);
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  ${projNum}: Would set site_surveyor = "${hsValue}" (${fullName})`);
      updated++;
    } else {
      const success = await hubspotPatch(dealId, { site_surveyor: hsValue });
      if (success) {
        console.log(`  ${projNum}: Updated site_surveyor = "${hsValue}" (${fullName})`);
        updated++;
      } else {
        console.log(`  ${projNum}: FAILED to update`);
        failed++;
      }
      await sleep(150); // rate limit padding
    }
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log(`SUMMARY (${DRY_RUN ? "DRY RUN" : "APPLIED"})`);
  console.log("=".repeat(60));
  console.log(`  ${DRY_RUN ? "Would update" : "Updated"}: ${updated}`);
  console.log(`  Skipped (no HubSpot owner match): ${skipped}`);
  console.log(`  No Zuper assignee found: ${noMatch}`);
  if (!DRY_RUN) console.log(`  Failed: ${failed}`);
  console.log("=".repeat(60));

  if (DRY_RUN && updated > 0) {
    console.log(`\nRun with --apply to write these changes to HubSpot.`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
