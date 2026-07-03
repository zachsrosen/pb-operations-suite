/**
 * GET /api/cron/neon-branch-sweep
 *
 * Weekly backstop that deletes stale Vercel-created Neon preview branches so
 * they can't accumulate into "extra branch" charges (~$1.47/branch/mo on the
 * Launch plan). The Neon↔Vercel integration creates a branch per preview
 * deployment; its built-in "auto-delete obsolete" toggle is unreliable, so we
 * sweep ourselves.
 *
 * Only ever deletes `preview/*` branches older than NEON_SWEEP_MAX_AGE_DAYS
 * that are neither the default (production) nor protected. Pass ?dryRun=true to
 * see what would be deleted without deleting.
 *
 * Auth: CRON_SECRET bearer token. Listed in PUBLIC_API_ROUTES + in-route auth.
 * Env: NEON_API_KEY (required), NEON_PROJECT_ID (optional), NEON_SWEEP_MAX_AGE_DAYS (optional).
 */

import { NextResponse } from "next/server";

import { sweepStalePreviewBranches } from "@/lib/neon-branch-sweep";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const DEFAULT_PROJECT_ID = "aged-tooth-18266150"; // PB Operations Suite Neon project
const DEFAULT_MAX_AGE_DAYS = 14;

export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.NEON_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "NEON_API_KEY not configured" }, { status: 503 });
  }

  const projectId = process.env.NEON_PROJECT_ID || DEFAULT_PROJECT_ID;
  const parsedAge = Number(process.env.NEON_SWEEP_MAX_AGE_DAYS);
  const maxAgeDays = Number.isFinite(parsedAge) && parsedAge > 0 ? parsedAge : DEFAULT_MAX_AGE_DAYS;
  const dryRun = new URL(request.url).searchParams.get("dryRun") === "true";

  try {
    const result = await sweepStalePreviewBranches(
      { projectId, apiKey, maxAgeDays },
      { dryRun, delayMs: 150 },
    );
    return NextResponse.json({ status: "ok", projectId, maxAgeDays, ...result });
  } catch (err) {
    return NextResponse.json(
      { status: "error", error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
