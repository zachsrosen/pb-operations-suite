/**
 * GET /api/portal/survey/[token]
 *
 * Public endpoint (no auth). Validates the token, returns invite details
 * and available survey time slots for the customer.
 */

import { NextRequest, NextResponse } from "next/server";
import { validateToken, hashToken } from "@/lib/portal-token";
import { getPortalAvailability } from "@/lib/portal-availability";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  // Validate token
  const result = await validateToken(token);

  if (!result.valid) {
    const statusMap = {
      not_found: 404,
      expired: 410,
      inactive: 410,
    } as const;
    return NextResponse.json(
      { error: result.reason === "not_found" ? "Invalid link" : "This link has expired" },
      { status: statusMap[result.reason] },
    );
  }

  const { invite } = result;

  // If already scheduled/rescheduled, return booking details
  if (invite.status === "SCHEDULED" || invite.status === "RESCHEDULED") {
    const response: Record<string, unknown> = {
      status: "scheduled",
      customerName: invite.customerName,
      propertyAddress: invite.propertyAddress,
      pbLocation: invite.pbLocation,
      booking: {
        date: invite.scheduledDate,
        time: invite.scheduledTime,
        accessNotes: invite.accessNotes,
        canModify: invite.cutoffAt ? new Date() < invite.cutoffAt : false,
      },
    };

    // Include availability when customer is rescheduling
    const wantsReschedule = new URL(request.url).searchParams.get("reschedule") === "1";
    if (wantsReschedule) {
      response.availability = await getPortalAvailability(invite.pbLocation);
    }

    return NextResponse.json(response);
  }

  // Status is PENDING — fetch available slots
  const availability = await getPortalAvailability(invite.pbLocation);

  return NextResponse.json({
    status: "pending",
    customerName: invite.customerName,
    propertyAddress: invite.propertyAddress,
    pbLocation: invite.pbLocation,
    availability,
  });
}
