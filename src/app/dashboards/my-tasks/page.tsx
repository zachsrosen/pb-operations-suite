"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import DashboardShell from "@/components/DashboardShell";
import TaskFilters from "@/components/my-tasks/TaskFilters";
import TasksGrouped from "@/components/my-tasks/TasksGrouped";
import CompletedTasksSection from "@/components/my-tasks/CompletedTasksSection";
import BulkActionBar from "@/components/my-tasks/BulkActionBar";
import CreateTaskModal, { type CreateTaskInput } from "@/components/my-tasks/CreateTaskModal";
import KeyboardHelp from "@/components/my-tasks/KeyboardHelp";
import type { SortMode } from "@/components/my-tasks/grouping";
import type {
  EnrichedTask,
  TaskQueue,
  TaskStatus,
} from "@/lib/hubspot-tasks";

interface MyTasksPayload {
  ownerId: string | null;
  reason?: "NO_HUBSPOT_OWNER";
  tasks: EnrichedTask[];
  completedTasks: EnrichedTask[];
  queues: TaskQueue[];
  allQueues: TaskQueue[];
  fetchedAt: string;
}

const VALID_SORTS: SortMode[] = ["due", "created", "name"];

async function fetchMyTasks(includeCompleted: boolean): Promise<MyTasksPayload> {
  const url = includeCompleted
    ? "/api/hubspot/tasks/mine?includeCompleted=1"
    : "/api/hubspot/tasks/mine";
  const r = await fetch(url);
  if (!r.ok) throw new Error(`failed: ${r.status}`);
  return r.json();
}

export default function MyTasksPage() {
  return (
    <Suspense fallback={<MyTasksLoadingShell />}>
      <MyTasksPageInner />
    </Suspense>
  );
}

function MyTasksLoadingShell() {
  return (
    <DashboardShell title="My Tasks" accentColor="blue">
      <div className="rounded-lg border border-t-border bg-surface p-8 text-center text-muted">
        Loading your tasks…
      </div>
    </DashboardShell>
  );
}

