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

type QueueType = "ESCALATION" | "DESIGN_REVIEW";

interface Props {
  onClose: () => void;
}

export function AddEscalationDialog({ onClose }: Props) {
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const [searchText, setSearchText] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [selectedDeal, setSelectedDeal] = useState<DealResult | null>(null);
  const [queueType, setQueueType] = useState<QueueType>("ESCALATION");
  const [reason, setReason] = useState("");
  const [showPrefill, setShowPrefill] = useState(false);
  const [customerNotes, setCustomerNotes] = useState("");
  const [operationsNotes, setOperationsNotes] = useState("");
  const [designNotes, setDesignNotes] = useState("");
  const backdropRef = useRef<HTMLDivElement>(null);

  // Debounce search
  useEffect(() => {
    if (searchText.length < 2) {
      setDebouncedQ("");
      return;
    }
    const timer = setTimeout(() => setDebouncedQ(searchText), 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  // Search query
  const searchQuery = useQuery({
    queryKey: queryKeys.idrMeeting.dealSearch(debouncedQ),
    queryFn: async () => {
      const res = await fetch(`/api/idr-meeting/deal-search?q=${encodeURIComponent(debouncedQ)}`);
      if (!res.ok) throw new Error("Search failed");
      return res.json() as Promise<{ deals: DealResult[] }>;
    },
    enabled: debouncedQ.length >= 2,
  });

  // Add to queue mutation
  const addToQueue = useMutation({
    mutationFn: async () => {
      if (!selectedDeal) throw new Error("No deal selected");
      const body: Record<string, unknown> = {
        dealId: selectedDeal.dealId,
        dealName: selectedDeal.dealName,
        region: selectedDeal.region,
        queueType,
        reason,
      };
      if (customerNotes.trim()) body.customerNotes = customerNotes.trim();
      if (operationsNotes.trim()) body.operationsNotes = operationsNotes.trim();
      if (designNotes.trim()) body.designNotes = designNotes.trim();

      const res = await fetch("/api/idr-meeting/escalation-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 409) throw new Error("Already queued");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to queue");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.idrMeeting.escalationQueue() });
      const label = queueType === "ESCALATION" ? "Escalation" : "Design review";
      addToast({ type: "success", title: `${label} queued for next meeting` });
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
          <h2 className="text-lg font-semibold text-foreground">Queue for Next Meeting</h2>
          <button
            className="text-muted hover:text-foreground transition-colors"
            onClick={onClose}
          >
            &#10005;
          </button>
        </div>

        <p className="text-xs text-muted mb-4">
          This deal will automatically join the next meeting session.
          You can optionally prefill notes now or add them later.
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
                    <p className="text-sm font-medium text-foreground truncate">
                      {deal.dealName}
                    </p>
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

        {/* Selected deal — type + reason + optional prefill */}
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

            {/* Queue type selector */}
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-muted block mb-1.5">
                Type
              </label>
              <div className="flex gap-2">
                <button
                  className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                    queueType === "ESCALATION"
                      ? "border-orange-500 bg-orange-500/10 text-orange-500"
                      : "border-t-border bg-surface-2 text-muted hover:text-foreground"
                  }`}
                  onClick={() => setQueueType("ESCALATION")}
                >
                  &#9889; Escalation
                </button>
                <button
                  className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                    queueType === "DESIGN_REVIEW"
                      ? "border-cyan-500 bg-cyan-500/10 text-cyan-500"
                      : "border-t-border bg-surface-2 text-muted hover:text-foreground"
                  }`}
                  onClick={() => setQueueType("DESIGN_REVIEW")}
                >
                  &#9998; Design Review
                </button>
              </div>
            </div>

            {/* Reason / context */}
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-muted block mb-1">
                {queueType === "ESCALATION" ? "Escalation Reason" : "Review Context"}{" "}
                <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground resize-none placeholder:text-muted"
                placeholder={
                  queueType === "ESCALATION"
                    ? "Why does this need discussion?"
                    : "What should the team review?"
                }
              />
            </div>

            {/* Optional prefill toggle */}
            <button
              className="text-xs text-muted hover:text-foreground transition-colors"
              onClick={() => setShowPrefill(!showPrefill)}
            >
              {showPrefill ? "\u25BC" : "\u25B6"} Prefill notes (optional)
            </button>

            {showPrefill && (
              <div className={`space-y-3 pl-2 border-l-2 ${
                queueType === "ESCALATION" ? "border-orange-500/30" : "border-cyan-500/30"
              }`}>
                <div>
                  <label className="text-xs text-muted block mb-0.5">Customer Notes</label>
                  <textarea
                    rows={2}
                    value={customerNotes}
                    onChange={(e) => setCustomerNotes(e.target.value)}
                    className="w-full rounded border border-t-border bg-surface-2 px-2 py-1.5 text-xs text-foreground resize-none placeholder:text-muted"
                    placeholder="Notes about the customer..."
                  />
                </div>
                <div>
                  <label className="text-xs text-muted block mb-0.5">Operations Notes</label>
                  <textarea
                    rows={2}
                    value={operationsNotes}
                    onChange={(e) => setOperationsNotes(e.target.value)}
                    className="w-full rounded border border-t-border bg-surface-2 px-2 py-1.5 text-xs text-foreground resize-none placeholder:text-muted"
                    placeholder="Ops context..."
                  />
                </div>
                <div>
                  <label className="text-xs text-muted block mb-0.5">Design Notes</label>
                  <textarea
                    rows={2}
                    value={designNotes}
                    onChange={(e) => setDesignNotes(e.target.value)}
                    className="w-full rounded border border-t-border bg-surface-2 px-2 py-1.5 text-xs text-foreground resize-none placeholder:text-muted"
                    placeholder="Design context..."
                  />
                </div>
              </div>
            )}

            {/* Submit */}
            <div className="flex justify-end gap-2 pt-2">
              <button
                className="rounded-lg border border-t-border bg-surface-2 px-4 py-2 text-sm font-medium text-muted hover:text-foreground transition-colors"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50 ${
                  queueType === "ESCALATION"
                    ? "bg-orange-500 hover:bg-orange-600"
                    : "bg-cyan-500 hover:bg-cyan-600"
                }`}
                onClick={() => addToQueue.mutate()}
                disabled={!canSubmit}
              >
                {addToQueue.isPending ? "Queuing..." : "Queue for Next Meeting"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
