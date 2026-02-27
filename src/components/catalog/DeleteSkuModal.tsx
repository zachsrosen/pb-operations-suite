"use client";

import { useState } from "react";

interface DeleteSkuModalProps {
  sku: { id: string; category: string; brand: string; model: string };
  warning?: string;
  syncedSystems?: string[];
  pendingCount?: number;
  preflightDone: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  deleting: boolean;
}

export default function DeleteSkuModal({
  sku,
  warning,
  syncedSystems,
  pendingCount,
  preflightDone,
  onConfirm,
  onCancel,
  deleting,
}: DeleteSkuModalProps) {
  const [confirmText, setConfirmText] = useState("");

  const matches = confirmText.trim().toLowerCase() === sku.model.trim().toLowerCase();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-surface-elevated rounded-xl border border-t-border shadow-card-lg w-full max-w-md mx-4 p-6">
        <h3 className="text-lg font-semibold text-foreground mb-2">Delete SKU</h3>

        <div className="rounded-lg bg-surface-2 border border-t-border p-3 mb-4 text-sm">
          <div className="text-muted">
            {sku.category} &middot; {sku.brand} &middot;{" "}
            <span className="text-foreground font-medium">{sku.model}</span>
          </div>
        </div>

        {!preflightDone && (
          <div className="flex items-center gap-2 text-sm text-muted mb-3">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
            Checking SKU status…
          </div>
        )}

        {syncedSystems && syncedSystems.length > 0 && (
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 mb-3 text-sm text-amber-400">
            This SKU is synced to{" "}
            <span className="font-semibold">{syncedSystems.join(", ")}</span>.
            Deleting it will not remove the external records.
          </div>
        )}

        {pendingCount != null && pendingCount > 0 && (
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 mb-3 text-sm text-amber-400">
            This SKU has <span className="font-semibold">{pendingCount}</span> pending
            push request(s) that will be unlinked.
          </div>
        )}

        {warning && !syncedSystems?.length && !pendingCount && (
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 mb-3 text-sm text-amber-400">
            {warning}
          </div>
        )}

        <p className="text-sm text-muted mb-2">
          This action is <span className="text-red-400 font-medium">permanent</span> and
          cannot be undone. Type the model name to confirm:
        </p>

        <div className="mb-1 text-xs text-muted font-mono">{sku.model}</div>

        <input
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="Type model name to confirm"
          className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-red-500/50 mb-4"
          autoFocus
        />

        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={deleting}
            className="rounded-lg border border-t-border bg-surface px-4 py-2 text-sm font-medium text-muted hover:text-foreground hover:bg-surface-2 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!matches || deleting || !preflightDone}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {deleting ? "Deleting..." : "Delete permanently"}
          </button>
        </div>
      </div>
    </div>
  );
}
