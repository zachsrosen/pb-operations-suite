import { NextRequest, NextResponse } from "next/server";
import { getActualCommsUser } from "@/lib/comms-auth";
import { createGmailDraft, updateGmailDraft } from "@/lib/comms-email-compose";

export async function POST(req: NextRequest) {
  const { user, blocked } = await getActualCommsUser();
  if (blocked) return NextResponse.json({ error: "Comms unavailable while impersonating" }, { status: 403 });
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const body = await req.json();
  const { to, cc, subject, body: draftBody, threadId } = body;

  if (!to || !subject) {
    return NextResponse.json({ error: "to and subject are required" }, { status: 400 });
  }

  const result = await createGmailDraft(user.id, { to, cc, subject, body: draftBody || "", threadId });

  if ("disconnected" in result) return NextResponse.json({ disconnected: true });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 502 });

  return NextResponse.json(result.data);
}

export async function PUT(req: NextRequest) {
  const { user, blocked } = await getActualCommsUser();
  if (blocked) return NextResponse.json({ error: "Comms unavailable while impersonating" }, { status: 403 });
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const body = await req.json();
  const { draftId, to, cc, subject, body: draftBody } = body;

  if (!draftId || !to || !subject) {
    return NextResponse.json({ error: "draftId, to, and subject are required" }, { status: 400 });
  }

  const result = await updateGmailDraft(user.id, draftId, { to, cc, subject, body: draftBody || "" });

  if ("disconnected" in result) return NextResponse.json({ disconnected: true });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 502 });

  return NextResponse.json(result.data);
}
