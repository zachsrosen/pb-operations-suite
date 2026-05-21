import type { Project } from "@/lib/hubspot";
import { DEAL_STAGE_MAP } from "@/lib/hubspot";
import { normalizeLocation } from "@/lib/locations";

export interface ProjectFunnelStageData {
  count: number;
  amount: number;
  cancelledCount: number;
  cancelledAmount: number;
}

export const PROJECT_FUNNEL_STAGES = [
  "salesClosed",
  "surveyScheduled",
  "surveyDone",
  "daSent",
  "daApproved",
  "designCompleted",
  "permitsSubmitted",
  "permitsIssued",
  "constructionScheduled",
  "constructionComplete",
  "inspectionPassed",
  "ptoGranted",
] as const;

export type ProjectFunnelStageKey = (typeof PROJECT_FUNNEL_STAGES)[number];

export interface ProjectFunnelCohort {
  month: string;
  salesClosed: ProjectFunnelStageData;
  surveyScheduled: ProjectFunnelStageData;
  surveyDone: ProjectFunnelStageData;
  daSent: ProjectFunnelStageData;
  daApproved: ProjectFunnelStageData;
  designCompleted: ProjectFunnelStageData;
  permitsSubmitted: ProjectFunnelStageData;
  permitsIssued: ProjectFunnelStageData;
  constructionScheduled: ProjectFunnelStageData;
  constructionComplete: ProjectFunnelStageData;
  inspectionPassed: ProjectFunnelStageData;
  ptoGranted: ProjectFunnelStageData;
}

export interface ProjectFunnelMedianDays {
  closedToSurveyScheduled: number | null;
  surveyScheduledToComplete: number | null;
  surveyToDaSent: number | null;
  daSentToApproved: number | null;
  approvedToDesignComplete: number | null;
  designCompleteToPermitSubmit: number | null;
  permitSubmitToIssued: number | null;
  permitIssuedToConstructionScheduled: number | null;
  constructionScheduledToComplete: number | null;
  constructionCompleteToInspection: number | null;
  inspectionToPto: number | null;
}

export interface ProjectMonthlyActivity {
  month: string;
  surveysScheduled: number;
  surveysCompleted: number;
  dasSent: number;
  dasApproved: number;
  dasApprovedAmount: number;
  designsCompleted: number;
  permitsSubmitted: number;
  permitsIssued: number;
  constructionsScheduled: number;
  constructionsComplete: number;
  constructionsCompleteAmount: number;
  inspectionsPassed: number;
  ptosGranted: number;
  ptosGrantedAmount: number;
}

export interface ProjectFunnelStageGroup {
  stageId: string;
  stageName: string;
  count: number;
  amount: number;
}

export interface ProjectFunnelDrillDownDeal {
  id: number;
  name: string;
  projectNumber: string;
  amount: number;
  pbLocation: string;
  closeDate: string;
  stage: string;
  url: string;
  daysWaiting: number;
  status: string | null;
}

export interface ProjectFunnelDrillDown {
  awaitingSurveySchedule: ProjectFunnelDrillDownDeal[];
  awaitingSurvey: ProjectFunnelDrillDownDeal[];
  awaitingDaSend: ProjectFunnelDrillDownDeal[];
  awaitingApproval: ProjectFunnelDrillDownDeal[];
  awaitingDesignComplete: ProjectFunnelDrillDownDeal[];
  awaitingPermitSubmit: ProjectFunnelDrillDownDeal[];
  awaitingPermitIssue: ProjectFunnelDrillDownDeal[];
  awaitingConstructionSchedule: ProjectFunnelDrillDownDeal[];
  awaitingConstructionComplete: ProjectFunnelDrillDownDeal[];
  awaitingInspection: ProjectFunnelDrillDownDeal[];
  awaitingPto: ProjectFunnelDrillDownDeal[];
  awaitingCloseOut: ProjectFunnelDrillDownDeal[];
}

