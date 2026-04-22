import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  canEditTriageRun,
  getTriageRun,
  updateTriageRun,
  UpdateTriageRunSchema,
} from "@/lib/adders/triage-runs";

export async function GET(
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
  return NextResponse.json({ run });
}

export async function PATCH(
  req: NextRequest,
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

  const body = await req.json().catch(() => ({}));
  const parsed = UpdateTriageRunSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const updated = await updateTriageRun(id, parsed.data);
    return NextResponse.json({ run: updated });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "unknown";
    if (msg.includes("cannot update submitted")) {
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    throw e;
  }
}
