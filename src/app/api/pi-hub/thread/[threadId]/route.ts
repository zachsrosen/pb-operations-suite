import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import {
  allowedTeamsForRoles,
  isPiHubAllowedRole,
  isPiHubEnabled,
} from "@/lib/pi-hub/access";
import { parseTeam } from "@/lib/pi-hub/types";
import {
  fetchSharedInboxThreadMessages,
  getSharedInboxAddress,
  type InboxRegion,
  type InboxTeam,
} from "@/lib/gmail-shared-inbox";

/** Every mailbox the hub is allowed to read from — the inbox query param is
 *  validated against this set so the route can never be pointed at an
 *  arbitrary mailbox. */
function configuredInboxes(): Set<string> {
  const set = new Set<string>();
  for (const team of ["permit", "ic"] as InboxTeam[]) {
    for (const region of ["co", "ca"] as InboxRegion[]) {
      const addr = getSharedInboxAddress(team, region);
      if (addr) set.add(addr.toLowerCase());
    }
  }
  return set;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  if (!isPiHubEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isPiHubAllowedRole(auth.roles)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const team = parseTeam(req.nextUrl.searchParams.get("team"));
  if (!team) {
    return NextResponse.json({ error: "Invalid team" }, { status: 400 });
  }
  if (!allowedTeamsForRoles(auth.roles).includes(team)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const inbox = (req.nextUrl.searchParams.get("inbox") ?? "").toLowerCase();
  if (!inbox || !configuredInboxes().has(inbox)) {
    return NextResponse.json({ error: "Invalid inbox" }, { status: 400 });
  }

  const { threadId } = await params;
  if (!/^[a-zA-Z0-9_-]{8,32}$/.test(threadId)) {
    return NextResponse.json({ error: "Invalid thread id" }, { status: 400 });
  }

  const result = await fetchSharedInboxThreadMessages(inbox, threadId);
  if (!result.ok) {
    console.error(`[pi-hub/thread] ${result.error}`);
    return NextResponse.json(
      { error: "Could not load the email thread" },
      { status: 502 },
    );
  }
  return NextResponse.json({ messages: result.messages });
}
