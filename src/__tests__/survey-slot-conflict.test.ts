/**
 * Tests for server-side survey slot conflict detection.
 *
 * Incident (7/2, caught 7/7): two sales reps booked the same surveyor
 * (Joe Lynch) into the same 10-11am slot 5 hours apart — the second rep's
 * scheduler tab was stale and the booking API performed no conflict
 * re-validation. These helpers are the booking-time guard: check our
 * ScheduleRecords AND live Zuper jobs for the requested assignee/window
 * before writing.
 */
import {
  timesOverlap,
  findRecordConflict,
  findZuperJobConflict,
} from "@/lib/survey-slot-conflict";

describe("timesOverlap", () => {
  it("detects overlap and respects exclusive boundaries", () => {
    expect(timesOverlap("10:00", "11:00", "10:00", "11:00")).toBe(true);
    expect(timesOverlap("10:00", "11:00", "10:30", "11:30")).toBe(true);
    expect(timesOverlap("10:00", "11:00", "11:00", "12:00")).toBe(false);
    expect(timesOverlap("10:00", "11:00", "08:00", "09:00")).toBe(false);
  });
});

describe("findRecordConflict", () => {
  const JOE_UID = "f203f99b-4aaf-488e-8e6a-8ee5e94ec217";
  const baseParams = {
    dealId: "60456724017", // Crane
    startTime: "10:00",
    endTime: "11:00",
    assigneeUid: JOE_UID,
    assigneeName: "Joe Lynch",
  };
  const branyanRecord = {
    projectId: "13833491464",
    projectName: "PROJ-10028 | Branyan, William (Bill) R | 40 Pine Tree Ln",
    scheduledStart: "10:00",
    scheduledEnd: "11:00",
    assignedUser: "Joe Lynch",
    assignedUserUid: JOE_UID,
  };

  it("flags the exact incident: same assignee, same slot, different deal", () => {
    const conflict = findRecordConflict([branyanRecord], baseParams);
    expect(conflict).not.toBeNull();
    expect(conflict!.projectId).toBe("13833491464");
    expect(conflict!.source).toBe("schedule-record");
  });

  it("ignores the deal's own record (reschedules)", () => {
    expect(
      findRecordConflict([{ ...branyanRecord, projectId: "60456724017" }], baseParams)
    ).toBeNull();
  });

  it("ignores non-overlapping times and other assignees", () => {
    expect(
      findRecordConflict([{ ...branyanRecord, scheduledStart: "13:00", scheduledEnd: "14:00" }], baseParams)
    ).toBeNull();
    expect(
      findRecordConflict(
        [{ ...branyanRecord, assignedUser: "Drew Perry", assignedUserUid: "other-uid" }],
        baseParams
      )
    ).toBeNull();
  });

  it("matches by name when the record has no UID (legacy rows)", () => {
    const conflict = findRecordConflict(
      [{ ...branyanRecord, assignedUserUid: null }],
      { ...baseParams, assigneeUid: undefined }
    );
    expect(conflict).not.toBeNull();
  });
});

describe("findZuperJobConflict", () => {
  const JOE_UID = "f203f99b-4aaf-488e-8e6a-8ee5e94ec217";
  const params = {
    dealId: "60456724017",
    startUtc: "2026-07-10 16:00:00",
    endUtc: "2026-07-10 17:00:00",
    assigneeUid: JOE_UID,
    assigneeName: "Joe Lynch",
    excludeJobUid: "crane-own-job-uid",
  };
  const SITE_SURVEY_UID = "002bac33-84d3-4083-a35d-50626fc49288";
  const branyanJob = {
    job_uid: "branyan-job-uid",
    job_title: "PROJ-10028 | Branyan, William (Bill) R | 40 Pine Tree Ln",
    scheduled_start_time: "2026-07-10T16:00:00.000Z",
    scheduled_end_time: "2026-07-10T17:00:00.000Z",
    assigned_to: [{ user: { user_uid: JOE_UID, first_name: "Joe", last_name: "Lynch" } }],
    job_tags: ["hubspot-13833491464", "proj-10028"],
    job_category: { category_uid: SITE_SURVEY_UID, category_name: "Site Survey" },
  };
  // Survey category allow-list, as the booking routes pass it.
  const surveyParams = { ...params, allowedCategoryUids: [SITE_SURVEY_UID] };

  it("flags an overlapping Zuper job for the same assignee", () => {
    const conflict = findZuperJobConflict([branyanJob], surveyParams);
    expect(conflict).not.toBeNull();
    expect(conflict!.projectId).toBe("13833491464");
    expect(conflict!.source).toBe("zuper");
  });

  it("ignores the job being rescheduled and the deal's own job", () => {
    expect(
      findZuperJobConflict([{ ...branyanJob, job_uid: "crane-own-job-uid" }], surveyParams)
    ).toBeNull();
    expect(
      findZuperJobConflict(
        [{ ...branyanJob, job_tags: ["hubspot-60456724017"] }],
        surveyParams
      )
    ).toBeNull();
  });

  it("ignores zero-length (cleared) schedules, other assignees, non-overlaps", () => {
    expect(
      findZuperJobConflict(
        [{ ...branyanJob, scheduled_end_time: branyanJob.scheduled_start_time }],
        surveyParams
      )
    ).toBeNull();
    expect(
      findZuperJobConflict(
        [{ ...branyanJob, assigned_to: [{ user: { user_uid: "someone-else" } }] }],
        surveyParams
      )
    ).toBeNull();
    expect(
      findZuperJobConflict(
        [{ ...branyanJob, scheduled_start_time: "2026-07-10T18:00:00.000Z", scheduled_end_time: "2026-07-10T19:00:00.000Z" }],
        surveyParams
      )
    ).toBeNull();
  });

  it("does NOT block on a multi-day construction job (Purcell regression)", () => {
    // Drew Perry is on a 2-day install (7/13 8am -> 7/14 4pm MT) whose UTC
    // span envelops a 7/14 2-3pm survey. The survey scheduler grid only
    // considers survey-category jobs, so the guard must too — a construction
    // overlap is not a survey double-book. Request window overlaps the span.
    const purcellInstall = {
      job_uid: "purcell-install",
      job_title: "PROJ-7064 | Purcell, Andrew | 720 Madison St",
      scheduled_start_time: "2026-07-13T14:00:00.000Z",
      scheduled_end_time: "2026-07-14T22:00:00.000Z",
      assigned_to: [{ user: { user_uid: JOE_UID, first_name: "Joe", last_name: "Lynch" } }],
      job_tags: ["hubspot-7064"],
      job_category: { category_uid: "f2fcb6bf-990f-408c-a66b-fba6caec6893", category_name: "Construction - Solar" },
    };
    const survey14th = {
      ...surveyParams,
      startUtc: "2026-07-14 20:00:00", // 2pm MT
      endUtc: "2026-07-14 21:00:00",
    };
    // Sanity: WITHOUT the survey allow-list this construction job DOES overlap
    // (proves the date window is genuinely conflicting) …
    expect(
      findZuperJobConflict([purcellInstall], { ...survey14th, allowedCategoryUids: undefined })
    ).not.toBeNull();
    // … but WITH the survey allow-list it's ignored.
    expect(findZuperJobConflict([purcellInstall], survey14th)).toBeNull();
  });
});
