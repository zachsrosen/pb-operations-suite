import { NextRequest, NextResponse } from "next/server";
import { getRecentActivities, ActivityType, UserRole } from "@/lib/db";

/**
 * GET /api/it/activity-export
 *
 * Read-only activity log export for the IT team's user-activity aggregation.
 * Protected by IT_EXPORT_TOKEN via middleware (separate from API_SECRET_TOKEN
 * so IT's key can be rotated independently and cannot write BOM/Zuper data).
 *
 * Query params:
 * - since: ISO date string (required-ish for incremental pulls)
 * - until: ISO date string (optional upper bound)
 * - type: repeatable activity type filter
 * - types: comma-separated activity types (alternate format)
 * - role: repeatable user-role filter
 * - email: partial user email match
 * - userId: exact user ID
 * - entityType: filter by entity type
 * - limit: page size (default 1000, max 10000)
 * - offset: pagination offset
 * - format: json (default) | ndjson | csv
 */
export async function GET(request: NextRequest) {
  const isAuthed = request.headers.get("x-it-export-authenticated") === "1";
  if (!isAuthed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);

    const limit = Math.min(parseInt(searchParams.get("limit") || "1000", 10) || 1000, 10000);
    const offset = Math.max(parseInt(searchParams.get("offset") || "0", 10) || 0, 0);

    const validTypes = new Set(Object.keys(ActivityType));
    const repeatedTypes = searchParams.getAll("type");
    const csvTypes = (searchParams.get("types") || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const types = Array.from(new Set([...repeatedTypes, ...csvTypes])).filter(
      (t): t is ActivityType => validTypes.has(t)
    );

    const validRoles = new Set(Object.keys(UserRole));
    const roles = Array.from(new Set(searchParams.getAll("role"))).filter(
      (r): r is UserRole => validRoles.has(r)
    );

    const sinceParam = searchParams.get("since");
    const untilParam = searchParams.get("until");
    let since: Date | undefined;
    if (sinceParam) {
      const d = new Date(sinceParam);
      if (!isNaN(d.getTime())) since = d;
    }
    let until: Date | undefined;
    if (untilParam) {
      const d = new Date(untilParam);
      if (!isNaN(d.getTime())) until = d;
    }

    const userId = searchParams.get("userId") || undefined;
    const entityType = searchParams.get("entityType") || undefined;
    const email = searchParams.get("email") || undefined;
    const format = (searchParams.get("format") || "json").toLowerCase();

    const { activities, total } = await getRecentActivities({
      limit,
      offset,
      types: types.length > 0 ? types : undefined,
      userRoles: roles.length > 0 ? roles : undefined,
      userId,
      entityType,
      since,
      userEmail: email,
    });

    const rows = until
      ? activities.filter((a) => a.createdAt.getTime() <= until!.getTime())
      : activities;

    const normalized = rows.map((a) => ({
      id: a.id,
      type: a.type,
      description: a.description,
      createdAt: a.createdAt.toISOString(),
      userId: a.userId,
      userEmail: a.userEmail || a.user?.email || null,
      userName: a.user?.name || null,
      userRoles: a.user?.roles || [],
      entityType: a.entityType,
      entityId: a.entityId,
      ipAddress: a.ipAddress,
      userAgent: a.userAgent,
      metadata: a.metadata,
    }));

    if (format === "ndjson") {
      const body = normalized.map((r) => JSON.stringify(r)).join("\n");
      return new NextResponse(body, {
        status: 200,
        headers: {
          "content-type": "application/x-ndjson; charset=utf-8",
          "x-total-count": String(total),
        },
      });
    }

    if (format === "csv") {
      const cols = [
        "id",
        "createdAt",
        "type",
        "userEmail",
        "userName",
        "userRoles",
        "entityType",
        "entityId",
        "description",
        "ipAddress",
        "userAgent",
        "metadata",
      ];
      const esc = (v: unknown): string => {
        if (v == null) return "";
        const s = typeof v === "string" ? v : JSON.stringify(v);
        return `"${s.replace(/"/g, '""')}"`;
      };
      const lines = [cols.join(",")];
      for (const r of normalized) {
        lines.push(
          cols
            .map((c) => esc((r as Record<string, unknown>)[c]))
            .join(",")
        );
      }
      return new NextResponse(lines.join("\n"), {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "x-total-count": String(total),
        },
      });
    }

    return NextResponse.json({
      activities: normalized,
      total,
      limit,
      offset,
      nextOffset: offset + normalized.length < total ? offset + normalized.length : null,
    });
  } catch (error) {
    console.error("[IT activity-export] Export failed:", error);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
