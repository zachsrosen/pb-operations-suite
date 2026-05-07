import { NextResponse } from "next/server";
import { syncAssets } from "@/lib/powerhub-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (process.env.POWERHUB_ENABLED !== "true") {
    return NextResponse.json({ skipped: true, reason: "POWERHUB_ENABLED is false" });
  }

  try {
    const result = await syncAssets();
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[powerhub-assets] Sync failed:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
