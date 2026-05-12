/* eslint-disable no-console */
/**
 * One-off historical sweep for Zuper status drift.
 *
 * Mirrors /api/cron/zuper-status-reconcile but with a wider lookback
 * (default 90 days). Latest-job-per-(project, inspection) dedup so older
 * superseded sibling jobs don't generate false positives.
 *
 * Usage:
 *   LOOKBACK_DAYS=90 npx tsx scripts/backfill-zuper-drift.ts
 *   WIPE=1 LOOKBACK_DAYS=90 npx tsx scripts/backfill-zuper-drift.ts
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { CONSTRUCTION_CATEGORY_NAMES, JOB_CATEGORIES } from "../src/lib/zuper";
import {
  evaluateJobDrift,
  markSupersededJobs,
  toMappingCategory,
  type DriftEvalDeal,
  type DriftEvalJob,
  type DriftType,
} from "../src/lib/zuper-status-mapping";
import { hubspotClient } from "../src/lib/hubspot";

const LOOKBACK_DAYS = Number(process.env.LOOKBACK_DAYS ?? 90);
const WIPE = process.env.WIPE === "1";

function categoryFromCache(jobCategory: string): string {
  switch (jobCategory) {
    case JOB_CATEGORIES.SITE_SURVEY:
      return "site_survey";
    case JOB_CATEGORIES.CONSTRUCTION:
      return "construction";
    case JOB_CATEGORIES.SOLAR_INSTALL:
      return "solar_install";
    case JOB_CATEGORIES.BATTERY_INSTALL:
      return "battery_install";
    case JOB_CATEGORIES.EV_INSTALL:
      return "ev_install";
    case JOB_CATEGORIES.INSPECTION:
      return "inspection";
    default:
      return jobCategory.toLowerCase().replace(/\s+/g, "_");
  }
}

function extractProjectNumberFromTitle(title: string | null | undefined): string | null {
  if (!title) return null;
  const m = title.match(/PROJ-\d+/i);
  return m ? m[0].toUpperCase() : null;
}

const HUBSPOT_PROPS = [
  "dealname",
  "pb_location",
  "pb_project_number",
  "site_survey_status",
  "install_status",
  "final_inspection_status",
  "construction_complete_date",
  "inspections_completion_date",
  "inspections_fail_date",
];

async function main() {
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  if (WIPE) {
    const wiped = await prisma.zuperStatusDrift.deleteMany({});
    console.log(`Wiped ${wiped.count} existing drift rows (WIPE=1).`);
  }

  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const allowedCategories = [
    JOB_CATEGORIES.SITE_SURVEY,
    JOB_CATEGORIES.INSPECTION,
    ...CONSTRUCTION_CATEGORY_NAMES,
  ];
  console.log(`Scanning ZuperJobCache modified since ${since.toISOString()} (${LOOKBACK_DAYS}d lookback)...`);

  const cached = await prisma.zuperJobCache.findMany({
    where: { jobCategory: { in: allowedCategories }, lastSyncedAt: { gte: since } },
    orderBy: { lastSyncedAt: "desc" },
  });
  console.log(`Found ${cached.length} Zuper jobs.`);

  // Build candidate jobs with deal linkage.
  type CandidateJob = DriftEvalJob & {
    dealId: string;
    projectNumber: string | null;
    scheduledStart: string | null;
    createdAt: string | null;
    isSuperseded: boolean;
  };
  const jobs: CandidateJob[] = [];
  for (const c of cached) {
    if (!c.hubspotDealId) continue;
    jobs.push({
      jobUid: c.jobUid,
      jobTitle: c.jobTitle,
      category: categoryFromCache(c.jobCategory),
      zuperStatus: c.jobStatus,
      completedAt: c.completedDate ? c.completedDate.toISOString() : null,
      dealId: c.hubspotDealId,
      // Fall back to dealId so markSupersededJobs (which skips null
      // projectNumber) doesn't leak duplicate rows for jobs whose titles
      // don't contain PROJ-XXXX.
      projectNumber: extractProjectNumberFromTitle(c.jobTitle) ?? c.hubspotDealId,
      scheduledStart: c.scheduledStart ? c.scheduledStart.toISOString() : null,
      createdAt: null,
      isSuperseded: false,
    });
  }
  console.log(`${jobs.length} jobs have HubSpot deal linkage.`);

  // Mark superseded siblings.
  markSupersededJobs(jobs);
  const survivors = jobs.filter((j) => !j.isSuperseded);
  console.log(`After superseded dedup: ${survivors.length} jobs (${jobs.length - survivors.length} superseded).`);

  // Batch-fetch HubSpot deals.
  const dealIds = Array.from(new Set(survivors.map((j) => j.dealId)));
  const dealsById = new Map<string, DriftEvalDeal>();
  const CHUNK = 100;
  for (let i = 0; i < dealIds.length; i += CHUNK) {
    const batch = dealIds.slice(i, i + CHUNK);
    try {
      const res = await hubspotClient.crm.deals.batchApi.read({
        properties: HUBSPOT_PROPS,
        propertiesWithHistory: [],
        inputs: batch.map((id) => ({ id })),
      });
      for (const d of res.results) {
        dealsById.set(d.id, {
          dealId: d.id,
          dealName: (d.properties.dealname as string) ?? null,
          pbLocation: (d.properties.pb_location as string) ?? null,
          projectNumber: (d.properties.pb_project_number as string) ?? null,
          siteSurveyStatus: (d.properties.site_survey_status as string) ?? null,
          constructionStatus: (d.properties.install_status as string) ?? null,
          inspectionStatus: (d.properties.final_inspection_status as string) ?? null,
          constructionCompleteDate:
            (d.properties.construction_complete_date as string) ?? null,
          inspectionPassDate:
            (d.properties.inspections_completion_date as string) ?? null,
          inspectionFailDate: (d.properties.inspections_fail_date as string) ?? null,
        });
      }
    } catch (err) {
      console.warn(
        `HubSpot batch failed for ${batch.length} deals:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  console.log(`Fetched ${dealsById.size} HubSpot deals.`);

  // Evaluate + upsert.
  let drifted = 0;
  let matched = 0;
  let autoHealed = 0;
  const errors: string[] = [];

  for (const job of survivors) {
    const deal = dealsById.get(job.dealId);
    if (!deal) continue;

    const driftTypes: DriftType[] = evaluateJobDrift(job, deal);

    if (driftTypes.length === 0) {
      const healed = await prisma.zuperStatusDrift.updateMany({
        where: { zuperJobUid: job.jobUid, status: "OPEN" },
        data: {
          status: "RESOLVED",
          resolvedAt: new Date(),
          resolvedBy: "system:healed",
          resolveNote: "Zuper and HubSpot now match",
        },
      });
      if (healed.count > 0) autoHealed += healed.count;
      else matched++;
      continue;
    }

    drifted++;
    const mc = toMappingCategory(job.category);
    const hubspotStatus =
      mc === "site_survey"
        ? deal.siteSurveyStatus
        : mc === "construction"
          ? deal.constructionStatus
          : deal.inspectionStatus;

    const hubspotCompletionAt =
      mc === "construction"
        ? deal.constructionCompleteDate
        : mc === "inspection" && job.zuperStatus.toLowerCase() === "passed"
          ? deal.inspectionPassDate
          : null;
    const hubspotFailAt =
      mc === "inspection" && job.zuperStatus.toLowerCase() === "failed"
        ? deal.inspectionFailDate
        : null;

    await prisma.zuperStatusDrift.upsert({
      where: { zuperJobUid: job.jobUid },
      update: {
        hubspotDealId: job.dealId,
        projectNumber: deal.projectNumber,
        dealName: deal.dealName,
        pbLocation: deal.pbLocation,
        category: job.category,
        zuperJobTitle: job.jobTitle,
        zuperStatus: job.zuperStatus,
        hubspotStatus,
        driftTypes,
        zuperCompletedAt: job.completedAt ? new Date(job.completedAt) : null,
        hubspotCompletionAt: hubspotCompletionAt ? new Date(hubspotCompletionAt) : null,
        zuperFailedAt:
          job.zuperStatus.toLowerCase() === "failed" && job.completedAt
            ? new Date(job.completedAt)
            : null,
        hubspotFailAt: hubspotFailAt ? new Date(hubspotFailAt) : null,
        status: "OPEN",
        resolvedAt: null,
        resolvedBy: null,
        resolveNote: null,
      },
      create: {
        zuperJobUid: job.jobUid,
        hubspotDealId: job.dealId,
        projectNumber: deal.projectNumber,
        dealName: deal.dealName,
        pbLocation: deal.pbLocation,
        category: job.category,
        zuperJobTitle: job.jobTitle,
        zuperStatus: job.zuperStatus,
        hubspotStatus,
        driftTypes,
        zuperCompletedAt: job.completedAt ? new Date(job.completedAt) : null,
        hubspotCompletionAt: hubspotCompletionAt ? new Date(hubspotCompletionAt) : null,
        zuperFailedAt:
          job.zuperStatus.toLowerCase() === "failed" && job.completedAt
            ? new Date(job.completedAt)
            : null,
        hubspotFailAt: hubspotFailAt ? new Date(hubspotFailAt) : null,
      },
    });

    process.stdout.write(
      `  • drift: deal=${job.dealId} job=${job.jobUid} types=${driftTypes.join(",")} — ${(job.jobTitle ?? "").slice(0, 60)}\n`,
    );
  }

  console.log("\n=== Summary ===");
  console.log(`Scanned (cache rows):     ${cached.length}`);
  console.log(`With deal linkage:        ${jobs.length}`);
  console.log(`After dedup:              ${survivors.length}`);
  console.log(`Matched (in sync):        ${matched}`);
  console.log(`Auto-healed open rows:    ${autoHealed}`);
  console.log(`Drifted (logged):         ${drifted}`);
  console.log(`Errors:                   ${errors.length}`);
  if (errors.length) errors.slice(0, 20).forEach((e) => console.log("  -", e));

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
