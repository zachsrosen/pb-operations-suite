/**
 * POST /api/portal/survey/[token]/cancel
 *
 * Public endpoint (no auth). Cancels a scheduled survey if >24h away.
 * Frees the booked slot, updates the invite, then fires side effects inline
 * (Zuper, HubSpot, Google Calendar, emails).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma, getCrewMemberByName } from "@/lib/db";
import { validateToken } from "@/lib/portal-token";
import { getTimezoneForLocation } from "@/lib/constants";
import { zuper } from "@/lib/zuper";
import { updateDealProperty } from "@/lib/hubspot";
import { sendPortalEmail } from "@/lib/email";
import {
  deleteSiteSurveyCalendarEvent,
  getDenverSiteSurveyCalendarId,
  getSharedCalendarImpersonationEmail,
} from "@/lib/google-calendar";

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

  // Resolve crew info before transaction (needed for side effects)
  let crewEmail: string | null = null;
  let crewName: string | null = null;
  if (invite.crewMemberId) {
    const crew = await prisma.crewMember.findUnique({
      where: { id: invite.crewMemberId },
      select: { name: true, email: true },
    });
    crewName = crew?.name || null;
    crewEmail = crew?.email || null;
    if (!crewEmail && crewName) {
      const byName = await getCrewMemberByName(crewName);
      crewEmail = byName?.email || null;
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Free the booked slot
      if (invite.scheduledDate && invite.scheduledTime && crewName) {
        await tx.bookedSlot.deleteMany({
          where: {
            date: invite.scheduledDate,
            userName: crewName,
            startTime: invite.scheduledTime,
            projectId: invite.dealId,
          },
        });
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

    // ----- Fire side effects (best-effort, awaited for durability) -----
    const baseUrl = process.env.PORTAL_BASE_URL
      || process.env.NEXTAUTH_URL
      || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
    const portalUrl = `${baseUrl}/portal/survey/${token}`;

    try {
      await firePostCancelSideEffects({
        invite,
        crewEmail,
        crewName,
        portalUrl,
      });
    } catch (err) {
      console.error("[portal/cancel] Side effect error (non-fatal):", err);
    }

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

// ---------------------------------------------------------------------------
// Post-cancel side effects
// ---------------------------------------------------------------------------

async function firePostCancelSideEffects(ctx: {
  invite: {
    id: string;
    dealId: string;
    customerName: string;
    customerEmail: string;
    propertyAddress: string;
    pbLocation: string;
    scheduledDate: string | null;
    scheduledTime: string | null;
    zuperJobUid: string | null;
    sentBy: string | null;
  };
  crewEmail: string | null;
  crewName: string | null;
  portalUrl: string;
}) {
  const { invite, crewEmail, crewName } = ctx;
  const warnings: string[] = [];
  const timezone = getTimezoneForLocation(invite.pbLocation);

  // 1. Unschedule in Zuper (clear scheduled times + unassign)
  if (invite.zuperJobUid && zuper.isConfigured()) {
    try {
      const unscheduleResult = await zuper.unscheduleJob(invite.zuperJobUid);
      if (unscheduleResult.type === "success") {
        console.log(`[portal/cancel] Zuper job unscheduled: ${invite.zuperJobUid}`);
      } else {
        warnings.push(`Zuper unschedule failed: ${unscheduleResult.error}`);
      }
    } catch (err) {
      warnings.push(`Zuper unschedule error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 2. Clear HubSpot schedule date + surveyor
  try {
    await updateDealProperty(invite.dealId, {
      site_survey_schedule_date: "",
      site_surveyor: "",
    });
  } catch (err) {
    warnings.push(`HubSpot property clear error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 3. Delete Google Calendar events
  if (crewEmail) {
    // Personal calendar
    try {
      const personalResult = await deleteSiteSurveyCalendarEvent({
        projectId: invite.dealId,
        surveyorEmail: crewEmail,
        calendarId: "primary",
        impersonateEmail: crewEmail,
      });
      if (!personalResult.success) {
        warnings.push(`Google Calendar personal delete: ${personalResult.error}`);
      }
    } catch (err) {
      warnings.push(`Google Calendar personal error: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Shared survey calendar
    const sharedCalendarId = getSiteSurveySharedCalendarIdForSurveyor(crewEmail);
    if (sharedCalendarId) {
      try {
        const sharedResult = await deleteSiteSurveyCalendarEvent({
          projectId: invite.dealId,
          calendarId: sharedCalendarId,
          impersonateEmail:
            getSiteSurveySharedCalendarImpersonationEmail(crewEmail) || crewEmail,
        });
        if (!sharedResult.success) {
          warnings.push(`Google Calendar shared delete: ${sharedResult.error}`);
        }
      } catch (err) {
        warnings.push(`Google Calendar shared error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // 4. Send customer cancellation email
  try {
    const formattedDate = invite.scheduledDate
      ? new Date(invite.scheduledDate + "T12:00:00Z").toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
          timeZone: "UTC",
        })
      : "your scheduled date";
    const tzAbbrev = timezone === "America/Los_Angeles" ? "PT" : "MT";
    const formattedTime = invite.scheduledTime ? formatTime12(invite.scheduledTime) : "";

    await sendPortalEmail({
      to: invite.customerEmail,
      subject: "Your Site Survey Has Been Cancelled - Photon Brothers",
      html: buildCancellationEmailHtml({
        customerName: invite.customerName,
        formattedDate,
        formattedTime,
        tzAbbrev,
        propertyAddress: invite.propertyAddress,
        portalUrl: ctx.portalUrl,
      }),
      senderEmail: invite.sentBy || undefined,
    });
    console.log(`[portal/cancel] Cancellation email sent to ${invite.customerEmail}`);
  } catch (err) {
    warnings.push(`Customer cancellation email failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (warnings.length > 0) {
    console.warn(`[portal/cancel] Side effect warnings for deal ${invite.dealId}:`, warnings);
  }
}

// ---------------------------------------------------------------------------
// Shared calendar helpers
// ---------------------------------------------------------------------------

function isNickSurveyorEmail(email?: string | null): boolean {
  const normalized = (email || "").trim().toLowerCase();
  return normalized === "nick.scarpellino@photonbrothers.com" || normalized === "nick@photonbrothers.com";
}

function getNickSiteSurveyCalendarId(): string | null {
  return (
    (process.env.GOOGLE_SITE_SURVEY_NICK_CALENDAR_ID || "").trim() ||
    (process.env.GOOGLE_NICK_SITE_SURVEY_CALENDAR_ID || "").trim() ||
    null
  );
}

function getSiteSurveySharedCalendarIdForSurveyor(email?: string | null): string | null {
  if (isNickSurveyorEmail(email)) {
    return getNickSiteSurveyCalendarId() || getDenverSiteSurveyCalendarId();
  }
  return getDenverSiteSurveyCalendarId();
}

function getSiteSurveySharedCalendarImpersonationEmail(email?: string | null): string | null {
  if (isNickSurveyorEmail(email)) {
    return (email || "").trim().toLowerCase() || getSharedCalendarImpersonationEmail();
  }
  return getSharedCalendarImpersonationEmail() || (email || "").trim().toLowerCase() || null;
}

// ---------------------------------------------------------------------------
// Cancellation email HTML
// ---------------------------------------------------------------------------

function buildCancellationEmailHtml(params: {
  customerName: string;
  formattedDate: string;
  formattedTime: string;
  tzAbbrev: string;
  propertyAddress: string;
  portalUrl: string;
}): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #f97316;">Your Site Survey Has Been Cancelled</h2>
      <p>Hi ${escapeHtml(extractFirstName(params.customerName))},</p>
      <p>Your site survey has been cancelled. Here were the original details:</p>
      <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <p style="margin: 4px 0;"><strong>Date:</strong> ${escapeHtml(params.formattedDate)}</p>
        ${params.formattedTime ? `<p style="margin: 4px 0;"><strong>Time:</strong> ${escapeHtml(params.formattedTime)} ${escapeHtml(params.tzAbbrev)}</p>` : ""}
        <p style="margin: 4px 0;"><strong>Location:</strong> ${escapeHtml(params.propertyAddress)}</p>
      </div>
      <p>If you'd like to reschedule, click the button below to pick a new time:</p>
      <div style="text-align: center; margin: 24px 0;">
        <a href="${escapeHtml(params.portalUrl)}" style="display: inline-block; background-color: #f97316; color: #ffffff; font-size: 16px; font-weight: 600; text-decoration: none; border-radius: 8px; padding: 12px 32px;">Reschedule Survey</a>
      </div>
      <p style="margin-top: 24px;">Thank you for choosing Photon Brothers!</p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
      <p style="color: #6b7280; font-size: 12px;">Photon Brothers Solar</p>
    </div>
  `;
}

/** Extract first name from "Last, First" or "First Last" format */
function extractFirstName(name: string): string {
  if (name.includes(",")) {
    return name.split(",")[1]?.trim().split(" ")[0] || name;
  }
  return name.split(" ")[0] || name;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function markFailed(key: string, scope: string) {
  try {
    await prisma?.idempotencyKey.update({
      where: { key_scope: { key, scope } },
      data: { status: "failed" },
    });
  } catch { /* best-effort */ }
}

/** "09:00" → "9:00 AM" */
function formatTime12(time: string): string {
  const [hr, min] = time.split(":").map(Number);
  const period = hr >= 12 ? "PM" : "AM";
  const hour12 = hr === 0 ? 12 : hr > 12 ? hr - 12 : hr;
  return `${hour12}:${min.toString().padStart(2, "0")} ${period}`;
}
