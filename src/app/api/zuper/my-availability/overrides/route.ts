/**
 * Self-Service Availability Override API
 *
 * GET    /api/zuper/my-availability/overrides - List own overrides (upcoming)
 * POST   /api/zuper/my-availability/overrides - Block a specific date
 * DELETE /api/zuper/my-availability/overrides - Remove own override
 *
 * All operations scoped to the logged-in crew member via email matching.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { LOCATION_TIMEZONES } from "@/lib/constants";
import { sendAvailabilityConflictNotification } from "@/lib/email";
import { getDealOwnerContact } from "@/lib/hubspot";
import { JOB_CATEGORY_UIDS, ZuperClient } from "@/lib/zuper";
import {
  prisma,
  getUserByEmail,
  getCrewMemberByEmail,
  getAvailabilityOverrides,
  upsertAvailabilityOverride,
  deleteAvailabilityOverride,
  logActivity,
} from "@/lib/db";

/**
 * Resolve the logged-in user's crew member profile (with impersonation support).
 */
async function resolveCrewMember(): Promise<
  {
    crewMember: NonNullable<Awaited<ReturnType<typeof getCrewMemberByEmail>>>;
    userId: string;
    currentUserEmail: string;
    currentUserName: string;
  } | NextResponse
> {
  const session = await auth();

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const currentUser = await getUserByEmail(session.user.email);
  if (!currentUser) {
    return NextResponse.json({ error: "User not found" }, { status: 401 });
  }

  // Support admin impersonation
  let lookupEmail = session.user.email;
  if (
    currentUser.role === "ADMIN" &&
    (currentUser as Record<string, unknown>).impersonatingUserId &&
    prisma
  ) {
    const impersonatedUser = await prisma.user.findUnique({
      where: { id: (currentUser as Record<string, unknown>).impersonatingUserId as string },
    });
    if (impersonatedUser?.email) {
      lookupEmail = impersonatedUser.email;
    }
  }

  const crewMember = await getCrewMemberByEmail(lookupEmail);
  if (!crewMember) {
    return NextResponse.json(
      { error: "No crew profile linked to your account" },
      { status: 403 }
    );
  }

  return {
    crewMember,
    userId: currentUser.id,
    currentUserEmail: session.user.email,
    currentUserName: session.user.name || currentUser.name || session.user.email,
  };
}

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function overlaps(startA: string, endA: string, startB: string, endB: string): boolean {
  const aStart = toMinutes(startA);
  const aEnd = toMinutes(endA);
  const bStart = toMinutes(startB);
  const bEnd = toMinutes(endB);
  return aStart < bEnd && bStart < aEnd;
}

function inferEndTime(start?: string | null, end?: string | null): string | null {
  if (end && /^\d{2}:\d{2}$/.test(end)) return end;
  if (!start || !/^\d{2}:\d{2}$/.test(start)) return null;
  const [h, m] = start.split(":").map(Number);
  const next = new Date(2000, 0, 1, h, m, 0, 0);
  next.setHours(next.getHours() + 1);
  return `${String(next.getHours()).padStart(2, "0")}:${String(next.getMinutes()).padStart(2, "0")}`;
}

function parseProjectSummary(projectName: string): { customerName: string; customerAddress: string } {
  const parts = projectName.split(" | ").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 3) {
    return { customerName: parts[1], customerAddress: parts.slice(2).join(" | ") };
  }
  if (parts.length === 2) {
    return { customerName: parts[0], customerAddress: parts[1] };
  }
  return { customerName: parts[0] || projectName, customerAddress: "See HubSpot" };
}

function isLikelyDealId(value: string): boolean {
  return /^\d+$/.test(value.trim());
}

/**
 * GET - List own upcoming overrides
 */
export async function GET() {
  const resolved = await resolveCrewMember();
  if (resolved instanceof NextResponse) return resolved;
  const { crewMember } = resolved;

  try {
    // Show overrides from today onwards
    const today = new Date().toISOString().split("T")[0];
    const records = await getAvailabilityOverrides({
      crewMemberId: crewMember.id,
      dateFrom: today,
    });

    return NextResponse.json({ records });
  } catch (error) {
    console.error("Error fetching overrides:", error);
    return NextResponse.json({ error: "Failed to fetch overrides" }, { status: 500 });
  }
}

/**
 * POST - Create a date override (full-day block or partial time block)
 */
