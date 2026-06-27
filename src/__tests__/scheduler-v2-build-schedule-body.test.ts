/**
 * Tests for scheduler-v2 buildScheduleBody() — the pure request-body builder for
 * PUT /api/zuper/jobs/schedule.
 *
 * These tests assert the two load-bearing decisions:
 *   1. create-vs-reschedule (driven by WorkItem.hasZuperJob)
 *   2. timezone selection (driven by WorkItem.location: CA → LA, CO → Denver)
 *
 * No network is touched — buildScheduleBody is pure. (The drawer that *sends*
 * the body is never invoked here, so no live endpoint is called.)
 */
import {
  buildScheduleBody,
  resolveTimezone,
  DEFAULT_START_TIME,
  DEFAULT_END_TIME,
  type ScheduleFormValues,
} from "@/lib/scheduler-v2/buildScheduleBody";
import type { Resource, WorkItem } from "@/lib/scheduler-v2/types";

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "wi-1",
    dealId: "deal-123",
    customer: "Jane Homeowner",
    location: "Westminster",
    workType: "install",
    durationDays: 2,
    status: "unscheduled",
    assignedResourceIds: [],
    isTentative: false,
    isOverdue: false,
    isForecast: false,
    hasZuperJob: true,
    source: "hubspot",
    ...overrides,
  };
}

function makeResource(overrides: Partial<Resource> = {}): Resource {
  return {
    id: "res-1",
    name: "Joe Lynch",
    kind: "crew",
    locations: ["Westminster"],
    primaryLocation: "Westminster",
    color: "#abc",
    capacityPerDay: 1,
    zuperUserUid: "uid-joe",
    zuperTeamUid: "team-westy",
    assignable: true,
    ...overrides,
  };
}

const baseForm: ScheduleFormValues = {
  date: "2026-07-01",
  days: 2,
  startTime: "08:00",
  endTime: "16:00",
  installerNotes: "",
  testMode: true,
};

describe("resolveTimezone", () => {
  it("maps CO locations to America/Denver", () => {
    expect(resolveTimezone("Westminster")).toBe("America/Denver");
    expect(resolveTimezone("Colorado Springs")).toBe("America/Denver");
  });
  it("maps CA locations to America/Los_Angeles", () => {
    expect(resolveTimezone("San Luis Obispo")).toBe("America/Los_Angeles");
    expect(resolveTimezone("Camarillo")).toBe("America/Los_Angeles");
  });
  it("falls back to Denver for unknown / undefined locations", () => {
    expect(resolveTimezone("Nowhere")).toBe("America/Denver");
    expect(resolveTimezone(undefined)).toBe("America/Denver");
  });
});

describe("buildScheduleBody — create vs reschedule", () => {
  it("sends rescheduleOnly:true when the WorkItem already has a Zuper job", () => {
    const body = buildScheduleBody(makeWorkItem({ hasZuperJob: true }), makeResource(), baseForm);
    expect(body.rescheduleOnly).toBe(true);
  });

  it("sends rescheduleOnly:false (create + assign at creation) when no Zuper job exists", () => {
    const body = buildScheduleBody(makeWorkItem({ hasZuperJob: false }), makeResource(), baseForm);
    expect(body.rescheduleOnly).toBe(false);
  });

  it("treats undefined hasZuperJob as reschedule (defensive default)", () => {
    const wi = makeWorkItem();
    // @ts-expect-error simulate a malformed item missing the flag
    delete wi.hasZuperJob;
    expect(buildScheduleBody(wi, makeResource(), baseForm).rescheduleOnly).toBe(true);
  });
});

describe("buildScheduleBody — timezone selection", () => {
  it("uses Denver for a CO WorkItem", () => {
    const body = buildScheduleBody(makeWorkItem({ location: "Centennial" }), makeResource(), baseForm);
    expect(body.schedule.timezone).toBe("America/Denver");
  });
  it("uses Los Angeles for a CA WorkItem", () => {
    const body = buildScheduleBody(
      makeWorkItem({ location: "San Luis Obispo" }),
      makeResource({ primaryLocation: "San Luis Obispo" }),
      baseForm,
    );
    expect(body.schedule.timezone).toBe("America/Los_Angeles");
  });
});

describe("buildScheduleBody — body shape parity with construction-scheduler", () => {
  it("maps project + schedule fields and threads crew uids", () => {
    const body = buildScheduleBody(
      makeWorkItem({ zuperJobUid: "job-9", address: "1 Main St", dealId: "deal-123" }),
      makeResource({ name: "Joe Lynch", zuperUserUid: "uid-joe", zuperTeamUid: "team-westy" }),
      { ...baseForm, days: 3, installerNotes: "gate code 1234" },
    );

    expect(body.project.id).toBe("deal-123");
    expect(body.project.name).toBe("Jane Homeowner");
    expect(body.project.address).toBe("1 Main St");
    expect(body.project.zuperJobUid).toBe("job-9");

    expect(body.schedule.type).toBe("installation");
    expect(body.schedule.date).toBe("2026-07-01");
    expect(body.schedule.days).toBe(3);
    expect(body.schedule.crew).toBe("uid-joe");
    expect(body.schedule.userUid).toBe("uid-joe");
    expect(body.schedule.assignedUser).toBe("Joe Lynch");
    expect(body.schedule.teamUid).toBe("team-westy");
    expect(body.schedule.installerNotes).toBe("gate code 1234");
    expect(body.schedule.testMode).toBe(true);
  });

  it("defaults missing times and clamps days to >= 1", () => {
    const body = buildScheduleBody(
      makeWorkItem(),
      makeResource(),
      { ...baseForm, days: 0, startTime: "", endTime: "" },
    );
    expect(body.schedule.startTime).toBe(DEFAULT_START_TIME);
    expect(body.schedule.endTime).toBe(DEFAULT_END_TIME);
    expect(body.schedule.days).toBe(1);
  });

  it("annotates the note with a test-mode marker when testMode is on", () => {
    const on = buildScheduleBody(makeWorkItem(), makeResource(), { ...baseForm, testMode: true });
    expect(on.schedule.notes).toMatch(/TEST MODE/);
    const off = buildScheduleBody(makeWorkItem(), makeResource(), { ...baseForm, testMode: false });
    expect(off.schedule.notes).not.toMatch(/TEST MODE/);
  });

  it("falls back to empty crew uid (resolved by name server-side) when resource lacks one", () => {
    const body = buildScheduleBody(
      makeWorkItem(),
      makeResource({ name: "Lenny Uematsu", zuperUserUid: undefined }),
      baseForm,
    );
    expect(body.schedule.crew).toBe("");
    expect(body.schedule.assignedUser).toBe("Lenny Uematsu");
  });
});
