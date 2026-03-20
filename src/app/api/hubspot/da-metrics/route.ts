import { NextRequest, NextResponse } from "next/server";
import { fetchAllProjects, type Project } from "@/lib/hubspot";
import { appCache, CACHE_KEYS } from "@/lib/cache";

// DA statuses that indicate "sent but not yet approved"
const PENDING_DA_STATUSES = [
  "Sent For Approval",
  "Resent For Approval",
  "Review In Progress",
  "Sent to Customer",
  "Pending Review",
  "Ready For Review",
];

const APPROVED_STATUSES = ["Approved", "DA Approved", "da_approved", "approved"];

function isApproved(status: string | null): boolean {
  if (!status) return false;
  return APPROVED_STATUSES.some((s) => s.toLowerCase() === status.toLowerCase());
}

function isPendingDA(status: string | null): boolean {
  if (!status) return false;
  return PENDING_DA_STATUSES.some((s) => s.toLowerCase() === status.toLowerCase());
}

interface DealDetail {
  dealId: string;
  projectNumber: string;
  name: string;
  url: string;
  pbLocation: string;
  designLead: string;
  siteSurveyor: string;
  designApprovalSentDate: string | null;
  designApprovalDate: string | null;
  siteSurveyScheduleDate: string | null;
  siteSurveyCompletionDate: string | null;
  turnaroundDays: number | null;
  daRevisionCounter: number | null;
}

interface GroupMetrics {
  count: number;
  avgTurnaround: number | null;
  avgRevisions: number | null;
  firstTryRate: number | null;
  totalRevisions: number;
  deals: DealDetail[];
}

interface PendingDeal {
  dealId: string;
  projectNumber: string;
  name: string;
  url: string;
  pbLocation: string;
  designLead: string;
  siteSurveyor: string;
  layoutStatus: string;
  designApprovalSentDate: string | null;
  siteSurveyScheduleDate: string | null;
  siteSurveyCompletionDate: string | null;
  daysWaiting: number;
}

function buildDealDetail(p: Project): DealDetail {
  const raw = p.daTurnaroundTime as number | null | undefined;
  const turnaroundDays =
    raw !== undefined && raw !== null && !isNaN(raw) && raw >= 0
      ? Math.round(raw * 10) / 10
      : null;
  return {
    dealId: String(p.id),
    projectNumber: p.projectNumber,
    name: p.name,
    url: p.url,
    pbLocation: p.pbLocation || "Unknown",
    designLead: p.designLead || "Unknown",
    siteSurveyor: p.siteSurveyor || "Unknown",
    designApprovalSentDate: p.designApprovalSentDate,
    designApprovalDate: p.designApprovalDate,
    siteSurveyScheduleDate: p.siteSurveyScheduleDate,
    siteSurveyCompletionDate: p.siteSurveyCompletionDate,
    turnaroundDays,
    daRevisionCounter: p.daRevisionCounter,
  };
}

