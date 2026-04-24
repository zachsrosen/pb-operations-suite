"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type EquipmentRequestDetail = {
  id: string;
  brand: string;
  model: string;
  category: string;
  description: string | null;
  salesRequestNote: string | null;
  requestedBy: string;
  dealId: string | null;
  status: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  note: string | null;
};

export default function EquipmentRequestDrawer({
  requestId,
  onClose,
  onResolved,
}: {
  requestId: string;
  onClose: () => void;
  onResolved: () => void;
}) {
  const pushId = requestId.startsWith("eq_") ? requestId.slice(3) : requestId;
  const [detail, setDetail] = useState<EquipmentRequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"decline" | null>(null);
  const [reviewerNote, setReviewerNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/catalog/push-requests/${pushId}`);
        if (!res.ok) throw new Error(`Failed (${res.status})`);
        const body = await res.json();
        if (!cancelled) setDetail(body as EquipmentRequestDetail);
      } catch {
        if (!cancelled) setError("Couldn't load request detail.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pushId]);

  async function handleApprove() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/product-requests/${requestId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
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
      setError("Please explain why — the rep will see this note.");
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

  const metadata = detail?.metadata && typeof detail.metadata === "object" ? detail.metadata : null;
  const extractedSpecs = metadata
    ? Object.fromEntries(Object.entries(metadata).filter(([k]) => !k.startsWith("_")))
    : null;
  const datasheetUrl =
    metadata && typeof metadata._datasheetUrl === "string" ? metadata._datasheetUrl : null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative h-full w-full max-w-lg overflow-y-auto bg-surface border-l border-t-border p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-foreground">Review Equipment Request</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-foreground"
          >
            ✕
          </button>
        </div>

        {loading && <div className="text-sm text-muted">Loading…</div>}

        {detail && (
          <>
            <div className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 p-3 text-sm">
              <div className="text-xs font-medium uppercase tracking-wide text-cyan-300 mb-1">
                Sales request
              </div>
              <div className="text-foreground">
                {detail.salesRequestNote || "(no note)"}
              </div>
              <div className="text-xs text-muted mt-2">
                From {detail.requestedBy}
                {detail.dealId ? ` · Deal ${detail.dealId}` : ""}
              </div>
            </div>

            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-xs text-muted mb-0.5">Category</div>
                  <div className="text-foreground">{detail.category}</div>
                </div>
                <div>
                  <div className="text-xs text-muted mb-0.5">Status</div>
                  <div className="text-foreground">{detail.status}</div>
                </div>
                <div>
                  <div className="text-xs text-muted mb-0.5">Brand</div>
                  <div className="text-foreground">{detail.brand}</div>
                </div>
                <div>
                  <div className="text-xs text-muted mb-0.5">Model</div>
                  <div className="text-foreground">{detail.model}</div>
                </div>
              </div>
              {datasheetUrl && (
                <a
                  href={datasheetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block text-xs text-cyan-400 hover:text-cyan-300"
                >
                  Datasheet link →
                </a>
              )}
            </div>

            {extractedSpecs && Object.keys(extractedSpecs).length > 0 && (
              <div className="rounded-lg border border-t-border bg-surface-2 p-3 text-xs">
                <div className="text-muted mb-2 font-medium uppercase tracking-wide">
                  Extracted specs (from datasheet)
                </div>
                <pre className="whitespace-pre-wrap text-foreground">
                  {JSON.stringify(extractedSpecs, null, 2)}
                </pre>
              </div>
            )}

            {detail.status === "PENDING" && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                Approving will run the full catalog pipeline (InternalProduct + HubSpot + Zoho +
                Zuper + OpenSolar stub). For best results, open{" "}
                <Link
                  href={`/dashboards/catalog/edit/${pushId}`}
                  className="underline hover:text-amber-100"
                >
                  the catalog editor
                </Link>{" "}
                first to fill in specs/pricing, then return here to approve.
              </div>
            )}

            {detail.status === "PENDING" && !mode && (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={handleApprove}
                  disabled={submitting}
                  className="w-full rounded-lg bg-cyan-600 px-4 py-3 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
                >
                  {submitting ? "Approving…" : "Approve — push to all systems"}
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

            {detail.status !== "PENDING" && detail.note && (
              <div className="rounded-lg border border-t-border bg-surface-2 p-3 text-xs">
                <div className="text-muted mb-1 font-medium uppercase tracking-wide">
                  Reviewer note
                </div>
                <div className="text-foreground whitespace-pre-wrap">{detail.note}</div>
              </div>
            )}
          </>
        )}

        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
