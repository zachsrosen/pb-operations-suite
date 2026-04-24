import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { zuper } from "@/lib/zuper";
import { getCurrentUser } from "@/lib/auth-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  note: z.string().trim().min(1, "note required").max(2000),
});

/**
 * Append a note to the underlying Zuper job for a JobMarker.
 * Only supports markers whose id begins with `zuperjob:` (service / D&R /
 * roofing). Other kinds return 501.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const [prefix, rawRef] = id.split(":");
  const jobUid = (rawRef ?? "").trim();
  if (prefix !== "zuperjob" || !jobUid) {
    return NextResponse.json(
      { error: "note adding is only supported for zuperjob:* markers" },
      { status: 501 }
    );
  }

  let body: { note: string };
  try {
    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "bad body" }, { status: 400 });
    }
    body = parsed.data;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  // Tag the note with who added it + when, so Zuper's notes stay auditable.
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const attribution = user.name || user.email;
  const stamped = `[Map · ${stamp} · ${attribution}] ${body.note}`;

  try {
    const res = await zuper.appendJobNote(jobUid, stamped);
    if (res.type !== "success") {
      return NextResponse.json({ error: res.error ?? "Zuper append failed" }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[map note] append failed:", err);
    return NextResponse.json({ error: "append failed" }, { status: 500 });
  }
}
