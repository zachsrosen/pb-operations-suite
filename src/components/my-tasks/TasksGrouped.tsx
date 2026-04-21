"use client";

import type { EnrichedTask } from "@/lib/hubspot-tasks";
import { BUCKET_LABELS, BUCKET_ORDER, groupByBucket } from "./bucket";
import TaskRow from "./TaskRow";

interface TasksGroupedProps {
  tasks: EnrichedTask[];
}

export default function TasksGrouped({ tasks }: TasksGroupedProps) {
  const groups = groupByBucket(tasks);

  return (
    <div className="space-y-6">
      {BUCKET_ORDER.map((bucket) => {
        const list = groups[bucket];
        if (list.length === 0) return null;
        const isOverdue = bucket === "overdue";
        return (
          <section key={bucket}>
            <h2 className={`mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider ${isOverdue ? "text-red-500" : "text-muted"}`}>
              <span>{BUCKET_LABELS[bucket]}</span>
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">
                {list.length}
              </span>
            </h2>
            <div className="space-y-2">
              {list.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
