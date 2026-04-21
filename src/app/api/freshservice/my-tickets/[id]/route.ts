import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  fetchRequesterId,
  fetchTicketDetail,
} from "@/lib/freshservice";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    const requesterId = await fetchRequesterId(
      session.user.email,
      session.user.name ?? null
    );
    if (!requesterId) {
      return NextResponse.json(
        { error: "Not authorized to view this ticket" },
        { status: 403 }
      );
    }

    const ticket = await fetchTicketDetail(id);
    if (ticket.requester_id !== requesterId) {
      return NextResponse.json(
        { error: "Not authorized to view this ticket" },
        { status: 403 }
      );
    }

    return NextResponse.json({ ticket });
  } catch (err) {
    console.error("Freshservice my-ticket detail failed:", err);
    return NextResponse.json(
      { error: "Freshservice unavailable" },
      { status: 502 }
    );
  }
}
