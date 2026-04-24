import type { ServiceTaskRaw, FormSubmissionRaw, ServiceTasksBundle } from "@/lib/compliance-v2/service-tasks-fetcher";

export interface FixtureJob {
  // Zuper "searchJobs" payload shape
  job_uid: string;
  job_title: string;
  job_category: { category_uid: string };
  current_job_status: { status_name: string };
  scheduled_start_time: string | null;
  scheduled_end_time: string | null;
  assigned_to: Array<{ user: { user_uid: string; first_name: string; last_name: string; is_active: boolean } }>;
  assigned_to_team: Array<{ team: { team_uid: string; team_name: string } }>;
  job_status: Array<{ status_name: string; created_at: string }>;
  custom_fields?: unknown[];
  job_tags?: string[];
}

export interface FixtureBundle {
  job: FixtureJob;
  taskBundle: ServiceTasksBundle;
}

export const CONSTRUCTION_UID = "construction-uid";

// Helper for building assignees. Default team is Centennial, matching the
// Centennial-based fixtures below. Override `team` for SLO/CA scenarios.
function mkAssignee(uid: string, name: string, active = true, teamName = "Centennial") {
  const [first, ...rest] = name.split(" ");
  return {
    user: { user_uid: uid, first_name: first, last_name: rest.join(" "), is_active: active },
    team: { team_uid: "t-auto", team_name: teamName },
  };
}

// === Fixture A: PV/Battery split — PV on-time, Electrical late ===
export function buildPvBatterySplitFixture(): FixtureBundle {
  const job: FixtureJob = {
    job_uid: "pvbat",
    job_title: "PROJ-9999 PV/Battery multi-day",
    job_category: { category_uid: CONSTRUCTION_UID },
    current_job_status: { status_name: "Completed" },
    scheduled_start_time: "2026-04-01T15:00:00Z",
    scheduled_end_time: "2026-04-03T23:00:00Z", // day-3 deadline
    assigned_to: [
      mkAssignee("u-pv", "Tyler Guerra"),
      mkAssignee("u-elec", "Chris Kahl"),
    ],
    assigned_to_team: [{ team: { team_uid: "t-cent", team_name: "Centennial" } }],
    job_status: [{ status_name: "Completed", created_at: "2026-04-08T20:00:00Z" }], // parent late
  };
  const pvTask: ServiceTaskRaw = {
    service_task_uid: "pv-task",
    service_task_title: "PV Install - Colorado",
    service_task_status: "COMPLETED",
    assigned_to: [mkAssignee("u-pv", "Tyler Guerra")],
    asset_inspection_submission_uid: null,
    actual_end_time: "2026-04-01T23:00:00Z", // day-1: on-time
  };
  const elecTask: ServiceTaskRaw = {
    service_task_uid: "elec-task",
    service_task_title: "Electrical Install - Colorado",
    service_task_status: "COMPLETED",
    assigned_to: [mkAssignee("u-elec", "Chris Kahl")],
    asset_inspection_submission_uid: null,
    actual_end_time: "2026-04-08T20:00:00Z", // day-8: late
  };
  return {
    job,
    taskBundle: {
      tasks: [pvTask, elecTask],
      formByTaskUid: new Map([["pv-task", null], ["elec-task", null]]),
    },
  };
}

// === Fixture B: Form-filer-only ===
export function buildFormFilerOnlyFixture(): FixtureBundle {
  const job: FixtureJob = {
    job_uid: "form-only",
    job_title: "form-only job",
    job_category: { category_uid: CONSTRUCTION_UID },
    current_job_status: { status_name: "Completed" },
    scheduled_start_time: "2026-04-01T15:00:00Z",
    scheduled_end_time: "2026-04-03T23:00:00Z",
    assigned_to: [mkAssignee("u-parent", "ParentOnly Tech")],
    assigned_to_team: [{ team: { team_uid: "t-cent", team_name: "Centennial" } }],
    job_status: [{ status_name: "Completed", created_at: "2026-04-02T23:00:00Z" }],
  };
  const task: ServiceTaskRaw = {
    service_task_uid: "pv",
    service_task_title: "PV Install - Colorado",
    service_task_status: "COMPLETED",
    assigned_to: [], // no task assignees
    asset_inspection_submission_uid: "form-uid",
    actual_end_time: "2026-04-02T22:00:00Z",
  };
  const form: FormSubmissionRaw = {
    created_by: { user_uid: "u-filer", first_name: "Filer", last_name: "Tech" },
    created_at: "2026-04-02T22:30:00Z",
  };
  return {
    job,
    taskBundle: {
      tasks: [task],
      formByTaskUid: new Map([["pv", form]]),
    },
  };
}

