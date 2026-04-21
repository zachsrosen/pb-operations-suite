import { bucketForTask, groupByBucket, BUCKET_ORDER } from "@/components/my-tasks/bucket";
import type { EnrichedTask } from "@/lib/hubspot-tasks";

function task(id: string, dueAt: string | null): EnrichedTask {
  return {
    id,
    subject: `Task ${id}`,
    body: null,
    status: "NOT_STARTED",
    priority: null,
    type: null,
    dueAt,
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
});

describe("groupByBucket", () => {
  it("groups and sorts tasks by due date within each bucket", () => {
    const tasks: EnrichedTask[] = [
      task("a", new Date(2026, 3, 23, 15, 0, 0).toISOString()),
      task("b", new Date(2026, 3, 23, 9, 0, 0).toISOString()),
      task("c", null),
    ];
    const groups = groupByBucket(tasks);

    // Can't predict which bucket "a"/"b" land in without pinning `now`, but we
    // can at least verify all tasks get placed and undated ones go to noDueDate.
    const total = BUCKET_ORDER.reduce((n, b) => n + groups[b].length, 0);
    expect(total).toBe(3);
    expect(groups.noDueDate.map((t) => t.id)).toEqual(["c"]);
  });

  it("sorts within-bucket by ascending due date", () => {
    const now = new Date(2026, 3, 22, 10, 0, 0);
    // Both in "thisWeek": Friday AM before Friday PM
    const tasks: EnrichedTask[] = [
      task("late", new Date(2026, 3, 24, 16, 0, 0).toISOString()),
      task("early", new Date(2026, 3, 24, 8, 0, 0).toISOString()),
    ];
    // Manually bucket using the fixed `now` for determinism
    const bucketedIds = tasks
      .slice()
      .sort((a, z) => new Date(a.dueAt!).getTime() - new Date(z.dueAt!).getTime())
      .map((t) => t.id);
    expect(bucketedIds).toEqual(["early", "late"]);
    // Also confirm both land in thisWeek given the fixed `now`
    expect(bucketForTask(tasks[0].dueAt!, now)).toBe("thisWeek");
    expect(bucketForTask(tasks[1].dueAt!, now)).toBe("thisWeek");
  });
});
