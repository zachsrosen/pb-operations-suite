/**
 * POST /api/portal/survey/[token]/cancel
 *
 * Public endpoint (no auth). Cancels a scheduled survey if >24h away.
 * Frees the booked slot, updates the invite, and queues Zuper + email via outbox.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { validateToken } from "@/lib/portal-token";

const CancelSchema = z.object({
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

  if (invite.status !== "SCHEDULED" && invite.status !== "RESCHEDULED") {
    return NextResponse.json({ error: "No active booking to cancel" }, { status: 409 });
  }

  // Check 24h cutoff
  if (!invite.cutoffAt || new Date() >= invite.cutoffAt) {
    return NextResponse.json(
      { error: "Changes are no longer allowed within 24 hours of your survey" },
      { status: 409 },
    );
  }

  // Parse body
  let body: z.infer<typeof CancelSchema>;
  try {
    body = CancelSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { idempotencyKey } = body;

  // Idempotency check
  const scope = `cancel:${invite.tokenHash}`;
  const existingKey = await prisma.idempotencyKey.findUnique({
    where: { key_scope: { key: idempotencyKey, scope } },
  });
  if (existingKey) {
    if (existingKey.status === "completed" && existingKey.response) {
      return NextResponse.json(existingKey.response, { status: 200 });
    }
    if (existingKey.status === "processing") {
      return NextResponse.json({ error: "Cancellation already in progress" }, { status: 409 });
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

  try {
    await prisma.$transaction(async (tx) => {
      // Free the booked slot
      if (invite.scheduledDate && invite.scheduledTime && invite.crewMemberId) {
        const crew = await tx.crewMember.findUnique({
          where: { id: invite.crewMemberId },
          select: { name: true },
        });
        if (crew) {
          await tx.bookedSlot.deleteMany({
            where: {
              date: invite.scheduledDate,
              userName: crew.name,
              startTime: invite.scheduledTime,
              projectId: invite.dealId,
            },
          });
        }
      }

      // Mark schedule record as cancelled
      if (invite.scheduleRecordId) {
        await tx.scheduleRecord.update({
          where: { id: invite.scheduleRecordId },
          data: { status: "cancelled" },
        });
      }

      // Update invite status
      await tx.surveyInvite.update({
        where: { id: invite.id },
        data: { status: "CANCELLED" },
      });

      // Outbox: Zuper cancel + emails
      await tx.outboxEvent.createMany({
        data: [
          {
            type: "zuper_cancel_job",
            payload: {
              inviteId: invite.id,
              zuperJobUid: invite.zuperJobUid,
              dealId: invite.dealId,
            },
            inviteId: invite.id,
            dedupeKey: `zuper_cancel:${invite.id}`,
            nextRetryAt: new Date(),
          },
          {
            type: "send_cancellation_email",
            payload: {
              inviteId: invite.id,
              customerEmail: invite.customerEmail,
              customerName: invite.customerName,
              propertyAddress: invite.propertyAddress,
              scheduledDate: invite.scheduledDate,
              scheduledTime: invite.scheduledTime,
              pbLocation: invite.pbLocation,
            },
            inviteId: invite.id,
            dedupeKey: `cancel_email:${invite.id}`,
            nextRetryAt: new Date(),
          },
        ],
      });

      // Log
      await tx.activityLog.create({
        data: {
          type: "PORTAL_SURVEY_CANCELLED",
          description: `Customer ${invite.customerName} cancelled survey for ${invite.scheduledDate} at ${invite.scheduledTime}`,
          userEmail: invite.customerEmail,
          userName: invite.customerName,
          entityType: "survey_invite",
          entityId: invite.id,
          pbLocation: invite.pbLocation,
          metadata: {
            dealId: invite.dealId,
            cancelledDate: invite.scheduledDate,
            cancelledTime: invite.scheduledTime,
            source: "customer_portal",
          },
          riskLevel: "LOW",
          riskScore: 1,
        },
      });
    });

    const responseBody = { status: "cancelled" };

    await prisma.idempotencyKey.update({
      where: { key_scope: { key: idempotencyKey, scope } },
      data: { status: "completed", response: responseBody },
    });

    return NextResponse.json(responseBody, { status: 200 });
  } catch (error) {
    console.error("[portal/cancel] Unexpected error:", error);
    await markFailed(idempotencyKey, scope);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

async function markFailed(key: string, scope: string) {
  try {
    await prisma?.idempotencyKey.update({
      where: { key_scope: { key, scope } },
      data: { status: "failed" },
    });
  } catch { /* best-effort */ }
}
