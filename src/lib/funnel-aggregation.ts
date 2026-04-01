import type { Project } from "@/lib/hubspot";
import { DEAL_STAGE_MAP } from "@/lib/hubspot";
import { normalizeLocation } from "@/lib/locations";

export interface FunnelStageData {
  count: number;
  amount: number;
  cancelledCount: number;
  cancelledAmount: number;
}

export interface FunnelCohort {
  month: string;
  salesClosed: FunnelStageData;
  surveyDone: FunnelStageData;
  daSent: FunnelStageData;
  daApproved: FunnelStageData;
}

export interface FunnelMedianDays {
  closedToSurvey: number | null;
  surveyToDaSent: number | null;
  daSentToApproved: number | null;
}

/** Milestones binned by the month the activity actually occurred (not close date). */
export interface MonthlyActivity {
  month: string;
  surveysCompleted: number;
  dasSent: number;
  dasApproved: number;
  dasApprovedAmount: number;
}

/** Current deal stage distribution for all deals in the filtered window. */
export interface StageGroup {
  stageId: string;
  stageName: string;
  count: number;
  amount: number;
}

/** Deals currently blocked on a sales change order (layoutStatus === "Pending Sales Changes"). */
export interface PendingSalesChange {
  count: number;
  amount: number;
}

/** Slim deal record for drill-down tables. */
export interface DrillDownDeal {
  id: number;
  name: string;
  projectNumber: string;
  amount: number;
  pbLocation: string;
  closeDate: string;
  stage: string;
  url: string;
  daysWaiting: number;
  /** Context-dependent status: siteSurveyStatus, designStatus, or layoutStatus. */
  status: string | null;
}

export interface DrillDown {
  awaitingSurvey: DrillDownDeal[];
  awaitingDaSend: DrillDownDeal[];
  awaitingApproval: DrillDownDeal[];
  pendingSalesChange: DrillDownDeal[];
}

export interface FunnelResponse {
  summary: {
    salesClosed: FunnelStageData;
    surveyDone: FunnelStageData;
    daSent: FunnelStageData;
    daApproved: FunnelStageData;
  };
  cohorts: FunnelCohort[];
  /** Milestone counts by the month the work happened — for throughput pacing. */
  monthlyActivity: MonthlyActivity[];
  /** Where all deals from the filtered window currently sit in the pipeline. */
  stageDistribution: StageGroup[];
  /** Deals currently blocked — DA pending sales change order. */
  pendingSalesChange: PendingSalesChange;
  /** Deal-level drill-down lists for each backlog bucket. */
  drillDown: DrillDown;
  medianDays: FunnelMedianDays;
  generatedAt: string;
}

const CANCELLED_STAGE_ID = "68229433";

/** Today as YYYY-MM-DD for daysWaiting calculations. */
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toDrillDown(
  p: Project,
  daysWaiting: number,
  status: string | null
): DrillDownDeal {
  return {
    id: p.id,
    name: p.name,
    projectNumber: p.projectNumber,
    amount: p.amount || 0,
    pbLocation: p.pbLocation,
    closeDate: p.closeDate!,
    stage: p.stage,
    url: p.url,
    daysWaiting,
    status,
  };
}

