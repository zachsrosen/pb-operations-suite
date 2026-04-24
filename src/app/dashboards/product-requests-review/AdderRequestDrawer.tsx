"use client";

import { useState } from "react";
import { AdderType, AdderDirection } from "@/generated/prisma/enums";
import type { MergedRequestRow } from "@/lib/product-requests/types";

export default function AdderRequestDrawer({
  requestId,
  row,
  onClose,
  onResolved,
}: {
  requestId: string;
  row?: MergedRequestRow;
  onClose: () => void;
  onResolved: () => void;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState(row?.title || "");
  const [basePrice, setBasePrice] = useState(
    row?.estimatedPrice != null ? String(row.estimatedPrice) : "",
  );
  const [baseCost, setBaseCost] = useState(
    row?.estimatedCost != null ? String(row.estimatedCost) : "",
  );
  const [type, setType] = useState<string>(AdderType.FIXED);
  const [direction, setDirection] = useState<string>(AdderDirection.ADD);
  const [reviewerNote, setReviewerNote] = useState("");
  const [mode, setMode] = useState<"approve" | "decline" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleApprove() {
    setError(null);
    if (!code.trim() || !name.trim() || !basePrice.trim() || !baseCost.trim()) {
      setError("Code, name, base price, and base cost are required.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/product-requests/${requestId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: code.trim(),
          name: name.trim(),
          basePrice: Number(basePrice.trim()),
          baseCost: Number(baseCost.trim()),
          type,
          direction,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error || `Approval failed (${res.status})`);
        setSubmitting(false);
        return;
      }
      onResolved();
    } catch {
      setError("Network error.");
      setSubmitting(false);
    }
  }

  async function handleDecline() {
    setError(null);
    if (!reviewerNote.trim()) {
      setError("Please explain why this is being declined — the rep will see this note.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/product-requests/${requestId}/decline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewerNote: reviewerNote.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error || `Decline failed (${res.status})`);
        setSubmitting(false);
        return;
      }
      onResolved();
    } catch {
      setError("Network error.");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative h-full w-full max-w-lg overflow-y-auto bg-surface border-l border-t-border p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-foreground">Review Adder Request</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-foreground"
          >
            ✕
          </button>
        </div>

        {row?.salesRequestNote && (
          <div className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 p-3 text-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-cyan-300 mb-1">
              Sales request
            </div>
            <div className="text-foreground">{row.salesRequestNote}</div>
            <div className="text-xs text-muted mt-2">
              From {row.requestedBy}
              {row.dealId ? ` · Deal ${row.dealId}` : ""}
            </div>
          </div>
        )}

        {!mode && (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setMode("approve")}
              className="w-full rounded-lg bg-cyan-600 px-4 py-3 text-sm font-medium text-white hover:bg-cyan-500"
            >
              Approve — add to catalog
            </button>
            <button
              type="button"
              onClick={() => setMode("decline")}
              className="w-full rounded-lg border border-t-border bg-surface-2 px-4 py-3 text-sm font-medium text-foreground hover:bg-surface-elevated"
            >
              Decline
            </button>
          </div>
        )}

        {mode === "approve" && (
          <div className="space-y-4">
            <label className="block">
              <span className="block text-xs font-medium text-muted mb-1.5">
                Unique code *
              </span>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. MPU_200A"
                className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground"
              />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-muted mb-1.5">Display name *</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-xs font-medium text-muted mb-1.5">Base price *</span>
                <input
                  type="number"
                  step="0.01"
                  value={basePrice}
                  onChange={(e) => setBasePrice(e.target.value)}
                  className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground"
                />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-muted mb-1.5">Base cost *</span>
                <input
                  type="number"
                  step="0.01"
                  value={baseCost}
                  onChange={(e) => setBaseCost(e.target.value)}
                  className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground"
                />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-muted mb-1.5">Type</span>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground"
                >
                  {Object.values(AdderType).map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-muted mb-1.5">Direction</span>
                <select
                  value={direction}
                  onChange={(e) => setDirection(e.target.value)}
                  className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground"
                >
                  {Object.values(AdderDirection).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {error && (
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setMode(null)}
                className="rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-xs font-medium text-foreground hover:bg-surface-elevated"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleApprove}
                disabled={submitting}
                className="rounded-lg bg-cyan-600 px-4 py-2 text-xs font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
              >
                {submitting ? "Approving…" : "Approve & create adder"}
              </button>
            </div>
          </div>
        )}

        {mode === "decline" && (
          <div className="space-y-4">
            <label className="block">
              <span className="block text-xs font-medium text-muted mb-1.5">
                Reason (sent to the rep in email) *
              </span>
              <textarea
                value={reviewerNote}
                onChange={(e) => setReviewerNote(e.target.value)}
                rows={4}
                className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground"
              />
            </label>

            {error && (
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setMode(null)}
                className="rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-xs font-medium text-foreground hover:bg-surface-elevated"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleDecline}
                disabled={submitting}
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50"
              >
                {submitting ? "Declining…" : "Decline & email rep"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
