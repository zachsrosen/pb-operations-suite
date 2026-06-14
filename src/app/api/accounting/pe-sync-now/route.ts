import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { syncFromPeApi, getLatestSyncRun } from "@/lib/pe-api-sync";
import { appCache, CACHE_KEYS } from "@/lib/cache";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// At most one visit-triggered incremental sync per this window — keeps page
// visits from stampeding the PE API. The hourly cron still runs independently.
const THROTTLE_MS = 4 * 60 * 1000;

/**
 * POST /api/accounting/pe-sync-now
 * Throttled, on-visit incremental PE sync so the dashboard reflects fresh data.
 * Returns { skipped } when a recent/in-flight sync makes another redundant, or
 * { synced } after pulling changes (and busting the analytics cache).
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const last = await getLatestSyncRun();
  if (last) {
    // Another sync already running — don't pile on.
    if (last.status === "running" && Date.now() - new Date(last.startedAt).getTime() < 5 * 60 * 1000) {
      return NextResponse.json({ skipped: true, reason: "in-progress" });
    }
    const ref = last.completedAt ?? last.startedAt;
    if (Date.now() - new Date(ref).getTime() < THROTTLE_MS) {
      return NextResponse.json({ skipped: true, lastSync: ref });
    }
  }

  try {
    const r = await syncFromPeApi({ skipActionItems: true, timeBudgetMs: 22_000 });
    // Bust the (heavy) analytics cache so the next fetch reflects the fresh sync.
    appCache.invalidate(CACHE_KEYS.PE_ANALYTICS);
    return NextResponse.json({ synced: true, docs: r.docsUpserted, versions: r.versionsUpserted });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
