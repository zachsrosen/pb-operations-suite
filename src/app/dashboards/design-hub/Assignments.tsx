"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import type { Tab } from "@/lib/design-hub/types";
import { ACCENTS, type Accent } from "./accents";

interface AssignmentRow {
  id: string;
  dealId: string;
  tab: string;
  name: string;
  address: string | null;
  pbLocation: string | null;
  assignedBy: string;
  note: string | null;
  dueDate: string | null;
  createdAt: string;
  statusMoved: boolean;
  statusAtAssignmentLabel: string;
  currentStatusLabel: string | null;
}

interface TaskRow {
  id: string;
  subject: string;
  dueAt: string | null;
  createdAt: string | null;
  hubspotUrl: string;
  deal: { id: string; name: string } | null;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function isOverdue(iso: string | null): boolean {
  return iso ? new Date(iso).getTime() < Date.now() : false;
}

export function Assignments({
  selectedDealId,
  onSelect,
  accent,
}: {
  selectedDealId: string | null;
  /** Carries the assignment's OWN tab: an ask made from the DA tab must open
   *  a DA detail pane, or the status dropdown would write design_status. */
  onSelect: (dealId: string, tab: Tab) => void;
  accent: Accent;
}) {
  const a = ACCENTS[accent];
  const queryClient = useQueryClient();

  const query = useQuery<{ assignments: AssignmentRow[] }>({
    queryKey: queryKeys.designHub.assignments(),
    queryFn: async () => {
      const r = await fetch("/api/design-hub/assignments");
      if (!r.ok) throw new Error("Failed to load assignments");
      return r.json();
    },
    staleTime: 30_000,
  });

  const tasksQuery = useQuery<{ tasks: TaskRow[]; ownerResolved: boolean }>({
    queryKey: [...queryKeys.designHub.root, "tasks"],
    queryFn: async () => {
      const r = await fetch("/api/design-hub/tasks");
      if (!r.ok) throw new Error("Failed to load tasks");
      return r.json();
    },
    staleTime: 60_000,
  });

  const clear = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/design-hub/assignments/${id}`, {
        method: "PATCH",
      });
      if (!r.ok) throw new Error("Failed to clear");
      return r.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.designHub.assignments(),
      });
      // Both queues carry assignment badges, and an ask can be made from
      // either tab — invalidate both rather than guessing which one holds it.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.designHub.queue("design"),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.designHub.queue("da"),
      });
    },
  });

  const rows = query.data?.assignments ?? [];
  const tasks = tasksQuery.data?.tasks ?? [];
  const ownerResolved = tasksQuery.data?.ownerResolved ?? true;
  const total = rows.length + tasks.length;
  const nothing =
    !query.isLoading &&
    !tasksQuery.isLoading &&
    rows.length === 0 &&
    tasks.length === 0;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-t-border px-3 py-2.5">
        <span className="text-foreground text-sm font-semibold">
          Assigned to me
        </span>
        <span className="text-muted ml-2 text-xs">{total}</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {query.isLoading && tasksQuery.isLoading ? (
          <div className="text-muted p-4 text-sm">Loading…</div>
        ) : nothing ? (
          <div className="text-muted p-4 text-sm">
            Nothing assigned to you right now.
          </div>
        ) : (
          <>
            {/* App-local assignments — the asks Zach pushes from the hub. */}
            {rows.length > 0 && (
              <SectionLabel label="From the hub" count={rows.length} />
            )}
            {rows.map((row) => (
              <div
                key={row.id}
                className={`border-b border-t-border ${
                  row.dealId === selectedDealId ? a.rowSelected : ""
                }`}
              >
                <button
                  type="button"
                  onClick={() =>
                    onSelect(row.dealId, row.tab === "da" ? "da" : "design")
                  }
                  className="block w-full px-3 py-2.5 text-left hover:bg-surface-2"
                >
                  <div className="text-foreground truncate text-sm font-medium">
                    {row.name}
                  </div>
                  {row.address && (
                    <div className="text-muted truncate text-xs">
                      {row.address}
                    </div>
                  )}
                  {row.note && (
                    <p className="text-foreground mt-1 text-xs italic">
                      “{row.note}”
                    </p>
                  )}
                  <div className="text-muted mt-1 flex flex-wrap items-center gap-x-2 text-[11px]">
                    <span>from {row.assignedBy.split("@")[0]}</span>
                    {row.dueDate && <span>due {formatDate(row.dueDate)}</span>}
                    <span>{row.currentStatusLabel ?? "status unknown"}</span>
                  </div>
                  {row.statusMoved && (
                    // Hint only — assignments are never auto-cleared, because a
                    // workflow flipping a status would silently eat the ask.
                    <div className="mt-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                      Status moved since assigned (was{" "}
                      {row.statusAtAssignmentLabel})
                    </div>
                  )}
                </button>
                <div className="px-3 pb-2">
                  <button
                    type="button"
                    onClick={() => clear.mutate(row.id)}
                    disabled={clear.isPending}
                    className="text-muted rounded-md bg-surface-2 px-2 py-1 text-[11px] font-medium hover:bg-surface-elevated disabled:opacity-50"
                  >
                    Mark done
                  </button>
                </div>
              </div>
            ))}

            {/* HubSpot tasks — the designer's real task queue. These complete
                in HubSpot, so there's no "Mark done" here; the row links out
                and (when it has a deal) opens that deal's detail. */}
            {tasks.length > 0 && (
              <SectionLabel label="HubSpot tasks" count={tasks.length} />
            )}
            {tasks.map((t) => (
              <div
                key={t.id}
                className={`border-b border-t-border ${
                  t.deal && t.deal.id === selectedDealId ? a.rowSelected : ""
                }`}
              >
                <div className="px-3 py-2.5">
                  <div className="text-foreground text-sm font-medium">
                    {t.subject}
                  </div>
                  {t.deal ? (
                    <button
                      type="button"
                      onClick={() => onSelect(t.deal!.id, "design")}
                      className={`mt-0.5 block truncate text-left text-xs ${a.tabActive
                        .split(" ")
                        .slice(1)
                        .join(" ")} hover:underline`}
                    >
                      {t.deal.name}
                    </button>
                  ) : (
                    <div className="text-muted mt-0.5 text-xs">
                      No linked deal
                    </div>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px]">
                    {t.dueAt && (
                      <span
                        className={
                          isOverdue(t.dueAt)
                            ? "font-semibold text-red-600 dark:text-red-400"
                            : "text-muted"
                        }
                      >
                        due {formatDate(t.dueAt)}
                      </span>
                    )}
                    <a
                      href={t.hubspotUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted hover:text-foreground hover:underline"
                    >
                      Open in HubSpot ↗
                    </a>
                  </div>
                </div>
              </div>
            ))}

            {/* Owner unresolved: the tasks column can't be fetched. Say so
                rather than implying the designer has no tasks. */}
            {!ownerResolved && !tasksQuery.isLoading && (
              <div className="text-muted px-3 py-3 text-[11px]">
                Couldn’t match your login to a HubSpot user, so HubSpot tasks
                aren’t shown. Ask an admin to link your HubSpot owner.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SectionLabel({ label, count }: { label: string; count: number }) {
  return (
    <div className="text-muted sticky top-0 z-10 bg-surface-2 px-3 py-1.5 text-[11px] font-semibold tracking-wide uppercase">
      {label}
      <span className="ml-1.5 font-normal">{count}</span>
    </div>
  );
}
