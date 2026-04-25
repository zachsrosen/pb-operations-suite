import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

/**
 * GET /api/it/user-roster
 *
 * Current user directory for IT — roster, roles, capability booleans, and
 * recency-of-use signals. Snapshot view (not a log); intended for periodic
 * access reviews and offboarding audits.
 *
 * Protected by IT_EXPORT_TOKEN (scoped to /api/it/* in middleware).
 *
 * Query params:
 * - email: partial email match
 * - role: filter by role (repeat param to OR across roles)
 * - hasRoles: "1" only include users with at least one role assigned
 * - activeDays: integer — only include users whose lastLoginAt is within N days
 * - limit: default 500, max 5000 (full roster is typically small)
 * - offset: pagination offset
 * - format: json (default) | ndjson | csv
 */
export async function GET(request: NextRequest) {
  if (request.headers.get("x-it-export-authenticated") !== "1") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  try {
    const { searchParams } = new URL(request.url);

    const limit = Math.min(parseInt(searchParams.get("limit") || "500", 10) || 500, 5000);
    const offset = Math.max(parseInt(searchParams.get("offset") || "0", 10) || 0, 0);

    const where: Prisma.UserWhereInput = {};

    const email = searchParams.get("email") || undefined;
    if (email) where.email = { contains: email, mode: "insensitive" };

    const roles = searchParams.getAll("role").filter(Boolean);
    if (roles.length > 0) {
      where.roles = { hasSome: roles as Prisma.UserWhereInput["roles"] extends { hasSome?: infer R } ? R : never };
    }

    if (searchParams.get("hasRoles") === "1") {
      where.roles = { ...(where.roles as object), isEmpty: false } as Prisma.UserWhereInput["roles"];
    }

    const activeDaysParam = searchParams.get("activeDays");
    if (activeDaysParam) {
      const n = parseInt(activeDaysParam, 10);
      if (!isNaN(n) && n > 0) {
        const cutoff = new Date(Date.now() - n * 24 * 60 * 60 * 1000);
        where.lastLoginAt = { gte: cutoff };
      }
    }

    const format = (searchParams.get("format") || "json").toLowerCase();

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          name: true,
          image: true,
          roles: true,
          googleId: true,
          canScheduleSurveys: true,
          canScheduleInstalls: true,
          canSyncToZuper: true,
          canManageUsers: true,
          canManageAvailability: true,
          canManageAdders: true,
          extraAllowedRoutes: true,
          extraDeniedRoutes: true,
          allowedLocations: true,
          impersonatingUserId: true,
          hubspotOwnerId: true,
          createdAt: true,
          updatedAt: true,
          lastLoginAt: true,
        },
        orderBy: [{ lastLoginAt: "desc" }, { email: "asc" }],
        take: limit,
        skip: offset,
      }),
      prisma.user.count({ where }),
    ]);

    const now = Date.now();
    const normalized = users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      image: u.image,
      roles: u.roles,
      googleLinked: !!u.googleId,
      capabilities: {
        canScheduleSurveys: u.canScheduleSurveys,
        canScheduleInstalls: u.canScheduleInstalls,
        canSyncToZuper: u.canSyncToZuper,
        canManageUsers: u.canManageUsers,
        canManageAvailability: u.canManageAvailability,
        canManageAdders: u.canManageAdders,
      },
      extraAllowedRoutes: u.extraAllowedRoutes,
      extraDeniedRoutes: u.extraDeniedRoutes,
      allowedLocations: u.allowedLocations,
      isImpersonating: !!u.impersonatingUserId,
      impersonatingUserId: u.impersonatingUserId,
      hubspotOwnerId: u.hubspotOwnerId,
      createdAt: u.createdAt.toISOString(),
      updatedAt: u.updatedAt.toISOString(),
      lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
      daysSinceLastLogin: u.lastLoginAt
        ? Math.floor((now - u.lastLoginAt.getTime()) / (24 * 60 * 60 * 1000))
        : null,
    }));

    if (format === "ndjson") {
      return new NextResponse(
        normalized.map((r) => JSON.stringify(r)).join("\n"),
        {
          status: 200,
          headers: {
            "content-type": "application/x-ndjson; charset=utf-8",
            "x-total-count": String(total),
          },
        }
      );
    }

    if (format === "csv") {
      const cols = [
        "id",
        "email",
        "name",
        "roles",
        "googleLinked",
        "lastLoginAt",
        "daysSinceLastLogin",
        "createdAt",
        "canScheduleSurveys",
        "canScheduleInstalls",
        "canSyncToZuper",
        "canManageUsers",
        "canManageAvailability",
        "canManageAdders",
        "extraAllowedRoutes",
        "extraDeniedRoutes",
        "allowedLocations",
        "isImpersonating",
        "hubspotOwnerId",
      ];
      const esc = (v: unknown): string => {
        if (v == null) return "";
        const s = typeof v === "string" ? v : JSON.stringify(v);
        return `"${s.replace(/"/g, '""')}"`;
      };
      const lines = [cols.join(",")];
      for (const r of normalized) {
        const row: Record<string, unknown> = {
          id: r.id,
          email: r.email,
          name: r.name,
          roles: r.roles,
          googleLinked: r.googleLinked,
          lastLoginAt: r.lastLoginAt,
          daysSinceLastLogin: r.daysSinceLastLogin,
          createdAt: r.createdAt,
          canScheduleSurveys: r.capabilities.canScheduleSurveys,
          canScheduleInstalls: r.capabilities.canScheduleInstalls,
          canSyncToZuper: r.capabilities.canSyncToZuper,
          canManageUsers: r.capabilities.canManageUsers,
          canManageAvailability: r.capabilities.canManageAvailability,
          canManageAdders: r.capabilities.canManageAdders,
          extraAllowedRoutes: r.extraAllowedRoutes,
          extraDeniedRoutes: r.extraDeniedRoutes,
          allowedLocations: r.allowedLocations,
          isImpersonating: r.isImpersonating,
          hubspotOwnerId: r.hubspotOwnerId,
        };
        lines.push(cols.map((c) => esc(row[c])).join(","));
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
      users: normalized,
      total,
      limit,
      offset,
      nextOffset:
        offset + normalized.length < total ? offset + normalized.length : null,
    });
  } catch (error) {
    console.error("[IT user-roster] Export failed:", error);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
