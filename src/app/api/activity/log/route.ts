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
} from "@/lib/db";

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

    // Get authenticated user
    const session = await auth();
    const userEmail = session?.user?.email || undefined;
    const userName = session?.user?.name || undefined;

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
    }

    const { action, ...data } = body;

    // Handle different action types
    switch (action) {
      case "dashboard_view":
        await logDashboardView({
          dashboard: data.dashboard,
          userEmail,
          userName,
          filters: data.filters,
          projectCount: data.projectCount,
          pbLocation: data.pbLocation,
          ipAddress,
          userAgent,
          sessionId: data.sessionId,
        });
        break;

      case "project_view":
        await logProjectView({
          projectId: data.projectId,
          projectName: data.projectName,
          userEmail,
          userName,
          source: data.source,
          ipAddress,
          userAgent,
          sessionId: data.sessionId,
        });
        break;

      case "search":
        await logSearch({
          searchTerm: data.searchTerm,
          resultCount: data.resultCount,
          dashboard: data.dashboard,
          userEmail,
          userName,
          ipAddress,
          userAgent,
          sessionId: data.sessionId,
        });
        break;

      case "filter":
        await logFilterChange({
          dashboard: data.dashboard,
          filters: data.filters,
          userEmail,
          userName,
          sessionId: data.sessionId,
        });
        break;

      case "export":
        await logDataExport({
          exportType: data.exportType,
          dashboard: data.dashboard,
          recordCount: data.recordCount,
          userEmail,
          userName,
          filters: data.filters,
          ipAddress,
          userAgent,
        });
        break;

      case "feature_used":
        await logActivity({
          type: "FEATURE_USED",
          description: data.description || `Used feature: ${data.feature}`,
          userEmail,
          userName,
          entityType: "feature",
          entityId: data.feature,
          entityName: data.feature,
          metadata: data.metadata,
          ipAddress,
          userAgent,
          sessionId: data.sessionId,
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
        });
        break;

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
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
