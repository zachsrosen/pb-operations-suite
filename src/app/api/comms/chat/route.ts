import { NextResponse } from "next/server";
import { getActualCommsUser } from "@/lib/comms-auth";
import { fetchChatMessages } from "@/lib/comms-chat";
import { prisma } from "@/lib/db";

export async function GET() {
  const { user, blocked } = await getActualCommsUser();
  if (blocked) {
    return NextResponse.json(
      { error: "Comms is not available while impersonating another user" },
      { status: 403 }
    );
  }
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const state = await prisma.commsUserState.findUnique({
    where: { userId: user.id },
  });

  const result = await fetchChatMessages(user.id, {
    chatLastSyncAt: state?.chatLastSyncAt,
  });

  if ("disconnected" in result) {
    return NextResponse.json({ disconnected: true });
  }
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  return NextResponse.json({
    messages: result.data.messages,
    spaceCount: result.data.spaceCount,
    lastUpdated: new Date().toISOString(),
  });
}
