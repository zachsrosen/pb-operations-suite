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
  evaluateRollupDrift,
  hubspotStatusForJob,
  markSupersededJobs,
  rollupDriftRowKey,
  toMappingCategory,
  type DriftEvalDeal,
  type DriftEvalJob,
  type DriftType,
} from "@/lib/zuper-status-mapping";

export const maxDuration = 60;

// Cron tick scope: rolling window of ZuperJobCache rows touched recently.
// 90 days was attempted initially and timed out at 60s on prod (504) —
// the cache holds 3k+ jobs over that window plus 1.6k unique deals to
// batch-fetch from HubSpot. 14 days catches anything genuinely "new"
// drift while keeping each tick under ~10s. The backfill script handles
// historical sweeps on demand with a wider window.
const LOOKBACK_DAYS = 14;

type ReconcileSummary = {
  scanned: number;
  candidates: number;
  superseded: number;
  matched: number;
  drifted: number;
  autoHealed: number;
  rollupChecked: number;
  rollupDrifted: number;
  rollupHealed: number;
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
  "construction_status_solar",
  "construction_status_battery",
  "construction_status_ev",
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
    rollupChecked: 0,
    rollupDrifted: 0,
    rollupHealed: 0,
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
            solarInstallStatus:
              (d.properties.construction_status_solar as string) ?? null,
            batteryInstallStatus:
              (d.properties.construction_status_battery as string) ?? null,
            evInstallStatus: (d.properties.construction_status_ev as string) ?? null,
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

      // Pick the relevant hubspotStatus for display. Sub-type aware — solar
      // jobs show construction_status_solar, etc. Matches what evaluateJobDrift
      // actually compared against.
      const hubspotStatus = hubspotStatusForJob(job, deal);
      const mc = toMappingCategory(job.category);

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

    // 6. Per-deal rollup integrity check: for every deal we processed, see
    //    if all set sub-type statuses are Complete but install_status isn't.
    //    A synthetic ZuperStatusDrift row (uid = rollup-construction:<dealId>)
    //    is upserted on drift, auto-healed when the rollup is consistent
    //    (or no longer applicable).
    for (const [dealId, deal] of dealsById) {
      summary.rollupChecked++;
      const rollup = evaluateRollupDrift(deal);
      const rowKey = rollupDriftRowKey(dealId);

      if (!rollup.drifted) {
        // Heal any existing open rollup drift for this deal.
        const healed = await prisma.zuperStatusDrift.updateMany({
          where: { zuperJobUid: rowKey, status: "OPEN" },
          data: {
            status: "RESOLVED",
            resolvedAt: new Date(),
            resolvedBy: "system:healed",
            resolveNote:
              rollup.incompleteSubTypes.length > 0
                ? "Sub-type work still in progress; rollup check not applicable"
                : "install_status now matches sub-type rollup",
          },
        });
        if (healed.count > 0) summary.rollupHealed += healed.count;
        continue;
      }

      summary.rollupDrifted++;
      const completeList = rollup.completeSubTypes.join("+");
      const drift = await prisma.zuperStatusDrift.upsert({
        where: { zuperJobUid: rowKey },
        update: {
          hubspotDealId: dealId,
          projectNumber: deal.projectNumber,
          dealName: deal.dealName,
          pbLocation: deal.pbLocation,
          category: "construction_rollup",
          zuperJobTitle: `Rollup: ${completeList} complete, install_status lagging`,
          zuperStatus: completeList, // e.g. "solar+battery"
          hubspotStatus: deal.constructionStatus,
          driftTypes: ["ROLLUP_MISMATCH"],
          zuperCompletedAt: null,
          hubspotCompletionAt: null,
          zuperFailedAt: null,
          hubspotFailAt: null,
          status: "OPEN",
          resolvedAt: null,
          resolvedBy: null,
          resolveNote: null,
        },
        create: {
          zuperJobUid: rowKey,
          hubspotDealId: dealId,
          projectNumber: deal.projectNumber,
          dealName: deal.dealName,
          pbLocation: deal.pbLocation,
          category: "construction_rollup",
          zuperJobTitle: `Rollup: ${completeList} complete, install_status lagging`,
          zuperStatus: completeList,
          hubspotStatus: deal.constructionStatus,
          driftTypes: ["ROLLUP_MISMATCH"],
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
