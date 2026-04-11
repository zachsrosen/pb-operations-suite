import { NextRequest, NextResponse } from "next/server";
import { getActualCommsUser } from "@/lib/comms-auth";
import { sendGmailDraft } from "@/lib/comms-email-compose";

export async function POST(req: NextRequest) {
  const { user, blocked } = await getActualCommsUser();
  if (blocked) return NextResponse.json({ error: "Comms unavailable while impersonating" }, { status: 403 });
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { draftId } = await req.json();
  if (!draftId) {
    return NextResponse.json({ error: "draftId is required" }, { status: 400 });
  }

  const result = await sendGmailDraft(user.id, draftId);

  if ("disconnected" in result) return NextResponse.json({ disconnected: true });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 502 });

  return NextResponse.json(result.data);
}
