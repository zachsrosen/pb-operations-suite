// src/app/api/inventory/product-sync/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { runProductSync } from "@/lib/product-sync";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = new Set([
  "ADMIN", "OWNER", "EXECUTIVE", "PROJECT_MANAGER", "OPERATIONS_MANAGER",
]);

export async function POST(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  if (!ALLOWED_ROLES.has(authResult.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const backfill = url.searchParams.get("mode") === "backfill";

  try {
    const { id, stats } = await runProductSync({
      trigger: "manual",
      triggeredBy: authResult.email,
      backfill,
    });

    return NextResponse.json({
      ok: true,
      runId: id,
      backfill,
      ...stats,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("already in progress")
    ) {
      return NextResponse.json(
        { ok: false, error: "A sync is already in progress. Try again shortly." },
        { status: 409 },
      );
    }

    console.error("[inventory/product-sync] Fatal error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
