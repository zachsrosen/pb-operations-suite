import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

/**
 * GET /api/it/anomaly-events
 *
 * Read-only export of risk-scored anomaly events for the IT team. Each row
 * corresponds to a rule firing on a single AuditSession — rule, risk score,
 * evidence blob, and acknowledgement state.
 *
 * Protected by IT_EXPORT_TOKEN (scoped to /api/it/* in middleware).
 *
 * Query params:
 * - since: ISO date string — createdAt >= since
 * - until: ISO date string — createdAt <= until
 * - rule: exact rule name (repeat param to OR across rules)
 * - riskLevel: LOW | MEDIUM | HIGH | CRITICAL — derived from the parent
 *   session's risk level (repeat param to OR)
 * - email: partial user email match on the parent session
 * - userId: exact user ID on the parent session
 * - unacknowledgedOnly: "1" to hide events that have been ack'd
 * - minRiskScore: integer — only include rows with riskScore >= this
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

    const where: Prisma.AuditAnomalyEventWhereInput = {};

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
      if (range.gte || range.lte) where.createdAt = range;
    }

    const rules = searchParams.getAll("rule").filter(Boolean);
    if (rules.length > 0) where.rule = { in: rules };

    const minRiskScoreParam = searchParams.get("minRiskScore");
    if (minRiskScoreParam) {
      const n = parseInt(minRiskScoreParam, 10);
      if (!isNaN(n)) where.riskScore = { gte: n };
    }

    if (searchParams.get("unacknowledgedOnly") === "1") {
      where.acknowledgedAt = null;
    }

    const sessionWhere: Prisma.AuditSessionWhereInput = {};
    const validRiskLevels = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
    const riskLevels = searchParams
      .getAll("riskLevel")
      .filter((r) => validRiskLevels.has(r));
    if (riskLevels.length > 0) {
      sessionWhere.riskLevel = {
        in: riskLevels as Array<"LOW" | "MEDIUM" | "HIGH" | "CRITICAL">,
      };
    }

    const email = searchParams.get("email") || undefined;
    if (email) {
      sessionWhere.OR = [
        { userEmail: { contains: email, mode: "insensitive" } },
        { user: { email: { contains: email, mode: "insensitive" } } },
      ];
    }

    const userId = searchParams.get("userId") || undefined;
    if (userId) sessionWhere.userId = userId;

    if (Object.keys(sessionWhere).length > 0) {
      where.session = sessionWhere;
    }

    const format = (searchParams.get("format") || "json").toLowerCase();

    const [events, total] = await Promise.all([
      prisma.auditAnomalyEvent.findMany({
        where,
        include: {
          session: {
            select: {
              userId: true,
              userEmail: true,
              userName: true,
              clientType: true,
              environment: true,
              ipAddress: true,
              userAgent: true,
              riskLevel: true,
              startedAt: true,
              user: { select: { name: true, email: true, roles: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.auditAnomalyEvent.count({ where }),
    ]);

    const normalized = events.map((e) => ({
      id: e.id,
      createdAt: e.createdAt.toISOString(),
      rule: e.rule,
      riskScore: e.riskScore,
      evidence: e.evidence,
      acknowledgedAt: e.acknowledgedAt ? e.acknowledgedAt.toISOString() : null,
      acknowledgedBy: e.acknowledgedBy,
      acknowledgeNote: e.acknowledgeNote,
      sessionId: e.sessionId,
      session: e.session
        ? {
            startedAt: e.session.startedAt.toISOString(),
            userId: e.session.userId,
            userEmail: e.session.userEmail || e.session.user?.email || null,
            userName: e.session.userName || e.session.user?.name || null,
            userRoles: e.session.user?.roles || [],
            clientType: e.session.clientType,
            environment: e.session.environment,
            ipAddress: e.session.ipAddress,
            userAgent: e.session.userAgent,
            riskLevel: e.session.riskLevel,
          }
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
        "createdAt",
        "rule",
        "riskScore",
        "sessionRiskLevel",
        "userEmail",
        "userName",
        "clientType",
        "environment",
        "ipAddress",
        "userAgent",
        "acknowledgedAt",
        "acknowledgedBy",
        "acknowledgeNote",
        "evidence",
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
          createdAt: r.createdAt,
          rule: r.rule,
          riskScore: r.riskScore,
          sessionRiskLevel: r.session?.riskLevel ?? null,
          userEmail: r.session?.userEmail ?? null,
          userName: r.session?.userName ?? null,
          clientType: r.session?.clientType ?? null,
          environment: r.session?.environment ?? null,
          ipAddress: r.session?.ipAddress ?? null,
          userAgent: r.session?.userAgent ?? null,
          acknowledgedAt: r.acknowledgedAt,
          acknowledgedBy: r.acknowledgedBy,
          acknowledgeNote: r.acknowledgeNote,
          evidence: r.evidence,
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
      events: normalized,
      total,
      limit,
      offset,
      nextOffset:
        offset + normalized.length < total ? offset + normalized.length : null,
    });
  } catch (error) {
    console.error("[IT anomaly-events] Export failed:", error);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
