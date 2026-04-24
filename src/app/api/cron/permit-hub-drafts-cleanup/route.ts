import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * GET /api/cron/permit-hub-drafts-cleanup
 *
 * Vercel cron — purges PermitHubDraft rows older than 7 days.
 * Schedule: daily 4am UTC. Protected by CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const result = await prisma.permitHubDraft.deleteMany({
    where: { updatedAt: { lt: cutoff } },
  });

  return NextResponse.json({ deleted: result.count });
}