export async function POST(request: NextRequest) {
  const resolved = await resolveCrewMember();
  if (resolved instanceof NextResponse) return resolved;
  const { crewMember, userId, currentUserEmail, currentUserName } = resolved;

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  try {
    const body = await request.json();
    const { date, reason, type, startTime, endTime } = body;
    const overrideType = type === "custom" ? "custom" : "blocked";

    if (!date) {
      return NextResponse.json({ error: "date is required" }, { status: 400 });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "Date must be YYYY-MM-DD format" }, { status: 400 });
    }

    if (overrideType === "custom") {
      if (!startTime || !endTime) {
        return NextResponse.json({ error: "startTime and endTime are required for custom overrides" }, { status: 400 });
      }
      if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
        return NextResponse.json({ error: "Time must be HH:mm format" }, { status: 400 });
      }
      const startMinutes = parseInt(startTime.slice(0, 2), 10) * 60 + parseInt(startTime.slice(3, 5), 10);
      const endMinutes = parseInt(endTime.slice(0, 2), 10) * 60 + parseInt(endTime.slice(3, 5), 10);
      if (startMinutes >= endMinutes) {
        return NextResponse.json({ error: "endTime must be after startTime" }, { status: 400 });
      }
    }

    const record = await upsertAvailabilityOverride({
      crewMemberId: crewMember.id,
      date,
      availabilityId: null, // Block all slots for the day
      type: overrideType,
      reason: reason || null,
      startTime: overrideType === "custom" ? startTime : null,
      endTime: overrideType === "custom" ? endTime : null,
      createdBy: userId,
      updatedBy: userId,
    });

    const summary = overrideType === "custom"
      ? `${date} ${startTime}-${endTime}${reason ? ` (${reason})` : ""}`
      : `${date}${reason ? ` (${reason})` : ""}`;

    await logActivity({
      type: "SETTINGS_CHANGED",
      description: `${crewMember.name} ${overrideType === "custom" ? "added time block" : "blocked"} ${summary}`,
      userId,
      entityType: "availability_override",
      entityId: record?.id,
    });

    // Notify surveyor + deal owner(s) when an override conflicts with existing scheduled surveys
    const candidateRecords = prisma
      ? await prisma.scheduleRecord.findMany({
          where: {
            scheduleType: "survey",
            scheduledDate: date,
            status: { in: ["scheduled", "tentative"] },
            OR: [
              { assignedUserUid: { contains: crewMember.zuperUserUid } },
              { assignedUser: { equals: crewMember.name, mode: "insensitive" } },
            ],
          },
          orderBy: { createdAt: "desc" },
          select: {
            projectId: true,
            projectName: true,
            scheduledDate: true,
            scheduledStart: true,
            scheduledEnd: true,
            assignedUser: true,
            createdAt: true,
          },
        })
      : [];

    const mergedCandidates: Array<{
      projectId: string;
      projectName: string;
      scheduledDate: string;
      scheduledStart: string | null;
      scheduledEnd: string | null;
      createdAt: Date;
    }> = [...candidateRecords];

    const zuper = new ZuperClient();
    if (zuper.isConfigured()) {
      try {
        const timezone = LOCATION_TIMEZONES[crewMember.locations[0]] || "America/Denver";
        const jobsResult = await zuper.getScheduledJobsForDateRange({
          fromDate: date,
          toDate: date,
          categoryUid: JOB_CATEGORY_UIDS.SITE_SURVEY,
        });

        if (jobsResult.type === "success" && jobsResult.data) {
          for (const job of jobsResult.data) {
            const assignedTo = (job as { assigned_to?: Array<{ user?: { user_uid?: string } }> }).assigned_to || [];
            const assignedUids = assignedTo.map((entry) => entry.user?.user_uid).filter(Boolean) as string[];
            if (!assignedUids.includes(crewMember.zuperUserUid)) continue;
            if (!job.scheduled_start_time) continue;
            if (job.scheduled_end_time && job.scheduled_start_time === job.scheduled_end_time) continue;

            const scheduledStartDate = new Date(job.scheduled_start_time);
            const localDate = scheduledStartDate.toLocaleDateString("en-CA", { timeZone: timezone });
            if (localDate !== date) continue;

            const startParts = scheduledStartDate.toLocaleTimeString("en-US", {
              timeZone: timezone,
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            }).split(":");
            const localStart = `${startParts[0]}:${startParts[1]}`;

            let localEnd: string | null = null;
            if (job.scheduled_end_time) {
              const scheduledEndDate = new Date(job.scheduled_end_time);
              const endParts = scheduledEndDate.toLocaleTimeString("en-US", {
                timeZone: timezone,
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              }).split(":");
              localEnd = `${endParts[0]}:${endParts[1]}`;
            } else {
              localEnd = inferEndTime(localStart, null);
            }

            const customFields = (job as { custom_fields?: Array<{ label?: string; value?: string }> }).custom_fields || [];
            const dealIdField = customFields.find((field) => (field.label || "").trim().toLowerCase() === "hubspot deal id");
            const dealLinkField = customFields.find((field) => {
              const label = (field.label || "").toLowerCase();
              return label.includes("hubspot") && label.includes("link");
            });
            let projectId = (dealIdField?.value || "").trim();
            if (!projectId && dealLinkField?.value) {
              const match = dealLinkField.value.match(/\/record\/0-3\/(\d+)/);
              if (match) projectId = match[1];
            }
            if (!projectId) {
              projectId = (job.job_uid || "").trim();
            }
            const jobUpdatedAt = (job as { updated_at?: string }).updated_at;

            mergedCandidates.push({
              projectId,
              projectName: job.job_title || projectId,
              scheduledDate: date,
              scheduledStart: localStart,
              scheduledEnd: localEnd,
              createdAt: new Date(jobUpdatedAt || job.scheduled_start_time),
            });
          }
        }
      } catch (zuperError) {
        console.warn("[Availability Override] Failed to evaluate Zuper survey conflicts:", zuperError);
      }
    }

    const latestByProject = new Map<string, typeof mergedCandidates[number]>();
    for (const rec of mergedCandidates) {
      if (!latestByProject.has(rec.projectId)) {
        latestByProject.set(rec.projectId, rec);
      }
    }

    const conflicts = Array.from(latestByProject.values()).filter((rec) => {
      if (overrideType === "blocked") return true;
      const recStart = rec.scheduledStart;
      const recEnd = inferEndTime(rec.scheduledStart, rec.scheduledEnd);
      if (!recStart || !recEnd || !startTime || !endTime) return true;
      return overlaps(startTime, endTime, recStart, recEnd);
    });

    const conflictNotifications = {
      detected: conflicts.length,
      sent: 0,
      warnings: [] as string[],
    };

    if (conflicts.length > 0) {
      const enrichedConflicts = await Promise.all(
        conflicts.map(async (rec) => {
          const owner = isLikelyDealId(rec.projectId)
            ? await getDealOwnerContact(rec.projectId)
            : { ownerId: null, ownerName: null, ownerEmail: null };
          const parsed = parseProjectSummary(rec.projectName);
          return {
            projectId: rec.projectId,
            customerName: parsed.customerName,
            customerAddress: parsed.customerAddress,
            scheduledDate: rec.scheduledDate,
            scheduledStart: rec.scheduledStart || undefined,
            scheduledEnd: inferEndTime(rec.scheduledStart, rec.scheduledEnd) || undefined,
            dealOwnerName: owner.ownerName,
            dealOwnerEmail: owner.ownerEmail,
          };
        })
      );

      const bccForNotifications = [currentUserEmail];

      if (crewMember.email) {
        const surveyorResult = await sendAvailabilityConflictNotification({
          to: crewMember.email,
          bcc: bccForNotifications,
          recipientName: crewMember.name,
          blockedByName: currentUserName,
          blockedByEmail: currentUserEmail,
          surveyorName: crewMember.name,
          overrideType,
          overrideDate: date,
          overrideStart: overrideType === "custom" ? startTime : undefined,
          overrideEnd: overrideType === "custom" ? endTime : undefined,
          overrideReason: reason || undefined,
          conflicts: enrichedConflicts.map((conflict) => ({
            projectId: conflict.projectId,
            customerName: conflict.customerName,
            customerAddress: conflict.customerAddress,
            scheduledDate: conflict.scheduledDate,
            scheduledStart: conflict.scheduledStart,
            scheduledEnd: conflict.scheduledEnd,
            dealOwnerName: conflict.dealOwnerName,
          })),
        });

        if (surveyorResult.success) {
          conflictNotifications.sent += 1;
        } else {
          conflictNotifications.warnings.push(
            `Surveyor notification failed (${crewMember.email}): ${surveyorResult.error || "unknown error"}`
          );
        }
      } else {
        conflictNotifications.warnings.push(`Surveyor email missing for ${crewMember.name}`);
      }

      const ownerBuckets = new Map<string, { ownerName: string; conflicts: typeof enrichedConflicts }>();
      for (const conflict of enrichedConflicts) {
        const email = (conflict.dealOwnerEmail || "").trim().toLowerCase();
        if (!email) continue;
        if (!ownerBuckets.has(email)) {
          ownerBuckets.set(email, {
            ownerName: conflict.dealOwnerName || "Deal Owner",
            conflicts: [],
          });
        }
        ownerBuckets.get(email)!.conflicts.push(conflict);
      }

      for (const [ownerEmail, bucket] of ownerBuckets.entries()) {
        const ownerResult = await sendAvailabilityConflictNotification({
          to: ownerEmail,
          bcc: bccForNotifications,
          recipientName: bucket.ownerName,
          blockedByName: currentUserName,
          blockedByEmail: currentUserEmail,
          surveyorName: crewMember.name,
          overrideType,
          overrideDate: date,
          overrideStart: overrideType === "custom" ? startTime : undefined,
          overrideEnd: overrideType === "custom" ? endTime : undefined,
          overrideReason: reason || undefined,
          conflicts: bucket.conflicts.map((conflict) => ({
            projectId: conflict.projectId,
            customerName: conflict.customerName,
            customerAddress: conflict.customerAddress,
            scheduledDate: conflict.scheduledDate,
            scheduledStart: conflict.scheduledStart,
            scheduledEnd: conflict.scheduledEnd,
            dealOwnerName: conflict.dealOwnerName,
          })),
        });
        if (ownerResult.success) {
          conflictNotifications.sent += 1;
        } else {
          conflictNotifications.warnings.push(
            `Deal owner notification failed (${ownerEmail}): ${ownerResult.error || "unknown error"}`
          );
        }
      }

      if (conflictNotifications.sent === 0 && currentUserEmail) {
        const fallbackResult = await sendAvailabilityConflictNotification({
          to: currentUserEmail,
          recipientName: currentUserName,
          blockedByName: currentUserName,
          blockedByEmail: currentUserEmail,
          surveyorName: crewMember.name,
          overrideType,
          overrideDate: date,
          overrideStart: overrideType === "custom" ? startTime : undefined,
          overrideEnd: overrideType === "custom" ? endTime : undefined,
          overrideReason: reason || undefined,
          conflicts: enrichedConflicts.map((conflict) => ({
            projectId: conflict.projectId,
            customerName: conflict.customerName,
            customerAddress: conflict.customerAddress,
            scheduledDate: conflict.scheduledDate,
            scheduledStart: conflict.scheduledStart,
            scheduledEnd: conflict.scheduledEnd,
            dealOwnerName: conflict.dealOwnerName,
          })),
        });
        if (fallbackResult.success) {
          conflictNotifications.sent += 1;
          conflictNotifications.warnings.push(
            "Fallback alert sent only to blocker because surveyor/deal owner emails were unavailable."
          );
        } else {
          conflictNotifications.warnings.push(
            `Fallback self-alert failed (${currentUserEmail}): ${fallbackResult.error || "unknown error"}`
          );
        }
      }
    }

    return NextResponse.json({ success: true, record, conflictNotifications });
  } catch (error) {
    console.error("Error creating override:", error);
    return NextResponse.json({ error: "Failed to create override" }, { status: 500 });
  }
}

/**
 * DELETE - Remove own override (ownership verified)
 */
export async function DELETE(request: NextRequest) {
  const resolved = await resolveCrewMember();
  if (resolved instanceof NextResponse) return resolved;
  const { crewMember, userId } = resolved;

  try {
    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    // Verify ownership
    if (!prisma) {
      return NextResponse.json({ error: "Database not configured" }, { status: 500 });
    }

    const existing = await prisma.availabilityOverride.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json({ error: "Override not found" }, { status: 404 });
    }

    if (existing.crewMemberId !== crewMember.id) {
      return NextResponse.json({ error: "Not your override" }, { status: 403 });
    }

    await deleteAvailabilityOverride(id);

    await logActivity({
      type: "SETTINGS_CHANGED",
      description: `${crewMember.name} unblocked ${existing.date}`,
      userId,
      entityType: "availability_override",
      entityId: id,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting override:", error);
    return NextResponse.json({ error: "Failed to delete override" }, { status: 500 });
  }
}
