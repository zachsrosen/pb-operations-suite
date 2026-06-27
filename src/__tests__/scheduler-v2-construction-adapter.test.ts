/**
 * Tests for the scheduler-v2 construction adapter.
 * Exercises toWorkItems() and toResources() from
 * src/lib/scheduler-v2/adapters/construction.ts.
 *
 * Fixture shapes mirror the REAL API payloads as read from:
 *   - src/app/dashboards/construction-scheduler/page.tsx (RawProject, zuperData)
 *   - src/lib/scheduler-subjobs.ts (SubJobInfo)
 *   - prisma/schema.prisma (CrewMember model)
 */

import {
  toWorkItems,
  toResources,
  type ConstructionAdapterProject,
  type ZuperLookupEntry,
  type AdapterCrewMember,
  type TeamUser,
} from "@/lib/scheduler-v2/adapters/construction";
// WorkItem and Resource types used structurally via returned values
import type { WorkItem as _WorkItem, Resource as _Resource } from "@/lib/scheduler-v2/types";
import type { SubJobInfo } from "@/lib/scheduler-subjobs";

/* ------------------------------------------------------------------ */
/*  Fixture helpers                                                    */
/* ------------------------------------------------------------------ */

function makeProject(overrides: Partial<ConstructionAdapterProject>): ConstructionAdapterProject {
  return {
    id: "deal-100",
    name: "PROJ-100 | Smith, John | 123 Main St",
    address: "123 Main St, Westminster, CO",
    location: "Westminster",
    amount: 30000,
    installDays: 2,
    scheduleDate: null,
    installStatus: "Ready to Schedule",
    completionDate: null,
    ...overrides,
  };
}

function makeSubJob(overrides: Partial<SubJobInfo>): SubJobInfo {
  return {
    systemType: "solar",
    jobUid: "job-pv-1",
    status: "Scheduled",
    scheduledDate: "2026-07-07",
    scheduledEnd: "2026-07-08",
    scheduledDays: 2,
    assignedTo: ["Joe Lynch"],
    ...overrides,
  };
}

function makeZuperEntry(overrides: Partial<ZuperLookupEntry>): ZuperLookupEntry {
  return {
    jobUid: "job-legacy-1",
    status: "Scheduled",
    scheduledDate: "2026-07-07",
    scheduledEnd: "2026-07-08",
    scheduledDays: 2,
    assignedTo: ["Joe Lynch"],
    subJobs: undefined,
    ...overrides,
  };
}

function makeCrewMember(overrides: Partial<AdapterCrewMember>): AdapterCrewMember {
  return {
    id: "cm-1",
    name: "Joe Lynch",
    role: "technician",
    locations: ["Westminster"],
    isActive: true,
    maxDailyJobs: 2,
    zuperUserUid: "user-uid-joe",
    zuperTeamUid: "team-uid-westy",
    ...overrides,
  };
}

function makeTeamUser(overrides: Partial<TeamUser>): TeamUser {
  return {
    name: "Joe Lynch",
    userUid: "user-uid-joe",
    teamUid: "team-uid-westy",
    ...overrides,
  };
}

/* ================================================================== */
/*  toWorkItems                                                        */
/* ================================================================== */

