import type { Project } from "@/lib/hubspot";
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

export interface FunnelResponse {
  summary: {
    salesClosed: FunnelStageData;
    surveyDone: FunnelStageData;
    daSent: FunnelStageData;
    daApproved: FunnelStageData;
  };
  cohorts: FunnelCohort[];
  medianDays: FunnelMedianDays;
  generatedAt: string;
}

const CANCELLED_STAGE_ID = "68229433";

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
  location?: string
): FunnelResponse {
  const now = new Date();
  // "6 months" on March 30 → cutoff Oct 1 → includes Oct through Mar (6 months)
  const cutoff = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);

  const filtered = projects.filter((p) => {
    if (!p.closeDate) return false;
    if (new Date(p.closeDate + "T12:00:00") < cutoff) return false;
    if (location && location !== "all" && normalizeLocation(p.pbLocation) !== location) return false;
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

    if (p.siteSurveyCompletionDate) {
      addToStage(summary.surveyDone, amt, cancelled);
      addToStage(cohort.surveyDone, amt, cancelled);
      if (!cancelled) {
        daysClosedToSurvey.push(daysBetween(p.closeDate!, p.siteSurveyCompletionDate));
      }
    }

    if (p.designApprovalSentDate) {
      addToStage(summary.daSent, amt, cancelled);
      addToStage(cohort.daSent, amt, cancelled);
      if (!cancelled && p.siteSurveyCompletionDate) {
        daysSurveyToDaSent.push(daysBetween(p.siteSurveyCompletionDate, p.designApprovalSentDate));
      }
    }

    if (p.designApprovalDate) {
      addToStage(summary.daApproved, amt, cancelled);
      addToStage(cohort.daApproved, amt, cancelled);
      if (!cancelled && p.designApprovalSentDate) {
        daysDaSentToApproved.push(daysBetween(p.designApprovalSentDate, p.designApprovalDate));
      }
    }
  }

  const cohorts = [...cohortMap.values()].sort((a, b) =>
    b.month.localeCompare(a.month)
  );

  return {
    summary,
    cohorts,
    medianDays: {
      closedToSurvey: median(daysClosedToSurvey),
      surveyToDaSent: median(daysSurveyToDaSent),
      daSentToApproved: median(daysDaSentToApproved),
    },
    generatedAt: new Date().toISOString(),
  };
}
