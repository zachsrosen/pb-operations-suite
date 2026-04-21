import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/auth";
import {
  logActivity,
  logDashboardView,
  logProjectView,
  logSearch,
  logFilterChange,
  logDataExport,
  ActivityType,
  prisma,
  getUserByEmail,
} from "@/lib/db";
import { getOrCreateAuditSession, runSessionAnomalyChecks } from "@/lib/audit/session";
import { getActivityRiskLevel } from "@/lib/audit/detect";
import type { AuditSessionLike } from "@/lib/audit/session";

function getActionActivityType(action: string): string {
  switch (action) {
    case "page_view": return "DASHBOARD_VIEWED";
    case "dashboard_view": return "DASHBOARD_VIEWED";
    case "project_view": return "PROJECT_VIEWED";
    case "search": return "PROJECT_SEARCHED";
    case "filter": return "DASHBOARD_FILTERED";
    case "export": return "DATA_EXPORTED";
    case "feature_used": return "FEATURE_USED";
    default: return "FEATURE_USED";
  }
}

/**
 * POST /api/activity/log
 *
 * Endpoint for frontend to log user activities.
 * Automatically captures IP, user agent, and authenticated user.
 */
export async function POST(request: NextRequest) {
  try {
    const headersList = await headers();
    const ipAddress = headersList.get("x-forwarded-for")?.split(",")[0] ||
                      headersList.get("x-real-ip") ||
                      "unknown";
    const userAgent = headersList.get("user-agent") || undefined;

    // Get authenticated user — require auth to prevent audit log pollution
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const userEmail = session.user.email;
    const userName = session.user.name || undefined;

    // Resolve userId for audit (Amendment A3)
    const currentUser = await getUserByEmail(userEmail);
    const userId = currentUser?.id || null;
    const userIdForLog = userId ?? undefined;

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
    }

    const { action, ...data } = body;

    // Resolve audit session
    const xClientType = headersList.get("x-client-type");
    let auditSessionId: string | undefined;
    let auditSessionData: AuditSessionLike | null = null;
    let activityRiskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" = "LOW";
    let activityRiskScore = 1;

    try {
      const auditResult = await getOrCreateAuditSession({
        userEmail: userEmail || null,
        userName: userName || null,
        userId,
        ipAddress,
        userAgent: userAgent || null,
        xClientType,
        hasValidSession: !!session?.user?.email,
        deviceFingerprint: body?.deviceFingerprint || null,
        fingerprintVersion: body?.deviceFingerprint ? 1 : null,
      }, prisma);
      auditSessionId = auditResult.sessionId || undefined;
      auditSessionData = auditResult.sessionData ?? null;
    } catch (e) {
      console.error("Audit session resolution failed:", e);
    }

    // Compute risk level
    const mappedType = action === "custom" ? data.type : getActionActivityType(action);
    const risk = getActivityRiskLevel(mappedType || "FEATURE_USED");
    activityRiskLevel = risk.riskLevel as typeof activityRiskLevel;
    activityRiskScore = risk.riskScore;

    // Handle different action types
    switch (action) {
      case "page_view":
        await logActivity({
          type: "DASHBOARD_VIEWED",
          description: `Viewed page ${data.path || "unknown"}`,
          userId: userIdForLog,
          userEmail,
          userName,
          entityType: "page",
          entityId: data.path,
          entityName: data.title || data.path,
          metadata: {
            source: data.source,
            title: data.title,
          },
          ipAddress,
          userAgent,
          sessionId: data.sessionId,
          auditSessionId,
          riskLevel: activityRiskLevel,
          riskScore: activityRiskScore,
        });
        break;

      case "dashboard_view":
        await logDashboardView({
          dashboard: data.dashboard,
          userId: userIdForLog,
          userEmail,
          userName,
          filters: data.filters,
          projectCount: data.projectCount,
          pbLocation: data.pbLocation,
          ipAddress,
          userAgent,
          sessionId: data.sessionId,
          auditSessionId,
          riskLevel: activityRiskLevel,
          riskScore: activityRiskScore,
        });
        break;

      case "project_view":
        await logProjectView({
          projectId: data.projectId,
          projectName: data.projectName,
          userId: userIdForLog,
          userEmail,
          userName,
          source: data.source,
          ipAddress,
          userAgent,
          sessionId: data.sessionId,
          auditSessionId,
          riskLevel: activityRiskLevel,
          riskScore: activityRiskScore,
        });
        break;

      case "search":
        await logSearch({
          searchTerm: data.searchTerm,
          resultCount: data.resultCount,
          dashboard: data.dashboard,
          userId: userIdForLog,
          userEmail,
          userName,
          ipAddress,
          userAgent,
          sessionId: data.sessionId,
          auditSessionId,
          riskLevel: activityRiskLevel,
          riskScore: activityRiskScore,
        });
        break;

      case "filter":
        await logFilterChange({
          dashboard: data.dashboard,
          filters: data.filters,
          userId: userIdForLog,
          userEmail,
          userName,
          sessionId: data.sessionId,
          auditSessionId,
          riskLevel: activityRiskLevel,
          riskScore: activityRiskScore,
        });
        break;

      case "export":
        await logDataExport({
          exportType: data.exportType,
          dashboard: data.dashboard,
          recordCount: data.recordCount,
          userId: userIdForLog,
          userEmail,
          userName,
          filters: data.filters,
          ipAddress,
          userAgent,
          auditSessionId,
          riskLevel: activityRiskLevel,
          riskScore: activityRiskScore,
        });
        break;

      case "feature_used":
        await logActivity({
          type: "FEATURE_USED",
          description: data.description || `Used feature: ${data.feature}`,
          userId: userIdForLog,
          userEmail,
          userName,
          entityType: "feature",
          entityId: data.feature,
          entityName: data.feature,
          metadata: data.metadata,
          ipAddress,
          userAgent,
          sessionId: data.sessionId,
          auditSessionId,
          riskLevel: activityRiskLevel,
          riskScore: activityRiskScore,
        });
        break;

      case "custom":
        // Allow custom activity types
        if (!data.type || !Object.keys(ActivityType).includes(data.type)) {
          return NextResponse.json(
            { error: "Invalid activity type" },
            { status: 400 }
          );
        }
        await logActivity({
          type: data.type as ActivityType,
          description: data.description,
          userId: userIdForLog,
          userEmail,
          userName,
          entityType: data.entityType,
          entityId: data.entityId,
          entityName: data.entityName,
          pbLocation: data.pbLocation,
          metadata: data.metadata,
          ipAddress,
          userAgent,
          requestPath: data.requestPath,
          sessionId: data.sessionId,
          auditSessionId,
          riskLevel: activityRiskLevel,
          riskScore: activityRiskScore,
        });
        break;

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }

    // Amendment A4: Run anomaly checks on EVERY activity (both new and reused sessions).
    // Fire-and-forget — don't block the response.
    if (auditSessionData && prisma) {
      runSessionAnomalyChecks(auditSessionData, activityRiskScore, prisma).catch(
        (e: unknown) => console.error("Anomaly check failed:", e)
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to log activity:", error);
    return NextResponse.json(
      { error: "Failed to log activity" },
      { status: 500 }
    );
  }
}
