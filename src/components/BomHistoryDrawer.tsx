// src/components/BomHistoryDrawer.tsx
"use client";

import { useEffect, useState, useMemo } from "react";
import { BomSnapshot, relativeTime, getDateGroup, GROUP_ORDER } from "@/lib/bom-history";

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (snap: BomSnapshot) => void;
}

export default function BomHistoryDrawer({ open, onClose, onSelect }: Props) {
  const [snapshots, setSnapshots] = useState<BomSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Fetch once when drawer first opens
  useEffect(() => {
    if (!open || snapshots.length > 0) return;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch("/api/bom/history/all");
        const data = await r.json();
        if (data.error) throw new Error(data.error);
        setSnapshots(data.snapshots ?? []);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [open, snapshots.length]);

  const filtered = useMemo(() => {
    if (!search.trim()) return snapshots;
    const q = search.toLowerCase();
    return snapshots.filter(
      (s) =>
        s.dealName?.toLowerCase().includes(q) ||
        s.customer?.toLowerCase().includes(q) ||
        s.address?.toLowerCase().includes(q)
    );
  }, [snapshots, search]);

  const grouped = useMemo(() => {
    const map: Record<string, BomSnapshot[]> = {};
    for (const s of filtered) {
      const g = getDateGroup(s.createdAt);
      if (!map[g]) map[g] = [];
      map[g].push(s);
    }
    return map;
  }, [filtered]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div className="fixed right-0 top-0 z-50 h-full w-full max-w-lg bg-surface shadow-card-lg flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-t-border bg-surface-2 flex-shrink-0">
          <h2 className="text-base font-semibold text-foreground">BOM History</h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-foreground transition-colors text-lg leading-none"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b border-t-border flex-shrink-0">
          <input
            type="text"
            placeholder="Search deal, customer, or address…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
          />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {loading && (
            <p className="text-sm text-muted animate-pulse text-center py-8">Loading history…</p>
          )}
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div className="text-center py-12 text-muted text-sm">
              {search ? "No results for that search." : "No BOM snapshots saved yet."}
            </div>
          )}
          {!loading && !error && filtered.length > 0 &&
            GROUP_ORDER.filter((g) => grouped[g]?.length).map((group) => (
              <div key={group}>
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-widest text-muted">{group}</span>
                  <span className="text-xs text-muted">({grouped[group].length})</span>
                  <div className="flex-1 border-t border-t-border" />
                </div>
                <div className="rounded-xl border border-t-border bg-surface overflow-hidden">
                  {grouped[group].map((s) => (
                    <button
                      key={s.id}
                      onClick={() => { onSelect(s); onClose(); }}
                      className="w-full text-left border-b border-t-border last:border-b-0 px-4 py-3 hover:bg-surface-2 transition-colors"
                    >
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="inline-flex items-center rounded-md bg-cyan-500/15 px-1.5 py-0.5 text-xs font-semibold text-cyan-400 ring-1 ring-cyan-500/30">
                          v{s.version}
                        </span>
                        <span className="font-medium text-sm text-foreground truncate">{s.dealName}</span>
                      </div>
                      {s.customer && <div className="text-xs text-muted truncate">{s.customer}</div>}
                      {s.address && <div className="text-xs text-muted truncate">{s.address}</div>}
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted">
                        {s.systemSizeKwdc != null && <span>{s.systemSizeKwdc} kWdc</span>}
                        {s.moduleCount != null && <span>{s.moduleCount} modules</span>}
                        <span>{s.itemCount} items</span>
                        <span className="ml-auto">{relativeTime(s.createdAt)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))
          }
        </div>

        {/* Footer count */}
        {!loading && snapshots.length > 0 && (
          <div className="px-5 py-3 border-t border-t-border bg-surface-2 flex-shrink-0">
            <p className="text-xs text-muted text-center">
              {filtered.length} of {snapshots.length} snapshot{snapshots.length !== 1 ? "s" : ""}
            </p>
          </div>
        )}
      </div>
    </>
  );
}