describe("toWorkItems", () => {

  /* ---------------------------------------------------------------- */
  /*  Deal with PV + ESS sub-jobs → 2 WorkItems                       */
  /* ---------------------------------------------------------------- */

  it("produces TWO WorkItems for a deal with PV + ESS sub-jobs", () => {
    const project = makeProject({ id: "deal-200" });
    const pvSubJob = makeSubJob({ systemType: "solar", jobUid: "job-pv-200", status: "Scheduled" });
    const essSubJob = makeSubJob({ systemType: "battery", jobUid: "job-ess-200", status: "Scheduled" });
    const zuperLookup: Record<string, ZuperLookupEntry> = {
      "deal-200": makeZuperEntry({
        jobUid: "job-pv-200",
        subJobs: [pvSubJob, essSubJob],
      }),
    };

    const items = toWorkItems([project], zuperLookup, {});

    expect(items.length).toBe(2);

    const pvItem = items.find((i) => i.subSystem === "PV");
    const essItem = items.find((i) => i.subSystem === "ESS");

    expect(pvItem).toBeDefined();
    expect(essItem).toBeDefined();
  });

  it("both sub-job WorkItems share the same parentDealId", () => {
    const project = makeProject({ id: "deal-200" });
    const pvSubJob = makeSubJob({ systemType: "solar", jobUid: "job-pv-200" });
    const essSubJob = makeSubJob({ systemType: "battery", jobUid: "job-ess-200" });
    const zuperLookup: Record<string, ZuperLookupEntry> = {
      "deal-200": makeZuperEntry({ subJobs: [pvSubJob, essSubJob] }),
    };

    const items = toWorkItems([project], zuperLookup, {});

    expect(items.every((i) => i.parentDealId === "deal-200")).toBe(true);
  });

  it("each sub-job WorkItem carries its own distinct zuperJobUid", () => {
    const project = makeProject({ id: "deal-200" });
    const pvSubJob = makeSubJob({ systemType: "solar", jobUid: "job-pv-200" });
    const essSubJob = makeSubJob({ systemType: "battery", jobUid: "job-ess-200" });
    const zuperLookup: Record<string, ZuperLookupEntry> = {
      "deal-200": makeZuperEntry({ subJobs: [pvSubJob, essSubJob] }),
    };

    const items = toWorkItems([project], zuperLookup, {});

    const pvItem = items.find((i) => i.subSystem === "PV")!;
    const essItem = items.find((i) => i.subSystem === "ESS")!;

    expect(pvItem.zuperJobUid).toBe("job-pv-200");
    expect(essItem.zuperJobUid).toBe("job-ess-200");
  });

  it("each sub-job WorkItem has hasZuperJob:true", () => {
    const project = makeProject({ id: "deal-200" });
    const pvSubJob = makeSubJob({ systemType: "solar", jobUid: "job-pv-200" });
    const essSubJob = makeSubJob({ systemType: "battery", jobUid: "job-ess-200" });
    const zuperLookup: Record<string, ZuperLookupEntry> = {
      "deal-200": makeZuperEntry({ subJobs: [pvSubJob, essSubJob] }),
    };

    const items = toWorkItems([project], zuperLookup, {});

    expect(items.every((i) => i.hasZuperJob === true)).toBe(true);
  });

  it("sub-job WorkItem ids are stable (derived from jobUid)", () => {
    const project = makeProject({ id: "deal-200" });
    const pvSubJob = makeSubJob({ systemType: "solar", jobUid: "job-pv-200" });
    const zuperLookup: Record<string, ZuperLookupEntry> = {
      "deal-200": makeZuperEntry({ subJobs: [pvSubJob] }),
    };

    const items1 = toWorkItems([project], zuperLookup, {});
    const items2 = toWorkItems([project], zuperLookup, {});

    // IDs must be deterministic across calls
    expect(items1[0].id).toBe(items2[0].id);
    // ID contains the zuper job uid
    expect(items1[0].id).toContain("job-pv-200");
  });

  /* ---------------------------------------------------------------- */
  /*  Unscheduled RTB deal with no Zuper job → 1 WorkItem             */
  /* ---------------------------------------------------------------- */

  it("produces a single WorkItem for an RTB deal with no Zuper job", () => {
    const project = makeProject({ id: "deal-300", installStatus: "Ready to Build" });
    const items = toWorkItems([project], {}, {});
    expect(items.length).toBe(1);
  });

  it("RTB deal with no Zuper job has hasZuperJob:false", () => {
    const project = makeProject({ id: "deal-300" });
    const items = toWorkItems([project], {}, {});
    expect(items[0].hasZuperJob).toBe(false);
  });

  it("RTB deal with no Zuper job has status 'unscheduled'", () => {
    const project = makeProject({ id: "deal-300" });
    const items = toWorkItems([project], {}, {});
    expect(items[0].status).toBe("unscheduled");
  });

  it("RTB deal with no Zuper job has source 'hubspot'", () => {
    const project = makeProject({ id: "deal-300" });
    const items = toWorkItems([project], {}, {});
    expect(items[0].source).toBe("hubspot");
  });

  /* ---------------------------------------------------------------- */
  /*  Tentative schedule record → isTentative:true                    */
  /* ---------------------------------------------------------------- */

  it("sets isTentative:true when a tentative schedule record exists for the deal", () => {
    const project = makeProject({ id: "deal-400" });
    // scheduleRecords keyed by projectId, value = { id, scheduledDate }
    const scheduleRecords: Record<string, { id: string; scheduledDate: string }> = {
      "deal-400": { id: "sr-1", scheduledDate: "2026-07-10" },
    };
    const items = toWorkItems([project], {}, scheduleRecords);
    expect(items[0].isTentative).toBe(true);
  });

  it("sets isTentative:false when no tentative record exists", () => {
    const project = makeProject({ id: "deal-400" });
    const items = toWorkItems([project], {}, {});
    expect(items[0].isTentative).toBe(false);
  });

  /* ---------------------------------------------------------------- */
  /*  isOverdue population                                             */
  /* ---------------------------------------------------------------- */

  it("populates isOverdue via normalize.isOverdue", () => {
    // A project with scheduleDate well in the past and no completionDate should be overdue
    const project = makeProject({
      id: "deal-500",
      scheduleDate: "2026-01-01", // far in the past
      installStatus: "scheduled",
    });
    const items = toWorkItems([project], {}, {});
    expect(items[0].isOverdue).toBe(true);
  });

  it("isOverdue is false for an unscheduled (no date) deal", () => {
    const project = makeProject({ id: "deal-501", scheduleDate: null });
    const items = toWorkItems([project], {}, {});
    expect(items[0].isOverdue).toBe(false);
  });

  /* ---------------------------------------------------------------- */
  /*  Correct customer name parsing                                    */
  /* ---------------------------------------------------------------- */

  it("extracts customer name from pipe-delimited deal name", () => {
    const project = makeProject({ name: "PROJ-999 | Doe, Jane | 456 Oak Ave" });
    const items = toWorkItems([project], {}, {});
    expect(items[0].customer).toBe("Doe, Jane");
  });

  it("falls back to full name when no pipe delimiter", () => {
    const project = makeProject({ name: "Smith Residence" });
    const items = toWorkItems([project], {}, {});
    expect(items[0].customer).toBe("Smith Residence");
  });

  /* ---------------------------------------------------------------- */
  /*  Correct workType                                                 */
  /* ---------------------------------------------------------------- */

  it("sets workType to 'install' for all construction WorkItems", () => {
    const project = makeProject({ id: "deal-600" });
    const items = toWorkItems([project], {}, {});
    expect(items.every((i) => i.workType === "install")).toBe(true);
  });
});

