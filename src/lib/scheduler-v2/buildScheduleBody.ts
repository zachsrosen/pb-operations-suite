/**
 * scheduler-v2 — pure request-body builder for the schedule write path.
 *
 * Constructs the EXACT body shape that `PUT /api/zuper/jobs/schedule` expects,
 * copied verbatim from the proven construction-scheduler `confirmSchedule`
 * contract (src/app/dashboards/construction-scheduler/page.tsx ~L987-1015):
 *
 *   {
 *     project: { id, name, address, city, state, systemSizeKw, batteryCount,
 *                projectType, zuperJobUid },
 *     schedule: { type:"installation", date, days, startTime, endTime, crew,
 *                 userUid, assignedUser, teamUid, timezone, notes,
 *                 installerNotes, testMode },
 *     rescheduleOnly,
 *   }
 *
 * This is a PURE function (no fetch, no React) so it can be unit-tested in
 * isolation: create-vs-reschedule branching + timezone selection are the two
 * load-bearing decisions and both live here.
 *
 * SAFETY: this only *builds* the body — it never sends it. The drawer is the
 * only caller that performs the network write, and it does so behind an explicit
 * human confirm with testMode defaulted ON.
 */

import { LOCATION_TIMEZONES, DEFAULT_TIMEZONE } from "@/lib/constants";
import type { WorkItem, Resource } from "./types";

/** Default install-day arrival window when the user does not change it. */
export const DEFAULT_START_TIME = "08:00";
export const DEFAULT_END_TIME = "16:00";

export interface ScheduleFormValues {
  /** YYYY-MM-DD target date. */
  date: string;
  /** Number of install days (defaults from the WorkItem.durationDays). */
  days: number;
  /** Local arrival window. */
  startTime: string;
  endTime: string;
  /** Free-text installer notes pushed to the Zuper job + HubSpot. */
  installerNotes?: string;
  /**
   * When true, the schedule endpoint suppresses crew emails. Defaults ON while
   * the feature is in beta — the drawer threads this through.
   */
  testMode: boolean;
}

/** The exact JSON body for `PUT /api/zuper/jobs/schedule`. */
export interface ScheduleRequestBody {
  project: {
    id: string;
    name: string;
    address: string;
    city: string;
    state: string;
    systemSizeKw: number;
    batteryCount: number;
    projectType: string;
    zuperJobUid: string | undefined;
  };
  schedule: {
    type: "installation";
    date: string;
    days: number;
    startTime: string;
    endTime: string;
    crew: string;
    userUid: string;
    assignedUser: string;
    teamUid: string;
    timezone: string;
    notes: string;
    installerNotes: string;
    testMode: boolean;
  };
  /**
   * Create-vs-reschedule. The endpoint defaults this to `true` (reschedule only)
   * when omitted; we ALWAYS send it explicitly so the create path is reachable.
   */
  rescheduleOnly: boolean;
}

/**
 * Resolve the IANA timezone for a WorkItem's location.
 * CA locations (San Luis Obispo, Camarillo) → America/Los_Angeles;
 * CO locations → America/Denver; unknown → DEFAULT_TIMEZONE.
 */
export function resolveTimezone(location: string | undefined): string {
  if (!location) return DEFAULT_TIMEZONE;
  return LOCATION_TIMEZONES[location] || DEFAULT_TIMEZONE;
}

/**
 * Build the schedule request body from a WorkItem, the dropped Resource, and the
 * drawer's form values.
 *
 * Create-vs-reschedule rule (matches spec §6):
 *   - `workItem.hasZuperJob === false` → `rescheduleOnly: false`
 *       (the endpoint takes the CREATE path and assigns crew at creation — the
 *        only moment Zuper honors `assigned_to`).
 *   - otherwise → `rescheduleOnly: true`
 *       (reschedule the existing Zuper job + reconcile crew).
 *
 * Crew resolution mirrors construction-scheduler: the resolved Zuper user uid is
 * sent as both `crew` and `userUid`; the human-readable name as `assignedUser`;
 * the team uid as `teamUid`. The endpoint resolves an empty uid by name at
 * runtime (e.g. Colorado Springs / Lenny), so we still send the name even when
 * the uid is blank.
 */
export function buildScheduleBody(
  workItem: WorkItem,
  resource: Resource,
  form: ScheduleFormValues,
): ScheduleRequestBody {
  const rescheduleOnly = workItem.hasZuperJob !== false;
  const timezone = resolveTimezone(workItem.location);

  const crewUid = resource.zuperUserUid ?? "";
  const teamUid = resource.zuperTeamUid ?? "";
  const assignedUser = resource.name;

  const installerNotes = form.installerNotes?.trim() ?? "";
  const modeLabel = rescheduleOnly ? "reschedule" : "create";
  const noteParts = [
    `Scheduled via Dispatch Board (${modeLabel}) — Assignee: ${assignedUser}`,
    form.testMode ? "[TEST MODE — crew email suppressed]" : null,
  ].filter(Boolean);

  return {
    project: {
      id: workItem.dealId ?? workItem.id,
      name: workItem.customer,
      address: workItem.address ?? "",
      city: "",
      state: "",
      systemSizeKw: 0,
      batteryCount: 0,
      projectType: workItem.subSystem ?? "Solar",
      zuperJobUid: workItem.zuperJobUid,
    },
    schedule: {
      type: "installation",
      date: form.date,
      days: Math.max(1, Math.floor(form.days) || 1),
      startTime: form.startTime || DEFAULT_START_TIME,
      endTime: form.endTime || DEFAULT_END_TIME,
      crew: crewUid,
      userUid: crewUid,
      assignedUser,
      teamUid,
      timezone,
      notes: noteParts.join(" "),
      installerNotes,
      testMode: form.testMode,
    },
    rescheduleOnly,
  };
}
