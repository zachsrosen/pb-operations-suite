import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { autoLinkSites, getAutoLinkStats } from "@/lib/powerhub-auto-link";

export const dynamic = "force-dynamic";

/**
 * GET /api/powerhub/auto-link
 *
 * Returns auto-link stats and a dry-run preview of what would be linked.
 * Admin only.
 */
export async function GET() {
  if (process.env.POWERHUB_ENABLED !== "true") {
    return NextResponse.json({ error: "PowerHub disabled" }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user?.roles?.includes("ADMIN")) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const stats = await getAutoLinkStats();

  return NextResponse.json({ stats });
}

/**
 * POST /api/powerhub/auto-link
 *
 * Trigger the auto-link process. Accepts:
 *   { dryRun?: boolean, limit?: number }
 *
 * dryRun=true (default) returns what would be linked without writing to DB.
 * dryRun=false executes the links.
 * limit caps the number of sites processed (for testing).
 *
 * Admin only.
 */
export async function POST(request: Request) {
  if (process.env.POWERHUB_ENABLED !== "true") {
    return NextResponse.json({ error: "PowerHub disabled" }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user?.roles?.includes("ADMIN")) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  let dryRun = true;
  let limit: number | undefined;

  try {
    const body = await request.json();
    if (body.dryRun === false) dryRun = false;
    if (typeof body.limit === "number" && body.limit > 0) limit = body.limit;
  } catch {
    // Empty body is fine — defaults to dry run
  }

  const result = await autoLinkSites({ dryRun, limit });

  return NextResponse.json({
    mode: dryRun ? "dry_run" : "live",
    ...result,
  });
}