export interface ProjectFunnelResponse {
  summary: Record<ProjectFunnelStageKey, ProjectFunnelStageData>;
  cohorts: ProjectFunnelCohort[];
  monthlyActivity: ProjectMonthlyActivity[];
  stageDistribution: ProjectFunnelStageGroup[];
  drillDown: ProjectFunnelDrillDown;
  medianDays: ProjectFunnelMedianDays;
  generatedAt: string;
}

const CANCELLED_STAGE_ID = "68229433";
const ON_HOLD_STAGE_ID = "20440344";

/**
 * Stage priority from DEAL_STAGE_MAP / STAGE_PRIORITY.
 * Used to infer completed milestones from the deal's current pipeline stage
 * when date fields are missing.
 */
const STAGE_PRIORITY_MAP: Record<string, number> = {
  "20461935": 0,  // Project Rejected - Needs Review
  "20461936": 1,  // Site Survey
  "20461937": 2,  // Design & Engineering
  "20461938": 3,  // Permitting & Interconnection
  "71052436": 4,  // RTB - Blocked
  "22580871": 5,  // Ready To Build
  "20440342": 6,  // Construction
  "22580872": 7,  // Inspection
  "20461940": 8,  // Permission To Operate
  "24743347": 9,  // Close Out
  "20440343": 10, // Project Complete
  "68229433": 11, // Cancelled
  "20440344": 12, // On Hold
};

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toDrillDown(
  p: Project,
  daysWaiting: number,
  status: string | null
): ProjectFunnelDrillDownDeal {
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

function emptyStage(): ProjectFunnelStageData {
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
  stage: ProjectFunnelStageData,
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

function emptySummary(): Record<ProjectFunnelStageKey, ProjectFunnelStageData> {
  return {
    salesClosed: emptyStage(),
    surveyScheduled: emptyStage(),
    surveyDone: emptyStage(),
    daSent: emptyStage(),
    daApproved: emptyStage(),
    designCompleted: emptyStage(),
    permitsSubmitted: emptyStage(),
    permitsIssued: emptyStage(),
    constructionScheduled: emptyStage(),
    constructionComplete: emptyStage(),
    inspectionPassed: emptyStage(),
    ptoGranted: emptyStage(),
  };
}

function emptyCohort(month: string): ProjectFunnelCohort {
  return { month, ...emptySummary() };
}

/**
 * Resolve milestone flags using three layers:
 *   1. Stage-based floor — the deal's current pipeline stage implies certain
 *      milestones are done even when date fields are missing.
 *   2. Date-based detection — milestone date exists.
 *   3. Implied progression — later milestones cascade to earlier ones.
 *
 * Stage → milestone mapping (RTB-Blocked does NOT imply permits submitted):
 *   D&E (≥2)           → survey
 *   P&I (≥3)           → survey, DA sent, DA approved, design complete
 *   RTB-Blocked (4)    → same as P&I (no permit assumption)
 *   RTB (≥5)           → + permits submitted, permits issued
 *   Construction (≥6)  → + construction scheduled
 *   Inspection (≥7)    → + construction complete
 *   PTO (≥8)           → + inspection passed
 *   Close Out (≥9)     → + PTO granted
 *   Project Complete   → all milestones
 */
function resolveMilestones(p: Project) {
  const sp = STAGE_PRIORITY_MAP[p.stageId ?? ""] ?? 0;

  // Stage-based floor: what must be true given the deal's current stage
  const stageSurvey = sp >= 2;
  const stageDaSent = sp >= 3;
  const stageDaApproved = sp >= 3;
  const stageDesignComplete = sp >= 3;
  // RTB-Blocked (4) does NOT imply permits — jump to 5
  const stagePermitSubmit = sp >= 5;
  const stagePermitIssued = sp >= 5;
  const stageConstructionScheduled = sp >= 6;
  const stageConstructionComplete = sp >= 7;
  const stageInspectionPassed = sp >= 8;
  const stagePtoGranted = sp >= 9;

  // Date-based + implied progression chain (later dates cascade to earlier)
  const hasPtoGranted = stagePtoGranted || !!p.ptoGrantedDate;
  const hasInspectionPassed = hasPtoGranted || stageInspectionPassed || !!p.inspectionPassDate;
  const hasConstructionComplete = hasInspectionPassed || stageConstructionComplete || !!p.constructionCompleteDate;
  const hasConstructionScheduled = hasConstructionComplete || stageConstructionScheduled || !!p.constructionScheduleDate;
  const hasPermitIssued = hasConstructionScheduled || stagePermitIssued || !!p.permitIssueDate;
  const hasPermitSubmit = hasPermitIssued || stagePermitSubmit || !!p.permitSubmitDate;
  const hasDesignComplete = hasPermitSubmit || stageDesignComplete || !!p.designCompletionDate;
  const hasDaApproved = hasDesignComplete || stageDaApproved || !!p.designApprovalDate;
  const hasDaSent = hasDaApproved || stageDaSent || !!p.designApprovalSentDate;
  const hasSurvey = hasDaSent || stageSurvey || !!p.siteSurveyCompletionDate;
  const hasSurveyScheduled = hasSurvey || !!p.siteSurveyScheduleDate || p.isSiteSurveyScheduled;

  return {
    hasSurveyScheduled,
    hasSurvey,
    hasDaSent,
    hasDaApproved,
    hasDesignComplete,
    hasPermitSubmit,
    hasPermitIssued,
    hasConstructionScheduled,
    hasConstructionComplete,
    hasInspectionPassed,
    hasPtoGranted,
  };
}

export function buildProjectFunnelData(
  projects: Project[],
  months: number,
  locations?: string[]
): ProjectFunnelResponse {
  const now = new Date();
  const cutoff = new Date(now.getFullYear(), now.getMonth() - months, now.getDate());

  const locSet = locations && locations.length > 0 ? new Set(locations) : null;
  function matchesLocation(p: Project): boolean {
    if (!locSet) return true;
    const canonical = normalizeLocation(p.pbLocation);
    return canonical != null && locSet.has(canonical);
  }

  const filtered = projects.filter((p) => {
    if (!p.closeDate) return false;
    if (p.stageId === ON_HOLD_STAGE_ID) return false;
    if (new Date(p.closeDate + "T12:00:00") < cutoff) return false;
    if (!matchesLocation(p)) return false;
    return true;
  });

  const summary = emptySummary();
  const cohortMap = new Map<string, ProjectFunnelCohort>();

  // Median-days accumulators
  const dClosedToSurveyScheduled: number[] = [];
  const dSurveyScheduledToComplete: number[] = [];
  const dSurveyToDaSent: number[] = [];
  const dDaSentToApproved: number[] = [];
  const dApprovedToDesignComplete: number[] = [];
  const dDesignCompleteToPermitSubmit: number[] = [];
  const dPermitSubmitToIssued: number[] = [];
  const dPermitIssuedToConstructionScheduled: number[] = [];
  const dConstructionScheduledToComplete: number[] = [];
  const dConstructionCompleteToInspection: number[] = [];
  const dInspectionToPto: number[] = [];

  for (const p of filtered) {
    const cancelled = p.stageId === CANCELLED_STAGE_ID;
    const amt = p.amount || 0;
    const mk = monthKey(p.closeDate!);

    if (!cohortMap.has(mk)) cohortMap.set(mk, emptyCohort(mk));
    const cohort = cohortMap.get(mk)!;

    const m = resolveMilestones(p);

    addToStage(summary.salesClosed, amt, cancelled);
    addToStage(cohort.salesClosed, amt, cancelled);

    if (m.hasSurveyScheduled) {
      addToStage(summary.surveyScheduled, amt, cancelled);
      addToStage(cohort.surveyScheduled, amt, cancelled);
      if (!cancelled && p.siteSurveyScheduleDate)
        dClosedToSurveyScheduled.push(daysBetween(p.closeDate!, p.siteSurveyScheduleDate));
    }
    if (m.hasSurvey) {
      addToStage(summary.surveyDone, amt, cancelled);
      addToStage(cohort.surveyDone, amt, cancelled);
      if (!cancelled && p.siteSurveyScheduleDate && p.siteSurveyCompletionDate)
        dSurveyScheduledToComplete.push(daysBetween(p.siteSurveyScheduleDate, p.siteSurveyCompletionDate));
    }
    if (m.hasDaSent) {
      addToStage(summary.daSent, amt, cancelled);
      addToStage(cohort.daSent, amt, cancelled);
      if (!cancelled && p.siteSurveyCompletionDate && p.designApprovalSentDate)
        dSurveyToDaSent.push(daysBetween(p.siteSurveyCompletionDate, p.designApprovalSentDate));
    }
    if (m.hasDaApproved) {
      addToStage(summary.daApproved, amt, cancelled);
      addToStage(cohort.daApproved, amt, cancelled);
      if (!cancelled && p.designApprovalSentDate && p.designApprovalDate)
        dDaSentToApproved.push(daysBetween(p.designApprovalSentDate, p.designApprovalDate));
    }
    if (m.hasDesignComplete) {
      addToStage(summary.designCompleted, amt, cancelled);
      addToStage(cohort.designCompleted, amt, cancelled);
      if (!cancelled && p.designApprovalDate && p.designCompletionDate)
        dApprovedToDesignComplete.push(daysBetween(p.designApprovalDate, p.designCompletionDate));
    }
    if (m.hasPermitSubmit) {
      addToStage(summary.permitsSubmitted, amt, cancelled);
      addToStage(cohort.permitsSubmitted, amt, cancelled);
      if (!cancelled && p.designCompletionDate && p.permitSubmitDate)
        dDesignCompleteToPermitSubmit.push(daysBetween(p.designCompletionDate, p.permitSubmitDate));
    }
    if (m.hasPermitIssued) {
      addToStage(summary.permitsIssued, amt, cancelled);
      addToStage(cohort.permitsIssued, amt, cancelled);
      if (!cancelled && p.permitSubmitDate && p.permitIssueDate)
        dPermitSubmitToIssued.push(daysBetween(p.permitSubmitDate, p.permitIssueDate));
    }
    if (m.hasConstructionScheduled) {
      addToStage(summary.constructionScheduled, amt, cancelled);
      addToStage(cohort.constructionScheduled, amt, cancelled);
      if (!cancelled && p.permitIssueDate && p.constructionScheduleDate)
        dPermitIssuedToConstructionScheduled.push(daysBetween(p.permitIssueDate, p.constructionScheduleDate));
    }
    if (m.hasConstructionComplete) {
      addToStage(summary.constructionComplete, amt, cancelled);
      addToStage(cohort.constructionComplete, amt, cancelled);
      if (!cancelled && p.constructionScheduleDate && p.constructionCompleteDate)
        dConstructionScheduledToComplete.push(daysBetween(p.constructionScheduleDate, p.constructionCompleteDate));
    }
    if (m.hasInspectionPassed) {
      addToStage(summary.inspectionPassed, amt, cancelled);
      addToStage(cohort.inspectionPassed, amt, cancelled);
      if (!cancelled && p.constructionCompleteDate && p.inspectionPassDate)
        dConstructionCompleteToInspection.push(daysBetween(p.constructionCompleteDate, p.inspectionPassDate));
    }
    if (m.hasPtoGranted) {
      addToStage(summary.ptoGranted, amt, cancelled);
      addToStage(cohort.ptoGranted, amt, cancelled);
      if (!cancelled && p.inspectionPassDate && p.ptoGrantedDate)
        dInspectionToPto.push(daysBetween(p.inspectionPassDate, p.ptoGrantedDate));
    }
  }

  const cohorts = [...cohortMap.values()].sort((a, b) => b.month.localeCompare(a.month));

  // Activity-based counts: bin milestones by the month they happened
  const activityMap = new Map<string, ProjectMonthlyActivity>();
  function ensureActivity(mk: string): ProjectMonthlyActivity {
    if (!activityMap.has(mk)) {
      activityMap.set(mk, {
        month: mk,
        surveysScheduled: 0,
        surveysCompleted: 0,
        dasSent: 0,
        dasApproved: 0,
        dasApprovedAmount: 0,
        designsCompleted: 0,
        permitsSubmitted: 0,
        permitsIssued: 0,
        constructionsScheduled: 0,
        constructionsComplete: 0,
        constructionsCompleteAmount: 0,
        inspectionsPassed: 0,
        ptosGranted: 0,
        ptosGrantedAmount: 0,
      });
    }
    return activityMap.get(mk)!;
  }

  const dateMilestones: Array<{
    field: keyof Project;
    activityKey: keyof ProjectMonthlyActivity;
    amountKey?: keyof ProjectMonthlyActivity;
  }> = [
    { field: "siteSurveyScheduleDate", activityKey: "surveysScheduled" },
    { field: "siteSurveyCompletionDate", activityKey: "surveysCompleted" },
    { field: "designApprovalSentDate", activityKey: "dasSent" },
    { field: "designApprovalDate", activityKey: "dasApproved", amountKey: "dasApprovedAmount" },
    { field: "designCompletionDate", activityKey: "designsCompleted" },
    { field: "permitSubmitDate", activityKey: "permitsSubmitted" },
    { field: "permitIssueDate", activityKey: "permitsIssued" },
    { field: "constructionScheduleDate", activityKey: "constructionsScheduled" },
    { field: "constructionCompleteDate", activityKey: "constructionsComplete", amountKey: "constructionsCompleteAmount" },
    { field: "inspectionPassDate", activityKey: "inspectionsPassed" },
    { field: "ptoGrantedDate", activityKey: "ptosGranted", amountKey: "ptosGrantedAmount" },
  ];

  for (const p of projects) {
    if (!matchesLocation(p)) continue;
    for (const { field, activityKey, amountKey } of dateMilestones) {
      const dateVal = p[field] as string | null;
      if (dateVal) {
        const d = new Date(dateVal + "T12:00:00");
        if (d >= cutoff) {
          const act = ensureActivity(monthKey(dateVal));
          (act[activityKey] as number)++;
          if (amountKey) (act[amountKey] as number) += p.amount || 0;
        }
      }
    }
  }

  const monthlyActivity = [...activityMap.values()].sort((a, b) => b.month.localeCompare(a.month));

  // Stage distribution — sorted by pipeline order (STAGE_PRIORITY_MAP)
  const stageMap = new Map<string, ProjectFunnelStageGroup>();
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
    (a, b) => (STAGE_PRIORITY_MAP[a.stageId] ?? 99) - (STAGE_PRIORITY_MAP[b.stageId] ?? 99)
  );

  // Drill-down
  const today = todayStr();
  const drillDown: ProjectFunnelDrillDown = {
    awaitingSurveySchedule: [],
    awaitingSurvey: [],
    awaitingDaSend: [],
    awaitingApproval: [],
    awaitingDesignComplete: [],
    awaitingPermitSubmit: [],
    awaitingPermitIssue: [],
    awaitingConstructionSchedule: [],
    awaitingConstructionComplete: [],
    awaitingInspection: [],
    awaitingPto: [],
    awaitingCloseOut: [],
  };

  for (const p of filtered) {
    if (p.stageId === CANCELLED_STAGE_ID) continue;
    const m = resolveMilestones(p);

    if (!m.hasSurveyScheduled) {
      drillDown.awaitingSurveySchedule.push(
        toDrillDown(p, daysBetween(p.closeDate!, today), p.siteSurveyStatus ?? null)
      );
    } else if (!m.hasSurvey) {
      const waitSince = p.siteSurveyScheduleDate || p.closeDate!;
      drillDown.awaitingSurvey.push(
        toDrillDown(p, daysBetween(waitSince, today), p.siteSurveyStatus ?? null)
      );
    } else if (!m.hasDaSent) {
      const waitSince = p.siteSurveyCompletionDate || p.closeDate!;
      drillDown.awaitingDaSend.push(
        toDrillDown(p, daysBetween(waitSince, today), p.designStatus ?? null)
      );
    } else if (!m.hasDaApproved) {
      const waitSince = p.designApprovalSentDate || p.closeDate!;
      drillDown.awaitingApproval.push(
        toDrillDown(p, daysBetween(waitSince, today), p.layoutStatus ?? null)
      );
    } else if (!m.hasDesignComplete) {
      const waitSince = p.designApprovalDate || p.closeDate!;
      drillDown.awaitingDesignComplete.push(
        toDrillDown(p, daysBetween(waitSince, today), p.designStatus ?? null)
      );
    } else if (!m.hasPermitSubmit) {
      const waitSince = p.designCompletionDate || p.closeDate!;
      drillDown.awaitingPermitSubmit.push(
        toDrillDown(p, daysBetween(waitSince, today), p.permittingStatus ?? null)
      );
    } else if (!m.hasPermitIssued) {
      const waitSince = p.permitSubmitDate || p.closeDate!;
      drillDown.awaitingPermitIssue.push(
        toDrillDown(p, daysBetween(waitSince, today), p.permittingStatus ?? null)
      );
    } else if (!m.hasConstructionScheduled) {
      const waitSince = p.permitIssueDate || p.closeDate!;
      drillDown.awaitingConstructionSchedule.push(
        toDrillDown(p, daysBetween(waitSince, today), p.constructionStatus ?? null)
      );
    } else if (!m.hasConstructionComplete) {
      const waitSince = p.constructionScheduleDate || p.closeDate!;
      drillDown.awaitingConstructionComplete.push(
        toDrillDown(p, daysBetween(waitSince, today), p.constructionStatus ?? null)
      );
    } else if (!m.hasInspectionPassed) {
      const waitSince = p.constructionCompleteDate || p.closeDate!;
      drillDown.awaitingInspection.push(
        toDrillDown(p, daysBetween(waitSince, today), p.finalInspectionStatus ?? null)
      );
    } else if (!m.hasPtoGranted) {
      const waitSince = p.inspectionPassDate || p.closeDate!;
      drillDown.awaitingPto.push(
        toDrillDown(p, daysBetween(waitSince, today), p.ptoStatus ?? null)
      );
    } else {
      // PTO granted but not yet in Close Out or Project Complete
      const sp = STAGE_PRIORITY_MAP[p.stageId ?? ""] ?? 0;
      if (sp < 9) {
        const waitSince = p.ptoGrantedDate || p.closeDate!;
        drillDown.awaitingCloseOut.push(
          toDrillDown(p, daysBetween(waitSince, today), null)
        );
      }
    }
  }

  const byWaitDesc = (a: ProjectFunnelDrillDownDeal, b: ProjectFunnelDrillDownDeal) =>
    b.daysWaiting - a.daysWaiting;
  drillDown.awaitingSurveySchedule.sort(byWaitDesc);
  drillDown.awaitingSurvey.sort(byWaitDesc);
  drillDown.awaitingDaSend.sort(byWaitDesc);
  drillDown.awaitingApproval.sort(byWaitDesc);
  drillDown.awaitingDesignComplete.sort(byWaitDesc);
  drillDown.awaitingPermitSubmit.sort(byWaitDesc);
  drillDown.awaitingPermitIssue.sort(byWaitDesc);
  drillDown.awaitingConstructionSchedule.sort(byWaitDesc);
  drillDown.awaitingConstructionComplete.sort(byWaitDesc);
  drillDown.awaitingInspection.sort(byWaitDesc);
  drillDown.awaitingPto.sort(byWaitDesc);
  drillDown.awaitingCloseOut.sort(byWaitDesc);

  return {
    summary,
    cohorts,
    monthlyActivity,
    stageDistribution,
    drillDown,
    medianDays: {
      closedToSurveyScheduled: median(dClosedToSurveyScheduled),
      surveyScheduledToComplete: median(dSurveyScheduledToComplete),
      surveyToDaSent: median(dSurveyToDaSent),
      daSentToApproved: median(dDaSentToApproved),
      approvedToDesignComplete: median(dApprovedToDesignComplete),
      designCompleteToPermitSubmit: median(dDesignCompleteToPermitSubmit),
      permitSubmitToIssued: median(dPermitSubmitToIssued),
      permitIssuedToConstructionScheduled: median(dPermitIssuedToConstructionScheduled),
      constructionScheduledToComplete: median(dConstructionScheduledToComplete),
      constructionCompleteToInspection: median(dConstructionCompleteToInspection),
      inspectionToPto: median(dInspectionToPto),
    },
    generatedAt: new Date().toISOString(),
  };
}
