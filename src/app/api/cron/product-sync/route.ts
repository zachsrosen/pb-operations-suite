// src/app/api/cron/product-sync/route.ts
import { NextRequest, NextResponse } from "next/server";
import { runProductSync } from "@/lib/product-sync";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id, stats } = await runProductSync({ trigger: "cron" });

    return NextResponse.json({
      ok: true,
      runId: id,
      ...stats,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("already in progress")
    ) {
      return NextResponse.json({ ok: true, skipped: "lock_held" });
    }

    console.error("[cron/product-sync] Fatal error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
