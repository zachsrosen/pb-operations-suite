import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { createTriageRun, CreateTriageRunSchema } from "@/lib/adders/triage-runs";

/**
 * POST /api/triage/runs
 * Create a draft TriageRun. Caller becomes the `runBy` owner; only they
 * (or ADMIN/OWNER) may subsequently PATCH/submit.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = CreateTriageRunSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const run = await createTriageRun(parsed.data, {
    userId: session.user.id as string,
  });
  return NextResponse.json({ run }, { status: 201 });
}
