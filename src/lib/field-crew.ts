/**
 * Single source of truth for PB field-crew identity + per-location assignment.
 *
 * Each crew member's Zuper identity (name + userUid + email) is defined ONCE in
 * `FIELD_CREW`, and which member covers each location's survey / inspection /
 * construction work is defined ONCE in `LOCATION_FIELD_CREW`. Every scheduling
 * surface (master scheduler, construction scheduler, availability API, crew
 * roster seed, pipeline director emails) derives from these maps instead of
 * re-declaring literals.
 *
 * To swap who covers a location (e.g. the Rolando Valle -> Lenny Uematsu CO
 * Springs swap, #1204/#1213), change the member reference in `LOCATION_FIELD_CREW`
 * (and the member's identity in `FIELD_CREW` if new) — it now propagates
 * everywhere instead of needing edits in ~7 files.
 *
 * IMPORTANT: this module is PURE DATA + TYPES. It is imported by client
 * components (scheduler pages) as well as server routes, so it must never pull
 * in server-only dependencies (no DB, no `process.env` secrets, no HubSpot/Zuper
 * client code).
 */

export interface FieldCrewMember {
  /** Display name as it appears in Zuper and the scheduling UIs. */
  name: string;
  /**
   * Zuper user UID. Empty string when the Zuper client resolves the UID at
   * runtime by name (some surveyors/inspectors are intentionally left blank).
   */
  userUid: string;
  /** Google Workspace email. Present for crew who receive pipeline/role email. */
  email?: string;
}

/**
 * Every field-crew person, defined once. Reference these members from the
 * location/role maps below and from call sites — never re-type a userUid.
 */
export const FIELD_CREW = {
  drew: { name: "Drew Perry", userUid: "0ddc7e1d-62e1-49df-b89d-905a39c1e353", email: "drew@photonbrothers.com" },
  joe: { name: "Joe Lynch", userUid: "f203f99b-4aaf-488e-8e6a-8ee5e94ec217", email: "joe@photonbrothers.com" },
  ryszard: { name: "Ryszard Szymanski", userUid: "e043bf1d-006b-4033-a46e-3b5d06ed3d00", email: "richard@photonbrothers.com" },
  nick: { name: "Nick Scarpellino", userUid: "8e67159c-48fe-4fb0-acc3-b1c905ff6e95", email: "nick.scarpellino@photonbrothers.com" },
  lenny: { name: "Lenny Uematsu", userUid: "6b0a8b10-a969-4dd9-8104-62e5c38f7d77", email: "lenny@photonbrothers.com" },
  danielKelly: { name: "Daniel Kelly", userUid: "f0a5aca8-0137-478c-a910-1380b9a31a79", email: "dan@photonbrothers.com" },

  // Surveyors/inspectors whose Zuper userUid is resolved at runtime by name
  // (left blank on purpose — the availability/schedule APIs look them up).
  lucas: { name: "Lucas Scarpellino", userUid: "" },
  samuel: { name: "Samuel Paro", userUid: "" },
  chadSchollman: { name: "Chad Schollman", userUid: "" },
  alexanderSwope: { name: "Alexander Swope", userUid: "" },
  anthonyVillanueva: { name: "Anthony Villanueva", userUid: "" },

  // Regional-director EMAIL role only — NOT a field-work assignee. Lenny took
  // over all CO Springs field work while Rolando is OOO (#1204/#1213); Rolando
  // remains a regional-director email recipient. See email.ts
  // PIPELINE_LOCATION_DIRECTORS, which intentionally keeps BOTH for CO Springs.
  rolando: { name: "Rolando Valle", userUid: "", email: "rolando@photonbrothers.com" },
} satisfies Record<string, FieldCrewMember>;

export type FieldCrewKey = keyof typeof FIELD_CREW;

export type FieldLocation =
  | "Westminster"
  | "Centennial"
  | "DTC"
  | "Colorado Springs"
  | "San Luis Obispo"
  | "Camarillo";

/**
 * Zuper team UID used when ASSIGNING field jobs at each location. This is the
 * team that owns the job, so a member covering a location is assigned under
 * that location's team — e.g. Daniel Kelly inspects under the Westminster team
 * for Westminster jobs and the Centennial team for DTC jobs.
 *
 * Camarillo field work runs under the SLO team (the two share an install crew),
 * which is why Camarillo's assignment team is the SLO UID, not Camarillo's own
 * standalone Zuper team.
 */
