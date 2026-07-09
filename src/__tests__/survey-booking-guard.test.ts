/**
 * Tests for the shared booking-time conflict guard used by the customer
 * portal book/reschedule routes.
 *
 * Same stale-availability race PR #1337 closed on the internal scheduler
 * (7/2 Branyan/Crane incident): the portal validates slots when the page
 * loads, not when the customer confirms. This helper re-validates the
 * requested assignee/window against ScheduleRecords AND live Zuper jobs
 * right before writing.
 */

const mockScheduleRecordFindMany = jest.fn();
jest.mock("@/lib/db", () => ({
  prisma: {
    scheduleRecord: {
      findMany: (...args: unknown[]) => mockScheduleRecordFindMany(...args),
    },
  },
}));

const mockGetScheduledJobsForDateRange = jest.fn();
jest.mock("@/lib/zuper", () => ({
  // Real category UIDs — the guard scopes conflicts to survey categories, so a
  // mock that dropped them would silently disable matching. (requireActual is
  // avoided: the real module statically imports Prisma, which Jest can't load.)
  JOB_CATEGORY_UIDS: {
    SITE_SURVEY: "002bac33-84d3-4083-a35d-50626fc49288",
    PRE_SALE_SITE_VISIT: "c53070e5-63fd-41bc-8803-f66ad842dbb5",
  },
  zuper: {
    getScheduledJobsForDateRange: (...args: unknown[]) =>
      mockGetScheduledJobsForDateRange(...args),
  },
}));

import { checkSurveySlotBookingConflict } from "@/lib/survey-booking-guard";

const JOE_UID = "f203f99b-4aaf-488e-8e6a-8ee5e94ec217";

const baseParams = {
  dealId: "60456724017",
  date: "2026-07-10",
  startTime: "10:00",
  endTime: "11:00",
  startUtc: "2026-07-10 16:00:00",
  endUtc: "2026-07-10 17:00:00",
  assigneeUid: JOE_UID,
  assigneeName: "Joe Lynch",
};

const conflictingRecord = {
  projectId: "13833491464",
  projectName: "PROJ-10028 | Branyan, William (Bill) R | 40 Pine Tree Ln",
  scheduledStart: "10:00",
  scheduledEnd: "11:00",
  assignedUser: "Joe Lynch",
  assignedUserUid: JOE_UID,
};

const conflictingZuperJob = {
  job_uid: "zj-1",
  job_title: "survey - PROJ-10028 | Branyan",
  scheduled_start_time: "2026-07-10 16:00:00",
  scheduled_end_time: "2026-07-10 17:00:00",
  assigned_to: [{ user: { user_uid: JOE_UID, first_name: "Joe", last_name: "Lynch" } }],
  job_tags: ["hubspot-13833491464"],
  // Survey category — the guard now scopes to survey categories only so a
  // surveyor's multi-day install can't false-block a survey booking.
  job_category: { category_uid: "002bac33-84d3-4083-a35d-50626fc49288", category_name: "Site Survey" },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockScheduleRecordFindMany.mockResolvedValue([]);
  mockGetScheduledJobsForDateRange.mockResolvedValue({ type: "success", data: [] });
});

