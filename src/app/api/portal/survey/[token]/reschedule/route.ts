/**
 * PUT /api/portal/survey/[token]/reschedule
 *
 * Public endpoint (no auth). Allows a customer to change their survey slot
 * if the existing booking is >24h away (checked via pre-computed cutoffAt).
 *
 * Reliability: DB transaction first, then side effects fire inline
 * (same pattern as the booking endpoint). Side effect failures are logged
 * but don't fail the reschedule.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma, cacheZuperJob, getCrewMemberByName } from "@/lib/db";
import { validateToken } from "@/lib/portal-token";
import { decodeSlotId, getDayOfWeekForTz } from "@/lib/portal-availability";
import { getTimezoneForLocation } from "@/lib/constants";
import { zuper } from "@/lib/zuper";
import { updateDealProperty, getDealProperties, updateSiteSurveyorProperty } from "@/lib/hubspot";
import { sendSchedulingNotification, sendPortalEmail } from "@/lib/email";
import {
  upsertSiteSurveyCalendarEvent,
  getDenverSiteSurveyCalendarId,
  getSharedCalendarImpersonationEmail,
  getSurveyCalendarEventId,
} from "@/lib/google-calendar";
import { getGoogleCalendarEventUrl } from "@/lib/external-links";

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
    select: { name: true, email: true, zuperUserUid: true, zuperTeamUid: true },
  });
  if (!crewMember) {
    await markFailed(idempotencyKey, scope);
    return NextResponse.json({ error: "This time slot is no longer available" }, { status: 409 });
  }

  const [h, m] = newSlot.time.split(":").map(Number);
  const endTime = `${(h + 1).toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Lock new slot — use timezone-aware day-of-week
      const dayOfWeek = getDayOfWeekForTz(newSlot.date, timezone);
      await tx.$queryRaw`
        SELECT id FROM "CrewAvailability"
        WHERE "crewMemberId" = ${newSlot.crewMemberId}
          AND "dayOfWeek" = ${dayOfWeek}
          AND "startTime" <= ${newSlot.time}
          AND "endTime" > ${newSlot.time}
        FOR UPDATE
      `;

      // Check new slot available
      const taken = await tx.bookedSlot.findFirst({
        where: { date: newSlot.date, userName: crewMember.name, startTime: newSlot.time },
      });
      const conflictingSchedule = await tx.scheduleRecord.findFirst({
        where: {
          scheduleType: "survey",
          status: { in: ["scheduled", "tentative"] },
          scheduledDate: newSlot.date,
          scheduledStart: { in: [newSlot.time, `${newSlot.time}:00`] },
          OR: [
            { assignedUserUid: crewMember.zuperUserUid },
            { assignedUser: crewMember.name },
          ],
        },
        select: { projectId: true },
      });
      // Allow conflict if it's for the same deal (we're rescheduling it)
      if (taken || (conflictingSchedule && conflictingSchedule.projectId !== invite.dealId)) {
        throw new SlotTakenError();
      }

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

      // Update old schedule record
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

      return { newScheduleRecord };
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

    // ----- Fire side effects (best-effort, awaited for durability) -----
    try {
      await firePostRescheduleSideEffects({
        invite,
        newSlot,
        endTime,
        timezone,
        crewMember,
        scheduleRecordId: result.newScheduleRecord.id,
      });
    } catch (err) {
      console.error("[portal/reschedule] Side effect error (non-fatal):", err);
    }

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
// Post-reschedule side effects — mirrors booking's firePostBookingSideEffects
// ---------------------------------------------------------------------------

async function firePostRescheduleSideEffects(ctx: {
  invite: {
    id: string;
    dealId: string;
    customerName: string;
    customerEmail: string;
    customerPhone: string | null;
    propertyAddress: string;
    pbLocation: string;
    systemSize: number | null;
    zuperJobUid: string | null;
    sentBy?: string | null;
  };
  newSlot: { date: string; time: string; crewMemberId: string };
  endTime: string;
  timezone: string;
  crewMember: {
    name: string;
    email: string | null;
    zuperUserUid: string;
    zuperTeamUid: string | null;
  };
  scheduleRecordId: string;
}) {
  const { invite, newSlot, endTime, timezone, crewMember } = ctx;
  const warnings: string[] = [];

  // 1. Fetch deal properties from HubSpot
  const dealProps = await getDealProperties(invite.dealId, [
    "dealname",
    "property_address",
    "deal_owner_name",
  ]);

  const projectName = dealProps?.dealname || `PROJ | ${invite.customerName} | ${invite.propertyAddress}`;
  const dealOwnerName = dealProps?.deal_owner_name || undefined;

  // 2. Reschedule in Zuper (or create if no job exists)
  if (invite.zuperJobUid && zuper.isConfigured()) {
    try {
      const startUtc = localTimeToUtcString(newSlot.date, newSlot.time, timezone);
      const endUtc = localTimeToUtcString(newSlot.date, endTime, timezone);
      const rescheduleResult = await zuper.rescheduleJob(
        invite.zuperJobUid,
        startUtc,
        endUtc,
        [crewMember.zuperUserUid],
        crewMember.zuperTeamUid || undefined,
      );
      if (rescheduleResult.type === "success") {
        console.log(`[portal/reschedule] Zuper job rescheduled: ${invite.zuperJobUid}`);
      } else {
        warnings.push(`Zuper reschedule failed: ${rescheduleResult.error}`);
      }
    } catch (err) {
      warnings.push(`Zuper reschedule error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 3. Update schedule record with Zuper info
  if (invite.zuperJobUid) {
    try {
      await prisma?.scheduleRecord.update({
        where: { id: ctx.scheduleRecordId },
        data: { zuperJobUid: invite.zuperJobUid, zuperSynced: true, zuperAssigned: true },
      });
    } catch (err) {
      warnings.push(`Schedule record update error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 4. Cache the Zuper job
  if (invite.zuperJobUid) {
    try {
      const parsedStart = localTimeToUtc(newSlot.date, newSlot.time, timezone);
      const parsedEnd = localTimeToUtc(newSlot.date, endTime, timezone);
      await cacheZuperJob({
        jobUid: invite.zuperJobUid,
        jobTitle: `survey - ${projectName}`,
        jobCategory: "Site Survey",
        jobStatus: "SCHEDULED",
        hubspotDealId: invite.dealId,
        projectName,
        scheduledStart: parsedStart,
        scheduledEnd: parsedEnd,
      });
    } catch (err) {
      warnings.push(`Cache Zuper job failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 5. Update HubSpot schedule date
  try {
    const dateUpdated = await updateDealProperty(invite.dealId, {
      site_survey_schedule_date: newSlot.date,
    });
    if (!dateUpdated) {
      warnings.push("HubSpot site_survey_schedule_date write failed");
    }
  } catch (err) {
    warnings.push(`HubSpot date update error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 6. Update HubSpot site_surveyor
  try {
    const surveyorUpdated = await updateSiteSurveyorProperty(invite.dealId, crewMember.name);
    if (!surveyorUpdated) {
      warnings.push("HubSpot site_surveyor write failed");
    }
  } catch (err) {
    warnings.push(`HubSpot surveyor update error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 7. Resolve crew email
  let crewEmail = crewMember.email;
  if (!crewEmail) {
    const byName = await getCrewMemberByName(crewMember.name);
    crewEmail = byName?.email || null;
  }

  // 8. Send crew notification email
  if (crewEmail) {
    try {
      await sendSchedulingNotification({
        to: crewEmail,
        crewMemberName: crewMember.name,
        scheduledByName: "Customer Portal",
        scheduledByEmail: invite.sentBy || "portal@photonbrothers.com",
        dealOwnerName: dealOwnerName || undefined,
        appointmentType: "survey",
        customerName: invite.customerName,
        customerAddress: invite.propertyAddress,
        scheduledDate: newSlot.date,
        scheduledStart: newSlot.time,
        scheduledEnd: endTime,
        projectId: invite.dealId,
        zuperJobUid: invite.zuperJobUid || undefined,
        googleCalendarEventUrl:
          getGoogleCalendarEventUrl(getSurveyCalendarEventId(invite.dealId), crewEmail) || undefined,
        notes: `Rescheduled by customer via portal`,
      });
      console.log(`[portal/reschedule] Crew notification sent to ${crewEmail}`);
    } catch (err) {
      warnings.push(`Crew notification failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    warnings.push(`No crew email found for ${crewMember.name}, skipping notification`);
  }

  // 9. Google Calendar — upsert with new time (replaces old event via deterministic event ID)
  if (crewEmail) {
    try {
      const personalResult = await upsertSiteSurveyCalendarEvent({
        surveyorEmail: crewEmail,
        surveyorName: crewMember.name,
        projectId: invite.dealId,
        projectName,
        customerName: invite.customerName,
        customerAddress: invite.propertyAddress,
        date: newSlot.date,
        startTime: newSlot.time,
        endTime,
        timezone,
        notes: `Rescheduled by customer via portal`,
        zuperJobUid: invite.zuperJobUid || undefined,
        calendarId: "primary",
        impersonateEmail: crewEmail,
      });
      if (!personalResult.success) {
        warnings.push(`Google Calendar personal sync: ${personalResult.error}`);
      }
    } catch (err) {
      warnings.push(`Google Calendar personal error: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Shared survey calendar
    const sharedCalendarId = getSiteSurveySharedCalendarIdForSurveyor(crewEmail);
    if (sharedCalendarId) {
      try {
        const sharedResult = await upsertSiteSurveyCalendarEvent({
          surveyorEmail: crewEmail,
          surveyorName: crewMember.name,
          projectId: invite.dealId,
          projectName,
          customerName: invite.customerName,
          customerAddress: invite.propertyAddress,
          date: newSlot.date,
          startTime: newSlot.time,
          endTime,
          timezone,
          notes: `Rescheduled by customer via portal`,
          zuperJobUid: invite.zuperJobUid || undefined,
          calendarId: sharedCalendarId,
          impersonateEmail:
            getSiteSurveySharedCalendarImpersonationEmail(crewEmail) || crewEmail,
        });
        if (!sharedResult.success) {
          warnings.push(`Google Calendar shared sync: ${sharedResult.error}`);
        }
      } catch (err) {
        warnings.push(`Google Calendar shared error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // 10. Send customer reschedule confirmation email
  try {
    const formattedDate = new Date(newSlot.date + "T12:00:00Z").toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
    const tzAbbrev = timezone === "America/Los_Angeles" ? "PT" : "MT";
    const formattedTime = formatTime12(newSlot.time);

    await sendPortalEmail({
      to: invite.customerEmail,
      subject: "Your Site Survey Has Been Rescheduled - Photon Brothers",
      html: buildRescheduleEmailHtml({
        customerName: invite.customerName,
        formattedDate,
        formattedTime,
        tzAbbrev,
        propertyAddress: invite.propertyAddress,
      }),
      senderEmail: invite.sentBy || undefined,
    });
    console.log(`[portal/reschedule] Confirmation email sent to ${invite.customerEmail}`);
  } catch (err) {
    warnings.push(`Customer confirmation email failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (warnings.length > 0) {
    console.warn(`[portal/reschedule] Side effect warnings for deal ${invite.dealId}:`, warnings);
  }
}

// ---------------------------------------------------------------------------
// Shared calendar helpers (mirrored from booking route)
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
// Reschedule email HTML
// ---------------------------------------------------------------------------

function buildRescheduleEmailHtml(params: {
  customerName: string;
  formattedDate: string;
  formattedTime: string;
  tzAbbrev: string;
  propertyAddress: string;
}): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #f97316;">Your Site Survey Has Been Rescheduled</h2>
      <p>Hi ${escapeHtml(extractFirstName(params.customerName))},</p>
      <p>Your site survey has been rescheduled. Here are the updated details:</p>
      <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <p style="margin: 4px 0;"><strong>Date:</strong> ${escapeHtml(params.formattedDate)}</p>
        <p style="margin: 4px 0;"><strong>Time:</strong> ${escapeHtml(params.formattedTime)} ${escapeHtml(params.tzAbbrev)}</p>
        <p style="margin: 4px 0;"><strong>Location:</strong> ${escapeHtml(params.propertyAddress)}</p>
      </div>
      <p>A Photon Brothers surveyor will visit your property at the scheduled time. Please ensure access to your electrical panel and roof area.</p>
      <p>If you need to make further changes, please contact us as soon as possible.</p>
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

/** Convert local date + time to UTC string "YYYY-MM-DD HH:mm:ss" for Zuper API */
function localTimeToUtcString(dateStr: string, timeStr: string, timezone: string): string {
  const utc = localTimeToUtc(dateStr, timeStr, timezone);
  const y = utc.getUTCFullYear();
  const mo = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const d = String(utc.getUTCDate()).padStart(2, "0");
  const hr = String(utc.getUTCHours()).padStart(2, "0");
  const mi = String(utc.getUTCMinutes()).padStart(2, "0");
  return `${y}-${mo}-${d} ${hr}:${mi}:00`;
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

/** "09:00" → "9:00 AM" */
function formatTime12(time: string): string {
  const [hr, min] = time.split(":").map(Number);
  const period = hr >= 12 ? "PM" : "AM";
  const hour12 = hr === 0 ? 12 : hr > 12 ? hr - 12 : hr;
  return `${hour12}:${min.toString().padStart(2, "0")} ${period}`;
}
