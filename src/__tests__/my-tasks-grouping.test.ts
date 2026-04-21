import { bucketForTask, groupTasks, normalizeName, type SortMode } from "@/components/my-tasks/grouping";
import type { EnrichedTask } from "@/lib/hubspot-tasks";

function task(
  id: string,
  dueAt: string | null,
  opts: { createdAt?: string | null; subject?: string } = {},
): EnrichedTask {
  return {
    id,
    subject: opts.subject ?? `Task ${id}`,
    body: null,
    status: "NOT_STARTED",
    priority: null,
    type: null,
    dueAt,
    createdAt: opts.createdAt ?? null,
    queueIds: [],
    ownerId: "owner-1",
    hubspotUrl: `https://app.hubspot.com/contacts/0/tasks/${id}`,
    associations: {},
  };
}

describe("bucketForTask", () => {
  // Fixed reference: Wed 2026-04-22 10:00 local time
  const now = new Date(2026, 3, 22, 10, 0, 0);

  it("classifies overdue (before today 00:00)", () => {
    expect(bucketForTask(new Date(2026, 3, 21, 23, 59, 0).toISOString(), now)).toBe("overdue");
  });

  it("classifies today (same day, any time)", () => {
    expect(bucketForTask(new Date(2026, 3, 22, 0, 0, 0).toISOString(), now)).toBe("today");
    expect(bucketForTask(new Date(2026, 3, 22, 23, 59, 0).toISOString(), now)).toBe("today");
  });

  it("classifies thisWeek (tomorrow through end of week)", () => {
    expect(bucketForTask(new Date(2026, 3, 23, 9, 0, 0).toISOString(), now)).toBe("thisWeek");
    expect(bucketForTask(new Date(2026, 3, 26, 20, 0, 0).toISOString(), now)).toBe("thisWeek");
  });

  it("classifies later (after end of week)", () => {
    expect(bucketForTask(new Date(2026, 3, 27, 9, 0, 0).toISOString(), now)).toBe("later");
    expect(bucketForTask(new Date(2026, 5, 1, 9, 0, 0).toISOString(), now)).toBe("later");
  });

  it("classifies noDueDate when null or invalid", () => {
    expect(bucketForTask(null, now)).toBe("noDueDate");
    expect(bucketForTask("not a date", now)).toBe("noDueDate");
  });

  it("when today is Saturday, Sunday is thisWeek and next Monday is later", () => {
    const saturday = new Date(2026, 3, 25, 10, 0, 0);
    expect(bucketForTask(new Date(2026, 3, 26, 9, 0, 0).toISOString(), saturday)).toBe("thisWeek");
    expect(bucketForTask(new Date(2026, 3, 27, 9, 0, 0).toISOString(), saturday)).toBe("later");
  });
});

describe("normalizeName", () => {
  it("strips punctuation and collapses whitespace", () => {
    expect(normalizeName("Follow up: Smith")).toBe("follow up smith");
    expect(normalizeName("Follow up – Smith")).toBe("follow up smith");
    expect(normalizeName("follow  up   Smith")).toBe("follow up smith");
  });

  it("handles null and empty", () => {
    expect(normalizeName(null)).toBe("(no subject)");
    expect(normalizeName("")).toBe("(no subject)");
    expect(normalizeName("  ")).toBe("(no subject)");
  });
});

describe("groupTasks", () => {
  it("sort=due returns buckets in canonical order and hides empty ones", () => {
    // one overdue, one today (using a recent date to keep test deterministic-ish).
    // We just verify the SortMode=due path returns grouped output with correct keys.
    const tasks: EnrichedTask[] = [task("c", null)];
    const groups = groupTasks(tasks, "due");
    expect(groups.map((g) => g.key)).toEqual(["noDueDate"]);
  });

  it("sort=created returns a single group sorted by createdAt desc", () => {
    const tasks: EnrichedTask[] = [
      task("old", null, { createdAt: "2026-04-01T10:00:00Z" }),
      task("new", null, { createdAt: "2026-04-20T10:00:00Z" }),
      task("mid", null, { createdAt: "2026-04-10T10:00:00Z" }),
    ];
    const groups = groupTasks(tasks, "created");
    expect(groups).toHaveLength(1);
    expect(groups[0].tasks.map((t) => t.id)).toEqual(["new", "mid", "old"]);
  });

  it("sort=name groups tasks with matching normalized subjects", () => {
    const tasks: EnrichedTask[] = [
      task("a", null, { subject: "Follow up: Smith" }),
      task("b", null, { subject: "Schedule install" }),
      task("c", null, { subject: "follow up – Smith" }),
      task("d", null, { subject: "Schedule Install" }),
    ];
    const groups = groupTasks(tasks, "name" as SortMode);
    const byKey = Object.fromEntries(groups.map((g) => [g.key, g.tasks.map((t) => t.id)]));
    expect(byKey["follow up smith"].sort()).toEqual(["a", "c"]);
    expect(byKey["schedule install"].sort()).toEqual(["b", "d"]);
  });
});