// === Fixture C: Paperwork-only tech (JHA Form filer) ===
export function buildPaperworkOnlyFixture(): FixtureBundle {
  const job: FixtureJob = {
    job_uid: "paper-only",
    job_title: "paperwork job",
    job_category: { category_uid: CONSTRUCTION_UID },
    current_job_status: { status_name: "Completed" },
    scheduled_start_time: "2026-04-01T15:00:00Z",
    scheduled_end_time: "2026-04-03T23:00:00Z",
    assigned_to: [mkAssignee("u-paper", "Paperwork Tech")],
    assigned_to_team: [{ team: { team_uid: "t-cent", team_name: "Centennial" } }],
    job_status: [{ status_name: "Completed", created_at: "2026-04-02T23:00:00Z" }],
  };
  const task: ServiceTaskRaw = {
    service_task_uid: "jha",
    service_task_title: "JHA Form",
    service_task_status: "COMPLETED",
    assigned_to: [mkAssignee("u-paper", "Paperwork Tech")],
    asset_inspection_submission_uid: null,
    actual_end_time: "2026-04-02T22:00:00Z",
  };
  return {
    job,
    taskBundle: {
      tasks: [task],
      formByTaskUid: new Map([["jha", null]]),
    },
  };
}

// === Fixture D: Empty credit set — no one to blame ===
export function buildEmptyCreditSetFixture(): FixtureBundle {
  const job: FixtureJob = {
    job_uid: "empty",
    job_title: "empty credit set",
    job_category: { category_uid: CONSTRUCTION_UID },
    current_job_status: { status_name: "Completed" },
    scheduled_start_time: "2026-04-01T15:00:00Z",
    scheduled_end_time: "2026-04-03T23:00:00Z",
    assigned_to: [mkAssignee("u-parent", "ParentOnly")],
    assigned_to_team: [{ team: { team_uid: "t-cent", team_name: "Centennial" } }],
    job_status: [{ status_name: "Completed", created_at: "2026-04-05T00:00:00Z" }],
  };
  const task: ServiceTaskRaw = {
    service_task_uid: "orphan",
    service_task_title: "PV Install - Colorado",
    service_task_status: "COMPLETED",
    assigned_to: [], // empty
    asset_inspection_submission_uid: null, // no form
    actual_end_time: null,
  };
  return {
    job,
    taskBundle: {
      tasks: [task],
      formByTaskUid: new Map([["orphan", null]]),
    },
  };
}

// === Fixture E: Fractional 1/N — 3 techs on one task, late ===
export function buildFractionalLateFixture(): FixtureBundle {
  const job: FixtureJob = {
    job_uid: "frac",
    job_title: "3-tech fractional",
    job_category: { category_uid: CONSTRUCTION_UID },
    current_job_status: { status_name: "Completed" },
    scheduled_start_time: "2026-04-01T15:00:00Z",
    scheduled_end_time: "2026-04-03T23:00:00Z",
    assigned_to: [mkAssignee("u1", "Alpha"), mkAssignee("u2", "Bravo"), mkAssignee("u3", "Charlie")],
    assigned_to_team: [{ team: { team_uid: "t-cent", team_name: "Centennial" } }],
    job_status: [{ status_name: "Completed", created_at: "2026-04-06T23:00:00Z" }],
  };
  const task: ServiceTaskRaw = {
    service_task_uid: "pv",
    service_task_title: "PV Install - Colorado",
    service_task_status: "COMPLETED",
    assigned_to: [mkAssignee("u1", "Alpha"), mkAssignee("u2", "Bravo"), mkAssignee("u3", "Charlie")],
    asset_inspection_submission_uid: null,
    actual_end_time: "2026-04-06T23:00:00Z", // late
  };
  return {
    job,
    taskBundle: {
      tasks: [task],
      formByTaskUid: new Map([["pv", null]]),
    },
  };
}

