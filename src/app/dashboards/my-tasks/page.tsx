"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import TaskFilters from "@/components/my-tasks/TaskFilters";
import TasksGrouped from "@/components/my-tasks/TasksGrouped";
import type { SortMode } from "@/components/my-tasks/grouping";
import type { EnrichedTask, TaskQueue } from "@/lib/hubspot-tasks";

interface MyTasksPayload {
  ownerId: string | null;
  reason?: "NO_HUBSPOT_OWNER";
  tasks: EnrichedTask[];
  queues: TaskQueue[];
  fetchedAt: string;
}

async function fetchMyTasks(): Promise<MyTasksPayload> {
  const r = await fetch("/api/hubspot/tasks/mine");
  if (!r.ok) throw new Error(`failed: ${r.status}`);
  return r.json();
}

export default function MyTasksPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["my-tasks"],
    queryFn: fetchMyTasks,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  const [search, setSearch] = useState("");
  const [types, setTypes] = useState<string[]>([]);
  const [priorities, setPriorities] = useState<string[]>([]);
  const [queueIds, setQueueIds] = useState<string[]>([]);
  const [stages, setStages] = useState<string[]>([]);
  const [sort, setSort] = useState<SortMode>("due");
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  const needle = search.trim().toLowerCase();
  const filtered = (data?.tasks ?? []).filter((t) => {
    if (types.length > 0 && !types.includes(t.type ?? "")) return false;
    if (priorities.length > 0 && !priorities.includes(t.priority ?? "")) return false;
    if (queueIds.length > 0) {
      const hit = t.queueIds.some((q) => queueIds.includes(q));
      if (!hit) return false;
    }
    if (stages.length > 0) {
      const stage = t.associations.deal?.stage ?? null;
      if (!stage || !stages.includes(stage)) return false;
    }
    if (needle) {
      const haystack = [
        t.subject ?? "",
        t.associations.deal?.name ?? "",
        t.associations.ticket?.subject ?? "",
        t.associations.contact?.name ?? "",
      ].join(" ").toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });

  // Derive available deal stages from loaded tasks — keeps the dropdown tight.
  const availableStages = Array.from(
    new Set(
      (data?.tasks ?? [])
        .map((t) => t.associations.deal?.stage)
        .filter((s): s is string => typeof s === "string" && s.length > 0),
    ),
  ).sort();

  const handleComplete = async (taskId: string) => {
    setPendingIds((prev) => new Set(prev).add(taskId));
    // Optimistically drop the task from the cache
    const previous = queryClient.getQueryData<MyTasksPayload>(["my-tasks"]);
    if (previous) {
      queryClient.setQueryData<MyTasksPayload>(["my-tasks"], {
        ...previous,
        tasks: previous.tasks.filter((t) => t.id !== taskId),
      });
    }
    try {
      const res = await fetch(`/api/hubspot/tasks/${taskId}/complete`, { method: "POST" });
      if (!res.ok) throw new Error(`complete failed: ${res.status}`);
    } catch (err) {
      // Rollback optimistic removal
      if (previous) queryClient.setQueryData(["my-tasks"], previous);
      console.error("[my-tasks] failed to complete task", err);
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    }
  };

  const isMissingOwner = data?.reason === "NO_HUBSPOT_OWNER";

  return (
    <DashboardShell
      title="My Tasks"
      accentColor="blue"
      lastUpdated={data?.fetchedAt}
      headerRight={
        <button
          type="button"
          onClick={() => refetch()}
          className="rounded-md border border-t-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-2"
        >
          Refresh
        </button>
      }
    >
      {isLoading ? (
        <div className="rounded-lg border border-t-border bg-surface p-8 text-center text-muted">
          Loading your tasks…
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-t-border bg-surface p-8 text-center">
          <p className="text-foreground">Couldn&apos;t load tasks.</p>
          <button
            onClick={() => refetch()}
            className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
          >
            Try again
          </button>
        </div>
      ) : isMissingOwner ? (
        <div className="rounded-lg border border-t-border bg-surface p-8 text-center">
          <h3 className="text-lg font-semibold text-foreground">No HubSpot owner linked</h3>
          <p className="mt-2 text-sm text-muted">
            We couldn&apos;t find a HubSpot owner record for your email. Ask an admin to link your HubSpot account, then refresh.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <TaskFilters
            search={search}
            onSearchChange={setSearch}
            types={types}
            onTypesChange={setTypes}
            priorities={priorities}
            onPrioritiesChange={setPriorities}
            queueIds={queueIds}
            onQueueIdsChange={setQueueIds}
            queues={data?.queues ?? []}
            stages={stages}
            onStagesChange={setStages}
            availableStages={availableStages}
            sort={sort}
            onSortChange={setSort}
          />
          {filtered.length === 0 ? (
            <div className="rounded-lg border border-t-border bg-surface p-8 text-center text-muted">
              {data?.tasks.length === 0 ? "No open tasks. Nice." : "No tasks match these filters."}
            </div>
          ) : (
            <TasksGrouped
              tasks={filtered}
              sort={sort}
              onComplete={handleComplete}
              pendingTaskIds={pendingIds}
            />
          )}
        </div>
      )}
    </DashboardShell>
  );
}
