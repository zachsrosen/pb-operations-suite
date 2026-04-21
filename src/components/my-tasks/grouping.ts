import type { EnrichedTask } from "@/lib/hubspot-tasks";

export type SortMode = "due" | "created" | "name";

export interface TaskGroup {
  key: string;
  label: string;
  tasks: EnrichedTask[];
  accent?: "red" | "muted";
}

// ── Date-bucket grouping (sort=due) ──────────────────────────────────────

type Bucket = "overdue" | "today" | "thisWeek" | "later" | "noDueDate";

const BUCKET_LABELS: Record<Bucket, string> = {
  overdue: "Overdue",
  today: "Today",
  thisWeek: "This week",
  later: "Later",
  noDueDate: "No due date",
};

const BUCKET_ORDER: Bucket[] = ["overdue", "today", "thisWeek", "later", "noDueDate"];

/**
 * Assign a task to a date bucket, using the local machine's timezone for
 * day boundaries. "This week" means the remainder of the current Mon–Sun
 * week, excluding today. On Sunday, the current week has already ended —
 * next Monday onward falls into "Later" (the new week hasn't started yet).
 */
export function bucketForTask(dueAt: string | null, now: Date = new Date()): Bucket {
  if (!dueAt) return "noDueDate";
  const due = new Date(dueAt);
  if (isNaN(due.getTime())) return "noDueDate";

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

  const dayOfWeek = startOfToday.getDay();
  const daysUntilNextMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
  const endOfWeek = new Date(startOfToday);
  endOfWeek.setDate(endOfWeek.getDate() + daysUntilNextMonday);

  if (due < startOfToday) return "overdue";
  if (due < startOfTomorrow) return "today";
  if (due < endOfWeek) return "thisWeek";
  return "later";
}

// ── Name normalization (sort=name) ───────────────────────────────────────

/**
 * Normalize a task subject for grouping: lowercase, strip punctuation and
 * whitespace so "Follow up – Smith", "Follow up: Smith", and "follow up Smith"
 * all land in the same bucket.
 */
export function normalizeName(subject: string | null): string {
  if (!subject) return "(no subject)";
  return subject
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "(no subject)";
}

// ── Dispatcher ───────────────────────────────────────────────────────────

export function groupTasks(tasks: EnrichedTask[], sort: SortMode): TaskGroup[] {
  if (sort === "due") {
    return groupByDueBuckets(tasks);
  }
  if (sort === "created") {
    return [
      {
        key: "all",
        label: "Sorted by assigned date (newest first)",
        tasks: [...tasks].sort((a, z) => timeOf(z.createdAt) - timeOf(a.createdAt)),
      },
    ];
  }
  // sort === "name"
  return groupByName(tasks);
}

function timeOf(iso: string | null): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return isNaN(t) ? 0 : t;
}

function groupByDueBuckets(tasks: EnrichedTask[]): TaskGroup[] {
  const groups: Record<Bucket, EnrichedTask[]> = {
    overdue: [],
    today: [],
    thisWeek: [],
    later: [],
    noDueDate: [],
  };
  for (const t of tasks) groups[bucketForTask(t.dueAt)].push(t);

  for (const b of BUCKET_ORDER) {
    groups[b].sort((a, z) => {
      const ad = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
      const zd = z.dueAt ? new Date(z.dueAt).getTime() : Infinity;
      return ad - zd;
    });
  }

  return BUCKET_ORDER.filter((b) => groups[b].length > 0).map((b) => ({
    key: b,
    label: BUCKET_LABELS[b],
    tasks: groups[b],
    accent: b === "overdue" ? ("red" as const) : ("muted" as const),
  }));
}

function groupByName(tasks: EnrichedTask[]): TaskGroup[] {
  const buckets = new Map<string, { displaySubject: string; tasks: EnrichedTask[] }>();
  for (const t of tasks) {
    const key = normalizeName(t.subject);
    if (!buckets.has(key)) {
      buckets.set(key, { displaySubject: t.subject || "(no subject)", tasks: [] });
    }
    buckets.get(key)!.tasks.push(t);
  }

  const entries = [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b));

  return entries.map(([key, value]) => ({
    key,
    label: value.displaySubject,
    tasks: value.tasks.sort((a, z) => timeOf(a.dueAt) - timeOf(z.dueAt)),
  }));
}
