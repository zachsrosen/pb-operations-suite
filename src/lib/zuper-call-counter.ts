/**
 * Per-endpoint Zuper API call counter.
 *
 * Persists daily call counts to SystemConfig so we can independently
 * audit our Zuper traffic without waiting for their team to flag it.
 *
 * Storage shape:
 *   key:   "zuper_call_counter:YYYY-MM-DD"
 *   value: JSON { method: { normalizedPath: count } }
 *
 * Path normalization strips query strings and replaces UUID-like /
 * hash-like / long-numeric segments with `:id` so paths like
 * `/jobs/8d2a40c0-1234-…` and `/jobs/3a1f-…` both bucket as
 * `/jobs/:id` instead of polluting the counter with 5k unique keys.
 *
 * Read endpoint: GET /api/admin/zuper-stats
 *
 * NOTE on cost: each call does one Prisma upsert (~1-3ms). For ~1k
 * Zuper calls/day that's negligible. For a runaway loop, the upsert
 * itself does NOT hit Zuper — it just records that we already did.
 */

import { prisma } from "@/lib/db";

const ID_LIKE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-z]{20,}|\d{6,})$/i;

function normalizePath(rawPath: string): string {
  // Strip query string first
  const qIdx = rawPath.indexOf("?");
  const pathOnly = qIdx >= 0 ? rawPath.slice(0, qIdx) : rawPath;
  return pathOnly
    .split("/")
    .map((seg) => (ID_LIKE.test(seg) ? ":id" : seg))
    .join("/");
}

function todayKey(): string {
  const d = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  return `zuper_call_counter:${d}`;
}

/**
 * Best-effort caller attribution. The original implementation walked the
 * stack looking for "the first frame outside our own files" — but in the
 * Turbopack-bundled prod build every .ts file collapses into one chunk
 * (e.g. /var/task/.next/server/chunks/src_lib_00wu2i3._.js), so the
 * file-path filter can't distinguish frames and we end up emitting
 * "from=" with no useful attribution.
 *
 * The reliable fix is to pass an explicit `caller` string at every call
 * site (see recordZuperCall's `caller` arg). This function stays as a
 * fallback that emits the first 3-5 stack frames raw so we at least have
 * SOMETHING grep-able in the Vercel log.
 */
function captureStackSnippet(): string {
  const stack = new Error().stack || "";
  // Drop the first line ("Error") and the first frame (this fn itself
  // + the recordZuperCall caller). Keep the next 4 frames.
  const lines = stack.split("\n").slice(3, 7);
  return lines.map((l) => l.trim()).join(" | ") || "<no-stack>";
}

/**
 * Increment the counter for a (method, normalizedPath) bucket on today's row.
 * Also emits a structured console.log so each call is visible in Vercel logs
 * with the caller source/file.
 *
 * `caller` is an explicit attribution string (e.g. "syncZuperServiceJobs",
 * "handleLookup:fuzzy", "zuperFetch:syncPropertyToZuper") supplied at the
 * call site — much more reliable than walking the stack in a bundled prod
 * build.
 *
 * Best-effort: failures are silent so storage hiccups never break Zuper calls.
 */
export async function recordZuperCall(
  method: string,
  endpoint: string,
  caller?: string,
): Promise<void> {
  const upMethod = method.toUpperCase();
  const path = normalizePath(endpoint);
  const attribution = caller || captureStackSnippet();

  // Structured log line — searchable in Vercel logs as "[zuper-call]"
  console.log(`[zuper-call] ${upMethod} ${path} from=${attribution}`);

  try {
    const key = todayKey();

    // Read-modify-write. Concurrent calls may race — that's acceptable for
    // a rough audit counter (we may under-count by a few in bursts but
    // never over-count). Per-call cost is one round-trip.
    const existing = await prisma.systemConfig.findUnique({ where: { key } });
    let parsed: Record<string, Record<string, number>> = {};
    if (existing?.value) {
      try {
        parsed = JSON.parse(existing.value);
      } catch {
        parsed = {};
      }
    }
    if (!parsed[upMethod]) parsed[upMethod] = {};
    parsed[upMethod][path] = (parsed[upMethod][path] || 0) + 1;

    await prisma.systemConfig.upsert({
      where: { key },
      create: { key, value: JSON.stringify(parsed) },
      update: { value: JSON.stringify(parsed) },
    });
  } catch {
    /* never throw — counter is best-effort instrumentation */
  }
}

/**
 * Read today's counter (and optionally the previous N days) as a flat
 * sorted list. Used by /api/admin/zuper-stats.
 */
export async function readZuperCounters(daysBack = 0): Promise<
  Array<{
    date: string;
    rows: Array<{ method: string; path: string; count: number }>;
    total: number;
  }>
> {
  const out: Awaited<ReturnType<typeof readZuperCounters>> = [];
  for (let i = 0; i <= daysBack; i++) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    const key = `zuper_call_counter:${d}`;
    const row = await prisma.systemConfig.findUnique({ where: { key } });
    if (!row) {
      out.push({ date: d, rows: [], total: 0 });
      continue;
    }
    let parsed: Record<string, Record<string, number>> = {};
    try {
      parsed = JSON.parse(row.value);
    } catch {
      parsed = {};
    }
    const rows: Array<{ method: string; path: string; count: number }> = [];
    let total = 0;
    for (const [method, byPath] of Object.entries(parsed)) {
      for (const [path, count] of Object.entries(byPath)) {
        rows.push({ method, path, count });
        total += count;
      }
    }
    rows.sort((a, b) => b.count - a.count);
    out.push({ date: d, rows, total });
  }
  return out;
}