// === Fixture F: Parent-only (tech assigned at parent but not in any task) ===
export function buildParentOnlyFixture(): FixtureBundle {
  // same as empty-credit-set but with a task that HAS a credit set
  // parent tech is separate and shouldn't be scored
  const job: FixtureJob = {
    job_uid: "parent-only",
    job_title: "parent-only tech",
    job_category: { category_uid: CONSTRUCTION_UID },
    current_job_status: { status_name: "Completed" },
    scheduled_start_time: "2026-04-01T15:00:00Z",
    scheduled_end_time: "2026-04-03T23:00:00Z",
    assigned_to: [
      mkAssignee("u-real", "Real Worker"),
      mkAssignee("u-ghost", "Ghost Assignee"),
    ],
    assigned_to_team: [{ team: { team_uid: "t-cent", team_name: "Centennial" } }],
    job_status: [{ status_name: "Completed", created_at: "2026-04-03T20:00:00Z" }],
  };
  const task: ServiceTaskRaw = {
    service_task_uid: "pv",
    service_task_title: "PV Install - Colorado",
    service_task_status: "COMPLETED",
    assigned_to: [mkAssignee("u-real", "Real Worker")], // ghost not in task
    asset_inspection_submission_uid: null,
    actual_end_time: "2026-04-03T20:00:00Z",
  };
  return {
    job,
    taskBundle: {
      tasks: [task],
      formByTaskUid: new Map([["pv", null]]),
    },
  };
}

// === Fixture G: Follow-up status (Return Visit Required, on-time) ===
export function buildFollowUpFixture(): FixtureBundle {
  const job: FixtureJob = {
    job_uid: "follow",
    job_title: "follow-up",
    job_category: { category_uid: CONSTRUCTION_UID },
    current_job_status: { status_name: "Return Visit Required" },
    scheduled_start_time: "2026-04-01T15:00:00Z",
    scheduled_end_time: "2026-04-03T23:00:00Z",
    assigned_to: [mkAssignee("u-f", "Followup Tech")],
    assigned_to_team: [{ team: { team_uid: "t-cent", team_name: "Centennial" } }],
    job_status: [{ status_name: "Return Visit Required", created_at: "2026-04-03T12:00:00Z" }],
  };
  const task: ServiceTaskRaw = {
    service_task_uid: "pv",
    service_task_title: "PV Install - Colorado",
    service_task_status: "COMPLETED",
    assigned_to: [mkAssignee("u-f", "Followup Tech")],
    asset_inspection_submission_uid: null,
    actual_end_time: "2026-04-03T12:00:00Z",
  };
  return {
    job,
    taskBundle: {
      tasks: [task],
      formByTaskUid: new Map([["pv", null]]),
    },
  };
}

// === Fixture H: Failed status ===
export function buildFailedFixture(): FixtureBundle {
  const job: FixtureJob = {
    job_uid: "failed",
    job_title: "failed inspection",
    job_category: { category_uid: CONSTRUCTION_UID },
    current_job_status: { status_name: "Failed" },
    scheduled_start_time: "2026-04-01T15:00:00Z",
    scheduled_end_time: "2026-04-03T23:00:00Z",
    assigned_to: [mkAssignee("u-f", "Failed Tech")],
    assigned_to_team: [{ team: { team_uid: "t-cent", team_name: "Centennial" } }],
    job_status: [{ status_name: "Failed", created_at: "2026-04-02T12:00:00Z" }],
  };
  const task: ServiceTaskRaw = {
    service_task_uid: "pv",
    service_task_title: "PV Install - Colorado",
    service_task_status: "COMPLETED",
    assigned_to: [mkAssignee("u-f", "Failed Tech")],
    asset_inspection_submission_uid: null,
    actual_end_time: "2026-04-02T12:00:00Z",
  };
  return {
    job,
    taskBundle: {
      tasks: [task],
      formByTaskUid: new Map([["pv", null]]),
    },
  };
}