function emptyStage(): FunnelStageData {
  return { count: 0, amount: 0, cancelledCount: 0, cancelledAmount: 0 };
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b + "T12:00:00").getTime() - new Date(a + "T12:00:00").getTime()) / (1000 * 60 * 60 * 24)
  );
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function monthKey(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function addToStage(
  stage: FunnelStageData,
  amount: number,
  cancelled: boolean
): void {
  if (cancelled) {
    stage.cancelledCount += 1;
    stage.cancelledAmount += amount;
  } else {
    stage.count += 1;
    stage.amount += amount;
  }
}

export function buildFunnelData(
  projects: Project[],
  months: number,
  locations?: string[]
): FunnelResponse {
  const now = new Date();
  // Rolling days: "3 months" = ~90 days back from today, not calendar-month aligned.
  // Avoids the cliff where an entire month drops off on the 1st.
  const cutoff = new Date(now.getFullYear(), now.getMonth() - months, now.getDate());

  const locSet = locations && locations.length > 0 ? new Set(locations) : null;
  function matchesLocation(p: Project): boolean {
    if (!locSet) return true;
    const canonical = normalizeLocation(p.pbLocation);
    return canonical != null && locSet.has(canonical);
  }

  const filtered = projects.filter((p) => {
    if (!p.closeDate) return false;
    if (new Date(p.closeDate + "T12:00:00") < cutoff) return false;
    if (!matchesLocation(p)) return false;
    return true;
  });

  const summary = {
    salesClosed: emptyStage(),
    surveyDone: emptyStage(),
    daSent: emptyStage(),
    daApproved: emptyStage(),
  };

  const cohortMap = new Map<string, FunnelCohort>();
  const daysClosedToSurvey: number[] = [];
  const daysSurveyToDaSent: number[] = [];
  const daysDaSentToApproved: number[] = [];

  for (const p of filtered) {
    const cancelled = p.stageId === CANCELLED_STAGE_ID;
    const amt = p.amount || 0;
    const mk = monthKey(p.closeDate!);

    if (!cohortMap.has(mk)) {
      cohortMap.set(mk, {
        month: mk,
        salesClosed: emptyStage(),
        surveyDone: emptyStage(),
        daSent: emptyStage(),
        daApproved: emptyStage(),
      });
    }
    const cohort = cohortMap.get(mk)!;

    addToStage(summary.salesClosed, amt, cancelled);
    addToStage(cohort.salesClosed, amt, cancelled);

    // Implied progression: approved → implies sent → implies surveyed.
    // HubSpot data sometimes has later milestones without earlier ones.
    const hasSurvey = !!(p.siteSurveyCompletionDate || p.designApprovalSentDate || p.designApprovalDate);
    const hasDaSent = !!(p.designApprovalSentDate || p.designApprovalDate);
    const hasDaApproved = !!p.designApprovalDate;

    if (hasSurvey) {
      addToStage(summary.surveyDone, amt, cancelled);
      addToStage(cohort.surveyDone, amt, cancelled);
      if (!cancelled && p.siteSurveyCompletionDate) {
        daysClosedToSurvey.push(daysBetween(p.closeDate!, p.siteSurveyCompletionDate));
      }
    }

    if (hasDaSent) {
      addToStage(summary.daSent, amt, cancelled);
      addToStage(cohort.daSent, amt, cancelled);
      if (!cancelled && p.siteSurveyCompletionDate && p.designApprovalSentDate) {
        daysSurveyToDaSent.push(daysBetween(p.siteSurveyCompletionDate, p.designApprovalSentDate));
      }
    }

    if (hasDaApproved) {
      addToStage(summary.daApproved, amt, cancelled);
      addToStage(cohort.daApproved, amt, cancelled);
      if (!cancelled && p.designApprovalSentDate) {
        daysDaSentToApproved.push(daysBetween(p.designApprovalSentDate, p.designApprovalDate!));
      }
    }
  }

  const cohorts = [...cohortMap.values()].sort((a, b) =>
    b.month.localeCompare(a.month)
  );

  // Activity-based counts: bin milestones by the month they happened,
  // across ALL projects (not just closeDate-filtered), so pacing reflects
  // actual team throughput regardless of when the deal originally closed.
  const activityMap = new Map<string, MonthlyActivity>();
  function ensureActivity(mk: string): MonthlyActivity {
    if (!activityMap.has(mk)) {
      activityMap.set(mk, { month: mk, surveysCompleted: 0, dasSent: 0, dasApproved: 0, dasApprovedAmount: 0 });
    }
    return activityMap.get(mk)!;
  }

  for (const p of projects) {
    // Apply location filter only — no closeDate filter for activity counts
    if (!matchesLocation(p)) continue;

    if (p.siteSurveyCompletionDate) {
      const d = new Date(p.siteSurveyCompletionDate + "T12:00:00");
      if (d >= cutoff) ensureActivity(monthKey(p.siteSurveyCompletionDate)).surveysCompleted++;
    }
    if (p.designApprovalSentDate) {
      const d = new Date(p.designApprovalSentDate + "T12:00:00");
      if (d >= cutoff) ensureActivity(monthKey(p.designApprovalSentDate)).dasSent++;
    }
    if (p.designApprovalDate) {
      const d = new Date(p.designApprovalDate + "T12:00:00");
      if (d >= cutoff) {
        const act = ensureActivity(monthKey(p.designApprovalDate));
        act.dasApproved++;
        act.dasApprovedAmount += p.amount || 0;
      }
    }
  }

  const monthlyActivity = [...activityMap.values()].sort((a, b) =>
    b.month.localeCompare(a.month)
  );

  // Stage distribution: where all deals from the filtered window currently sit.
  // Ordered by pipeline progression (DEAL_STAGE_MAP key order).
  const stageOrder = Object.keys(DEAL_STAGE_MAP);
  const stageMap = new Map<string, StageGroup>();
  for (const p of filtered) {
    const sid = p.stageId || "unknown";
    if (!stageMap.has(sid)) {
      stageMap.set(sid, {
        stageId: sid,
        stageName: p.stage || DEAL_STAGE_MAP[sid] || sid,
        count: 0,
        amount: 0,
      });
    }
    const sg = stageMap.get(sid)!;
    sg.count++;
    sg.amount += p.amount || 0;
  }
  const stageDistribution = [...stageMap.values()].sort(
    (a, b) => stageOrder.indexOf(a.stageId) - stageOrder.indexOf(b.stageId)
  );

  // Deals currently blocked on a sales change order
  const pendingSalesChange: PendingSalesChange = { count: 0, amount: 0 };
  for (const p of filtered) {
    if (p.layoutStatus === "Pending Sales Changes") {
      pendingSalesChange.count++;
      pendingSalesChange.amount += p.amount || 0;
    }
  }

  // Drill-down: deal-level lists for each backlog bucket (active only, sorted longest-stuck first)
  const today = todayStr();
  const drillDown: DrillDown = {
    awaitingSurvey: [],
    awaitingDaSend: [],
    awaitingApproval: [],
    pendingSalesChange: [],
  };
  for (const p of filtered) {
    if (p.stageId === CANCELLED_STAGE_ID) continue;

    // Use same implied progression for drill-down bucketing:
    // approved → implies sent → implies surveyed
    const ddSurvey = !!(p.siteSurveyCompletionDate || p.designApprovalSentDate || p.designApprovalDate);
    const ddDaSent = !!(p.designApprovalSentDate || p.designApprovalDate);
    const ddDaApproved = !!p.designApprovalDate;

    if (!ddSurvey) {
      // Closed but no survey (and no later milestones)
      drillDown.awaitingSurvey.push(
        toDrillDown(p, daysBetween(p.closeDate!, today), p.siteSurveyStatus ?? null)
      );
    } else if (!ddDaSent) {
      // Surveyed but DA not sent (and not approved)
      const waitSince = p.siteSurveyCompletionDate || p.closeDate!;
      drillDown.awaitingDaSend.push(
        toDrillDown(p, daysBetween(waitSince, today), p.designStatus ?? null)
      );
    } else if (!ddDaApproved) {
      // DA sent but not approved
      const waitSince = p.designApprovalSentDate || p.closeDate!;
      drillDown.awaitingApproval.push(
        toDrillDown(p, daysBetween(waitSince, today), p.layoutStatus ?? null)
      );
    }

    if (p.layoutStatus === "Pending Sales Changes") {
      drillDown.pendingSalesChange.push(
        toDrillDown(p, daysBetween(p.closeDate!, today), p.layoutStatus)
      );
    }
  }
  // Sort each list by daysWaiting descending (longest-stuck first)
  const byWaitDesc = (a: DrillDownDeal, b: DrillDownDeal) => b.daysWaiting - a.daysWaiting;
  drillDown.awaitingSurvey.sort(byWaitDesc);
  drillDown.awaitingDaSend.sort(byWaitDesc);
  drillDown.awaitingApproval.sort(byWaitDesc);
  drillDown.pendingSalesChange.sort(byWaitDesc);

  return {
    summary,
    cohorts,
    monthlyActivity,
    stageDistribution,
    pendingSalesChange,
    drillDown,
    medianDays: {
      closedToSurvey: median(daysClosedToSurvey),
      surveyToDaSent: median(daysSurveyToDaSent),
      daSentToApproved: median(daysDaSentToApproved),
    },
    generatedAt: new Date().toISOString(),
  };
}
