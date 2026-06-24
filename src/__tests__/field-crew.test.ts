import {
  CONSTRUCTION_DIRECTORS_BY_LOCATION,
  FIELD_CREW,
  INSPECTION_USERS_BY_LOCATION,
  SURVEY_USERS_BY_LOCATION,
  fieldCrewAssignee,
} from "@/lib/field-crew";

/**
 * Behavior-preservation guard for the field-crew centralization.
 *
 * The snapshots below are copied verbatim from the pre-refactor literals on
 * origin/main (scheduler `ZUPER_SURVEY_USERS` / `ZUPER_INSPECTION_USERS` /
 * `ZUPER_CONSTRUCTION_DIRECTORS` and construction-scheduler `CONSTRUCTION_DIRECTORS`).
 * If a future crew swap changes a resolved name/userUid/teamUid, this test makes
 * the change explicit rather than silently divergent across call sites.
 */

// --- origin/main literals (frozen) ------------------------------------------

const ORIGINAL_SURVEY_USERS: Record<string, { name: string; userUid: string; teamUid: string }[]> = {
  Westminster: [
    { name: "Joe Lynch", userUid: "f203f99b-4aaf-488e-8e6a-8ee5e94ec217", teamUid: "1c23adb9-cefa-44c7-8506-804949afc56f" },
    { name: "Ryszard Szymanski", userUid: "e043bf1d-006b-4033-a46e-3b5d06ed3d00", teamUid: "1c23adb9-cefa-44c7-8506-804949afc56f" },
  ],
  Centennial: [
    { name: "Drew Perry", userUid: "0ddc7e1d-62e1-49df-b89d-905a39c1e353", teamUid: "76b94bd3-e2fc-4cfe-8c2a-357b9a850b3c" },
  ],
  DTC: [
    { name: "Drew Perry", userUid: "0ddc7e1d-62e1-49df-b89d-905a39c1e353", teamUid: "76b94bd3-e2fc-4cfe-8c2a-357b9a850b3c" },
  ],
  "Colorado Springs": [
    { name: "Lenny Uematsu", userUid: "6b0a8b10-a969-4dd9-8104-62e5c38f7d77", teamUid: "1a914a0e-b633-4f12-8ed6-3348285d6b93" },
  ],
  "San Luis Obispo": [
    { name: "Nick Scarpellino", userUid: "8e67159c-48fe-4fb0-acc3-b1c905ff6e95", teamUid: "699cec60-f9f8-4e57-b41a-bb29b1f3649c" },
  ],
  Camarillo: [
    { name: "Nick Scarpellino", userUid: "8e67159c-48fe-4fb0-acc3-b1c905ff6e95", teamUid: "699cec60-f9f8-4e57-b41a-bb29b1f3649c" },
  ],
};

const ORIGINAL_INSPECTION_USERS: Record<string, { name: string; userUid: string; teamUid: string }[]> = {
  Westminster: [
    { name: "Daniel Kelly", userUid: "f0a5aca8-0137-478c-a910-1380b9a31a79", teamUid: "1c23adb9-cefa-44c7-8506-804949afc56f" },
    { name: "Chad Schollman", userUid: "", teamUid: "1c23adb9-cefa-44c7-8506-804949afc56f" },
  ],
  Centennial: [
    { name: "Daniel Kelly", userUid: "f0a5aca8-0137-478c-a910-1380b9a31a79", teamUid: "76b94bd3-e2fc-4cfe-8c2a-357b9a850b3c" },
  ],
  DTC: [
    { name: "Daniel Kelly", userUid: "f0a5aca8-0137-478c-a910-1380b9a31a79", teamUid: "76b94bd3-e2fc-4cfe-8c2a-357b9a850b3c" },
  ],
  "Colorado Springs": [
    { name: "Lenny Uematsu", userUid: "6b0a8b10-a969-4dd9-8104-62e5c38f7d77", teamUid: "1a914a0e-b633-4f12-8ed6-3348285d6b93" },
    { name: "Alexander Swope", userUid: "", teamUid: "1a914a0e-b633-4f12-8ed6-3348285d6b93" },
  ],
  "San Luis Obispo": [
    { name: "Anthony Villanueva", userUid: "", teamUid: "699cec60-f9f8-4e57-b41a-bb29b1f3649c" },
  ],
};

const ORIGINAL_CONSTRUCTION_DIRECTORS: Record<string, { name: string; userUid: string; teamUid: string }> = {
  Westminster: { name: "Joe Lynch", userUid: "f203f99b-4aaf-488e-8e6a-8ee5e94ec217", teamUid: "1c23adb9-cefa-44c7-8506-804949afc56f" },
  Centennial: { name: "Drew Perry", userUid: "0ddc7e1d-62e1-49df-b89d-905a39c1e353", teamUid: "76b94bd3-e2fc-4cfe-8c2a-357b9a850b3c" },
  DTC: { name: "Drew Perry", userUid: "0ddc7e1d-62e1-49df-b89d-905a39c1e353", teamUid: "76b94bd3-e2fc-4cfe-8c2a-357b9a850b3c" },
  "Colorado Springs": { name: "Lenny Uematsu", userUid: "6b0a8b10-a969-4dd9-8104-62e5c38f7d77", teamUid: "1a914a0e-b633-4f12-8ed6-3348285d6b93" },
  "San Luis Obispo": { name: "Nick Scarpellino", userUid: "8e67159c-48fe-4fb0-acc3-b1c905ff6e95", teamUid: "699cec60-f9f8-4e57-b41a-bb29b1f3649c" },
  Camarillo: { name: "Nick Scarpellino", userUid: "8e67159c-48fe-4fb0-acc3-b1c905ff6e95", teamUid: "699cec60-f9f8-4e57-b41a-bb29b1f3649c" },
};

describe("field-crew centralization (behavior-preserving)", () => {
  it("reproduces the survey assignee map exactly", () => {
    expect(SURVEY_USERS_BY_LOCATION).toEqual(ORIGINAL_SURVEY_USERS);
  });

  it("reproduces the inspection assignee map exactly (Camarillo omitted)", () => {
    expect(INSPECTION_USERS_BY_LOCATION).toEqual(ORIGINAL_INSPECTION_USERS);
    expect(Object.keys(INSPECTION_USERS_BY_LOCATION)).not.toContain("Camarillo");
  });

  it("reproduces the construction director map exactly", () => {
    expect(CONSTRUCTION_DIRECTORS_BY_LOCATION).toEqual(ORIGINAL_CONSTRUCTION_DIRECTORS);
  });

  it("keeps runtime-resolved crew userUids blank", () => {
    expect(FIELD_CREW.chadSchollman.userUid).toBe("");
    expect(FIELD_CREW.alexanderSwope.userUid).toBe("");
    expect(FIELD_CREW.anthonyVillanueva.userUid).toBe("");
  });

  it("keeps Rolando as an email-only regional director (no assignment userUid)", () => {
    expect(FIELD_CREW.rolando.email).toBe("rolando@photonbrothers.com");
    expect(FIELD_CREW.rolando.userUid).toBe("");
  });

  it("assigns Camarillo field work under the SLO team", () => {
    expect(fieldCrewAssignee(FIELD_CREW.nick, "Camarillo").teamUid).toBe(
      "699cec60-f9f8-4e57-b41a-bb29b1f3649c",
    );
  });
});