function MyTasksPageInner() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();

  // ── URL-backed view state ─────────────────────────────────────────────
  const rawSort = searchParams.get("sort");
  const initialSort: SortMode = VALID_SORTS.includes(rawSort as SortMode)
    ? (rawSort as SortMode)
    : "due";
  const initialShowCompleted = searchParams.get("completed") === "1";

  const [showCompleted, setShowCompletedState] = useState(initialShowCompleted);
  const [sort, setSortState] = useState<SortMode>(initialSort);

  const setSort = useCallback(
    (next: SortMode) => {
      setSortState(next);
      const params = new URLSearchParams(searchParams.toString());
      if (next === "due") params.delete("sort");
      else params.set("sort", next);
      const qs = params.toString();
      router.replace(qs ? `/dashboards/my-tasks?${qs}` : "/dashboards/my-tasks", { scroll: false });
    },
    [router, searchParams],
  );

  const setShowCompleted = useCallback(
    (next: boolean) => {
      setShowCompletedState(next);
      const params = new URLSearchParams(searchParams.toString());
      if (next) params.set("completed", "1");
      else params.delete("completed");
      const qs = params.toString();
      router.replace(qs ? `/dashboards/my-tasks?${qs}` : "/dashboards/my-tasks", { scroll: false });
    },
    [router, searchParams],
  );

  // ── Data ──────────────────────────────────────────────────────────────
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["my-tasks", showCompleted],
    queryFn: () => fetchMyTasks(showCompleted),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  // ── Filter state ──────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [types, setTypes] = useState<string[]>([]);
  const [priorities, setPriorities] = useState<string[]>([]);
  const [queueIds, setQueueIds] = useState<string[]>([]);
  const [stages, setStages] = useState<string[]>([]);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [bulkWorking, setBulkWorking] = useState(false);
  // Start with the first task focused so keyboard shortcuts (c, x) work
  // without forcing the user to press j first.
  const [focusIndex, setFocusIndex] = useState<number>(0);

  const searchInputRef = useRef<HTMLInputElement>(null);

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

  const selectedVisible = new Set(
    [...selectedIds].filter((id) => filtered.some((t) => t.id === id)),
  );

  // ── Document title ────────────────────────────────────────────────────
  const openCount = filtered.length;
  useEffect(() => {
    const base = "My Tasks";
    document.title = openCount > 0 ? `${base} (${openCount}) · PB Tech Ops` : `${base} · PB Tech Ops`;
    return () => {
      document.title = "PB Tech Ops";
    };
  }, [openCount]);

  // ── Mutation helpers ─────────────────────────────────────────────────
  const startPending = (taskId: string) =>
    setPendingIds((prev) => new Set(prev).add(taskId));
  const clearPending = (taskId: string) =>
    setPendingIds((prev) => {
      const next = new Set(prev);
      next.delete(taskId);
      return next;
    });

  const updateCache = (mutator: (prev: MyTasksPayload) => MyTasksPayload): MyTasksPayload | undefined => {
    const previous = queryClient.getQueryData<MyTasksPayload>(["my-tasks", showCompleted]);
    if (previous) {
      queryClient.setQueryData<MyTasksPayload>(["my-tasks", showCompleted], mutator(previous));
    }
    return previous;
  };

  const rollback = (snapshot: MyTasksPayload | undefined) => {
    if (snapshot) queryClient.setQueryData(["my-tasks", showCompleted], snapshot);
  };

  const handleComplete = async (taskId: string) => {
    startPending(taskId);
    const snap = updateCache((p) => ({ ...p, tasks: p.tasks.filter((t) => t.id !== taskId) }));
    try {
      const res = await fetch(`/api/hubspot/tasks/${taskId}/complete`, { method: "POST" });
      if (!res.ok) throw new Error(`complete failed: ${res.status}`);
      if (showCompleted) refetch();
    } catch (err) {
      rollback(snap);
      console.error("[my-tasks] complete", err);
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
      console.error("[my-tasks] reopen", err);
    } finally {
      clearPending(taskId);
    }
  };

  const handleSnooze = async (taskId: string, dueAt: string | null) => {
    startPending(taskId);
    const snap = updateCache((p) => ({
      ...p,
      tasks: p.tasks.map((t) => (t.id === taskId ? { ...t, dueAt } : t)),
    }));
    try {
      const res = await fetch(`/api/hubspot/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dueAt }),
      });
      if (!res.ok) throw new Error(`snooze failed: ${res.status}`);
    } catch (err) {
      rollback(snap);
      console.error("[my-tasks] snooze", err);
    } finally {
      clearPending(taskId);
    }
  };

  const handleStatusChange = async (taskId: string, status: TaskStatus) => {
    startPending(taskId);
    const snap = updateCache((p) => ({
      ...p,
      tasks: p.tasks.map((t) => (t.id === taskId ? { ...t, status } : t)),
    }));
    try {
      const res = await fetch(`/api/hubspot/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`status failed: ${res.status}`);
    } catch (err) {
      rollback(snap);
      console.error("[my-tasks] status", err);
    } finally {
      clearPending(taskId);
    }
  };

  const handleQueuesChange = async (taskId: string, nextQueueIds: string[]) => {
    startPending(taskId);
    const snap = updateCache((p) => ({
      ...p,
      tasks: p.tasks.map((t) => (t.id === taskId ? { ...t, queueIds: nextQueueIds } : t)),
    }));
    try {
      const res = await fetch(`/api/hubspot/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queueIds: nextQueueIds }),
      });
      if (!res.ok) throw new Error(`queues failed: ${res.status}`);
    } catch (err) {
      rollback(snap);
      console.error("[my-tasks] queues", err);
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
    const snap = updateCache((p) => ({ ...p, tasks: p.tasks.filter((t) => !ids.includes(t.id)) }));
    setSelectedIds(new Set());
    try {
      const results = await Promise.allSettled(
        ids.map((id) => fetch(`/api/hubspot/tasks/${id}/complete`, { method: "POST" })),
      );
      const failures = results.filter(
        (r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok),
      );
      if (failures.length > 0) {
        console.error(`[my-tasks] ${failures.length} of ${ids.length} bulk-complete failed`);
        rollback(snap);
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

  // ── Keyboard shortcuts ────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Skip when typing in an input / textarea / select
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "/") {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (e.key === "?") {
        e.preventDefault();
        setShowHelp((v) => !v);
        return;
      }
      if (e.key === "n") {
        e.preventDefault();
        setShowCreate(true);
        return;
      }
      if (e.key === "j") {
        e.preventDefault();
        setFocusIndex((i) => Math.min(filtered.length - 1, i + 1));
        return;
      }
      if (e.key === "k") {
        e.preventDefault();
        setFocusIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === "c" && focusIndex >= 0 && focusIndex < filtered.length) {
        e.preventDefault();
        handleComplete(filtered[focusIndex].id);
        return;
      }
      if (e.key === "x" && focusIndex >= 0 && focusIndex < filtered.length) {
        e.preventDefault();
        const id = filtered[focusIndex].id;
        handleSelectedChange(id, !selectedIds.has(id));
        return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filtered, focusIndex, selectedIds, handleComplete]);

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
            onClick={() => setShowHelp(true)}
            title="Keyboard shortcuts (press ?)"
            className="rounded-md border border-t-border bg-surface px-2 py-1.5 text-xs font-medium text-muted hover:bg-surface-2"
          >
            ?
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
            searchInputRef={searchInputRef}
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
              onStatusChange={handleStatusChange}
              onQueuesChange={handleQueuesChange}
              allQueues={data?.allQueues ?? []}
              pendingTaskIds={pendingIds}
              selectedIds={selectedIds}
              onSelectedChange={handleSelectedChange}
              onSelectGroup={handleSelectGroup}
              focusedTaskId={
                focusIndex >= 0 && focusIndex < filtered.length ? filtered[focusIndex].id : null
              }
            />
          )}
          {showCompleted && (
            <CompletedTasksSection
              tasks={data?.completedTasks ?? []}
              onReopen={handleReopen}
              pendingTaskIds={pendingIds}
              allQueues={data?.allQueues ?? []}
            />
          )}
        </div>
      )}

      {showCreate && (
        <CreateTaskModal onClose={() => setShowCreate(false)} onCreate={handleCreate} />
      )}
      {showHelp && <KeyboardHelp onClose={() => setShowHelp(false)} />}
    </DashboardShell>
  );
}
