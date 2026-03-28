import { NextRequest, NextResponse } from "next/server";
import { runEodSummary } from "@/lib/eod-summary/send";
import { sendCronHealthAlert } from "@/lib/audit/alerts";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "true";

  try {
    const result = await runEodSummary({ dryRun });

    return NextResponse.json({
      dryRun,
      emailSent: result.sent,
      changeCount: result.changeCount,
      milestoneCount: result.milestoneCount,
      taskCount: result.taskCount,
      newDealCount: result.newDealCount,
      resolvedDealCount: result.resolvedDealCount,
      skipped: result.skipped,
      skipReason: result.skipReason ?? null,
      errors: result.errors.length > 0 ? result.errors : undefined,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[eod-summary] Cron failed: ${msg}`);

    try {
      await sendCronHealthAlert("eod-summary", msg);
    } catch {
      // Best-effort
    }

    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
