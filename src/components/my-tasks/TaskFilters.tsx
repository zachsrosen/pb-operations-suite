"use client";

import { useEffect, useState } from "react";
import { MultiSelectFilter, type FilterOption } from "@/components/ui/MultiSelectFilter";
import type { TaskQueue } from "@/lib/hubspot-tasks";
import type { SortMode } from "./grouping";

const TYPE_OPTIONS: FilterOption[] = [
  { value: "CALL", label: "Call" },
  { value: "EMAIL", label: "Email" },
  { value: "TODO", label: "To-do" },
];

const PRIORITY_OPTIONS: FilterOption[] = [
  { value: "HIGH", label: "High" },
  { value: "MEDIUM", label: "Medium" },
  { value: "LOW", label: "Low" },
];

const SORT_OPTIONS: Array<{ value: SortMode; label: string }> = [
  { value: "due", label: "Due date" },
  { value: "created", label: "Assigned date" },
  { value: "name", label: "Task name" },
];

interface TaskFiltersProps {
  search: string;
  onSearchChange: (v: string) => void;
  types: string[];
  onTypesChange: (v: string[]) => void;
  priorities: string[];
  onPrioritiesChange: (v: string[]) => void;
  queueIds: string[];
  onQueueIdsChange: (v: string[]) => void;
  queues: TaskQueue[];
  stages: string[];
  onStagesChange: (v: string[]) => void;
  availableStages: string[];
  sort: SortMode;
  onSortChange: (v: SortMode) => void;
  showCompleted: boolean;
  onShowCompletedChange: (v: boolean) => void;
}

export default function TaskFilters({
  search,
  onSearchChange,
  types,
  onTypesChange,
  priorities,
  onPrioritiesChange,
  queueIds,
  onQueueIdsChange,
  queues,
  stages,
  onStagesChange,
  availableStages,
  sort,
  onSortChange,
  showCompleted,
  onShowCompletedChange,
}: TaskFiltersProps) {
  const [localSearch, setLocalSearch] = useState(search);

  useEffect(() => {
    const t = setTimeout(() => onSearchChange(localSearch), 300);
    return () => clearTimeout(t);
  }, [localSearch, onSearchChange]);

  const queueOptions: FilterOption[] = queues.map((q) => ({ value: q.id, label: q.name }));
  const stageOptions: FilterOption[] = availableStages.map((s) => ({ value: s, label: s }));

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-t-border bg-surface p-3">
      <input
        type="search"
        value={localSearch}
        onChange={(e) => setLocalSearch(e.target.value)}
        placeholder="Search by subject, deal, ticket, contact…"
        className="min-w-[240px] flex-1 rounded-md border border-t-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none"
      />
      <MultiSelectFilter
        label="Type"
        options={TYPE_OPTIONS}
        selected={types}
        onChange={onTypesChange}
        accentColor="blue"
      />
      <MultiSelectFilter
        label="Priority"
        options={PRIORITY_OPTIONS}
        selected={priorities}
        onChange={onPrioritiesChange}
        accentColor="blue"
      />
      {queueOptions.length > 0 && (
        <MultiSelectFilter
          label="Queue"
          options={queueOptions}
          selected={queueIds}
          onChange={onQueueIdsChange}
          accentColor="blue"
        />
      )}
      {stageOptions.length > 0 && (
        <MultiSelectFilter
          label="Deal stage"
          options={stageOptions}
          selected={stages}
          onChange={onStagesChange}
          accentColor="blue"
        />
      )}
      <label className="flex items-center gap-2 text-xs text-muted">
        <input
          type="checkbox"
          checked={showCompleted}
          onChange={(e) => onShowCompletedChange(e.target.checked)}
          className="h-3.5 w-3.5 cursor-pointer accent-blue-500"
        />
        Show completed (7d)
      </label>
      <label className="ml-auto flex items-center gap-2 text-xs text-muted">
        <span>Sort</span>
        <select
          value={sort}
          onChange={(e) => onSortChange(e.target.value as SortMode)}
          className="rounded-md border border-t-border bg-background px-2 py-1 text-xs text-foreground focus:border-blue-500 focus:outline-none"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