// === Fixture I: Ready To Forecast — excluded entirely ===
export function buildExcludedStatusFixture(): FixtureBundle {
  const job: FixtureJob = {
    job_uid: "excluded",
    job_title: "ready to forecast",
    job_category: { category_uid: CONSTRUCTION_UID },
    current_job_status: { status_name: "Ready To Forecast" },
    scheduled_start_time: "2026-04-01T15:00:00Z",
    scheduled_end_time: "2026-04-03T23:00:00Z",
    assigned_to: [mkAssignee("u-exc", "Excluded Tech")],
    assigned_to_team: [{ team: { team_uid: "t-cent", team_name: "Centennial" } }],
    job_status: [{ status_name: "Ready To Forecast", created_at: "2026-04-01T00:00:00Z" }],
  };
  const task: ServiceTaskRaw = {
    service_task_uid: "pv",
    service_task_title: "PV Install - Colorado",
    service_task_status: "NEW",
    assigned_to: [mkAssignee("u-exc", "Excluded Tech")],
    asset_inspection_submission_uid: null,
    actual_end_time: null,
  };
  return {
    job,
    taskBundle: {
      tasks: [task],
      formByTaskUid: new Map([["pv", null]]),
    },
  };
}

// === Fixture M: Imported CO crew on a pure-SLO job ===
// Real-world case: a CA Construction job is staffed by CO technicians
// whose per-task team tags are "Centennial". The PARENT job is tagged
// exclusively "San Luis Obispo". Under the imported-crew rule, the CO
// tech should be included in SLO scoring (they actually did the CA work).
export function buildImportedCrewFixture(): FixtureBundle {
  const job: FixtureJob = {
    job_uid: "imported",
    job_title: "PROJ-CA-imported | CO crew doing CA work",
    job_category: { category_uid: CONSTRUCTION_UID },
    current_job_status: { status_name: "Completed" },
    scheduled_start_time: "2026-04-01T15:00:00Z",
    scheduled_end_time: "2026-04-03T23:00:00Z",
    assigned_to: [mkAssignee("u-co", "Imported CO Tech")],
    assigned_to_team: [{ team: { team_uid: "t-slo", team_name: "San Luis Obispo" } }], // pure SLO
    job_status: [{ status_name: "Completed", created_at: "2026-04-02T23:00:00Z" }],
  };
  const task: ServiceTaskRaw = {
    service_task_uid: "pv",
    service_task_title: "PV Install - California",
    service_task_status: "COMPLETED",
    assigned_to: [mkAssignee("u-co", "Imported CO Tech", true, "Centennial")], // CO team tag
    asset_inspection_submission_uid: null,
    actual_end_time: "2026-04-02T22:00:00Z",
  };
  return {
    job,
    taskBundle: {
      tasks: [task],
      formByTaskUid: new Map([["pv", null]]),
    },
  };
}

// === Fixture L: Cross-location — Centennial tech and SLO tech on the same multi-region job ===
// Same job, two techs with different team tags. When computing for "Centennial",
// only the Centennial tech should appear. When computing for "San Luis Obispo", only the SLO tech.
export function buildCrossLocationFixture(): FixtureBundle {
  const job: FixtureJob = {
    job_uid: "crossloc",
    job_title: "PROJ-cross-location",
    job_category: { category_uid: CONSTRUCTION_UID },
    current_job_status: { status_name: "Completed" },
    scheduled_start_time: "2026-04-01T15:00:00Z",
    scheduled_end_time: "2026-04-03T23:00:00Z",
    assigned_to: [
      mkAssignee("u-cent", "Centennial Tech"),
      mkAssignee("u-slo", "SLO Tech", true, "San Luis Obispo"),
    ],
    assigned_to_team: [
      { team: { team_uid: "t-cent", team_name: "Centennial" } },
      { team: { team_uid: "t-slo", team_name: "San Luis Obispo" } },
    ],
    job_status: [{ status_name: "Completed", created_at: "2026-04-02T23:00:00Z" }],
  };
  const task: ServiceTaskRaw = {
    service_task_uid: "pv",
    service_task_title: "PV Install - Colorado",
    service_task_status: "COMPLETED",
    assigned_to: [
      mkAssignee("u-cent", "Centennial Tech"),
      mkAssignee("u-slo", "SLO Tech", true, "San Luis Obispo"),
    ],
    asset_inspection_submission_uid: null,
    actual_end_time: "2026-04-02T22:00:00Z",
  };
  return {
    job,
    taskBundle: {
      tasks: [task],
      formByTaskUid: new Map([["pv", null]]),
    },
  };
}

