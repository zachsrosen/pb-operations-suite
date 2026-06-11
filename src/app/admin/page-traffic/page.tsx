"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";
import { AdminPageHeader } from "@/components/admin-shell/AdminPageHeader";
import { AdminFilterBar, DateRangeChip } from "@/components/admin-shell/AdminFilterBar";
import { AdminTable, type AdminTableColumn } from "@/components/admin-shell/AdminTable";
import { AdminError } from "@/components/admin-shell/AdminError";
import { AdminLoading } from "@/components/admin-shell/AdminLoading";
import { CANONICAL_LOCATIONS } from "@/lib/locations";
import type { PageTrafficResult, PageRow, UserRow, TrafficWindow } from "@/lib/page-traffic";

// Real UserRole enum members (no legacy aliases) — must match prisma enum so the
// API's `roles: { hasSome }` filter resolves to actual users.
const USER_ROLES = ["ADMIN", "EXECUTIVE", "OPERATIONS", "OPERATIONS_MANAGER", "SERVICE", "PROJECT_MANAGER", "SALES_MANAGER", "TECH_OPS", "DESIGN", "PERMIT", "INTERCONNECT", "INTELLIGENCE", "ROOFING", "MARKETING", "VIEWER", "SALES", "ACCOUNTING"] as const;
const WINDOW_OPTS = [{ value: "7d", label: "7d" }, { value: "30d", label: "30d" }, { value: "90d", label: "90d" }, { value: "all", label: "All" }];
const ROLE_OPTIONS = USER_ROLES.map((r) => ({ value: r, label: r }));
const LOCATION_OPTIONS = CANONICAL_LOCATIONS.map((l) => ({ value: l, label: l }));

