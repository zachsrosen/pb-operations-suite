/**
 * Booking-time conflict detection for survey slots.
 *
 * The scheduler UI checks availability at page load only; sales reps keep
 * tabs open for hours, so a slot taken after their last refresh still looks
 * bookable (7/2 incident: two reps booked Joe Lynch into the same 10-11am
 * slot 5 hours apart). The booking routes call these helpers right before
 * writing and return 409 when the requested assignee/window is occupied.
 *
 * Two sources are checked, cheapest first:
 *  - ScheduleRecord rows (our DB — catches app bookings incl. tentative)
 *  - live Zuper jobs for the date (authoritative — catches Zuper-UI/Tray
 *    bookings and ANY category: a surveyor mid-install is still busy)
 */

export interface SlotConflict {
  projectId: string;
  projectName: string;
  assignedUser: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  source: "schedule-record" | "zuper";
}

/** Overlap of two "HH:mm" windows (end-exclusive). */
export function timesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const mins = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  return mins(aStart) < mins(bEnd) && mins(bStart) < mins(aEnd);
}

export interface RecordConflictParams {
  dealId: string;
  startTime: string; // "HH:mm" local
  endTime: string;
  assigneeUid?: string | null;
  assigneeName?: string | null;
}

interface ScheduleRecordLike {
  projectId: string;
  projectName: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  assignedUser: string | null;
  assignedUserUid?: string | null;
}

const normalizeName = (v: string) => v.toLowerCase().replace(/\s+/g, " ").trim();

export function findRecordConflict(
  records: ScheduleRecordLike[],
  params: RecordConflictParams,
): SlotConflict | null {
  const uid = (params.assigneeUid || "").trim();
  const name = normalizeName(params.assigneeName || "");
  if (!uid && !name) return null;

  for (const rec of records) {
    if (String(rec.projectId) === String(params.dealId)) continue; // own reschedule
    if (!rec.scheduledStart || !rec.scheduledEnd) continue;
    if (!timesOverlap(params.startTime, params.endTime, rec.scheduledStart, rec.scheduledEnd)) continue;

    const recUid = (rec.assignedUserUid || "").trim();
    const uidMatch = !!uid && !!recUid && recUid.includes(uid);
    const nameMatch = !!name && !!rec.assignedUser && normalizeName(rec.assignedUser) === name;
    if (!uidMatch && !nameMatch) continue;

    return {
      projectId: String(rec.projectId),
      projectName: rec.projectName || String(rec.projectId),
      assignedUser: rec.assignedUser || params.assigneeName || "",
      scheduledStart: rec.scheduledStart,
      scheduledEnd: rec.scheduledEnd,
      source: "schedule-record",
    };
  }
  return null;
}

export interface ZuperConflictParams {
  dealId: string;
  /** Requested window in UTC, "YYYY-MM-DD HH:mm:ss" (as sent to Zuper). */
  startUtc: string;
  endUtc: string;
  assigneeUid?: string | null;
  assigneeName?: string | null;
  /** The deal's own Zuper job when rescheduling — never a conflict. */
  excludeJobUid?: string | null;
  /**
   * Only consider jobs in these Zuper category UIDs. The survey scheduler's
   * availability grid only models survey-category jobs, so the booking guard
   * must match — otherwise a surveyor on a multi-day install (whose UTC span
   * envelops the requested slot) false-blocks a survey the grid shows as free
   * (7/8 Purcell/Drew Perry incident). Undefined = consider all categories.
   */
  allowedCategoryUids?: string[] | null;
}

interface ZuperJobLike {
  job_uid?: string;
  job_title?: string;
  scheduled_start_time?: string | null;
  scheduled_end_time?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assigned_to?: any[];
  job_tags?: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  custom_fields?: any;
  // job_category is a UID string (create payloads) or an object (GET responses).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  job_category?: any;
}

/** Extract the category UID from a Zuper job (handles string or object form). */
function jobCategoryUid(job: ZuperJobLike): string | null {
  const c = job.job_category;
  if (!c) return null;
  if (typeof c === "string") return c;
  return c.category_uid || null;
}

const utcMs = (v: string): number => {
  // Accept both "YYYY-MM-DD HH:mm:ss" (Zuper request format) and ISO strings.
  const iso = v.includes("T") ? v : v.replace(" ", "T") + "Z";
  return new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z").getTime();
};

/** HubSpot deal id carried on a Zuper job (tags or custom fields). */
function jobDealId(job: ZuperJobLike): string | null {
  const tag = (job.job_tags || []).find((t) => /^hubspot-\d+$/i.test(t));
  if (tag) return tag.replace(/^hubspot-/i, "");
  const fields = Array.isArray(job.custom_fields) ? job.custom_fields : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const f = fields.find((x: any) => (x?.label || "").trim().toLowerCase() === "hubspot deal id");
  return f?.value ? String(f.value) : null;
}

export function findZuperJobConflict(
  jobs: ZuperJobLike[],
  params: ZuperConflictParams,
): SlotConflict | null {
  const uid = (params.assigneeUid || "").trim();
  const name = normalizeName(params.assigneeName || "");
  if (!uid && !name) return null;

  const reqStart = utcMs(params.startUtc);
  const reqEnd = utcMs(params.endUtc);
  const allowed = params.allowedCategoryUids && params.allowedCategoryUids.length > 0
    ? new Set(params.allowedCategoryUids)
    : null;

  for (const job of jobs) {
    if (params.excludeJobUid && job.job_uid === params.excludeJobUid) continue;
    if (allowed) {
      const cat = jobCategoryUid(job);
      // Exclude jobs outside the allowed categories. Unknown category (null)
      // is excluded too — the availability grid can't see it either.
      if (!cat || !allowed.has(cat)) continue;
    }
    const dealId = jobDealId(job);
    if (dealId && String(dealId) === String(params.dealId)) continue; // own job

    if (!job.scheduled_start_time || !job.scheduled_end_time) continue;
    if (job.scheduled_start_time === job.scheduled_end_time) continue; // cleared-schedule sentinel
    const jobStart = utcMs(job.scheduled_start_time);
    const jobEnd = utcMs(job.scheduled_end_time);
    if (Number.isNaN(jobStart) || Number.isNaN(jobEnd)) continue;
    if (!(reqStart < jobEnd && jobStart < reqEnd)) continue;

    // Assignee match — GET format: [{ user: { user_uid, first_name, last_name } }]
    const assignees = (job.assigned_to || [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((a: any) => a?.user || a)
      .filter(Boolean);
    const uidMatch =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      !!uid && assignees.some((u: any) => u?.user_uid === uid);
    const nameMatch =
      !!name &&
      assignees.some(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (u: any) => normalizeName(`${u?.first_name || ""} ${u?.last_name || ""}`) === name,
      );
    if (!uidMatch && !nameMatch) continue;

    return {
      projectId: dealId || job.job_uid || "",
      projectName: job.job_title || dealId || job.job_uid || "",
      assignedUser: params.assigneeName || "",
      scheduledStart: job.scheduled_start_time,
      scheduledEnd: job.scheduled_end_time,
      source: "zuper",
    };
  }
  return null;
}
