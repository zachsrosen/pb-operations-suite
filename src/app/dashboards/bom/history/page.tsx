"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import DashboardShell from "@/components/DashboardShell";

interface BomSnapshot {
  id: string;
  dealId: string;
  dealName: string;
  version: number;
  sourceFile: string | null;
  savedBy: string | null;
  createdAt: string;
  customer: string | null;
  address: string | null;
  systemSizeKwdc: number | string | null;
  moduleCount: number | string | null;
  itemCount: number;
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? "s" : ""} ago`;
  if (diffHr < 24) return `${diffHr} hour${diffHr !== 1 ? "s" : ""} ago`;
  if (diffDay === 1) return "yesterday";
  if (diffDay < 7) return `${diffDay} days ago`;
  return new Date(dateStr).toLocaleDateString();
}

function getDateGroup(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const nowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const itemDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((nowDate.getTime() - itemDate.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return "This Week";
  return "Older";
}

const GROUP_ORDER = ["Today", "Yesterday", "This Week", "Older"];

function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 px-4 py-3 border-b border-t-border animate-pulse">
      <div className="h-5 w-12 rounded bg-surface-2" />
      <div className="h-4 w-40 rounded bg-surface-2" />
      <div className="h-4 w-32 rounded bg-surface-2" />
      <div className="h-4 w-48 rounded bg-surface-2" />
      <div className="h-4 w-16 rounded bg-surface-2 ml-auto" />
    </div>
  );
}

export default function BomHistoryPage() {
  const router = useRouter();
  const [snapshots, setSnapshots] = useState<BomSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/bom/history/all")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setSnapshots(data.snapshots ?? []);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load BOM history");
      })
      .finally(() => setLoading(false));
  }, []);

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
      const group = getDateGroup(s.createdAt);
      if (!map[group]) map[group] = [];
      map[group].push(s);
    }
    return map;
  }, [filtered]);

  return (
    <DashboardShell title="BOM History" accentColor="cyan">
      {/* Search bar */}
      <div className="mb-5">
        <input
          type="text"
          placeholder="Search by deal name, customer, or address..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-md rounded-lg border border-t-border bg-surface px-4 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="rounded-xl border border-t-border bg-surface shadow-card overflow-hidden">
          {Array.from({ length: 8 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && filtered.length === 0 && (
        <div className="rounded-xl border border-t-border bg-surface shadow-card px-8 py-16 text-center">
          <p className="text-lg font-medium text-foreground">No BOM snapshots found</p>
          <p className="mt-1 text-sm text-muted">
            {search ? "Try a different search term." : "Save a BOM from the BOM Extractor to see history here."}
          </p>
        </div>
      )}

      {/* Grouped results */}
      {!loading && !error && filtered.length > 0 && (
        <div className="space-y-6">
          {GROUP_ORDER.filter((g) => grouped[g]?.length).map((group) => (
            <div key={group}>
              {/* Group header */}
              <div className="mb-2 flex items-center gap-3">
                <span className="text-xs font-semibold uppercase tracking-widest text-muted">
                  {group}
                </span>
                <span className="text-xs text-muted">({grouped[group].length})</span>
                <div className="flex-1 border-t border-t-border" />
              </div>

              {/* Table */}
              <div className="rounded-xl border border-t-border bg-surface shadow-card overflow-hidden">
                {/* Header row */}
                <div className="hidden md:grid grid-cols-[80px_1fr_1fr_1fr_80px_80px_60px_140px_120px] gap-x-3 border-b border-t-border bg-surface-2 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted">
                  <span>Version</span>
                  <span>Deal</span>
                  <span>Customer</span>
                  <span>Address</span>
                  <span className="text-right">kWdc</span>
                  <span className="text-right">Modules</span>
                  <span className="text-right">Items</span>
                  <span>Saved By</span>
                  <span>Time</span>
                </div>

                {grouped[group].map((s) => (
                  <div
                    key={s.id}
                    onClick={() => router.push(`/dashboards/bom?deal=${s.dealId}&load=latest`)}
                    className="cursor-pointer border-b border-t-border last:border-b-0 hover:bg-surface-2 transition-colors"
                  >
                    {/* Desktop row */}
                    <div className="hidden md:grid grid-cols-[80px_1fr_1fr_1fr_80px_80px_60px_140px_120px] gap-x-3 items-center px-4 py-3 text-sm">
                      <span>
                        <span className="inline-flex items-center rounded-md bg-cyan-500/15 px-2 py-0.5 text-xs font-semibold text-cyan-400 ring-1 ring-cyan-500/30">
                          v{s.version}
                        </span>
                      </span>
                      <span className="truncate font-medium text-foreground" title={s.dealName}>
                        {s.dealName}
                      </span>
                      <span className="truncate text-muted" title={s.customer ?? ""}>
                        {s.customer ?? <span className="italic opacity-50">—</span>}
                      </span>
                      <span className="truncate text-muted" title={s.address ?? ""}>
                        {s.address ?? <span className="italic opacity-50">—</span>}
                      </span>
                      <span className="text-right text-muted">
                        {s.systemSizeKwdc != null ? `${s.systemSizeKwdc}` : "—"}
                      </span>
                      <span className="text-right text-muted">
                        {s.moduleCount != null ? `${s.moduleCount}` : "—"}
                      </span>
                      <span className="text-right text-muted">{s.itemCount}</span>
                      <span className="truncate text-muted text-xs" title={s.savedBy ?? ""}>
                        {s.savedBy ?? "—"}
                      </span>
                      <span className="text-xs text-muted whitespace-nowrap">
                        {relativeTime(s.createdAt)}
                      </span>
                    </div>

                    {/* Mobile row */}
                    <div className="md:hidden px-4 py-3 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center rounded-md bg-cyan-500/15 px-2 py-0.5 text-xs font-semibold text-cyan-400 ring-1 ring-cyan-500/30">
                          v{s.version}
                        </span>
                        <span className="font-medium text-foreground text-sm truncate">{s.dealName}</span>
                      </div>
                      {s.customer && (
                        <div className="text-xs text-muted">{s.customer}</div>
                      )}
                      {s.address && (
                        <div className="text-xs text-muted">{s.address}</div>
                      )}
                      <div className="flex items-center gap-3 text-xs text-muted">
                        {s.systemSizeKwdc != null && <span>{s.systemSizeKwdc} kWdc</span>}
                        {s.moduleCount != null && <span>{s.moduleCount} modules</span>}
                        <span>{s.itemCount} items</span>
                        <span className="ml-auto">{relativeTime(s.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <p className="text-center text-xs text-muted pb-2">
            Showing {filtered.length} of {snapshots.length} snapshot{snapshots.length !== 1 ? "s" : ""}
          </p>
        </div>
      )}
    </DashboardShell>
  );
}