function fmtDwell(ms: number | null): string {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
function fmtNum(n: number): string { return n.toLocaleString(); }

function toCSV(pages: PageRow[]): string {
  const head = ["Path", "Suite", "Views", "Unique Users", "Clicks", "Avg Dwell (s)"];
  const lines = pages.map((p) => [p.path, p.suite, p.views, p.uniqueUsers, p.clicks, p.avgDwellMs == null ? "" : Math.round(p.avgDwellMs / 1000)]
    .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
  return [head.join(","), ...lines].join("\n");
}

export default function PageTrafficPage() {
  const [trafficWindow, setTrafficWindow] = useState<TrafficWindow>("30d"); // not `window` — avoids shadowing the global
  const [roleFilters, setRoleFilters] = useState<string[]>([]);
  const [locationFilters, setLocationFilters] = useState<string[]>([]);
  const [data, setData] = useState<(PageTrafficResult & { generatedAt: string }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true); setError(null);
    try {
      const qs = new URLSearchParams({ window: trafficWindow });
      if (roleFilters.length) qs.set("roles", roleFilters.join(","));
      if (locationFilters.length) qs.set("locations", locationFilters.join(","));
      const res = await fetch(`/api/admin/page-traffic?${qs}`, { signal: ac.signal });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      setData(await res.json());
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [trafficWindow, roleFilters, locationFilters]);

  useEffect(() => { void fetchData(); return () => abortRef.current?.abort(); }, [fetchData]);

  const hasActiveFilters = roleFilters.length > 0 || locationFilters.length > 0 || trafficWindow !== "30d";
  const clearAll = () => { setTrafficWindow("30d"); setRoleFilters([]); setLocationFilters([]); };

  const exportCSV = () => {
    if (!data) return;
    const blob = new Blob([toCSV(data.pages)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `page-traffic-${trafficWindow}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const pageColumns: AdminTableColumn<PageRow>[] = useMemo(() => [
    { key: "path", label: "Page", render: (r) => <span className="font-mono text-xs text-foreground">{r.path}</span> },
    { key: "suite", label: "Suite", render: (r) => <span className="text-muted">{r.suite}</span> },
    { key: "views", label: "Views", align: "right", sortable: true, render: (r) => fmtNum(r.views) },
    { key: "uniqueUsers", label: "Users", align: "right", sortable: true, render: (r) => fmtNum(r.uniqueUsers) },
    { key: "clicks", label: "Clicks", align: "right", render: (r) => fmtNum(r.clicks) },
    { key: "avgDwellMs", label: "Avg dwell", align: "right", render: (r) => fmtDwell(r.avgDwellMs) },
  ], []);

  const userColumns: AdminTableColumn<UserRow>[] = useMemo(() => [
    { key: "user", label: "User", render: (r) => <span className="text-foreground">{r.userName || r.userEmail || r.userId || "Unknown"}</span> },
    { key: "views", label: "Views", align: "right", sortable: true, render: (r) => fmtNum(r.views) },
    { key: "avgDwellMs", label: "Avg dwell", align: "right", render: (r) => fmtDwell(r.avgDwellMs) },
  ], []);

  // Dead-weight table shows path/suite/views — derive by key (robust to column reordering).
  const deadColumns = useMemo(
    () => pageColumns.filter((c) => ["path", "suite", "views"].includes(c.key)),
    [pageColumns],
  );

  const maxSuiteViews = Math.max(1, ...(data?.suites.map((s) => s.views) ?? [1]));

  return (
    <div>
      <AdminPageHeader
        title="Page Traffic"
        breadcrumb={["Admin", "Audit", "Page traffic"]}
        subtitle={data ? `${fmtNum(data.totals.views)} views · ${fmtNum(data.totals.uniqueUsers)} users` : undefined}
      />

      <div className="px-4 py-3">
        <AdminFilterBar hasActiveFilters={hasActiveFilters} onClearAll={clearAll}>
          <DateRangeChip label="Window" selected={trafficWindow} options={WINDOW_OPTS} onChange={(v) => setTrafficWindow(v as TrafficWindow)} />
          <MultiSelectFilter label="Role" options={ROLE_OPTIONS} selected={roleFilters} onChange={setRoleFilters} />
          <MultiSelectFilter label="Location" options={LOCATION_OPTIONS} selected={locationFilters} onChange={setLocationFilters} />
          <button type="button" onClick={exportCSV} className="rounded px-2 py-1 text-xs text-muted hover:text-foreground hover:bg-surface-2 transition-colors">CSV</button>
        </AdminFilterBar>
      </div>

      {error ? (
        <AdminError error={error} onRetry={fetchData} />
      ) : loading && !data ? (
        <AdminLoading label="Loading page traffic…" />
      ) : (
        <div className="space-y-6 px-4 pb-8">
          {/* Summary tiles */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Views", value: fmtNum(data?.totals.views ?? 0) },
              { label: "Unique users", value: fmtNum(data?.totals.uniqueUsers ?? 0) },
              { label: "Active pages", value: fmtNum(data?.totals.activePages ?? 0) },
              { label: "Avg dwell", value: fmtDwell(data?.totals.avgDwellMs ?? null) },
            ].map((t) => (
              <div key={t.label} className="rounded-lg border border-t-border bg-surface p-3">
                <div className="text-xs text-muted">{t.label}</div>
                <div className="mt-1 text-xl font-semibold text-foreground">{t.value}</div>
              </div>
            ))}
          </div>

          {/* Suite breakdown bars */}
          <section>
            <h2 className="mb-2 text-sm font-semibold text-foreground">By suite</h2>
            <div className="space-y-1.5">
              {(data?.suites ?? []).map((s) => (
                <div key={s.suite} className="flex items-center gap-2">
                  <div className="w-40 shrink-0 truncate text-xs text-muted">{s.suite}</div>
                  <div className="h-4 flex-1 rounded bg-surface-2">
                    <div className="h-4 rounded bg-purple-500/60" style={{ width: `${(s.views / maxSuiteViews) * 100}%` }} />
                  </div>
                  <div className="w-16 shrink-0 text-right text-xs text-foreground">{fmtNum(s.views)}</div>
                </div>
              ))}
            </div>
          </section>

          {/* Top pages */}
          <section>
            <h2 className="mb-2 text-sm font-semibold text-foreground">Top pages</h2>
            <AdminTable<PageRow>
              caption="Top pages by traffic"
              rows={data?.pages ?? []}
              rowKey={(r) => r.path}
              columns={pageColumns}
              loading={loading && !data}
            />
          </section>

          {/* Dead weight */}
          <section>
            <h2 className="mb-2 text-sm font-semibold text-foreground">Dead weight (little/no traffic)</h2>
            <AdminTable<PageRow>
              caption="Pages with little or no traffic"
              rows={(data?.deadPages ?? []).map((d) => ({ ...d, uniqueUsers: 0, clicks: 0, avgDwellMs: null }))}
              rowKey={(r) => r.path}
              columns={deadColumns}
              loading={loading && !data}
            />
          </section>

          {/* Per-user */}
          <section>
            <h2 className="mb-2 text-sm font-semibold text-foreground">By user</h2>
            <AdminTable<UserRow>
              caption="Usage by user"
              rows={data?.users ?? []}
              rowKey={(r) => r.userId || r.userEmail || "unknown"}
              columns={userColumns}
              loading={loading && !data}
            />
          </section>
        </div>
      )}
    </div>
  );
}