describe("checkSurveySlotBookingConflict", () => {
  it("returns the conflict when a ScheduleRecord occupies the window", async () => {
    mockScheduleRecordFindMany.mockResolvedValue([conflictingRecord]);

    const conflict = await checkSurveySlotBookingConflict(baseParams);

    expect(conflict).not.toBeNull();
    expect(conflict!.source).toBe("schedule-record");
    expect(conflict!.projectId).toBe("13833491464");
    // Zuper is only consulted when our own records are clean
    expect(mockGetScheduledJobsForDateRange).not.toHaveBeenCalled();
  });

  it("scopes the ScheduleRecord query to the date/assignee and excludes the own deal", async () => {
    await checkSurveySlotBookingConflict(baseParams);

    expect(mockScheduleRecordFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          scheduleType: "survey",
          scheduledDate: "2026-07-10",
          status: { in: ["scheduled", "tentative"] },
          NOT: { projectId: "60456724017" },
          OR: expect.arrayContaining([
            { assignedUserUid: { contains: JOE_UID } },
            { assignedUser: { equals: "Joe Lynch", mode: "insensitive" } },
          ]),
        }),
      }),
    );
  });

  it("falls through to live Zuper jobs and flags a conflict there", async () => {
    mockGetScheduledJobsForDateRange.mockResolvedValue({
      type: "success",
      data: [conflictingZuperJob],
    });

    const conflict = await checkSurveySlotBookingConflict(baseParams);

    expect(conflict).not.toBeNull();
    expect(conflict!.source).toBe("zuper");
    expect(mockGetScheduledJobsForDateRange).toHaveBeenCalledWith({
      fromDate: "2026-07-10",
      toDate: "2026-07-10",
    });
  });

  it("returns null when neither source has a conflict", async () => {
    const conflict = await checkSurveySlotBookingConflict(baseParams);
    expect(conflict).toBeNull();
  });

  it("does NOT flag a surveyor's multi-day construction job (Purcell regression)", async () => {
    mockGetScheduledJobsForDateRange.mockResolvedValue({
      type: "success",
      data: [
        {
          job_uid: "purcell-install",
          job_title: "PROJ-7064 | Purcell, Andrew | 720 Madison St",
          scheduled_start_time: "2026-07-09 14:00:00", // envelops the 7/10 slot
          scheduled_end_time: "2026-07-11 22:00:00",
          assigned_to: [{ user: { user_uid: JOE_UID, first_name: "Joe", last_name: "Lynch" } }],
          job_tags: ["hubspot-7064"],
          job_category: { category_uid: "f2fcb6bf-990f-408c-a66b-fba6caec6893", category_name: "Construction - Solar" },
        },
      ],
    });
    const conflict = await checkSurveySlotBookingConflict(baseParams);
    expect(conflict).toBeNull();
  });

  it("ignores the deal's own Zuper job via excludeJobUid (reschedules)", async () => {
    mockGetScheduledJobsForDateRange.mockResolvedValue({
      type: "success",
      data: [{ ...conflictingZuperJob, job_tags: [] }],
    });

    const conflict = await checkSurveySlotBookingConflict({
      ...baseParams,
      excludeJobUid: "zj-1",
    });

    expect(conflict).toBeNull();
  });

  it("skips the ScheduleRecord scan entirely when the assignee has no identifiers", async () => {
    // Blank zuperUserUid + blank name would otherwise match every row
    // (7/7 incident — see buildSurveyConflictAssigneeFilter).
    const conflict = await checkSurveySlotBookingConflict({
      ...baseParams,
      assigneeUid: "",
      assigneeName: "",
    });

    expect(conflict).toBeNull();
    expect(mockScheduleRecordFindMany).not.toHaveBeenCalled();
    expect(mockGetScheduledJobsForDateRange).not.toHaveBeenCalled();
  });

  it("fails open (returns null) when the DB or Zuper check throws", async () => {
    mockScheduleRecordFindMany.mockRejectedValue(new Error("db down"));

    await expect(checkSurveySlotBookingConflict(baseParams)).resolves.toBeNull();

    mockScheduleRecordFindMany.mockResolvedValue([]);
    mockGetScheduledJobsForDateRange.mockRejectedValue(new Error("zuper down"));

    await expect(checkSurveySlotBookingConflict(baseParams)).resolves.toBeNull();
  });

  it("fails open when the Zuper search returns an error result", async () => {
    mockGetScheduledJobsForDateRange.mockResolvedValue({ type: "error", error: "429" });

    await expect(checkSurveySlotBookingConflict(baseParams)).resolves.toBeNull();
  });
});
