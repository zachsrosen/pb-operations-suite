import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  fetchAgentIdByEmail,
  fetchTicketsByAgentId,
} from "@/lib/freshservice";

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.FRESHSERVICE_API_KEY) {
    return NextResponse.json(
      { error: "Freshservice not configured" },
      { status: 500 }
    );
  }

  try {
    const agentId = await fetchAgentIdByEmail(session.user.email);
    if (!agentId) {
      return NextResponse.json(
        {
          tickets: [],
          lastUpdated: new Date().toISOString(),
          agentFound: false,
        },
        { headers: { "Cache-Control": "private, max-age=60" } }
      );
    }

    const tickets = await fetchTicketsByAgentId(agentId);
    return NextResponse.json(
      {
        tickets,
        lastUpdated: new Date().toISOString(),
        agentFound: true,
      },
      { headers: { "Cache-Control": "private, max-age=60" } }
    );
  } catch (err) {
    console.error("Freshservice list failed:", err);
    return NextResponse.json(
      { error: "Freshservice unavailable" },
      { status: 502 }
    );
  }
}
