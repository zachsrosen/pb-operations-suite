/**
 * Admin Availability Change Requests API
 *
 * GET  /api/admin/availability-requests - List all pending (or filtered) availability change requests
 * POST /api/admin/availability-requests - Approve or reject a change request, applying the change if approved
 *
 * Requires ADMIN, OWNER, or OPERATIONS_MANAGER role.
 */

import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/auth";
import { prisma, getUserByEmail } from "@/lib/db";
import { logAdminActivity, extractRequestContext } from "@/lib/audit/admin-activity";

const ALLOWED_ROLES = ["ADMIN", "OWNER", "OPERATIONS_MANAGER"] as const;

/**
 * GET - List availability change requests, optionally filtered by status.
 * Query param: ?status=pending (default) | approved | rejected | all
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const user = await getUserByEmail(session.user.email);
  if (!user || !ALLOWED_ROLES.includes(user.role as typeof ALLOWED_ROLES[number])) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const status = request.nextUrl.searchParams.get("status") || "pending";
  const where = status === "all" ? {} : { status };

  try {
    const requests = await prisma.availabilityChangeRequest.findMany({
      where,
      include: {
        crewMember: {
          select: { id: true, name: true, email: true, role: true, locations: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ requests });
  } catch (error) {
    console.error("Error fetching availability change requests:", error);
    return NextResponse.json({ error: "Failed to fetch requests" }, { status: 500 });
  }
}

/**
 * POST - Approve or reject an availability change request.
 * Body: { requestId: string, action: "approve" | "reject", note?: string }
 *
 * On approval, the underlying availability record is created, updated, or deleted.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const user = await getUserByEmail(session.user.email);
  if (!user || !ALLOWED_ROLES.includes(user.role as typeof ALLOWED_ROLES[number])) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  let body: { requestId?: string; action?: string; note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { requestId, action, note } = body;

  if (!requestId || !["approve", "reject"].includes(action ?? "")) {
    return NextResponse.json(
      { error: "requestId and action (approve|reject) required" },
      { status: 400 }
    );
  }

  try {
    const changeRequest = await prisma.availabilityChangeRequest.findUnique({
      where: { id: requestId },
      include: { crewMember: true },
    });

    if (!changeRequest) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    if (changeRequest.status !== "pending") {
      return NextResponse.json(
        { error: `Request already ${changeRequest.status}` },
        { status: 409 }
      );
    }

    // Apply slot change + update request status atomically
    const updated = await prisma.$transaction(async (tx) => {
      if (action === "approve") {
        if (
          changeRequest.requestType === "add" ||
          changeRequest.requestType === "modify"
        ) {
          const slotData = {
            crewMemberId: changeRequest.crewMemberId,
            location: changeRequest.location || "",
            jobType: changeRequest.jobType || "survey",
            dayOfWeek: changeRequest.dayOfWeek ?? 0,
            startTime: changeRequest.startTime || "08:00",
            endTime: changeRequest.endTime || "17:00",
            timezone: "America/Denver",
            isActive: changeRequest.isAvailable,
            updatedBy: user.id,
          };
          const existingId =
            changeRequest.requestType === "modify"
              ? changeRequest.originalSlotId || undefined
              : undefined;
          if (existingId) {
            await tx.crewAvailability.update({ where: { id: existingId }, data: slotData });
          } else {
            await tx.crewAvailability.create({ data: slotData });
          }
        } else if (
          changeRequest.requestType === "delete" &&
          changeRequest.originalSlotId
        ) {
          await tx.crewAvailability.delete({ where: { id: changeRequest.originalSlotId } });
        }
      }

      return tx.availabilityChangeRequest.update({
        where: { id: requestId },
        data: {
          status: action === "approve" ? "approved" : "rejected",
          reviewedBy: user.id,
          reviewedAt: new Date(),
          reviewNote: note || null,
        },
      });
    });

    // Audit log — best-effort; failure must not mask a successful approval
    try {
      const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const dayLabel =
        changeRequest.dayOfWeek !== null && changeRequest.dayOfWeek !== undefined
          ? dayNames[changeRequest.dayOfWeek]
          : "";
      const headersList = await headers();
      const reqCtx = extractRequestContext(headersList);
      await logAdminActivity({
        type: "AVAILABILITY_CHANGED",
        description: `${user.name || user.email} ${action}d availability request from ${changeRequest.crewMember.name}: ${changeRequest.requestType} ${changeRequest.location || ""} ${dayLabel}`.trim(),
        userId: user.id,
        userEmail: user.email,
        userName: user.name || user.email,
        entityType: "crew_availability",
        entityId: requestId,
        requestPath: "/api/admin/availability-requests",
        requestMethod: "POST",
        ...reqCtx,
      });
    } catch (auditErr) {
      console.error("Non-critical: failed to write audit log for availability request", auditErr);
    }

    return NextResponse.json({ success: true, request: updated });
  } catch (error) {
    console.error("Error processing availability change request:", error);
    return NextResponse.json({ error: "Failed to process request" }, { status: 500 });
  }
}
