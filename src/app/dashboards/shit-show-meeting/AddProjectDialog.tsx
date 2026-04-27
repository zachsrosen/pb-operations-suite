"use client";

import { useEffect, useState } from "react";

type SearchResult = {
  dealId: string;
  dealName: string | null;
  region: string | null;
  projectType: string | null;
  designStatus: string | null;
  dealAmount: string | null;
  stage: string | null;
};

export function AddProjectDialog({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [picked, setPicked] = useState<SearchResult | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const res = await fetch(
        `/api/shit-show-meeting/deal-search?q=${encodeURIComponent(query)}`,
      );
      if (res.ok) {
        const json = (await res.json()) as { deals: SearchResult[] };
        setResults(json.deals);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  if (!open) return null;

  async function submit() {
    if (!picked || !reason.trim()) return;
    setSubmitting(true);
    try {
      await fetch("/api/shit-show-meeting/flag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId: picked.dealId, flagged: true, reason }),
      });
      await onAdded();
      onClose();
      setQuery("");
      setPicked(null);
      setReason("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-surface-elevated border border-t-border rounded-lg w-full max-w-lg p-4">
        <h3 className="text-lg font-semibold mb-3">Add a deal to Shit Show</h3>

        {!picked ? (
          <>
            <input
              autoFocus
              type="text"
              placeholder="Search deals by name…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-surface-2 border border-t-border rounded px-3 py-2 text-sm"
            />
            <div className="mt-2 max-h-72 overflow-y-auto">
              {results.map((r) => (
                <button
                  key={r.dealId}
                  onClick={() => setPicked(r)}
                  className="w-full text-left px-3 py-2 hover:bg-surface-2 rounded"
                >
                  <div className="text-sm">{r.dealName ?? "(no name)"}</div>
                  <div className="text-xs text-muted">
                    {r.region ?? "—"} · {r.projectType ?? "—"} · {r.dealAmount ?? "—"}
                  </div>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="bg-surface-2 rounded px-3 py-2 mb-3">
              <div className="text-sm">{picked.dealName}</div>
              <div className="text-xs text-muted">{picked.region}</div>
            </div>
            <textarea
              autoFocus
              placeholder="Why is this a shit show?"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              className="w-full bg-surface-2 border border-t-border rounded px-3 py-2 text-sm"
            />
          </>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm hover:bg-surface-2 rounded"
          >
            Cancel
          </button>
          {picked && (
            <button
              onClick={submit}
              disabled={!reason.trim() || submitting}
              className="bg-red-600 hover:bg-red-500 text-white px-3 py-1.5 rounded text-sm disabled:opacity-50"
            >
              Flag deal
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
