import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  fetchRequesterId,
  fetchTicketsByRequesterId,
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
    const requesterId = await fetchRequesterId(
      session.user.email,
      session.user.name ?? null
    );
    if (!requesterId) {
      return NextResponse.json(
        {
          tickets: [],
          lastUpdated: new Date().toISOString(),
          requesterFound: false,
        },
        { headers: { "Cache-Control": "private, max-age=60" } }
      );
    }

    const tickets = await fetchTicketsByRequesterId(requesterId);
    return NextResponse.json(
      {
        tickets,
        lastUpdated: new Date().toISOString(),
        requesterFound: true,
      },
      { headers: { "Cache-Control": "private, max-age=60" } }
    );
  } catch (err) {
    console.error("Freshservice my-tickets failed:", err);
    return NextResponse.json(
      { error: "Freshservice unavailable" },
      { status: 502 }
    );
  }
}
