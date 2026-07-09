/**
 * Shared booking-time double-book guard for the customer survey portal.
 *
 * Same stale-availability race PR #1337 closed on the internal scheduler
 * (7/2 Branyan/Crane incident): the portal renders its slot picker from
 * availability fetched at page load, so a slot taken after that still looks
 * bookable when the customer confirms. The book/reschedule routes call this
 * right before writing and 409 on conflict. Customers get no
 * allowDoubleBook bypass — deliberate stacking is an internal-only tool.
 *
 * Two sources, cheapest first (mirrors /api/zuper/jobs/schedule):
 *  - ScheduleRecord rows (our DB — catches app + portal bookings incl. tentative)
 *  - live Zuper jobs for the date, SURVEY categories only (matches the
 *    availability grid — a surveyor on a multi-day install whose UTC span
 *    envelops the slot is NOT a survey double-book; 7/8 Purcell/Drew incident)
 *
 * Guard failures never block bookings (fail-open, logged).
 */

import { prisma } from "@/lib/db";
import { zuper, JOB_CATEGORY_UIDS } from "@/lib/zuper";
import {
  findRecordConflict,
  findZuperJobConflict,
  type SlotConflict,
} from "@/lib/survey-slot-conflict";
import { buildSurveyConflictAssigneeFilter } from "@/lib/availability-conflict-filter";

export interface SurveySlotBookingCheck {
  dealId: string;
  /** Local slot date "YYYY-MM-DD". */
  date: string;
  /** Local window "HH:mm". */
  startTime: string;
  endTime: string;
  /** Same window in UTC "YYYY-MM-DD HH:mm:ss" (as sent to Zuper). */
  startUtc: string;
  endUtc: string;
  assigneeUid?: string | null;
  assigneeName?: string | null;
  /** The deal's own Zuper job when rescheduling — never a conflict. */
  excludeJobUid?: string | null;
}

export async function checkSurveySlotBookingConflict(
  params: SurveySlotBookingCheck,
): Promise<SlotConflict | null> {
  try {
    const assigneeFilter = buildSurveyConflictAssigneeFilter({
      name: params.assigneeName,
      zuperUserUid: params.assigneeUid,
    });
    if (!assigneeFilter) return null; // nothing to match on — skip the scan

    if (prisma) {
      const records = await prisma.scheduleRecord.findMany({
        where: {
          scheduleType: "survey",
          scheduledDate: params.date,
          status: { in: ["scheduled", "tentative"] },
          NOT: { projectId: String(params.dealId) },
          ...assigneeFilter,
        },
        select: {
          projectId: true,
          projectName: true,
          scheduledStart: true,
          scheduledEnd: true,
          assignedUser: true,
          assignedUserUid: true,
        },
      });
      const recordConflict = findRecordConflict(records, {
        dealId: String(params.dealId),
        startTime: params.startTime,
        endTime: params.endTime,
        assigneeUid: params.assigneeUid,
        assigneeName: params.assigneeName,
      });
      if (recordConflict) return recordConflict;
    }

    const jobsResult = await zuper.getScheduledJobsForDateRange({
      fromDate: params.date,
      toDate: params.date,
    });
    if (jobsResult.type === "success" && jobsResult.data) {
      return findZuperJobConflict(jobsResult.data, {
        dealId: String(params.dealId),
        startUtc: params.startUtc,
        endUtc: params.endUtc,
        assigneeUid: params.assigneeUid,
        assigneeName: params.assigneeName,
        excludeJobUid: params.excludeJobUid,
        allowedCategoryUids: [
          JOB_CATEGORY_UIDS.SITE_SURVEY,
          JOB_CATEGORY_UIDS.PRE_SALE_SITE_VISIT,
        ],
      });
    }

    return null;
  } catch (err) {
    console.warn("[survey-booking-guard] Conflict check failed (proceeding):", err);
    return null;
  }
}
