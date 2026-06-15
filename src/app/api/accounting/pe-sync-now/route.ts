import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { syncFromPeApi, getLatestSyncRun } from "@/lib/pe-api-sync";
import { appCache, CACHE_KEYS } from "@/lib/cache";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// At most one visit-triggered incremental sync per this window — keeps page
// visits from stampeding the PE API. The hourly cron still runs independently.
const THROTTLE_MS = 4 * 60 * 1000;

/**
 * POST /api/accounting/pe-sync-now
 * Body { scope?: "fast" | "full" } chooses the sync:
 *   - (no scope) auto on-visit: throttled incremental status-only sync.
 *   - "fast": manual "Sync now" — FULL list (every doc's current status, ignoring
 *     the since-filter that skips action resolutions), no detail sweep (~15–40s).
 *   - "full": manual full re-sync incl. action-item details (~3–4 min).
 * Manual scopes bypass the throttle. Returns { skipped } / { synced }.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let scope: "auto" | "fast" | "full" = "auto";
  try {
    const body = await req.json();
    if (body?.scope === "fast" || body?.scope === "full") scope = body.scope;
  } catch { /* no body → auto */ }

  const last = await getLatestSyncRun();
  // Never pile on a sync that's already running.
  if (last?.status === "running" && Date.now() - new Date(last.startedAt).getTime() < 5 * 60 * 1000) {
    return NextResponse.json({ skipped: true, reason: "in-progress" });
  }
  // Only the auto on-visit sync is throttled; manual button presses are not.
  if (scope === "auto" && last) {
    const ref = last.completedAt ?? last.startedAt;
    if (Date.now() - new Date(ref).getTime() < THROTTLE_MS) {
      return NextResponse.json({ skipped: true, lastSync: ref });
    }
  }

  try {
    const opts =
      scope === "full" ? { fullSync: true, timeBudgetMs: 280_000 }
        : scope === "fast" ? { fullSync: true, skipActionItems: true, timeBudgetMs: 120_000 }
          : { skipActionItems: true, timeBudgetMs: 22_000 };
    const r = await syncFromPeApi(opts);
    // Bust the (heavy) analytics cache so the next fetch reflects the fresh sync.
    appCache.invalidate(CACHE_KEYS.PE_ANALYTICS);
    return NextResponse.json({ synced: true, scope, docs: r.docsUpserted, versions: r.versionsUpserted });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
