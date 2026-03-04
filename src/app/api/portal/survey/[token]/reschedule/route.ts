/**
 * PUT /api/portal/survey/[token]/reschedule
 *
 * Public endpoint (no auth). Allows a customer to change their survey slot
 * if the existing booking is >24h away (checked via pre-computed cutoffAt).
 *
 * Reliability: same outbox pattern as booking — DB transaction first,
 * Zuper update + emails dispatched async.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { validateToken } from "@/lib/portal-token";
import { decodeSlotId } from "@/lib/portal-availability";
import { getTimezoneForLocation } from "@/lib/constants";

const RescheduleSchema = z.object({
  slotId: z.string().min(1),
  idempotencyKey: z.string().uuid(),
});

export async function PUT(
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

  if (invite.status !== "SCHEDULED" && invite.status !== "RESCHEDULED") {
    return NextResponse.json(
      { error: "No existing booking to reschedule" },
      { status: 409 },
    );
  }

  // Check 24h cutoff (pre-computed, DST-safe)
  if (!invite.cutoffAt || new Date() >= invite.cutoffAt) {
    return NextResponse.json(
      { error: "Changes are no longer allowed within 24 hours of your survey" },
      { status: 409 },
    );
  }

  // Parse body
  let body: z.infer<typeof RescheduleSchema>;
  try {
    body = RescheduleSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { slotId, idempotencyKey } = body;

  // Idempotency check
  const scope = `reschedule:${invite.tokenHash}`;
  const existingKey = await prisma.idempotencyKey.findUnique({
    where: { key_scope: { key: idempotencyKey, scope } },
  });
  if (existingKey) {
    if (existingKey.status === "completed" && existingKey.response) {
      return NextResponse.json(existingKey.response, { status: 200 });
    }
    if (existingKey.status === "processing") {
      return NextResponse.json({ error: "Reschedule already in progress" }, { status: 409 });
    }
    await prisma.idempotencyKey.delete({
      where: { key_scope: { key: idempotencyKey, scope } },
    });
  }

  await prisma.idempotencyKey.create({
    data: {
      key: idempotencyKey,
      scope,
      status: "processing",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  // Decode new slot
  const newSlot = decodeSlotId(slotId);
  if (!newSlot) {
    await markFailed(idempotencyKey, scope);
    return NextResponse.json({ error: "Invalid time slot" }, { status: 400 });
  }

  const timezone = getTimezoneForLocation(invite.pbLocation);
  const newStartUtc = localTimeToUtc(newSlot.date, newSlot.time, timezone);
  const newCutoffAt = new Date(newStartUtc.getTime() - 24 * 60 * 60 * 1000);

  if (newStartUtc <= new Date(Date.now() + 48 * 60 * 60 * 1000)) {
    await markFailed(idempotencyKey, scope);
    return NextResponse.json(
      { error: "This time slot is no longer available" },
      { status: 409 },
    );
  }

  const crewMember = await prisma.crewMember.findUnique({
    where: { id: newSlot.crewMemberId },
    select: { name: true, zuperUserUid: true, zuperTeamUid: true },
  });
  if (!crewMember) {
    await markFailed(idempotencyKey, scope);
    return NextResponse.json({ error: "This time slot is no longer available" }, { status: 409 });
  }

  const [h, m] = newSlot.time.split(":").map(Number);
  const endTime = `${(h + 1).toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;

  try {
    await prisma.$transaction(async (tx) => {
      // Lock new slot
      await tx.$queryRaw`
        SELECT id FROM "CrewAvailability"
        WHERE "crewMemberId" = ${newSlot.crewMemberId}
          AND "dayOfWeek" = ${new Date(newSlot.date + "T12:00:00Z").getUTCDay()}
          AND "startTime" <= ${newSlot.time}
          AND "endTime" > ${newSlot.time}
        FOR UPDATE
      `;

      // Check new slot available
      const taken = await tx.bookedSlot.findFirst({
        where: { date: newSlot.date, userName: crewMember.name, startTime: newSlot.time },
      });
      if (taken) throw new SlotTakenError();

      // Free old slot
      if (invite.scheduledDate && invite.scheduledTime && invite.crewMemberId) {
        const oldCrew = await tx.crewMember.findUnique({
          where: { id: invite.crewMemberId },
          select: { name: true },
        });
        if (oldCrew) {
          await tx.bookedSlot.deleteMany({
            where: {
              date: invite.scheduledDate,
              userName: oldCrew.name,
              startTime: invite.scheduledTime,
              projectId: invite.dealId,
            },
          });
        }
      }

      // Book new slot
      await tx.bookedSlot.create({
        data: {
          date: newSlot.date,
          startTime: newSlot.time,
          endTime,
          userName: crewMember.name,
          location: invite.pbLocation,
          projectId: invite.dealId,
          projectName: `Survey - ${invite.customerName}`,
          source: "customer_portal",
        },
      });

      // Update schedule record
      if (invite.scheduleRecordId) {
        await tx.scheduleRecord.update({
          where: { id: invite.scheduleRecordId },
          data: { status: "rescheduled" },
        });
      }

      // Create new schedule record
      const newScheduleRecord = await tx.scheduleRecord.create({
        data: {
          scheduleType: "survey",
          projectId: invite.dealId,
          projectName: `Survey - ${invite.customerName}`,
          scheduledDate: newSlot.date,
          scheduledStart: newSlot.time,
          scheduledEnd: endTime,
          assignedUser: crewMember.name,
          assignedUserUid: crewMember.zuperUserUid,
          assignedTeamUid: crewMember.zuperTeamUid || undefined,
          scheduledBy: "Customer Portal",
          scheduledByEmail: invite.customerEmail,
          status: "scheduled",
        },
      });

      // Update invite (relink to new schedule record)
      await tx.surveyInvite.update({
        where: { id: invite.id },
        data: {
          status: "RESCHEDULED",
          scheduledAt: new Date(),
          scheduledDate: newSlot.date,
          scheduledTime: newSlot.time,
          cutoffAt: newCutoffAt,
          crewMemberId: newSlot.crewMemberId,
          scheduleRecordId: newScheduleRecord.id,
        },
      });

      // Outbox: Zuper update + emails
      await tx.outboxEvent.createMany({
        data: [
          {
            type: "zuper_update_job",
            payload: {
              inviteId: invite.id,
              zuperJobUid: invite.zuperJobUid,
              newDate: newSlot.date,
              newTime: newSlot.time,
              crewUserUid: crewMember.zuperUserUid,
              crewTeamUid: crewMember.zuperTeamUid,
            },
            inviteId: invite.id,
            dedupeKey: `zuper_reschedule:${invite.id}:${newSlot.date}:${newSlot.time}`,
            nextRetryAt: new Date(),
          },
          {
            type: "send_reschedule_email",
            payload: {
              inviteId: invite.id,
              customerEmail: invite.customerEmail,
              customerName: invite.customerName,
              propertyAddress: invite.propertyAddress,
              scheduledDate: newSlot.date,
              scheduledTime: newSlot.time,
              pbLocation: invite.pbLocation,
            },
            inviteId: invite.id,
            dedupeKey: `reschedule_email:${invite.id}:${newSlot.date}:${newSlot.time}`,
            nextRetryAt: new Date(),
          },
        ],
      });

      // Log
      await tx.activityLog.create({
        data: {
          type: "PORTAL_SURVEY_RESCHEDULED",
          description: `Customer ${invite.customerName} rescheduled survey to ${newSlot.date} at ${newSlot.time}`,
          userEmail: invite.customerEmail,
          userName: invite.customerName,
          entityType: "survey_invite",
          entityId: invite.id,
          pbLocation: invite.pbLocation,
          metadata: {
            dealId: invite.dealId,
            oldDate: invite.scheduledDate,
            oldTime: invite.scheduledTime,
            newDate: newSlot.date,
            newTime: newSlot.time,
            source: "customer_portal",
          },
          riskLevel: "LOW",
          riskScore: 1,
        },
      });
    });

    const responseBody = {
      status: "rescheduled",
      booking: {
        date: newSlot.date,
        time: newSlot.time,
        propertyAddress: invite.propertyAddress,
        canModify: true,
      },
    };

    await prisma.idempotencyKey.update({
      where: { key_scope: { key: idempotencyKey, scope } },
      data: { status: "completed", response: responseBody },
    });

    return NextResponse.json(responseBody, { status: 200 });
  } catch (error) {
    if (error instanceof SlotTakenError || isPrismaUniqueViolation(error)) {
      await markFailed(idempotencyKey, scope);
      return NextResponse.json(
        { error: "This time slot was just taken. Please select another." },
        { status: 409 },
      );
    }

    console.error("[portal/reschedule] Unexpected error:", error);
    await markFailed(idempotencyKey, scope);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
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

async function markFailed(key: string, scope: string) {
  try {
    await prisma?.idempotencyKey.update({
      where: { key_scope: { key, scope } },
      data: { status: "failed" },
    });
  } catch { /* best-effort */ }
}

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
