"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import TaskFilters from "@/components/my-tasks/TaskFilters";
import TasksGrouped from "@/components/my-tasks/TasksGrouped";
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

  const needle = search.trim().toLowerCase();
  const filtered = (data?.tasks ?? []).filter((t) => {
    if (types.length > 0 && !types.includes(t.type ?? "")) return false;
    if (priorities.length > 0 && !priorities.includes(t.priority ?? "")) return false;
    if (queueIds.length > 0) {
      const hit = t.queueIds.some((q) => queueIds.includes(q));
      if (!hit) return false;
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
          />
          {filtered.length === 0 ? (
            <div className="rounded-lg border border-t-border bg-surface p-8 text-center text-muted">
              {data?.tasks.length === 0 ? "No open tasks. Nice." : "No tasks match these filters."}
            </div>
          ) : (
            <TasksGrouped tasks={filtered} />
          )}
        </div>
      )}
    </DashboardShell>
  );
}
