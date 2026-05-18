import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

export const maxDuration = 10;

/**
 * Bulk lookup of latest PeAuditRun per deal — used by the PE Prep landing
 * page to overlay audit history on the deal queue.
 *
 * Usage: GET /api/pe-prep/audit-runs?dealIds=123,456,789
 *
 * Returns: { runs: { [dealId]: LatestRunSummary | null } }
 *
 * Each LatestRunSummary contains only what the queue page needs (status,
 * counts, mode, timestamps) — full results live behind /status/[dealId].
 */
export async function GET(req: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const dealIdsParam = req.nextUrl.searchParams.get("dealIds");
  if (!dealIdsParam) {
    return NextResponse.json({ runs: {} });
  }

  const dealIds = dealIdsParam.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 500);
  if (dealIds.length === 0) {
    return NextResponse.json({ runs: {} });
  }

  // Latest completed run per dealId. We sort by completedAt desc and group
  // client-side rather than running N parallel queries — Prisma doesn't
  // support DISTINCT ON, and a single query with sort + dedupe is fastest
  // for typical queue sizes (50-200 deals).
  const allRuns = await prisma.peAuditRun.findMany({
    where: {
      dealId: { in: dealIds },
      status: { in: ["completed", "running"] },
    },
    select: {
      id: true,
      dealId: true,
      milestone: true,
      status: true,
      startedAt: true,
      completedAt: true,
      durationMs: true,
      summary: true,
      packageFolderUrl: true,
    },
    orderBy: { startedAt: "desc" },
  });

  // Group: latest run per (dealId, milestone)
  const runs: Record<string, {
    m1?: LatestRunSummary;
    m2?: LatestRunSummary;
  }> = {};

  for (const r of allRuns) {
    const milestone = r.milestone as "m1" | "m2";
    if (!runs[r.dealId]) runs[r.dealId] = {};
    if (runs[r.dealId][milestone]) continue; // already have a more recent one

    const summary = r.summary as Record<string, unknown> | null;
    runs[r.dealId][milestone] = {
      auditRunId: r.id,
      status: r.status,
      startedAt: r.startedAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
      durationMs: r.durationMs,
      mode: (summary?.mode as string) ?? "full",
      found: (summary?.found as number) ?? 0,
      missing: (summary?.missing as number) ?? 0,
      needsReview: (summary?.needsReview as number) ?? 0,
      notApplicable: (summary?.notApplicable as number) ?? 0,
      totalItems: (summary?.totalItems as number) ?? 0,
      assembled: !!r.packageFolderUrl,
    };
  }

  return NextResponse.json({ runs });
}

export interface LatestRunSummary {
  auditRunId: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  mode: string;
  found: number;
  missing: number;
  needsReview: number;
  notApplicable: number;
  totalItems: number;
  assembled: boolean;
}
