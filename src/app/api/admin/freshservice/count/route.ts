import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  fetchRequesterIdByEmail,
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
    const requesterId = await fetchRequesterIdByEmail(session.user.email);
    if (!requesterId) {
      return NextResponse.json(
        { open: 0, pending: 0, total: 0 },
        { headers: { "Cache-Control": "private, max-age=60" } }
      );
    }

    const tickets = await fetchTicketsByRequesterId(requesterId);
    const open = tickets.filter((t) => t.status === 2).length;
    const pending = tickets.filter((t) => t.status === 3).length;
    return NextResponse.json(
      { open, pending, total: open + pending },
      { headers: { "Cache-Control": "private, max-age=60" } }
    );
  } catch {
    return NextResponse.json(
      { error: "Freshservice unavailable" },
      { status: 502 }
    );
  }
}
