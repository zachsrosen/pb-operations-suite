"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import TaskFilters from "@/components/my-tasks/TaskFilters";
import TasksGrouped from "@/components/my-tasks/TasksGrouped";
import CompletedTasksSection from "@/components/my-tasks/CompletedTasksSection";
import BulkActionBar from "@/components/my-tasks/BulkActionBar";
import CreateTaskModal from "@/components/my-tasks/CreateTaskModal";
import type { SortMode } from "@/components/my-tasks/grouping";
import type { EnrichedTask, TaskQueue, TaskPriority, TaskType } from "@/lib/hubspot-tasks";

interface MyTasksPayload {
  ownerId: string | null;
  reason?: "NO_HUBSPOT_OWNER";
  tasks: EnrichedTask[];
  completedTasks: EnrichedTask[];
  queues: TaskQueue[];
  fetchedAt: string;
}

interface CreateTaskInput {
  subject: string;
  body?: string;
  dueAt?: string;
  priority?: TaskPriority;
  type?: TaskType;
  dealId?: string;
  ticketId?: string;
  contactId?: string;
}

async function fetchMyTasks(includeCompleted: boolean): Promise<MyTasksPayload> {
  const url = includeCompleted ? "/api/hubspot/tasks/mine?includeCompleted=1" : "/api/hubspot/tasks/mine";
  const r = await fetch(url);
  if (!r.ok) throw new Error(`failed: ${r.status}`);
  return r.json();
}

export default function MyTasksPage() {
  const queryClient = useQueryClient();
  const [showCompleted, setShowCompleted] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["my-tasks", showCompleted],
    queryFn: () => fetchMyTasks(showCompleted),
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);
  const [bulkWorking, setBulkWorking] = useState(false);

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
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });

  const availableStages = Array.from(
    new Set(
      (data?.tasks ?? [])
        .map((t) => t.associations.deal?.stage)
        .filter((s): s is string => typeof s === "string" && s.length > 0),
    ),
  ).sort();

  // Drop selections for tasks no longer visible
  const selectedVisible = new Set(
    [...selectedIds].filter((id) => filtered.some((t) => t.id === id)),
  );

  const startPending = (taskId: string) =>
    setPendingIds((prev) => new Set(prev).add(taskId));
  const clearPending = (taskId: string) =>
    setPendingIds((prev) => {
      const next = new Set(prev);
      next.delete(taskId);
      return next;
    });

  const optimisticallyRemoveTask = (taskId: string): MyTasksPayload | undefined => {
    const previous = queryClient.getQueryData<MyTasksPayload>(["my-tasks", showCompleted]);
    if (previous) {
      queryClient.setQueryData<MyTasksPayload>(["my-tasks", showCompleted], {
        ...previous,
        tasks: previous.tasks.filter((t) => t.id !== taskId),
      });
    }
    return previous;
  };

  const rollback = (snapshot: MyTasksPayload | undefined) => {
    if (snapshot) queryClient.setQueryData(["my-tasks", showCompleted], snapshot);
  };

  const handleComplete = async (taskId: string) => {
    startPending(taskId);
    const snap = optimisticallyRemoveTask(taskId);
    try {
      const res = await fetch(`/api/hubspot/tasks/${taskId}/complete`, { method: "POST" });
      if (!res.ok) throw new Error(`complete failed: ${res.status}`);
      if (showCompleted) refetch();
    } catch (err) {
      rollback(snap);
      console.error("[my-tasks] failed to complete task", err);
    } finally {
      clearPending(taskId);
    }
  };

  const handleReopen = async (taskId: string) => {
    startPending(taskId);
    try {
      const res = await fetch(`/api/hubspot/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "NOT_STARTED" }),
      });
      if (!res.ok) throw new Error(`reopen failed: ${res.status}`);
      refetch();
    } catch (err) {
      console.error("[my-tasks] failed to reopen task", err);
    } finally {
      clearPending(taskId);
    }
  };

  const handleSnooze = async (taskId: string, dueAt: string | null) => {
    startPending(taskId);
    const previous = queryClient.getQueryData<MyTasksPayload>(["my-tasks", showCompleted]);
    if (previous) {
      queryClient.setQueryData<MyTasksPayload>(["my-tasks", showCompleted], {
        ...previous,
        tasks: previous.tasks.map((t) => (t.id === taskId ? { ...t, dueAt } : t)),
      });
    }
    try {
      const res = await fetch(`/api/hubspot/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dueAt }),
      });
      if (!res.ok) throw new Error(`snooze failed: ${res.status}`);
    } catch (err) {
      rollback(previous);
      console.error("[my-tasks] failed to snooze task", err);
    } finally {
      clearPending(taskId);
    }
  };

  const handleSelectedChange = (taskId: string, selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (selected) next.add(taskId);
      else next.delete(taskId);
      return next;
    });
  };

  const handleSelectGroup = (taskIds: string[], selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of taskIds) {
        if (selected) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const handleBulkComplete = async () => {
    const ids = [...selectedVisible];
    if (ids.length === 0) return;
    setBulkWorking(true);
    const previous = queryClient.getQueryData<MyTasksPayload>(["my-tasks", showCompleted]);
    if (previous) {
      queryClient.setQueryData<MyTasksPayload>(["my-tasks", showCompleted], {
        ...previous,
        tasks: previous.tasks.filter((t) => !ids.includes(t.id)),
      });
    }
    setSelectedIds(new Set());
    try {
      const results = await Promise.allSettled(
        ids.map((id) => fetch(`/api/hubspot/tasks/${id}/complete`, { method: "POST" })),
      );
      const failures = results.filter(
        (r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok),
      );
      if (failures.length > 0) {
        console.error(`[my-tasks] ${failures.length} of ${ids.length} bulk-complete requests failed`);
        refetch();
      } else if (showCompleted) {
        refetch();
      }
    } finally {
      setBulkWorking(false);
    }
  };

  const handleCreate = async (input: CreateTaskInput) => {
    const res = await fetch("/api/hubspot/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(d.error || `create failed: ${res.status}`);
    }
    refetch();
  };

  const isMissingOwner = data?.reason === "NO_HUBSPOT_OWNER";

  return (
    <DashboardShell
      title="My Tasks"
      accentColor="blue"
      lastUpdated={data?.fetchedAt}
      headerRight={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            disabled={isMissingOwner}
            className="rounded-md bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-600 disabled:opacity-50"
          >
            + New task
          </button>
          <button
            type="button"
            onClick={() => refetch()}
            className="rounded-md border border-t-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-2"
          >
            Refresh
          </button>
        </div>
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
            We couldn&apos;t find a HubSpot owner record for your email. Ask an admin to link your
            HubSpot account in /admin/users, then refresh.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <BulkActionBar
            count={selectedVisible.size}
            onClear={() => setSelectedIds(new Set())}
            onMarkAllDone={handleBulkComplete}
            working={bulkWorking}
          />
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
            showCompleted={showCompleted}
            onShowCompletedChange={setShowCompleted}
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
              onSnooze={handleSnooze}
              pendingTaskIds={pendingIds}
              selectedIds={selectedIds}
              onSelectedChange={handleSelectedChange}
              onSelectGroup={handleSelectGroup}
            />
          )}
          {showCompleted && (
            <CompletedTasksSection
              tasks={data?.completedTasks ?? []}
              onReopen={handleReopen}
              pendingTaskIds={pendingIds}
            />
          )}
        </div>
      )}

      {showCreate && (
        <CreateTaskModal onClose={() => setShowCreate(false)} onCreate={handleCreate} />
      )}
    </DashboardShell>
  );
}
