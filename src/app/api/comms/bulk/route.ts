import { NextRequest, NextResponse } from "next/server";
import { getActualCommsUser } from "@/lib/comms-auth";
import { getValidCommsAccessToken } from "@/lib/comms-token";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export async function POST(req: NextRequest) {
  const { user, blocked } = await getActualCommsUser();
  if (blocked) return NextResponse.json({ error: "Comms unavailable while impersonating" }, { status: 403 });
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { action, messageIds } = await req.json();

  if (!action || !Array.isArray(messageIds) || messageIds.length === 0) {
    return NextResponse.json({ error: "action and messageIds[] are required" }, { status: 400 });
  }

  const tokenResult = await getValidCommsAccessToken(user.id);
  if ("disconnected" in tokenResult) return NextResponse.json({ disconnected: true });

  // Gmail batchModify supports up to 1000 IDs
  const ids = messageIds.slice(0, 100); // practical limit per request

  let addLabelIds: string[] = [];
  let removeLabelIds: string[] = [];

  switch (action) {
    case "mark_read":
      removeLabelIds = ["UNREAD"];
      break;
    case "mark_unread":
      addLabelIds = ["UNREAD"];
      break;
    case "archive":
      removeLabelIds = ["INBOX"];
      break;
    case "star":
      addLabelIds = ["STARRED"];
      break;
    case "unstar":
      removeLabelIds = ["STARRED"];
      break;
    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }

  const resp = await fetch(`${GMAIL_BASE}/messages/batchModify`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenResult.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ids, addLabelIds, removeLabelIds }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    return NextResponse.json({ error: `Bulk action failed: ${resp.status} ${text}` }, { status: 502 });
  }

  return NextResponse.json({ ok: true, count: ids.length });
}
