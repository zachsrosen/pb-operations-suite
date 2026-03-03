/**
 * POST /api/portal/survey/[token]/book
 *
 * Public endpoint (no auth). Books a survey slot for the customer.
 *
 * Reliability model:
 * - DB transaction: BookedSlot + SurveyInvite update + OutboxEvents (atomic)
 * - Zuper job creation + emails dispatched via outbox (async, retried)
 * - Idempotency: duplicate submissions return the same booking
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { validateToken, hashToken } from "@/lib/portal-token";
import { decodeSlotId } from "@/lib/portal-availability";
import { getTimezoneForLocation } from "@/lib/constants";

const BookingSchema = z.object({
  slotId: z.string().min(1),
  accessNotes: z.string().max(1000).optional(),
  idempotencyKey: z.string().uuid(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  if (!prisma) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  // Validate token
  const tokenResult = await validateToken(token);
  if (!tokenResult.valid) {
    const statusMap = { not_found: 404, expired: 410, inactive: 410 } as const;
    return NextResponse.json(
      { error: tokenResult.reason === "not_found" ? "Invalid link" : "This link has expired" },
      { status: statusMap[tokenResult.reason] },
    );
  }
  const { invite } = tokenResult;

  if (invite.status !== "PENDING") {
    return NextResponse.json(
      { error: "This survey has already been scheduled" },
      { status: 409 },
    );
  }

  // Parse and validate body
  let body: z.infer<typeof BookingSchema>;
  try {
    body = BookingSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { slotId, accessNotes, idempotencyKey } = body;

  // ----- Idempotency check -----
  const scope = `book:${invite.tokenHash}`;
  const existingKey = await prisma.idempotencyKey.findUnique({
    where: { key_scope: { key: idempotencyKey, scope } },
  });

  if (existingKey) {
    if (existingKey.status === "completed" && existingKey.response) {
      // Replay previous success
      return NextResponse.json(existingKey.response, { status: 200 });
    }
    if (existingKey.status === "processing") {
      return NextResponse.json(
        { error: "Booking already in progress" },
        { status: 409 },
      );
    }
    // "failed" — delete and allow retry
    await prisma.idempotencyKey.delete({
      where: { key_scope: { key: idempotencyKey, scope } },
    });
  }

  // Reserve the idempotency key
  await prisma.idempotencyKey.create({
    data: {
      key: idempotencyKey,
      scope,
      status: "processing",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h TTL
    },
  });

  // ----- Decode and validate slot -----
  const slot = decodeSlotId(slotId);
  if (!slot) {
    await markIdempotencyFailed(idempotencyKey, scope);
    return NextResponse.json({ error: "Invalid time slot" }, { status: 400 });
  }

  // Compute cutoff and scheduled start in UTC
  const timezone = getTimezoneForLocation(invite.pbLocation);
  const scheduledStartUtc = localTimeToUtc(slot.date, slot.time, timezone);
  const cutoffAt = new Date(scheduledStartUtc.getTime() - 24 * 60 * 60 * 1000);

  // Validate the slot is still in the future with lead time
  if (scheduledStartUtc <= new Date(Date.now() + 48 * 60 * 60 * 1000)) {
    await markIdempotencyFailed(idempotencyKey, scope);
    return NextResponse.json(
      { error: "This time slot is no longer available" },
      { status: 409 },
    );
  }

  // ----- Get crew member name for the BookedSlot -----
  const crewMember = await prisma.crewMember.findUnique({
    where: { id: slot.crewMemberId },
    select: { name: true, zuperUserUid: true, zuperTeamUid: true },
  });
  if (!crewMember) {
    await markIdempotencyFailed(idempotencyKey, scope);
    return NextResponse.json(
      { error: "This time slot is no longer available" },
      { status: 409 },
    );
  }

  // Compute end time (1-hour slot)
  const [h, m] = slot.time.split(":").map(Number);
  const endTime = `${(h + 1).toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;

  // ----- Transactional booking -----
  // SELECT FOR UPDATE on the crew availability row to serialize concurrent bookings,
  // then check BookedSlot uniqueness, insert BookedSlot + update invite + create outbox events.
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Lock the crew availability row for this day/time to serialize concurrent bookings
      await tx.$queryRaw`
        SELECT id FROM "CrewAvailability"
        WHERE "crewMemberId" = ${slot.crewMemberId}
          AND "dayOfWeek" = ${new Date(slot.date + "T12:00:00Z").getUTCDay()}
          AND "startTime" <= ${slot.time}
          AND "endTime" > ${slot.time}
        FOR UPDATE
      `;

      // Check if slot is already booked (unique constraint will also catch this)
      const existingBooking = await tx.bookedSlot.findFirst({
        where: {
          date: slot.date,
          userName: crewMember.name,
          startTime: slot.time,
        },
      });
      if (existingBooking) {
        throw new SlotTakenError();
      }

      // Create the booked slot
      const bookedSlot = await tx.bookedSlot.create({
        data: {
          date: slot.date,
          startTime: slot.time,
          endTime,
          userName: crewMember.name,
          location: invite.pbLocation,
          projectId: invite.dealId,
          projectName: `Survey - ${invite.customerName}`,
          source: "customer_portal",
        },
      });

      // Create schedule record
      const scheduleRecord = await tx.scheduleRecord.create({
        data: {
          scheduleType: "survey",
          projectId: invite.dealId,
          projectName: `Survey - ${invite.customerName}`,
          scheduledDate: slot.date,
          scheduledStart: slot.time,
          scheduledEnd: endTime,
          assignedUser: crewMember.name,
          assignedUserUid: crewMember.zuperUserUid,
          assignedTeamUid: crewMember.zuperTeamUid || undefined,
          scheduledBy: "Customer Portal",
          scheduledByEmail: invite.customerEmail,
          status: "scheduled",
          notes: accessNotes || undefined,
        },
      });

      // Update the invite
      await tx.surveyInvite.update({
        where: { id: invite.id },
        data: {
          status: "SCHEDULED",
          scheduledAt: new Date(),
          scheduledDate: slot.date,
          scheduledTime: slot.time,
          cutoffAt,
          crewMemberId: slot.crewMemberId,
          scheduleRecordId: scheduleRecord.id,
          accessNotes: accessNotes || undefined,
        },
      });

      // Create outbox events (processed async after commit)
      await tx.outboxEvent.createMany({
        data: [
          {
            type: "zuper_create_job",
            payload: {
              inviteId: invite.id,
              dealId: invite.dealId,
              customerName: invite.customerName,
              propertyAddress: invite.propertyAddress,
              pbLocation: invite.pbLocation,
              scheduledDate: slot.date,
              scheduledTime: slot.time,
              crewMemberId: slot.crewMemberId,
              crewName: crewMember.name,
              crewUserUid: crewMember.zuperUserUid,
              crewTeamUid: crewMember.zuperTeamUid,
            },
            inviteId: invite.id,
            dedupeKey: `zuper_create:${invite.id}`,
            nextRetryAt: new Date(),
          },
          {
            type: "send_confirmation_email",
            payload: {
              inviteId: invite.id,
              customerEmail: invite.customerEmail,
              customerName: invite.customerName,
              propertyAddress: invite.propertyAddress,
              scheduledDate: slot.date,
              scheduledTime: slot.time,
              pbLocation: invite.pbLocation,
              tokenHash: invite.tokenHash,
            },
            inviteId: invite.id,
            dedupeKey: `confirm_email:${invite.id}`,
            nextRetryAt: new Date(),
          },
          {
            type: "send_internal_notification",
            payload: {
              inviteId: invite.id,
              dealId: invite.dealId,
              customerName: invite.customerName,
              propertyAddress: invite.propertyAddress,
              scheduledDate: slot.date,
              scheduledTime: slot.time,
              crewName: crewMember.name,
              pbLocation: invite.pbLocation,
            },
            inviteId: invite.id,
            dedupeKey: `internal_notify:${invite.id}`,
            nextRetryAt: new Date(),
          },
        ],
      });

      // Log activity
      await tx.activityLog.create({
        data: {
          type: "PORTAL_SURVEY_SCHEDULED",
          description: `Customer ${invite.customerName} scheduled survey for ${slot.date} at ${slot.time}`,
          userEmail: invite.customerEmail,
          userName: invite.customerName,
          entityType: "survey_invite",
          entityId: invite.id,
          entityName: invite.customerName,
          pbLocation: invite.pbLocation,
          metadata: {
            dealId: invite.dealId,
            scheduledDate: slot.date,
            scheduledTime: slot.time,
            source: "customer_portal",
          },
          riskLevel: "LOW",
          riskScore: 1,
        },
      });

      return { bookedSlot, scheduleRecord };
    });

    // Build success response
    const responseBody = {
      status: "scheduled",
      booking: {
        date: slot.date,
        time: slot.time,
        propertyAddress: invite.propertyAddress,
        canModify: true,
      },
    };

    // Mark idempotency key as completed with response for replay
    await prisma.idempotencyKey.update({
      where: { key_scope: { key: idempotencyKey, scope } },
      data: { status: "completed", response: responseBody },
    });

    return NextResponse.json(responseBody, { status: 201 });
  } catch (error) {
    if (error instanceof SlotTakenError) {
      await markIdempotencyFailed(idempotencyKey, scope);
      return NextResponse.json(
        { error: "This time slot was just taken. Please select another." },
        { status: 409 },
      );
    }

    // Unique constraint violation on BookedSlot (concurrent race)
    if (isPrismaUniqueViolation(error)) {
      await markIdempotencyFailed(idempotencyKey, scope);
      return NextResponse.json(
        { error: "This time slot was just taken. Please select another." },
        { status: 409 },
      );
    }

    console.error("[portal/book] Unexpected error:", error);
    await markIdempotencyFailed(idempotencyKey, scope);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class SlotTakenError extends Error {
  constructor() {
    super("Slot already taken");
    this.name = "SlotTakenError";
  }
}

function isPrismaUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "P2002"
  );
}

async function markIdempotencyFailed(key: string, scope: string) {
  try {
    await prisma?.idempotencyKey.update({
      where: { key_scope: { key, scope } },
      data: { status: "failed" },
    });
  } catch {
    /* best-effort */
  }
}

/** Convert a local date + time to a UTC Date object */
function localTimeToUtc(dateStr: string, timeStr: string, timezone: string): Date {
  const ref = new Date(dateStr + "T12:00:00Z");
  const localStr = ref.toLocaleString("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const localRef = new Date(localStr);
  const offsetMs = ref.getTime() - localRef.getTime();
  const localTarget = new Date(`${dateStr}T${timeStr}:00`);
  return new Date(localTarget.getTime() + offsetMs);
}
