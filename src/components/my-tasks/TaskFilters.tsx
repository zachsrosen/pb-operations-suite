"use client";

import { useEffect, useState } from "react";
import { MultiSelectFilter, type FilterOption } from "@/components/ui/MultiSelectFilter";
import type { TaskQueue } from "@/lib/hubspot-tasks";

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
}: TaskFiltersProps) {
  const [localSearch, setLocalSearch] = useState(search);

  useEffect(() => {
    const t = setTimeout(() => onSearchChange(localSearch), 300);
    return () => clearTimeout(t);
  }, [localSearch, onSearchChange]);

  const queueOptions: FilterOption[] = queues.map((q) => ({ value: q.id, label: q.name }));

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
    </div>
  );
}
