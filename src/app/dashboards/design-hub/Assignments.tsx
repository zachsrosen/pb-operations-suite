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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
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

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-t-border px-3 py-2.5">
        <span className="text-foreground text-sm font-semibold">
          Assigned to me
        </span>
        <span className="text-muted ml-2 text-xs">{rows.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {query.isLoading ? (
          <div className="text-muted p-4 text-sm">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-muted p-4 text-sm">
            Nothing assigned to you right now.
          </div>
        ) : (
          rows.map((row) => (
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
          ))
        )}
      </div>
    </div>
  );
}
