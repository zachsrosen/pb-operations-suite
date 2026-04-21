"use client";

import type { EnrichedTask, TaskQueue, TaskStatus } from "@/lib/hubspot-tasks";
import { groupTasks, type SortMode } from "./grouping";
import TaskRow from "./TaskRow";

interface TasksGroupedProps {
  tasks: EnrichedTask[];
  sort: SortMode;
  onComplete: (taskId: string) => void;
  onSnooze: (taskId: string, dueAt: string | null) => void;
  onStatusChange: (taskId: string, status: TaskStatus) => void;
  onQueuesChange: (taskId: string, queueIds: string[]) => void;
  allQueues: TaskQueue[];
  pendingTaskIds: Set<string>;
  selectedIds: Set<string>;
  onSelectedChange: (taskId: string, selected: boolean) => void;
  onSelectGroup: (taskIds: string[], selected: boolean) => void;
}

export default function TasksGrouped({
  tasks,
  sort,
  onComplete,
  onSnooze,
  onStatusChange,
  onQueuesChange,
  allQueues,
  pendingTaskIds,
  selectedIds,
  onSelectedChange,
  onSelectGroup,
}: TasksGroupedProps) {
  const groups = groupTasks(tasks, sort);

  return (
    <div className="space-y-6">
      {groups.map((group) => {
        const groupIds = group.tasks.map((t) => t.id);
        const allSelected = groupIds.length > 0 && groupIds.every((id) => selectedIds.has(id));
        const someSelected = !allSelected && groupIds.some((id) => selectedIds.has(id));
        return (
          <section key={group.key}>
            <h2
              className={`mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider ${
                group.accent === "red" ? "text-red-500" : "text-muted"
              }`}
            >
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected;
                }}
                onChange={(e) => onSelectGroup(groupIds, e.target.checked)}
                aria-label={`Select all ${group.label}`}
                className="h-4 w-4 cursor-pointer accent-blue-500"
              />
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
                  mode="open"
                  onComplete={() => onComplete(task.id)}
                  onSnooze={(dueAt) => onSnooze(task.id, dueAt)}
                  onStatusChange={(status) => onStatusChange(task.id, status)}
                  onQueuesChange={(queueIds) => onQueuesChange(task.id, queueIds)}
                  allQueues={allQueues}
                  pending={pendingTaskIds.has(task.id)}
                  selected={selectedIds.has(task.id)}
                  onSelectedChange={(sel) => onSelectedChange(task.id, sel)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
