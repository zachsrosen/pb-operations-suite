"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useToast } from "@/contexts/ToastContext";

interface DealResult {
  dealId: string;
  dealName: string;
  region: string | null;
  projectType: string | null;
  designStatus: string | null;
}

interface Props {
  onClose: () => void;
}

export function AddEscalationDialog({ onClose }: Props) {
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const [searchText, setSearchText] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [selectedDeal, setSelectedDeal] = useState<DealResult | null>(null);
  const [reason, setReason] = useState("");
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (searchText.length < 2) {
      setDebouncedQ("");
      return;
    }
    const timer = setTimeout(() => setDebouncedQ(searchText), 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  const searchQuery = useQuery({
    queryKey: queryKeys.idrMeeting.dealSearch(debouncedQ),
    queryFn: async () => {
      const res = await fetch(`/api/idr-meeting/deal-search?q=${encodeURIComponent(debouncedQ)}`);
      if (!res.ok) throw new Error("Search failed");
      return res.json() as Promise<{ deals: DealResult[] }>;
    },
    enabled: debouncedQ.length >= 2,
  });

  const addToQueue = useMutation({
    mutationFn: async () => {
      if (!selectedDeal) throw new Error("No deal selected");
      const res = await fetch("/api/idr-meeting/escalation-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId: selectedDeal.dealId,
          dealName: selectedDeal.dealName,
          region: selectedDeal.region,
          reason,
        }),
      });
      if (res.status === 409) throw new Error("Already in queue");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to add");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.idrMeeting.escalationQueue() });
      queryClient.invalidateQueries({ queryKey: [...queryKeys.idrMeeting.root, "preview"] });
      addToast({ type: "success", title: "Project added to queue" });
      onClose();
    },
    onError: (err: Error) => {
      addToast({ type: "error", title: err.message });
    },
  });

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === backdropRef.current) onClose();
    },
    [onClose],
  );

  const canSubmit = selectedDeal && reason.trim().length > 0 && !addToQueue.isPending;

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
    >
      <div className="w-full max-w-lg rounded-xl border border-t-border bg-surface-elevated p-6 shadow-card max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">Add Project</h2>
          <button className="text-muted hover:text-foreground transition-colors" onClick={onClose}>
            &#10005;
          </button>
        </div>

        <p className="text-xs text-muted mb-4">
          Search for a deal not already in the review list. It will appear in the
          sidebar and carry over when a session starts.
        </p>

        {/* Search */}
        {!selectedDeal && (
          <>
            <input
              type="text"
              placeholder="Search by name, address, or deal ID..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground placeholder:text-muted mb-3"
              autoFocus
            />

            {searchQuery.isLoading && debouncedQ.length >= 2 && (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-10 rounded bg-surface-2 animate-pulse" />
                ))}
              </div>
            )}

            {searchQuery.data && (
              <div className="max-h-60 overflow-y-auto space-y-1">
                {searchQuery.data.deals.length === 0 && (
                  <p className="text-sm text-muted py-2">No deals found.</p>
                )}
                {searchQuery.data.deals.map((deal) => (
                  <button
                    key={deal.dealId}
                    className="w-full text-left rounded-lg border border-t-border bg-surface-2 px-3 py-2 hover:bg-surface transition-colors"
                    onClick={() => setSelectedDeal(deal)}
                  >
                    <p className="text-sm font-medium text-foreground truncate">{deal.dealName}</p>
                    <div className="flex gap-2 text-xs text-muted mt-0.5">
                      {deal.region && <span>{deal.region}</span>}
                      {deal.designStatus && <span>{deal.designStatus}</span>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {/* Selected deal — reason */}
        {selectedDeal && (
          <div className="space-y-4">
            <div className="rounded-lg border border-t-border bg-surface-2 p-3">
              <p className="text-sm font-medium text-foreground">{selectedDeal.dealName}</p>
              <div className="flex gap-2 text-xs text-muted mt-0.5">
                {selectedDeal.region && <span>{selectedDeal.region}</span>}
                {selectedDeal.designStatus && <span>{selectedDeal.designStatus}</span>}
              </div>
            </div>

            <button
              className="text-xs text-orange-500 hover:text-orange-600 transition-colors"
              onClick={() => setSelectedDeal(null)}
            >
              &#8592; Change deal
            </button>

            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-muted block mb-1">
                Reason <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground resize-none placeholder:text-muted"
                placeholder="Why does this need to be reviewed?"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                className="rounded-lg border border-t-border bg-surface-2 px-4 py-2 text-sm font-medium text-muted hover:text-foreground transition-colors"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 transition-colors disabled:opacity-50"
                onClick={() => addToQueue.mutate()}
                disabled={!canSubmit}
              >
                {addToQueue.isPending ? "Adding..." : "Add to Queue"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
