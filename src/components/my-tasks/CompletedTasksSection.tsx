"use client";

import type { EnrichedTask } from "@/lib/hubspot-tasks";
import TaskRow from "./TaskRow";

interface CompletedTasksSectionProps {
  tasks: EnrichedTask[];
  onReopen: (taskId: string) => void;
  pendingTaskIds: Set<string>;
}

export default function CompletedTasksSection({
  tasks,
  onReopen,
  pendingTaskIds,
}: CompletedTasksSectionProps) {
  if (tasks.length === 0) {
    return (
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">
          Completed (last 7 days)
        </h2>
        <p className="text-xs text-muted">Nothing completed in the past week.</p>
      </section>
    );
  }
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-emerald-400">
        <span>Completed (last 7 days)</span>
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">
          {tasks.length}
        </span>
      </h2>
      <div className="space-y-2">
        {tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            mode="completed"
            onComplete={() => {}}
            onReopen={() => onReopen(task.id)}
            onSnooze={() => {}}
            pending={pendingTaskIds.has(task.id)}
            selected={false}
            onSelectedChange={() => {}}
          />
        ))}
      </div>
    </section>
  );
}