// === Fixture K: Central fairness scenario — PV completed, Electrical stuck on same parent ===
// PV tech does their work on time; Electrical team is stuck (in progress past scheduledEnd).
// PV tech MUST NOT receive any stuck penalty. Electrical tech gets stuck 1/N.
export function buildPvCompletedElectricalStuckFixture(): FixtureBundle {
  const job: FixtureJob = {
    job_uid: "pvok-elecstuck",
    job_title: "PROJ-fair | PV ok, Electrical stuck",
    job_category: { category_uid: CONSTRUCTION_UID },
    // Parent status is "Started" (stuck if past scheduledEnd). Electrical is still in progress.
    current_job_status: { status_name: "Started" },
    scheduled_start_time: "2026-04-01T15:00:00Z",
    scheduled_end_time: "2026-04-03T23:00:00Z", // parent scheduledEnd
    assigned_to: [
      mkAssignee("u-pv", "Tyler Guerra"),
      mkAssignee("u-elec", "Chris Kahl"),
    ],
    assigned_to_team: [{ team: { team_uid: "t-cent", team_name: "Centennial" } }],
    job_status: [{ status_name: "Started", created_at: "2026-04-01T16:00:00Z" }],
  };
  const pvTask: ServiceTaskRaw = {
    service_task_uid: "pv",
    service_task_title: "PV Install - Colorado",
    service_task_status: "COMPLETED", // PV done
    assigned_to: [mkAssignee("u-pv", "Tyler Guerra")],
    asset_inspection_submission_uid: null,
    actual_end_time: "2026-04-01T23:00:00Z", // on-time
  };
  const elecTask: ServiceTaskRaw = {
    service_task_uid: "elec",
    service_task_title: "Electrical Install - Colorado",
    service_task_status: "IN_PROGRESS", // stuck
    assigned_to: [mkAssignee("u-elec", "Chris Kahl")],
    asset_inspection_submission_uid: null,
    actual_end_time: null,
    actual_start_time: "2026-04-02T16:00:00Z",
  };
  return {
    job,
    taskBundle: {
      tasks: [pvTask, elecTask],
      formByTaskUid: new Map([["pv", null], ["elec", null]]),
    },
  };
}

// === Fixture J: Timestamp tie-break — form later than actual_end ===
export function buildTimestampTieBreakFixture(): FixtureBundle {
  const job: FixtureJob = {
    job_uid: "tie",
    job_title: "tiebreak",
    job_category: { category_uid: CONSTRUCTION_UID },
    current_job_status: { status_name: "Completed" },
    scheduled_start_time: "2026-04-01T15:00:00Z",
    scheduled_end_time: "2026-04-03T23:00:00Z",
    assigned_to: [mkAssignee("u-t", "Tie Tech")],
    assigned_to_team: [{ team: { team_uid: "t-cent", team_name: "Centennial" } }],
    job_status: [{ status_name: "Completed", created_at: "2026-04-05T12:00:00Z" }],
  };
  const task: ServiceTaskRaw = {
    service_task_uid: "pv",
    service_task_title: "PV Install - Colorado",
    service_task_status: "COMPLETED",
    assigned_to: [mkAssignee("u-t", "Tie Tech")],
    asset_inspection_submission_uid: "form-uid",
    actual_end_time: "2026-04-03T23:00:00Z", // exactly on scheduledEnd; with 24h grace this is on-time
  };
  const form: FormSubmissionRaw = {
    created_by: { user_uid: "u-t", first_name: "Tie", last_name: "Tech" },
    created_at: "2026-04-05T12:00:00Z", // form filed 2 days later — should NOT tip into late via earliest-of rule
  };
  return {
    job,
    taskBundle: {
      tasks: [task],
      formByTaskUid: new Map([["pv", form]]),
    },
  };
}