/* ================================================================== */
/*  toResources                                                        */
/* ================================================================== */

describe("toResources", () => {

  /* ---------------------------------------------------------------- */
  /*  Basic reconciliation                                             */
  /* ---------------------------------------------------------------- */

  it("produces one Resource per team user", () => {
    const crew = [makeCrewMember({ zuperUserUid: "user-uid-joe", name: "Joe Lynch" })];
    const teamUsers = { Westminster: [makeTeamUser({ userUid: "user-uid-joe", name: "Joe Lynch" })] };
    const resources = toResources(crew, teamUsers);
    expect(resources.length).toBe(1);
  });

  it("sets crewMemberId when a team user matches a CrewMember by zuperUserUid", () => {
    const cm = makeCrewMember({ id: "cm-joe", zuperUserUid: "user-uid-joe", name: "Joe Lynch" });
    const teamUsers = { Westminster: [makeTeamUser({ userUid: "user-uid-joe", name: "Joe Lynch" })] };
    const resources = toResources([cm], teamUsers);
    expect(resources[0].crewMemberId).toBe("cm-joe");
  });

  it("sets assignable:true when a team user matches a CrewMember by zuperUserUid", () => {
    const cm = makeCrewMember({ zuperUserUid: "user-uid-joe", isActive: true });
    const teamUsers = { Westminster: [makeTeamUser({ userUid: "user-uid-joe" })] };
    const resources = toResources([cm], teamUsers);
    expect(resources[0].assignable).toBe(true);
  });

  it("uses CrewMember.maxDailyJobs for capacityPerDay when reconciled", () => {
    const cm = makeCrewMember({ zuperUserUid: "user-uid-joe", maxDailyJobs: 3 });
    const teamUsers = { Westminster: [makeTeamUser({ userUid: "user-uid-joe" })] };
    const resources = toResources([cm], teamUsers);
    expect(resources[0].capacityPerDay).toBe(3);
  });

  /* ---------------------------------------------------------------- */
  /*  Edge case (a) — team user with no matching CrewMember           */
  /* ---------------------------------------------------------------- */

  it("(a) team user with no matching CrewMember → Resource with assignable:true, crewMemberId undefined", () => {
    // No crew members, but a team user exists
    const teamUsers = {
      Westminster: [makeTeamUser({ userUid: "unmapped-uid", name: "Unknown Crew" })],
    };
    const resources = toResources([], teamUsers);
    expect(resources.length).toBe(1);
    expect(resources[0].assignable).toBe(true);
    expect(resources[0].crewMemberId).toBeUndefined();
  });

  it("(a) unmapped team user gets default capacityPerDay of 1", () => {
    const teamUsers = {
      Westminster: [makeTeamUser({ userUid: "unmapped-uid", name: "Unknown Crew" })],
    };
    const resources = toResources([], teamUsers);
    expect(resources[0].capacityPerDay).toBe(1);
  });

  /* ---------------------------------------------------------------- */
  /*  Edge case (b) — two CrewMembers with same display name          */
  /* ---------------------------------------------------------------- */

  it("(b) two CrewMembers with same name → match prefers zuperUserUid over name", () => {
    const cm1 = makeCrewMember({
      id: "cm-drew-a",
      name: "Drew Perry",
      zuperUserUid: "uid-drew-real",
    });
    const cm2 = makeCrewMember({
      id: "cm-drew-b",
      name: "Drew Perry",
      zuperUserUid: "uid-drew-other",
    });
    // Team user matches cm1 exactly by userUid
    const teamUsers = {
      Centennial: [makeTeamUser({ userUid: "uid-drew-real", name: "Drew Perry" })],
    };
    const resources = toResources([cm1, cm2], teamUsers);
    // Only one resource (one team user)
    expect(resources.length).toBe(1);
    expect(resources[0].crewMemberId).toBe("cm-drew-a");
  });

  it("(b) same display name but different uid → no double-assign (only one resource row)", () => {
    const cm1 = makeCrewMember({ id: "cm-drew-a", name: "Drew Perry", zuperUserUid: "uid-drew-real" });
    const cm2 = makeCrewMember({ id: "cm-drew-b", name: "Drew Perry", zuperUserUid: "uid-drew-other" });
    const teamUsers = {
      Centennial: [makeTeamUser({ userUid: "uid-drew-real", name: "Drew Perry" })],
    };
    const resources = toResources([cm1, cm2], teamUsers);
    // Should only produce one Resource for the one team user
    expect(resources.filter((r) => r.name === "Drew Perry").length).toBe(1);
  });

  /* ---------------------------------------------------------------- */
  /*  Edge case (c) — CrewMember with no current team membership      */
  /* ---------------------------------------------------------------- */

  it("(c) active CrewMember with no team membership → still rendered, assignable:false", () => {
    const cm = makeCrewMember({
      id: "cm-orphan",
      name: "Old Crew",
      zuperUserUid: "uid-orphan",
      isActive: true,
    });
    // No team users at any location include this user
    const teamUsers = {
      Westminster: [makeTeamUser({ userUid: "uid-someone-else", name: "Other Crew" })],
    };
    const resources = toResources([cm], teamUsers);
    const orphanResource = resources.find((r) => r.crewMemberId === "cm-orphan");
    expect(orphanResource).toBeDefined();
    expect(orphanResource!.assignable).toBe(false);
  });

  it("(c) inactive CrewMember is excluded entirely (not rendered)", () => {
    const cm = makeCrewMember({
      id: "cm-inactive",
      name: "Former Crew",
      zuperUserUid: "uid-inactive",
      isActive: false,
    });
    const teamUsers: Record<string, TeamUser[]> = {};
    const resources = toResources([cm], teamUsers);
    const found = resources.find((r) => r.crewMemberId === "cm-inactive");
    expect(found).toBeUndefined();
  });

  /* ---------------------------------------------------------------- */
  /*  Resource field correctness                                       */
  /* ---------------------------------------------------------------- */

  it("resource id is the zuperUserUid when the team user is matched", () => {
    const cm = makeCrewMember({ zuperUserUid: "user-uid-joe" });
    const teamUsers = { Westminster: [makeTeamUser({ userUid: "user-uid-joe" })] };
    const resources = toResources([cm], teamUsers);
    expect(resources[0].id).toBe("user-uid-joe");
  });

  it("resource primaryLocation matches the team location key", () => {
    const cm = makeCrewMember({ zuperUserUid: "user-uid-joe", locations: ["Westminster"] });
    const teamUsers = { Westminster: [makeTeamUser({ userUid: "user-uid-joe" })] };
    const resources = toResources([cm], teamUsers);
    expect(resources[0].primaryLocation).toBe("Westminster");
  });

  it("resource kind is 'crew' for construction install resources", () => {
    const cm = makeCrewMember({ zuperUserUid: "user-uid-joe" });
    const teamUsers = { Westminster: [makeTeamUser({ userUid: "user-uid-joe" })] };
    const resources = toResources([cm], teamUsers);
    expect(resources[0].kind).toBe("crew");
  });

  it("resource name fallback uses name-match when zuperUserUid match not found", () => {
    // Team user has different uid but same name as crew member → name-based fallback
    const cm = makeCrewMember({ id: "cm-name", name: "Nick Scarpellino", zuperUserUid: "uid-slo" });
    // Team user uid doesn't match — tests name-match fallback
    const teamUsers = {
      "San Luis Obispo": [
        makeTeamUser({ userUid: "uid-slo-team", name: "Nick Scarpellino" }),
      ],
    };
    const resources = toResources([cm], teamUsers);
    const resource = resources.find((r) => r.name === "Nick Scarpellino");
    expect(resource).toBeDefined();
    // Matched by name — crewMemberId is set
    expect(resource?.crewMemberId).toBe("cm-name");
  });

  it("multi-location team users across locations produce a resource per user", () => {
    const crew: AdapterCrewMember[] = [];
    const teamUsers = {
      Westminster: [makeTeamUser({ userUid: "uid-a", name: "Crew A" })],
      Centennial: [makeTeamUser({ userUid: "uid-b", name: "Crew B" })],
    };
    const resources = toResources(crew, teamUsers);
    expect(resources.length).toBe(2);
    const locations = resources.map((r) => r.primaryLocation);
    expect(locations).toContain("Westminster");
    expect(locations).toContain("Centennial");
  });
});
