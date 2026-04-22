import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { canEditTriageRun, getTriageRun } from "@/lib/adders/triage-runs";
import { submitTriageRun } from "@/lib/adders/triage-submit";

/**
 * POST /api/triage/runs/[id]/submit
 * Terminal transition: writes the run's `selectedAdders` as JSON to the
 * HubSpot deal property `pb_triage_adders`. Re-submitting overwrites.
 */
export async function POST(
  _: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const run = await getTriageRun(id);
  if (!run) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const userId = session.user.id as string;
  const roles = session.user.roles ?? [];
  if (!canEditTriageRun(run, userId, roles)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const result = await submitTriageRun(id);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status }
    );
  }
  return NextResponse.json({ run: result.run });
}
