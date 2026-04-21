"use client";

import type { EnrichedTask } from "@/lib/hubspot-tasks";
import { groupTasks, type SortMode } from "./grouping";
import TaskRow from "./TaskRow";

interface TasksGroupedProps {
  tasks: EnrichedTask[];
  sort: SortMode;
  onComplete: (taskId: string) => void;
  pendingTaskIds: Set<string>;
}

export default function TasksGrouped({
  tasks,
  sort,
  onComplete,
  pendingTaskIds,
}: TasksGroupedProps) {
  const groups = groupTasks(tasks, sort);

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <section key={group.key}>
          <h2
            className={`mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider ${
              group.accent === "red" ? "text-red-500" : "text-muted"
            }`}
          >
            <span>{group.label}</span>
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">
              {group.tasks.length}
            </span>
          </h2>
          <div className="space-y-2">
            {group.tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                onComplete={() => onComplete(task.id)}
                pending={pendingTaskIds.has(task.id)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
