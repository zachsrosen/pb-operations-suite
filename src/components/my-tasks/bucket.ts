import type { EnrichedTask } from "@/lib/hubspot-tasks";

export type Bucket = "overdue" | "today" | "thisWeek" | "later" | "noDueDate";

export const BUCKET_LABELS: Record<Bucket, string> = {
  overdue: "Overdue",
  today: "Today",
  thisWeek: "This week",
  later: "Later",
  noDueDate: "No due date",
};

export const BUCKET_ORDER: Bucket[] = ["overdue", "today", "thisWeek", "later", "noDueDate"];

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

  // End of this week — exclusive bound at start of next Monday.
  // getDay(): 0=Sun, 1=Mon ... 6=Sat. From Sun→1, Mon→7, Sat→2 days until Mon.
  const dayOfWeek = startOfToday.getDay();
  const daysUntilNextMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
  const endOfWeek = new Date(startOfToday);
  endOfWeek.setDate(endOfWeek.getDate() + daysUntilNextMonday);

  if (due < startOfToday) return "overdue";
  if (due < startOfTomorrow) return "today";
  if (due < endOfWeek) return "thisWeek";
  return "later";
}

export function groupByBucket(tasks: EnrichedTask[]): Record<Bucket, EnrichedTask[]> {
  const groups: Record<Bucket, EnrichedTask[]> = {
    overdue: [],
    today: [],
    thisWeek: [],
    later: [],
    noDueDate: [],
  };
  for (const t of tasks) {
    groups[bucketForTask(t.dueAt)].push(t);
  }
  // Sort each bucket by due date ascending; undated at bottom
  for (const b of BUCKET_ORDER) {
    groups[b].sort((a, z) => {
      const ad = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
      const zd = z.dueAt ? new Date(z.dueAt).getTime() : Infinity;
      return ad - zd;
    });
  }
  return groups;
}
