"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
  sessionId: string;
  onClose: () => void;
  onAdded: () => void;
}

export function AddProjectDialog({ sessionId, onClose, onAdded }: Props) {
  const { addToast } = useToast();
  const [searchText, setSearchText] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [selectedDeal, setSelectedDeal] = useState<DealResult | null>(null);
  const [itemType, setItemType] = useState<"IDR" | "ESCALATION">("IDR");
  const [escalationReason, setEscalationReason] = useState("");
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

  // Add item mutation
  const addItem = useMutation({
    mutationFn: async () => {
      if (!selectedDeal) throw new Error("No deal selected");
      const res = await fetch("/api/idr-meeting/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          dealId: selectedDeal.dealId,
          type: itemType,
          escalationReason: itemType === "ESCALATION" ? escalationReason : undefined,
        }),
      });
      if (res.status === 409) {
        throw new Error("Already in session");
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to add project");
      }
      return res.json();
    },
    onSuccess: () => {
      addToast({ type: "success", title: "Project added to session" });
      onAdded();
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

  const canSubmit =
    selectedDeal &&
    (itemType === "IDR" || escalationReason.trim().length > 0) &&
    !addItem.isPending;

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
    >
      <div className="w-full max-w-lg rounded-xl border border-t-border bg-surface-elevated p-6 shadow-card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">Add Project</h2>
          <button
            className="text-muted hover:text-foreground transition-colors"
            onClick={onClose}
          >
            &#10005;
          </button>
        </div>

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

        {/* Selected deal — type selector */}
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

            {/* Type selector */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
                Type
              </p>
              <div className="flex gap-3">
                {(["IDR", "ESCALATION"] as const).map((t) => (
                  <label
                    key={t}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer transition-colors ${
                      itemType === t
                        ? "border-orange-500 bg-orange-500/10 text-orange-500"
                        : "border-t-border bg-surface-2 text-foreground"
                    }`}
                  >
                    <input
                      type="radio"
                      name="item-type"
                      value={t}
                      checked={itemType === t}
                      onChange={() => setItemType(t)}
                      className="sr-only"
                    />
                    {t === "IDR" ? "IDR" : "Escalation"}
                  </label>
                ))}
              </div>
            </div>

            {/* Escalation reason */}
            {itemType === "ESCALATION" && (
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-muted block mb-1">
                  Escalation Reason <span className="text-red-500">*</span>
                </label>
                <textarea
                  rows={3}
                  value={escalationReason}
                  onChange={(e) => setEscalationReason(e.target.value)}
                  className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground resize-none placeholder:text-muted"
                  placeholder="Describe why this project needs escalation..."
                />
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
                className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 transition-colors disabled:opacity-50"
                onClick={() => addItem.mutate()}
                disabled={!canSubmit}
              >
                {addItem.isPending ? "Adding..." : "Add to Session"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
