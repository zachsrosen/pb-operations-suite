/**
 * POST /api/portal/survey/[token]/book
 *
 * Public endpoint (no auth). Books a survey slot for the customer.
 *
 * Reliability model:
 * - DB transaction: BookedSlot + SurveyInvite update (atomic)
 * - Side effects (Zuper, HubSpot, Calendar, email) fire inline after commit
 * - Side effect failures are logged but don't fail the booking
 * - Idempotency: duplicate submissions return the same booking
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma, cacheZuperJob, getCrewMemberByName, getCachedZuperJobByDealId } from "@/lib/db";
import { validateToken } from "@/lib/portal-token";
import { decodeSlotId, getDayOfWeekForTz } from "@/lib/portal-availability";
import { getTimezoneForLocation } from "@/lib/constants";
import { zuper, createJobFromProject, type ZuperJob } from "@/lib/zuper";
import { updateDealProperty, getDealProperties, updateSiteSurveyorProperty } from "@/lib/hubspot";
import { sendSchedulingNotification, sendPortalEmail } from "@/lib/email";
import {
  upsertSiteSurveyCalendarEvent,
  getDenverSiteSurveyCalendarId,
  getSharedCalendarImpersonationEmail,
  getSurveyCalendarEventId,
} from "@/lib/google-calendar";
import { getGoogleCalendarEventUrl } from "@/lib/external-links";

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

  if (invite.status !== "PENDING" && invite.status !== "CANCELLED") {
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

  // ----- Get crew member for the BookedSlot -----
  const crewMember = await prisma.crewMember.findUnique({
    where: { id: slot.crewMemberId },
    select: { name: true, email: true, zuperUserUid: true, zuperTeamUid: true },
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
  // then check BookedSlot uniqueness, insert BookedSlot + update invite.
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Lock the crew availability row for this day/time to serialize concurrent bookings
      const dayOfWeek = getDayOfWeekForTz(slot.date, timezone);
      await tx.$queryRaw`
        SELECT id FROM "CrewAvailability"
        WHERE "crewMemberId" = ${slot.crewMemberId}
          AND "dayOfWeek" = ${dayOfWeek}
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
      const existingSchedule = await tx.scheduleRecord.findFirst({
        where: {
          scheduleType: "survey",
          status: { in: ["scheduled", "tentative"] },
          scheduledDate: slot.date,
          scheduledStart: { in: [slot.time, `${slot.time}:00`] },
          OR: [
            { assignedUserUid: crewMember.zuperUserUid },
            { assignedUser: crewMember.name },
          ],
        },
        select: { projectId: true },
      });

      if (existingBooking || existingSchedule) {
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

    // ----- Fire side effects (best-effort, awaited for durability) -----
    // Run before marking idempotency complete so a retry re-runs them if the
    // process dies mid-flight.
    try {
      await firePostBookingSideEffects({
        invite,
        slot,
        endTime,
        timezone,
        crewMember,
        accessNotes,
        scheduleRecordId: result.scheduleRecord.id,
      });
    } catch (err) {
      console.error("[portal/book] Side effect error (non-fatal):", err);
    }

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

    const errMsg = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? error.stack : undefined;
    console.error("[portal/book] Unexpected error:", {
      message: errMsg,
      stack: errStack,
      inviteId: invite.id,
      dealId: invite.dealId,
      slotDate: slot.date,
      slotTime: slot.time,
      crewMemberId: slot.crewMemberId,
      pbLocation: invite.pbLocation,
    });
    await markIdempotencyFailed(idempotencyKey, scope);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// Post-booking side effects — same actions as the internal scheduler
// ---------------------------------------------------------------------------

async function firePostBookingSideEffects(ctx: {
  invite: {
    id: string;
    dealId: string;
    customerName: string;
    customerEmail: string;
    customerPhone: string | null;
    propertyAddress: string;
    pbLocation: string;
    systemSize: number | null;
    sentBy?: string | null;
  };
  slot: { date: string; time: string; crewMemberId: string };
  endTime: string;
  timezone: string;
  crewMember: {
    name: string;
    email: string | null;
    zuperUserUid: string;
    zuperTeamUid: string | null;
  };
  accessNotes: string | undefined;
  scheduleRecordId: string;
}) {
  const { invite, slot, endTime, timezone, crewMember, accessNotes } = ctx;
  const warnings: string[] = [];

  // 1. Fetch deal properties from HubSpot to build the project object
  const dealProps = await getDealProperties(invite.dealId, [
    "dealname",
    "property_address",
    "property_city",
    "property_state",
    "property_zip",
    "system_size_kw",
    "number_of_batteries",
    "project_type",
    "deal_owner_name",
  ]);

  const projectName = dealProps?.dealname || `PROJ | ${invite.customerName} | ${invite.propertyAddress}`;
  const projectAddress = dealProps?.property_address || invite.propertyAddress;
  const projectCity = dealProps?.property_city || "";
  const projectState = dealProps?.property_state || "";
  const projectZip = dealProps?.property_zip || "";
  const dealOwnerName = dealProps?.deal_owner_name || undefined;

  // 2. Find existing Zuper job or create new — same search-first logic as internal scheduler
  //    Jobs almost always exist by the time a deal reaches site survey stage.
  let zuperJobUid: string | undefined;
  let matchMethod = "";
  try {
    // --- Strategy A: Check DB cache (set when jobs are scheduled through the app) ---
    const cached = await getCachedZuperJobByDealId(invite.dealId, "Site Survey");
    if (cached?.jobUid) {
      console.log(`[portal/book] DB cache hit: deal ${invite.dealId} → job ${cached.jobUid}`);
      zuperJobUid = cached.jobUid;
      matchMethod = "db_cache";
    }

    // --- Strategy B: Full Zuper API search (mirrors internal scheduler's 5-strategy match) ---
    if (!zuperJobUid && zuper.isConfigured()) {
      const hubspotTag = `hubspot-${invite.dealId}`;

      // Extract customer name parts — invite.customerName may be "LastName, FirstName" or full name
      const customerLastName = invite.customerName.split(",")[0]?.trim() || "";

      // Extract PROJ number from the deal name (fetched from HubSpot later, but try invite fields)
      const projNumber = projectName.match(/PROJ-\d+/i)?.[0] || "";

      // Two parallel searches for maximum coverage (same as internal scheduler)
      const [nameSearch, broadSearch] = await Promise.all([
        customerLastName
          ? zuper.searchJobs({ limit: 100, search: customerLastName })
          : Promise.resolve({ type: "success" as const, data: { jobs: [] as ZuperJob[], total: 0 } }),
        zuper.searchJobs({
          limit: 500,
          from_date: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
          to_date: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
        }),
      ]);

      // Merge + deduplicate
      const allJobs = new Map<string, ZuperJob>();
      for (const result of [nameSearch, broadSearch]) {
        if (result.type === "success" && result.data?.jobs) {
          for (const job of result.data.jobs) {
            if (job.job_uid && !allJobs.has(job.job_uid)) {
              allJobs.set(job.job_uid, job);
            }
          }
        }
      }

      console.log(`[portal/book] Combined search: ${allJobs.size} unique jobs (name: ${nameSearch.data?.jobs?.length || 0}, broad: ${broadSearch.data?.jobs?.length || 0})`);

      // Filter to Site Survey category
      const categoryJobs = [...allJobs.values()].filter((job) => {
        const catName = typeof job.job_category === "string"
          ? job.job_category
          : job.job_category?.category_name || "";
        return catName.toLowerCase() === "site survey";
      });

      // Match B1: HubSpot Deal ID custom field (most reliable)
      for (const job of categoryJobs) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const customFields = (job as any).custom_fields as Array<{ label?: string; name?: string; value?: string }> | undefined;
        if (customFields && Array.isArray(customFields)) {
          const dealIdField = customFields.find((f) => {
            const label = f.label?.toLowerCase() || "";
            const name = f.name?.toLowerCase() || "";
            return label === "hubspot deal id" || label === "hubspot_deal_id" ||
                   name === "hubspot_deal_id" || name === "hubspot deal id";
          });
          if (dealIdField?.value === invite.dealId) {
            zuperJobUid = job.job_uid;
            matchMethod = "hubspot_deal_id";
            break;
          }
        }
      }

      // Match B2: HubSpot tag (hubspot-{dealId})
      if (!zuperJobUid) {
        const tagMatch = categoryJobs.find((job) => job.job_tags?.includes(hubspotTag));
        if (tagMatch) {
          zuperJobUid = tagMatch.job_uid;
          matchMethod = "hubspot_tag";
        }
      }

      // Match B3: PROJ number tag
      if (!zuperJobUid && projNumber) {
        const projMatch = categoryJobs.find((job) =>
          job.job_tags?.some((t) => t.toLowerCase() === projNumber.toLowerCase()),
        );
        if (projMatch) {
          zuperJobUid = projMatch.job_uid;
          matchMethod = "proj_tag";
        }
      }

      // Match B4: PROJ number in job title
      if (!zuperJobUid && projNumber) {
        const normalizedProj = projNumber.toLowerCase();
        const titleMatch = categoryJobs.find((job) =>
          (job.job_title?.toLowerCase() || "").includes(normalizedProj),
        );
        if (titleMatch) {
          zuperJobUid = titleMatch.job_uid;
          matchMethod = "proj_in_title";
        }
      }

      // Match B5: Customer last name in job title
      if (!zuperJobUid && customerLastName.length > 2) {
        const normalizedLastName = customerLastName.toLowerCase().trim();
        const nameMatch = categoryJobs.find((job) => {
          const title = job.job_title?.toLowerCase() || "";
          return title.includes(normalizedLastName + ",") ||
                 title.startsWith(normalizedLastName + " ");
        });
        if (nameMatch) {
          zuperJobUid = nameMatch.job_uid;
          matchMethod = "name_in_title";
        }
      }

      if (zuperJobUid) {
        console.log(`[portal/book] Found existing Zuper job: ${zuperJobUid} (matched by: ${matchMethod})`);
      } else {
        console.log(`[portal/book] No matching Site Survey job found for deal ${invite.dealId}`);
      }
    }

    if (zuperJobUid) {
      // Reschedule existing job — same as internal scheduler's reschedule path
      const startUtc = localTimeToUtcString(slot.date, slot.time, timezone);
      const endUtc = localTimeToUtcString(slot.date, endTime, timezone);
      const rescheduleResult = await zuper.rescheduleJob(
        zuperJobUid,
        startUtc,
        endUtc,
        [crewMember.zuperUserUid],
        crewMember.zuperTeamUid || undefined,
      );
      if (rescheduleResult.type === "success") {
        console.log(`[portal/book] Zuper job rescheduled: ${zuperJobUid}`);
      } else {
        warnings.push(`Zuper reschedule failed: ${rescheduleResult.error}`);
      }
    } else {
      // No existing job — create new one (same as internal scheduler's create path)
      const createResult = await createJobFromProject(
        {
          id: invite.dealId,
          name: projectName,
          address: projectAddress,
          city: projectCity,
          state: projectState,
          zipCode: projectZip,
          systemSizeKw: dealProps?.system_size_kw ? parseFloat(dealProps.system_size_kw) : (invite.systemSize || undefined),
          batteryCount: dealProps?.number_of_batteries ? parseInt(dealProps.number_of_batteries) : undefined,
          projectType: dealProps?.project_type || undefined,
          customerName: invite.customerName,
          customerEmail: invite.customerEmail,
          customerPhone: invite.customerPhone || undefined,
        },
        {
          type: "survey",
          date: slot.date,
          days: 1,
          startTime: slot.time,
          endTime,
          crew: crewMember.zuperUserUid,
          teamUid: crewMember.zuperTeamUid || undefined,
          timezone,
          notes: accessNotes,
        },
      );

      if (createResult.type === "success" && createResult.data?.job_uid) {
        zuperJobUid = createResult.data.job_uid;
        console.log(`[portal/book] Zuper job created: ${zuperJobUid}`);
      } else {
        warnings.push(`Zuper job creation failed: ${createResult.type === "error" ? createResult.error : "unknown"}`);
      }
    }

    // Update invite + schedule record with Zuper job UID
    if (zuperJobUid) {
      await Promise.all([
        prisma?.surveyInvite.update({
          where: { id: invite.id },
          data: { zuperJobUid },
        }),
        prisma?.scheduleRecord.update({
          where: { id: ctx.scheduleRecordId },
          data: { zuperJobUid, zuperSynced: true, zuperAssigned: true },
        }),
      ]);
    }
  } catch (err) {
    warnings.push(`Zuper job error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 3. Cache the Zuper job for fast lookup
  if (zuperJobUid) {
    try {
      const parsedStart = localTimeToUtc(slot.date, slot.time, timezone);
      const parsedEnd = localTimeToUtc(slot.date, endTime, timezone);
      await cacheZuperJob({
        jobUid: zuperJobUid,
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

  // 4. Update HubSpot schedule date — same as internal scheduler
  try {
    const dateUpdated = await updateDealProperty(invite.dealId, {
      site_survey_schedule_date: slot.date,
    });
    if (!dateUpdated) {
      warnings.push("HubSpot site_survey_schedule_date write failed");
    }
  } catch (err) {
    warnings.push(`HubSpot date update error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 5. Update HubSpot site_surveyor — same as internal scheduler
  try {
    const surveyorUpdated = await updateSiteSurveyorProperty(invite.dealId, crewMember.name);
    if (!surveyorUpdated) {
      warnings.push("HubSpot site_surveyor write failed");
    }
  } catch (err) {
    warnings.push(`HubSpot surveyor update error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 6. Resolve crew email for notification + calendar
  let crewEmail = crewMember.email;
  if (!crewEmail) {
    // Fallback: look up via getCrewMemberByName (might have email from a different source)
    const byName = await getCrewMemberByName(crewMember.name);
    crewEmail = byName?.email || null;
  }

  // 7. Send crew notification email — same function as internal scheduler
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
        scheduledDate: slot.date,
        scheduledStart: slot.time,
        scheduledEnd: endTime,
        projectId: invite.dealId,
        zuperJobUid,
        googleCalendarEventUrl:
          getGoogleCalendarEventUrl(getSurveyCalendarEventId(invite.dealId), crewEmail) || undefined,
        notes: accessNotes,
      });
      console.log(`[portal/book] Crew notification sent to ${crewEmail}`);
    } catch (err) {
      warnings.push(`Crew notification failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    warnings.push(`No crew email found for ${crewMember.name}, skipping notification`);
  }

  // 8. Google Calendar — personal calendar for the surveyor (same as internal scheduler)
  if (crewEmail) {
    try {
      const personalResult = await upsertSiteSurveyCalendarEvent({
        surveyorEmail: crewEmail,
        surveyorName: crewMember.name,
        projectId: invite.dealId,
        projectName,
        customerName: invite.customerName,
        customerAddress: invite.propertyAddress,
        date: slot.date,
        startTime: slot.time,
        endTime,
        timezone,
        notes: accessNotes,
        zuperJobUid,
        calendarId: "primary",
        impersonateEmail: crewEmail,
      });
      if (!personalResult.success) {
        warnings.push(`Google Calendar personal sync: ${personalResult.error}`);
      }
    } catch (err) {
      warnings.push(`Google Calendar personal error: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Shared survey calendar (Denver/site survey calendar)
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
          date: slot.date,
          startTime: slot.time,
          endTime,
          timezone,
          notes: accessNotes,
          zuperJobUid,
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

  // 9. Send confirmation email to the customer
  try {
    const formattedDate = new Date(slot.date + "T12:00:00Z").toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
    const tzAbbrev = timezone === "America/Los_Angeles" ? "PT" : "MT";
    const formattedTime = formatTime12(slot.time);

    await sendPortalEmail({
      to: invite.customerEmail,
      subject: "Your Site Survey is Confirmed - Photon Brothers",
      html: buildConfirmationEmailHtml({
        customerName: invite.customerName,
        formattedDate,
        formattedTime,
        tzAbbrev,
        propertyAddress: invite.propertyAddress,
      }),
      senderEmail: invite.sentBy || undefined,
    });
    console.log(`[portal/book] Confirmation email sent to ${invite.customerEmail}`);
  } catch (err) {
    warnings.push(`Customer confirmation email failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (warnings.length > 0) {
    console.warn(`[portal/book] Side effect warnings for deal ${invite.dealId}:`, warnings);
  }
}

// ---------------------------------------------------------------------------
// Shared calendar helpers (mirrored from internal scheduler)
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
// Confirmation email HTML
// ---------------------------------------------------------------------------

function buildConfirmationEmailHtml(params: {
  customerName: string;
  formattedDate: string;
  formattedTime: string;
  tzAbbrev: string;
  propertyAddress: string;
}): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #f97316;">Your Site Survey is Confirmed!</h2>
      <p>Hi ${escapeHtml(extractFirstName(params.customerName))},</p>
      <p>Your site survey has been scheduled. Here are the details:</p>
      <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <p style="margin: 4px 0;"><strong>Date:</strong> ${escapeHtml(params.formattedDate)}</p>
        <p style="margin: 4px 0;"><strong>Time:</strong> ${escapeHtml(params.formattedTime)} ${escapeHtml(params.tzAbbrev)}</p>
        <p style="margin: 4px 0;"><strong>Location:</strong> ${escapeHtml(params.propertyAddress)}</p>
      </div>
      <p>A Photon Brothers surveyor will visit your property at the scheduled time. Please ensure access to your electrical panel and roof area.</p>
      <p>If you need to make changes, please contact us as soon as possible.</p>
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

/** Convert local date + time to UTC string "YYYY-MM-DD HH:mm:ss" for Zuper API */
function localTimeToUtcString(dateStr: string, timeStr: string, timezone: string): string {
  const utc = localTimeToUtc(dateStr, timeStr, timezone);
  const y = utc.getUTCFullYear();
  const mo = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const d = String(utc.getUTCDate()).padStart(2, "0");
  const h = String(utc.getUTCHours()).padStart(2, "0");
  const mi = String(utc.getUTCMinutes()).padStart(2, "0");
  return `${y}-${mo}-${d} ${h}:${mi}:00`;
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

/** "09:00" → "9:00 AM" */
function formatTime12(time: string): string {
  const [hr, min] = time.split(":").map(Number);
  const period = hr >= 12 ? "PM" : "AM";
  const hour12 = hr === 0 ? 12 : hr > 12 ? hr - 12 : hr;
  return `${hour12}:${min.toString().padStart(2, "0")} ${period}`;
}
