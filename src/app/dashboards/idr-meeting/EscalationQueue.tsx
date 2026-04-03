"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useToast } from "@/contexts/ToastContext";

interface QueueItem {
  id: string;
  dealId: string;
  dealName: string;
  region: string | null;
  queueType: string; // ESCALATION | DESIGN_REVIEW
  reason: string;
  requestedBy: string;
  createdAt: string;
  // Prefilled fields
  difficulty: number | null;
  customerNotes: string | null;
  operationsNotes: string | null;
  designNotes: string | null;
}

interface Props {
  onAddEscalation: () => void;
}

export function EscalationQueue({ onAddEscalation }: Props) {
  const queryClient = useQueryClient();
  const { addToast } = useToast();

  const queueQuery = useQuery({
    queryKey: queryKeys.idrMeeting.escalationQueue(),
    queryFn: async () => {
      const res = await fetch("/api/idr-meeting/escalation-queue");
      if (!res.ok) throw new Error("Failed to fetch queue");
      return res.json() as Promise<{ items: QueueItem[] }>;
    },
    staleTime: 30 * 1000,
  });

  const dismissMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/idr-meeting/escalation-queue/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to dismiss");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.idrMeeting.escalationQueue() });
      addToast({ type: "success", title: "Item dismissed" });
    },
    onError: () => {
      addToast({ type: "error", title: "Failed to dismiss" });
    },
  });

  const items = queueQuery.data?.items ?? [];
  const escalations = items.filter((i) => i.queueType === "ESCALATION");
  const reviews = items.filter((i) => i.queueType === "DESIGN_REVIEW");

  return (
    <div className="rounded-xl border border-t-border bg-surface">
      <div className="flex items-center justify-between px-3 py-2 border-b border-t-border">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">
            Meeting Prep Queue
          </span>
          {escalations.length > 0 && (
            <span className="rounded-full bg-orange-500 px-1.5 py-0.5 text-[10px] font-bold text-white leading-none" title="Escalations">
              {escalations.length}
            </span>
          )}
          {reviews.length > 0 && (
            <span className="rounded-full bg-cyan-500 px-1.5 py-0.5 text-[10px] font-bold text-white leading-none" title="Design reviews">
              {reviews.length}
            </span>
          )}
        </div>
        <button
          className="text-xs font-medium text-orange-500 hover:text-orange-600 transition-colors"
          onClick={onAddEscalation}
        >
          + Queue Item
        </button>
      </div>

      {queueQuery.isLoading && (
        <div className="p-3 space-y-2">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="h-10 rounded bg-surface-2 animate-pulse" />
          ))}
        </div>
      )}

      {items.length === 0 && !queueQuery.isLoading && (
        <div className="p-3">
          <p className="text-xs text-muted text-center">
            No items queued. Escalations and design reviews added here will auto-join the next session.
          </p>
        </div>
      )}

      {items.length > 0 && (
        <div className="divide-y divide-t-border">
          {items.map((item) => {
            const isEsc = item.queueType === "ESCALATION";
            const hasPrefill = item.difficulty != null || item.customerNotes || item.operationsNotes || item.designNotes;
            return (
              <div key={item.id} className="px-3 py-2 flex items-start gap-2">
                <span className={`text-xs shrink-0 mt-0.5 ${isEsc ? "text-orange-500" : "text-cyan-500"}`}>
                  {isEsc ? "\u26A1" : "\u270E"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-foreground truncate">{item.dealName}</p>
                  <p className="text-[10px] text-muted truncate">{item.reason}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`text-[10px] font-medium ${isEsc ? "text-orange-500" : "text-cyan-500"}`}>
                      {isEsc ? "Escalation" : "Design Review"}
                    </span>
                    {item.region && (
                      <span className="text-[10px] text-muted">{item.region}</span>
                    )}
                    <span className="text-[10px] text-muted">
                      by {item.requestedBy.split("@")[0]}
                    </span>
                    {hasPrefill && (
                      <span className="text-[10px] text-emerald-500" title="Has prefilled notes">
                        &#9998; prefilled
                      </span>
                    )}
                  </div>
                </div>
                <button
                  className="text-xs text-muted hover:text-red-500 transition-colors shrink-0"
                  onClick={() => dismissMutation.mutate(item.id)}
                  disabled={dismissMutation.isPending}
                  title="Dismiss"
                >
                  &#10005;
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
