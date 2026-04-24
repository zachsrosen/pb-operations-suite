/**
 * Unit tests for logScheduleEventIfChanged — the append-only history hook
 * that watches cacheZuperJob for schedule/crew changes and writes rows to
 * the ScheduleEventLog table.
 */
import { logScheduleEventIfChanged, type ScheduleEventLogDb } from "@/lib/schedule-event-log";

function mkDb(findUniqueResult: unknown = null): {
  db: ScheduleEventLogDb;
  createCalls: unknown[];
} {
  const createCalls: unknown[] = [];
  const db: ScheduleEventLogDb = {
    zuperJobCache: {
      findUnique: jest.fn().mockResolvedValue(findUniqueResult) as unknown as ScheduleEventLogDb["zuperJobCache"]["findUnique"],
    },
    scheduleEventLog: {
      create: jest.fn().mockImplementation(async (args: unknown) => {
        createCalls.push(args);
        return { id: "mock" };
      }) as unknown as ScheduleEventLogDb["scheduleEventLog"]["create"],
    },
  };
  return { db, createCalls };
}

describe("logScheduleEventIfChanged", () => {
  it("writes an 'initial' row when the job has never been cached", async () => {
    const { db, createCalls } = mkDb(null);
    const result = await logScheduleEventIfChanged(db, {
      jobUid: "j1",
      scheduledStart: new Date("2026-04-08T15:00:00Z"),
      scheduledEnd: new Date("2026-04-09T23:00:00Z"),
      assignedUsers: [{ user_uid: "u1", user_name: "Tech A" }],
      assignedTeam: "t1",
    });
    expect(result).toBe("initial");
    expect(createCalls).toHaveLength(1);
    expect((createCalls[0] as { data: Record<string, unknown> }).data).toMatchObject({
      zuperJobUid: "j1",
      scheduledStart: new Date("2026-04-08T15:00:00Z"),
      scheduledEnd: new Date("2026-04-09T23:00:00Z"),
      crewUserUids: ["u1"],
      crewTeamUid: "t1",
      source: "initial",
    });
  });

  it("returns 'unchanged' when schedule and crew match the cache", async () => {
    const { db, createCalls } = mkDb({
      scheduledStart: new Date("2026-04-08T15:00:00Z"),
      scheduledEnd: new Date("2026-04-09T23:00:00Z"),
      assignedUsers: [{ user_uid: "u1" }],
      assignedTeam: "t1",
    });
    const result = await logScheduleEventIfChanged(db, {
      jobUid: "j1",
      scheduledStart: new Date("2026-04-08T15:00:00Z"),
      scheduledEnd: new Date("2026-04-09T23:00:00Z"),
      assignedUsers: [{ user_uid: "u1" }],
      assignedTeam: "t1",
    });
    expect(result).toBe("unchanged");
    expect(createCalls).toHaveLength(0);
  });

  it("writes a 'changed' row when scheduledEnd shifts (Monday → Friday)", async () => {
    const { db, createCalls } = mkDb({
      scheduledStart: new Date("2026-04-06T15:00:00Z"), // Monday
      scheduledEnd: new Date("2026-04-06T23:00:00Z"),
      assignedUsers: [{ user_uid: "u1" }],
      assignedTeam: "t1",
    });
    const result = await logScheduleEventIfChanged(db, {
      jobUid: "j1",
      scheduledStart: new Date("2026-04-10T15:00:00Z"), // Friday
      scheduledEnd: new Date("2026-04-10T23:00:00Z"),
      assignedUsers: [{ user_uid: "u1" }],
      assignedTeam: "t1",
    });
    expect(result).toBe("changed");
    expect(createCalls).toHaveLength(1);
    const data = (createCalls[0] as { data: Record<string, unknown> }).data;
    expect(data.source).toBe("changed");
    expect(data.scheduledEnd).toEqual(new Date("2026-04-10T23:00:00Z"));
    expect(data.previousScheduledEnd).toEqual(new Date("2026-04-06T23:00:00Z"));
  });

  it("writes a 'changed' row when the crew is replaced (Crew A → Crew B)", async () => {
    const { db, createCalls } = mkDb({
      scheduledStart: new Date("2026-04-08T15:00:00Z"),
      scheduledEnd: new Date("2026-04-09T23:00:00Z"),
      assignedUsers: [{ user_uid: "u1" }],
      assignedTeam: "t1",
    });
    const result = await logScheduleEventIfChanged(db, {
      jobUid: "j1",
      scheduledStart: new Date("2026-04-08T15:00:00Z"),
      scheduledEnd: new Date("2026-04-09T23:00:00Z"),
      assignedUsers: [{ user_uid: "u2" }],
      assignedTeam: "t1",
    });
    expect(result).toBe("changed");
    const data = (createCalls[0] as { data: Record<string, unknown> }).data;
    expect(data.crewUserUids).toEqual(["u2"]);
    expect(data.previousCrewUserUids).toEqual(["u1"]);
  });

  it("ignores undefined fields (partial update doesn't trigger false change)", async () => {
    const { db, createCalls } = mkDb({
      scheduledStart: new Date("2026-04-08T15:00:00Z"),
      scheduledEnd: new Date("2026-04-09T23:00:00Z"),
      assignedUsers: [{ user_uid: "u1" }],
      assignedTeam: "t1",
    });
    const result = await logScheduleEventIfChanged(db, {
      jobUid: "j1",
      scheduledStart: new Date("2026-04-08T15:00:00Z"),
      scheduledEnd: new Date("2026-04-09T23:00:00Z"),
      // no assignedUsers, no assignedTeam — partial update
    });
    expect(result).toBe("unchanged");
    expect(createCalls).toHaveLength(0);
  });

  it("treats crew order as insignificant (sorted comparison)", async () => {
    const { db } = mkDb({
      scheduledStart: null,
      scheduledEnd: null,
      assignedUsers: [{ user_uid: "u1" }, { user_uid: "u2" }, { user_uid: "u3" }],
      assignedTeam: null,
    });
    const result = await logScheduleEventIfChanged(db, {
      jobUid: "j1",
      assignedUsers: [{ user_uid: "u3" }, { user_uid: "u1" }, { user_uid: "u2" }],
    });
    expect(result).toBe("unchanged");
  });

  it("detects crew added (u1 → u1, u2) as changed", async () => {
    const { db, createCalls } = mkDb({
      scheduledStart: null,
      scheduledEnd: null,
      assignedUsers: [{ user_uid: "u1" }],
      assignedTeam: null,
    });
    const result = await logScheduleEventIfChanged(db, {
      jobUid: "j1",
      assignedUsers: [{ user_uid: "u1" }, { user_uid: "u2" }],
    });
    expect(result).toBe("changed");
    const data = (createCalls[0] as { data: Record<string, unknown> }).data;
    expect(data.crewUserUids).toEqual(["u1", "u2"]);
    expect(data.previousCrewUserUids).toEqual(["u1"]);
  });
});