function calculateGroupMetrics(projects: Project[]): GroupMetrics {
  const deals = projects.map(buildDealDetail);

  // Turnaround average
  const turnaroundValues = projects
    .map((p) => p.daTurnaroundTime as number | null | undefined)
    .filter((v): v is number => v !== null && v !== undefined && !isNaN(v) && v >= 0);
  const avgTurnaround =
    turnaroundValues.length > 0
      ? Math.round((turnaroundValues.reduce((s, v) => s + v, 0) / turnaroundValues.length) * 10) / 10
      : null;

  // Revision stats
  const revisionValues = projects
    .map((p) => p.daRevisionCounter)
    .filter((v): v is number => v !== null && v !== undefined && !isNaN(v) && v >= 0);
  const avgRevisions =
    revisionValues.length > 0
      ? Math.round((revisionValues.reduce((s, v) => s + v, 0) / revisionValues.length) * 10) / 10
      : null;
  const totalRevisions = revisionValues.reduce((s, v) => s + v, 0);
  const firstTryCount = revisionValues.filter((v) => v === 0).length;
  const firstTryRate =
    revisionValues.length > 0
      ? Math.round((firstTryCount / revisionValues.length) * 1000) / 10
      : null;

  return {
    count: projects.length,
    avgTurnaround,
    avgRevisions,
    firstTryRate,
    totalRevisions,
    deals,
  };
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const item of items) {
    const key = keyFn(item);
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }
  return groups;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const daysWindow = parseInt(searchParams.get("days") || "0") || 0;
    const forceRefresh = searchParams.get("refresh") === "true";

    const { data: allProjects, lastUpdated } = await appCache.getOrFetch<Project[]>(
      CACHE_KEYS.PROJECTS_ALL,
      () => fetchAllProjects({ activeOnly: false }),
      forceRefresh
    );

    let projects = allProjects || [];

    // Filter to projects with DA approved date in time window
    if (daysWindow > 0) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - daysWindow);
      const cutoffStr = cutoff.toISOString().split("T")[0];

      projects = projects.filter((p) => {
        if (!p.designApprovalDate) return false;
        return p.designApprovalDate >= cutoffStr;
      });
    } else {
      // All time — still require DA approved date
      projects = projects.filter((p) => !!p.designApprovalDate);
    }

    // Group by location
    const byLocationGroups = groupBy(projects, (p) => p.pbLocation || "Unknown");
    const byLocation: Record<string, GroupMetrics> = {};
    for (const [loc, locProjects] of Object.entries(byLocationGroups)) {
      if (loc === "Unknown") continue;
      byLocation[loc] = calculateGroupMetrics(locProjects);
    }

    // Group by designer
    const byDesignerGroups = groupBy(projects, (p) => p.designLead || "Unknown");
    const byDesigner: Record<string, GroupMetrics> = {};
    for (const [name, designerProjects] of Object.entries(byDesignerGroups)) {
      if (name === "Unknown" || !name) continue;
      byDesigner[name] = calculateGroupMetrics(designerProjects);
    }

    // Totals
    const totals = calculateGroupMetrics(projects);

    // Active DA pipeline — sent but not approved (from full project set)
    const now = new Date();
    const pendingDA: PendingDeal[] = (allProjects || [])
      .filter((p) => isPendingDA(p.layoutStatus) && !isApproved(p.layoutStatus))
      .map((p) => {
        const sentDate = p.designApprovalSentDate ? new Date(p.designApprovalSentDate) : null;
        const daysWaiting = sentDate
          ? Math.round((now.getTime() - sentDate.getTime()) / (1000 * 60 * 60 * 24))
          : 0;
        return {
          dealId: String(p.id),
          projectNumber: p.projectNumber,
          name: p.name,
          url: p.url,
          pbLocation: p.pbLocation || "Unknown",
          designLead: p.designLead || "Unknown",
          siteSurveyor: p.siteSurveyor || "Unknown",
          layoutStatus: p.layoutStatus || "Unknown",
          designApprovalSentDate: p.designApprovalSentDate,
          siteSurveyScheduleDate: p.siteSurveyScheduleDate,
          siteSurveyCompletionDate: p.siteSurveyCompletionDate,
          daysWaiting,
        };
      })
      .sort((a, b) => b.daysWaiting - a.daysWaiting);

    // Survey complete but DA not yet sent — the gap between survey and design
    const awaitingDA: (PendingDeal & { daysSinceSurvey: number })[] = (allProjects || [])
      .filter((p) => {
        // Survey is completed
        if (!p.isSiteSurveyCompleted || !p.siteSurveyCompletionDate) return false;
        // DA not sent yet (no sent date, and not approved)
        if (p.designApprovalSentDate) return false;
        if (isApproved(p.layoutStatus)) return false;
        // Still active (not closed/lost)
        if (!p.isActive) return false;
        return true;
      })
      .map((p) => {
        const surveyDate = new Date(p.siteSurveyCompletionDate!);
        const daysSinceSurvey = Math.round(
          (now.getTime() - surveyDate.getTime()) / (1000 * 60 * 60 * 24)
        );
        return {
          dealId: String(p.id),
          projectNumber: p.projectNumber,
          name: p.name,
          url: p.url,
          pbLocation: p.pbLocation || "Unknown",
          designLead: p.designLead || "Unassigned",
          siteSurveyor: p.siteSurveyor || "Unknown",
          layoutStatus: p.layoutStatus || "Not Started",
          designApprovalSentDate: null,
          siteSurveyScheduleDate: p.siteSurveyScheduleDate,
          siteSurveyCompletionDate: p.siteSurveyCompletionDate,
          daysWaiting: daysSinceSurvey,
          daysSinceSurvey,
        };
      })
      .sort((a, b) => b.daysSinceSurvey - a.daysSinceSurvey);

    return NextResponse.json({
      byLocation,
      byDesigner,
      totals,
      pendingDA,
      awaitingDA,
      daysWindow: daysWindow || "all",
      lastUpdated,
    });
  } catch (error) {
    console.error("DA Metrics API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch DA metrics" },
      { status: 500 }
    );
  }
}
