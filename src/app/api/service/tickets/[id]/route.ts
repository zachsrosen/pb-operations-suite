import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";
import { getTicketDetail, updateTicket, getTicketStageMap } from "@/lib/hubspot-tickets";
import { appCache, CACHE_KEYS } from "@/lib/cache";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const user = await getUserByEmail(session.user.email);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 403 });
    }

    const { id } = await params;
    const ticket = await getTicketDetail(id);

    if (!ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    // Include stage map for context
    const stageMap = await getTicketStageMap();

    return NextResponse.json({ ticket, stageMap });
  } catch (error) {
    console.error("[ServiceTickets] Detail error:", error);
    return NextResponse.json({ error: "Failed to load ticket" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const user = await getUserByEmail(session.user.email);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();

    const { ownerId, stageId, note } = body as {
      ownerId?: string;
      stageId?: string;
      note?: string;
    };

    // ownerId === "" means "unassign" — that's a valid update, not empty
    const hasUpdate = ownerId !== undefined || stageId || note;
    if (!hasUpdate) {
      return NextResponse.json({ error: "No updates provided" }, { status: 400 });
    }

    // Pass ownerId even if "" (means unassign) — updateTicket checks !== undefined
    const success = await updateTicket(id, {
      ...(ownerId !== undefined ? { ownerId } : {}),
      ...(stageId ? { stageId } : {}),
      ...(note ? { note } : {}),
    });

    if (!success) {
      return NextResponse.json({ error: "Failed to update ticket" }, { status: 500 });
    }

    // Invalidate ticket cache so priority queue and ticket list refresh
    appCache.invalidate(CACHE_KEYS.SERVICE_TICKETS);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[ServiceTickets] Update error:", error);
    return NextResponse.json({ error: "Failed to update ticket" }, { status: 500 });
  }
}
