/**
 * GET /api/cron/zuper-status-reconcile
 *
 * Scans ZuperJobCache for the three job categories (honoring
 * CONSTRUCTION_JOB_SPLIT_ENABLED), compares each surviving sub-job
 * against its HubSpot deal, and writes drift rows to ZuperStatusDrift.
 *
 * Auth: bearer CRON_SECRET (matches other crons).
 * Feature flag: ZUPER_RECONCILE_ENABLED=true to activate.
 * Flag-only — no writes back to Zuper or HubSpot.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hubspotClient } from "@/lib/hubspot";
import { CONSTRUCTION_CATEGORY_NAMES, JOB_CATEGORIES } from "@/lib/zuper";
import {
  evaluateJobDrift,
  markSupersededJobs,
  toMappingCategory,
  type DriftEvalDeal,
  type DriftEvalJob,
  type DriftType,
} from "@/lib/zuper-status-mapping";

export const maxDuration = 60;

const LOOKBACK_DAYS = 90;

type ReconcileSummary = {
  scanned: number;
  candidates: number;
  superseded: number;
  matched: number;
  drifted: number;
  autoHealed: number;
  newDriftIds: string[];
  errors: string[];
};

/** Map ZuperJobCache.jobCategory display name → canonical sub-type label. */
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

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (process.env.ZUPER_RECONCILE_ENABLED !== "true") {
    return NextResponse.json({ status: "disabled" });
  }

  if (!prisma) {
    return NextResponse.json(
      { status: "error", error: "Database not configured" },
      { status: 500 },
    );
  }

  const summary: ReconcileSummary = {
    scanned: 0,
    candidates: 0,
    superseded: 0,
    matched: 0,
    drifted: 0,
    autoHealed: 0,
    newDriftIds: [],
    errors: [],
  };

  try {
    // 1. Pull jobs from ZuperJobCache. Filter by the three top-level categories,
    //    construction expanded to honor CONSTRUCTION_JOB_SPLIT_ENABLED.
    const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const allowedCategories = [
      JOB_CATEGORIES.SITE_SURVEY,
      JOB_CATEGORIES.INSPECTION,
      ...CONSTRUCTION_CATEGORY_NAMES,
    ];

    const cached = await prisma.zuperJobCache.findMany({
      where: {
        jobCategory: { in: allowedCategories },
        lastSyncedAt: { gte: since },
      },
      orderBy: { lastSyncedAt: "desc" },
    });
    summary.scanned = cached.length;

    // 2. Build DriftEvalJob entries with canonical category labels.
    type CandidateJob = DriftEvalJob & {
      dealId: string;
      projectNumber: string | null;
      scheduledStart: string | null;
      createdAt: string | null;
      isSuperseded: boolean;
    };
    const jobs: CandidateJob[] = [];
    for (const c of cached) {
      if (!c.hubspotDealId) continue; // no deal → no drift to compute
      jobs.push({
        jobUid: c.jobUid,
        jobTitle: c.jobTitle,
        category: categoryFromCache(c.jobCategory),
        zuperStatus: c.jobStatus,
        completedAt: c.completedDate ? c.completedDate.toISOString() : null,
        dealId: c.hubspotDealId,
        // Fall back to dealId so markSupersededJobs (which skips null
        // projectNumber) doesn't leak duplicate drift rows for jobs
        // with non-standard titles. We already filter to hubspotDealId
        // above, so this fallback is always populated.
        projectNumber: extractProjectNumberFromTitle(c.jobTitle) ?? c.hubspotDealId,
        scheduledStart: c.scheduledStart ? c.scheduledStart.toISOString() : null,
        createdAt: null, // ZuperJobCache lacks Zuper's createdAt; scheduledStart is sufficient
        isSuperseded: false,
      });
    }
    summary.candidates = jobs.length;

    // 3. Apply markSupersededJobs to drop older siblings within (project, inspection).
    markSupersededJobs(jobs);
    const survivingJobs = jobs.filter((j) => !j.isSuperseded);
    summary.superseded = jobs.length - survivingJobs.length;

    // 4. Batch-fetch HubSpot deals (chunks of 100).
    const dealIds = Array.from(new Set(survivingJobs.map((j) => j.dealId)));
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
        summary.errors.push(
          `hubspot batch read failed for ${batch.length} deals: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // 5. For each surviving job, evaluate drift + upsert/heal.
    for (const job of survivingJobs) {
      const deal = dealsById.get(job.dealId);
      if (!deal) continue; // deal vanished — skip silently

      const driftTypes: DriftType[] = evaluateJobDrift(job, deal);

      if (driftTypes.length === 0) {
        // Heal any existing open drift for this job.
        const healed = await prisma.zuperStatusDrift.updateMany({
          where: { zuperJobUid: job.jobUid, status: "OPEN" },
          data: {
            status: "RESOLVED",
            resolvedAt: new Date(),
            resolvedBy: "system:healed",
            resolveNote: "Zuper and HubSpot now match",
          },
        });
        if (healed.count > 0) summary.autoHealed += healed.count;
        else summary.matched++;
        continue;
      }

      summary.drifted++;

      // Pick the relevant hubspotStatus for display.
      const mc = toMappingCategory(job.category);
      const hubspotStatus =
        mc === "site_survey"
          ? deal.siteSurveyStatus
          : mc === "construction"
            ? deal.constructionStatus
            : deal.inspectionStatus;

      // Pick the relevant HubSpot date for display.
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

      const drift = await prisma.zuperStatusDrift.upsert({
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
          // Re-open if previously resolved/ignored.
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
      summary.newDriftIds.push(drift.id);
    }

    return NextResponse.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      lookbackDays: LOOKBACK_DAYS,
      ...summary,
    });
  } catch (err) {
    console.error("[zuper-status-reconcile] failed:", err);
    return NextResponse.json(
      {
        status: "error",
        error: err instanceof Error ? err.message : "Unknown error",
        partial: summary,
      },
      { status: 500 },
    );
  }
}

/** Pull "PROJ-1234" out of a Zuper job title for project-level superseded grouping. */
function extractProjectNumberFromTitle(title: string | null | undefined): string | null {
  if (!title) return null;
  const m = title.match(/PROJ-\d+/i);
  return m ? m[0].toUpperCase() : null;
}
