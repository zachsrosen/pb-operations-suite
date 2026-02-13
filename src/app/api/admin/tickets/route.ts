import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail, logActivity, prisma } from "@/lib/db";
import { headers } from "next/headers";

/**
 * GET /api/admin/tickets
 *
 * List bug reports with optional filters.
 * Admin only.
 *
 * Query params:
 * - status: filter by status (OPEN, IN_PROGRESS, RESOLVED, CLOSED)
 * - limit: number of records (default 50)
 * - offset: pagination offset
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const user = await getUserByEmail(session.user.email);
    if (!user || (user.role !== "ADMIN" && user.role !== "OWNER")) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    if (!prisma) {
      return NextResponse.json({ tickets: [], total: 0 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    const where = {
      ...(status && { status: status as "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED" }),
    };

    const [tickets, total] = await Promise.all([
      prisma.bugReport.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.bugReport.count({ where }),
    ]);

    return NextResponse.json({ tickets, total });
  } catch (error) {
    console.error("Error fetching tickets:", error);
    return NextResponse.json(
      { error: "Failed to fetch tickets" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/admin/tickets
 *
 * Update a bug report status or admin notes.
 * Admin only.
 *
 * Body: { ticketId: string, status?: string, adminNotes?: string }
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const user = await getUserByEmail(session.user.email);
    if (!user || (user.role !== "ADMIN" && user.role !== "OWNER")) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    if (!prisma) {
      return NextResponse.json({ error: "Database not configured" }, { status: 503 });
    }

    const body = await request.json();
    const { ticketId, status, adminNotes } = body;

    if (!ticketId) {
      return NextResponse.json({ error: "ticketId is required" }, { status: 400 });
    }

    const validStatuses = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];
    if (status && !validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be: ${validStatuses.join(", ")}` },
        { status: 400 }
      );
    }

    const existing = await prisma.bugReport.findUnique({ where: { id: ticketId } });
    if (!existing) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};
    if (status) updateData.status = status;
    if (adminNotes !== undefined) updateData.adminNotes = adminNotes;

    const updated = await prisma.bugReport.update({
      where: { id: ticketId },
      data: updateData,
    });

    // Log the activity
    const hdrs = await headers();
    const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const userAgent = hdrs.get("user-agent") || "unknown";

    await logActivity({
      type: "BUG_STATUS_CHANGED",
      description: `Bug report "${existing.title}" updated: ${status ? `status → ${status}` : "notes updated"}`,
      userEmail: session.user.email,
      userName: session.user.name || undefined,
      entityType: "bug_report",
      entityId: ticketId,
      entityName: existing.title,
      metadata: {
        previousStatus: existing.status,
        newStatus: status || existing.status,
        hasAdminNotes: !!adminNotes,
      },
      ipAddress: ip,
      userAgent,
    });

    return NextResponse.json({ success: true, ticket: updated });
  } catch (error) {
    console.error("Error updating ticket:", error);
    return NextResponse.json(
      { error: "Failed to update ticket" },
      { status: 500 }
    );
  }
}
