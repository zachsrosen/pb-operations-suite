import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

/**
 * GET /api/it/audit-sessions
 *
 * Read-only audit-session export for the IT team. Complements
 * /api/it/activity-export by reporting session-level facts: who logged in,
 * from what client (BROWSER / CLAUDE_CODE / CODEX / API_CLIENT), IP/UA,
 * start/end timestamps, and risk signals.
 *
 * Protected by IT_EXPORT_TOKEN (scoped to /api/it/* in middleware).
 *
 * Query params:
 * - since: ISO date string — startedAt >= since
 * - until: ISO date string — startedAt <= until
 * - email: partial user email match (session.userEmail OR user.email)
 * - userId: exact user ID
 * - clientType: BROWSER | CLAUDE_CODE | CODEX | API_CLIENT | UNKNOWN
 * - environment: LOCAL | PREVIEW | PRODUCTION
 * - riskLevel: LOW | MEDIUM | HIGH | CRITICAL (repeat param to OR)
 * - activeOnly: "1" to only return sessions without endedAt
 * - limit: default 1000, max 10000
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

    const limit = Math.min(parseInt(searchParams.get("limit") || "1000", 10) || 1000, 10000);
    const offset = Math.max(parseInt(searchParams.get("offset") || "0", 10) || 0, 0);

    const where: Prisma.AuditSessionWhereInput = {};

    const sinceParam = searchParams.get("since");
    const untilParam = searchParams.get("until");
    if (sinceParam || untilParam) {
      const range: Prisma.DateTimeFilter = {};
      if (sinceParam) {
        const d = new Date(sinceParam);
        if (!isNaN(d.getTime())) range.gte = d;
      }
      if (untilParam) {
        const d = new Date(untilParam);
        if (!isNaN(d.getTime())) range.lte = d;
      }
      if (range.gte || range.lte) where.startedAt = range;
    }

    const email = searchParams.get("email") || undefined;
    if (email) {
      where.OR = [
        { userEmail: { contains: email, mode: "insensitive" } },
        { user: { email: { contains: email, mode: "insensitive" } } },
      ];
    }

    const userId = searchParams.get("userId") || undefined;
    if (userId) where.userId = userId;

    const validClientTypes = new Set([
      "BROWSER",
      "CLAUDE_CODE",
      "CODEX",
      "API_CLIENT",
      "UNKNOWN",
    ]);
    const clientType = searchParams.get("clientType");
    if (clientType && validClientTypes.has(clientType)) {
      where.clientType = clientType as Prisma.AuditSessionWhereInput["clientType"];
    }

    const validEnvironments = new Set(["LOCAL", "PREVIEW", "PRODUCTION"]);
    const environment = searchParams.get("environment");
    if (environment && validEnvironments.has(environment)) {
      where.environment = environment as Prisma.AuditSessionWhereInput["environment"];
    }

    const validRiskLevels = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
    const riskLevels = searchParams
      .getAll("riskLevel")
      .filter((r) => validRiskLevels.has(r));
    if (riskLevels.length > 0) {
      where.riskLevel = { in: riskLevels as Array<"LOW" | "MEDIUM" | "HIGH" | "CRITICAL"> };
    }

    if (searchParams.get("activeOnly") === "1") {
      where.endedAt = null;
    }

    const format = (searchParams.get("format") || "json").toLowerCase();

    const [sessions, total] = await Promise.all([
      prisma.auditSession.findMany({
        where,
        include: {
          user: { select: { name: true, email: true, roles: true } },
        },
        orderBy: { startedAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.auditSession.count({ where }),
    ]);

    const normalized = sessions.map((s) => ({
      id: s.id,
      userId: s.userId,
      userEmail: s.userEmail || s.user?.email || null,
      userName: s.userName || s.user?.name || null,
      userRoles: s.user?.roles || [],
      clientType: s.clientType,
      environment: s.environment,
      ipAddress: s.ipAddress,
      userAgent: s.userAgent,
      deviceFingerprint: s.deviceFingerprint,
      startedAt: s.startedAt.toISOString(),
      lastActiveAt: s.lastActiveAt.toISOString(),
      endedAt: s.endedAt ? s.endedAt.toISOString() : null,
      durationSec: s.endedAt
        ? Math.round((s.endedAt.getTime() - s.startedAt.getTime()) / 1000)
        : null,
      riskLevel: s.riskLevel,
      riskScore: s.riskScore,
      anomalyReasons: s.anomalyReasons,
      confidence: s.confidence,
      immediateAlertSentAt: s.immediateAlertSentAt
        ? s.immediateAlertSentAt.toISOString()
        : null,
      criticalAlertSentAt: s.criticalAlertSentAt
        ? s.criticalAlertSentAt.toISOString()
        : null,
      metadata: s.metadata,
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
        "startedAt",
        "lastActiveAt",
        "endedAt",
        "durationSec",
        "userEmail",
        "userName",
        "userRoles",
        "clientType",
        "environment",
        "ipAddress",
        "userAgent",
        "riskLevel",
        "riskScore",
        "anomalyReasons",
        "confidence",
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
          cols.map((c) => esc((r as Record<string, unknown>)[c])).join(",")
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
      sessions: normalized,
      total,
      limit,
      offset,
      nextOffset:
        offset + normalized.length < total ? offset + normalized.length : null,
    });
  } catch (error) {
    console.error("[IT audit-sessions] Export failed:", error);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