export const LOCATION_ASSIGNMENT_TEAM_UID: Record<FieldLocation, string> = {
  Westminster: "1c23adb9-cefa-44c7-8506-804949afc56f",
  Centennial: "76b94bd3-e2fc-4cfe-8c2a-357b9a850b3c",
  DTC: "76b94bd3-e2fc-4cfe-8c2a-357b9a850b3c", // DTC is part of the Centennial team
  "Colorado Springs": "1a914a0e-b633-4f12-8ed6-3348285d6b93",
  "San Luis Obispo": "699cec60-f9f8-4e57-b41a-bb29b1f3649c",
  Camarillo: "699cec60-f9f8-4e57-b41a-bb29b1f3649c", // shares the SLO install crew/team
};

export interface FieldCrewAssignee {
  name: string;
  userUid: string;
  teamUid: string;
}

/** Combine a crew member with a location's assignment team into a Zuper assignee. */
export function fieldCrewAssignee(member: FieldCrewMember, location: FieldLocation): FieldCrewAssignee {
  return { name: member.name, userUid: member.userUid, teamUid: LOCATION_ASSIGNMENT_TEAM_UID[location] };
}

/**
 * Per-location field-crew assignment. `survey`/`inspection` are ordered lists
 * (the FIRST entry is the default offered in the scheduler). `director` is the
 * construction director / default construction assignee for the location.
 *
 * This is the one place to edit when a location's crew changes.
 */
export const LOCATION_FIELD_CREW: Record<
  FieldLocation,
  { survey: FieldCrewMember[]; inspection: FieldCrewMember[]; director: FieldCrewMember }
> = {
  Westminster: {
    survey: [FIELD_CREW.joe, FIELD_CREW.ryszard],
    inspection: [FIELD_CREW.danielKelly, FIELD_CREW.chadSchollman],
    director: FIELD_CREW.joe,
  },
  Centennial: {
    survey: [FIELD_CREW.drew],
    inspection: [FIELD_CREW.danielKelly],
    director: FIELD_CREW.drew,
  },
  DTC: {
    survey: [FIELD_CREW.drew],
    inspection: [FIELD_CREW.danielKelly],
    director: FIELD_CREW.drew,
  },
  "Colorado Springs": {
    // Lenny Uematsu took over all CO Springs field work from Rolando Valle.
    survey: [FIELD_CREW.lenny],
    inspection: [FIELD_CREW.lenny, FIELD_CREW.alexanderSwope],
    director: FIELD_CREW.lenny,
  },
  "San Luis Obispo": {
    survey: [FIELD_CREW.nick],
    inspection: [FIELD_CREW.anthonyVillanueva],
    director: FIELD_CREW.nick,
  },
  Camarillo: {
    survey: [FIELD_CREW.nick],
    inspection: [], // No dedicated Camarillo inspector configured (shares the SLO crew).
    director: FIELD_CREW.nick, // Camarillo shares the SLO install crew.
  },
};

const FIELD_LOCATIONS = Object.keys(LOCATION_FIELD_CREW) as FieldLocation[];

function assigneesFor(members: FieldCrewMember[], location: FieldLocation): FieldCrewAssignee[] {
  return members.map((member) => fieldCrewAssignee(member, location));
}

/**
 * location -> ordered survey assignees (first = default). Reproduces the legacy
 * `ZUPER_SURVEY_USERS` map shape consumed by the master scheduler.
 */
export const SURVEY_USERS_BY_LOCATION: Record<string, FieldCrewAssignee[]> = Object.fromEntries(
  FIELD_LOCATIONS.map((location) => [location, assigneesFor(LOCATION_FIELD_CREW[location].survey, location)]),
);

/**
 * location -> ordered inspection assignees (first = default). Locations without
 * a configured inspector are omitted (matching the legacy `ZUPER_INSPECTION_USERS`
 * shape, which had no Camarillo key).
 */
export const INSPECTION_USERS_BY_LOCATION: Record<string, FieldCrewAssignee[]> = Object.fromEntries(
  FIELD_LOCATIONS.filter((location) => LOCATION_FIELD_CREW[location].inspection.length > 0).map((location) => [
    location,
    assigneesFor(LOCATION_FIELD_CREW[location].inspection, location),
  ]),
);

/**
 * location -> construction director / default construction assignee. Reproduces
 * the legacy `CONSTRUCTION_DIRECTORS` / `ZUPER_CONSTRUCTION_DIRECTORS` map shape.
 */
export const CONSTRUCTION_DIRECTORS_BY_LOCATION: Record<string, FieldCrewAssignee> = Object.fromEntries(
  FIELD_LOCATIONS.map((location) => [location, fieldCrewAssignee(LOCATION_FIELD_CREW[location].director, location)]),
);
