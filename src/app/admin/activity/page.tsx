"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";
import { useToast } from "@/contexts/ToastContext";
import { AdminPageHeader } from "@/components/admin-shell/AdminPageHeader";
import { AdminEmpty } from "@/components/admin-shell/AdminEmpty";
import { AdminError } from "@/components/admin-shell/AdminError";
import { AdminTable, type AdminTableColumn } from "@/components/admin-shell/AdminTable";
import { AdminFilterBar, DateRangeChip, FilterSearch } from "@/components/admin-shell/AdminFilterBar";
import { AdminDetailDrawer } from "@/components/admin-shell/AdminDetailDrawer";
import { AdminDetailHeader } from "@/components/admin-shell/AdminDetailHeader";
import { AdminKeyValueGrid } from "@/components/admin-shell/AdminKeyValueGrid";

// ── Types ─────────────────────────────────────────────────────────────────

interface ActivityLog {
  id: string;
  type: string;
  description: string;
  userId: string | null;
  userEmail: string | null;
  entityType: string | null;
  entityId: string | null;
  entityName: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  sessionId?: string | null;
  requestPath?: string | null;
  requestMethod?: string | null;
  riskLevel?: string | null;
  createdAt: string;
  user: { name: string | null; email: string; image: string | null; roles: string[] } | null;
}

type DateRange = "today" | "7d" | "30d" | "all";
type FiltersState = {
  dateRange: DateRange;
  typeFilters: string[];
  roleFilters: string[];
  emailQuery: string;
  userIdFilter: string;
  autoRefresh: boolean;
};

// ── Constants ─────────────────────────────────────────────────────────────

const USER_ROLES = ["ADMIN", "EXECUTIVE", "OPERATIONS", "OPERATIONS_MANAGER", "PROJECT_MANAGER", "TECH_OPS", "VIEWER", "SALES"] as const;
const ROLE_ALIASES: Record<string, string> = { OWNER: "EXECUTIVE", VIEWER: "UNASSIGNED", MANAGER: "PROJECT_MANAGER", DESIGNER: "TECH_OPS", PERMITTING: "TECH_OPS" };
const DATE_OPTS = [{ value: "today" as const, label: "Today" }, { value: "7d" as const, label: "7d" }, { value: "30d" as const, label: "30d" }, { value: "all" as const, label: "All" }];
const RISK_COLORS: Record<string, string> = { LOW: "text-green-400 bg-green-400/10", MEDIUM: "text-yellow-400 bg-yellow-400/10", HIGH: "text-orange-400 bg-orange-400/10", CRITICAL: "text-red-400 bg-red-400/10" };
const PAGE_SIZE = 100;

// ── Helpers ───────────────────────────────────────────────────────────────

function fmtRelative(ds: string): string {
  const diff = Date.now() - new Date(ds).getTime();
  const m = Math.floor(diff / 60000), h = Math.floor(diff / 3600000), d = Math.floor(diff / 86400000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 7) return `${d}d ago`;
  return new Date(ds).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function sinceFrom(dr: DateRange): string | null {
  const now = new Date();
  if (dr === "today") { const t = new Date(now); t.setHours(0, 0, 0, 0); return t.toISOString(); }
  if (dr === "7d") return new Date(now.getTime() - 7 * 864e5).toISOString();
  if (dr === "30d") return new Date(now.getTime() - 30 * 864e5).toISOString();
  return null;
}

function entityLink(type: string | null, id: string | null): string | null {
  if (!type || !id) return null;
  if (type === "user") return `/admin/users?userId=${encodeURIComponent(id)}`;
  if (type === "role") return `/admin/roles/${encodeURIComponent(id)}`;
  return null;
}

function initFilters(sp: URLSearchParams): FiltersState {
  return {
    dateRange: (sp.get("dateRange") as DateRange) || "all",
    typeFilters: sp.get("type") ? [sp.get("type")!] : [],
    roleFilters: [],
    emailQuery: sp.get("email") || "",
    userIdFilter: sp.get("userId") || "",
    autoRefresh: false,
  };
}

// ── Drawer detail ─────────────────────────────────────────────────────────

function ActivityDrawerBody({ a }: { a: ActivityLog }) {
  const link = entityLink(a.entityType, a.entityId);
  const kvItems = [
    { label: "Type", value: a.type.replace(/_/g, " ") },
    { label: "Actor", value: a.user?.email || a.userEmail || "System" },
    { label: "Entity", value: a.entityName ? (link ? <Link href={link} className="underline underline-offset-2 hover:text-foreground">{a.entityName}</Link> : a.entityName) : "—" },
    { label: "Session ID", value: a.sessionId || "—", mono: !!a.sessionId },
    { label: "IP Address", value: a.ipAddress || "—", mono: !!a.ipAddress },
    { label: "User Agent", value: a.userAgent || "—" },
    ...(a.requestPath ? [{ label: "Request", value: `${a.requestMethod ?? "GET"} ${a.requestPath}`, mono: true }] : []),
  ];
  return (
    <div className="space-y-5">
      <AdminDetailHeader title={a.description || a.type.replace(/_/g, " ")} subtitle={new Date(a.createdAt).toLocaleString()} />
      <AdminKeyValueGrid items={kvItems} />
      {a.metadata && Object.keys(a.metadata).length > 0 && (
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">Metadata</p>
          <pre className="rounded-md bg-surface-2 p-3 text-xs text-muted overflow-x-auto">{JSON.stringify(a.metadata, null, 2)}</pre>
        </div>
      )}
      {link && (
        <Link href={link} className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:underline">
          View {a.entityType}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3 w-3"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
        </Link>
      )}
    </div>
  );
}

// ── Table columns ─────────────────────────────────────────────────────────

const COLUMNS: AdminTableColumn<ActivityLog>[] = [
  {
    key: "createdAt", label: "Time", width: "w-28",
    render: (r) => <span className="text-xs text-muted whitespace-nowrap">{fmtRelative(r.createdAt)}</span>,
  },
  {
    key: "actor", label: "Actor", width: "w-48",
    render: (r) => <span className="text-xs truncate block max-w-[180px]">{r.user?.email || r.userEmail || "System"}</span>,
  },
  {
    key: "event", label: "Event",
    render: (r) => (
      <div>
        <span className="text-xs font-medium text-foreground">{r.type.replace(/_/g, " ")}</span>
        {r.description && <p className="text-xs text-muted truncate max-w-xs">{r.description}</p>}
      </div>
    ),
  },
  {
    key: "entity", label: "Entity", width: "w-36",
    render: (r) => {
      const link = entityLink(r.entityType, r.entityId);
      if (!r.entityName) return <span className="text-xs text-muted">—</span>;
      return link
        ? <Link href={link} onClick={(e) => e.stopPropagation()} className="text-xs underline underline-offset-2 text-muted hover:text-foreground">{r.entityName}</Link>
        : <span className="text-xs text-muted">{r.entityName}</span>;
    },
  },
  {
    key: "riskLevel", label: "Risk", width: "w-20", align: "center",
    render: (r) => {
      if (!r.riskLevel) return <span className="text-xs text-muted">—</span>;
      return <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${RISK_COLORS[r.riskLevel] ?? "text-muted bg-surface-2"}`}>{r.riskLevel}</span>;
    },
  },
];

// ── Page ──────────────────────────────────────────────────────────────────

export default function AdminActivityPage() {
  const { addToast } = useToast();
  const searchParams = useSearchParams();
  const router = useRouter();

  const [filters, setFilters] = useState<FiltersState>(() => initFilters(searchParams));
  const [data, setData] = useState<{ activities: ActivityLog[]; total: number }>({ activities: [], total: 0 });
  const [offset, setOffset] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ActivityLog | null>(null);
  const [allTypes, setAllTypes] = useState<string[]>([]);

  // Debounce email (300 ms)
  const [debouncedEmail, setDebouncedEmail] = useState(filters.emailQuery);
  const emailTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    emailTimer.current = setTimeout(() => setDebouncedEmail(filters.emailQuery), 300);
    return () => clearTimeout(emailTimer.current);
  }, [filters.emailQuery]);

  // Sync filter state → URL (no history spam)
  useEffect(() => {
    const p = new URLSearchParams();
    if (filters.dateRange !== "all") p.set("dateRange", filters.dateRange);
    if (filters.typeFilters.length === 1) p.set("type", filters.typeFilters[0]);
    if (filters.emailQuery) p.set("email", filters.emailQuery);
    if (filters.userIdFilter) p.set("userId", filters.userIdFilter);
    if (selected) p.set("drawerId", selected.id);
    router.replace(`?${p.toString()}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.dateRange, filters.typeFilters, filters.emailQuery, filters.userIdFilter, selected]);

  // Load distinct types on mount
  useEffect(() => {
    fetch("/api/admin/activity?meta=types").then((r) => r.ok ? r.json() : null).then((d) => d && setAllTypes(d.types || [])).catch(() => {});
  }, []);

  // Deep-link: open drawer from ?drawerId= after first load
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current || !data.activities.length) return;
    const id = searchParams.get("drawerId");
    if (id) { deepLinked.current = true; const m = data.activities.find((a) => a.id === id); if (m) setSelected(m); }
  }, [data.activities, searchParams]);

  // Build API query params
  const buildParams = useCallback((off: number) => {
    const p = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(off) });
    filters.typeFilters.forEach((t) => p.append("type", t));
    filters.roleFilters.forEach((r) => p.append("role", r));
    const since = sinceFrom(filters.dateRange);
    if (since) p.set("since", since);
    if (debouncedEmail.trim()) p.set("email", debouncedEmail.trim());
    if (filters.userIdFilter) p.set("userId", filters.userIdFilter);
    return p;
  }, [filters, debouncedEmail]);

  // Fetch activities
  const fetchActivities = useCallback(async (append = false, off = 0) => {
    try {
      append ? setLoadingMore(true) : setLoading(true);
      const res = await fetch(`/api/admin/activity?${buildParams(append ? off : 0)}`);
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Failed to fetch"); }
      const d = await res.json();
      setData((prev) => append
        ? { activities: [...prev.activities, ...d.activities], total: d.total }
        : { activities: d.activities, total: d.total });
      if (!append) setOffset(0);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [buildParams]);

  // Re-fetch when filters change
  useEffect(() => {
    fetchActivities(false, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.dateRange, filters.typeFilters, filters.roleFilters, debouncedEmail, filters.userIdFilter]);

  // Auto-refresh (30 s)
  useEffect(() => {
    if (!filters.autoRefresh) return;
    const id = setInterval(() => fetchActivities(false, 0), 30000);
    return () => clearInterval(id);
  }, [filters.autoRefresh, fetchActivities]);

  const handleLoadMore = () => { const next = offset + PAGE_SIZE; setOffset(next); fetchActivities(true, next); };
  const hasMore = data.activities.length < data.total;
  const hasActiveFilters = filters.dateRange !== "all" || filters.typeFilters.length > 0 || filters.roleFilters.length > 0 || !!filters.emailQuery || !!filters.userIdFilter;
  const clearAll = () => setFilters((f) => ({ ...f, dateRange: "all", typeFilters: [], roleFilters: [], emailQuery: "", userIdFilter: "" }));

  const typeOptions = useMemo(() => allTypes.map((t) => ({ value: t, label: t.replace(/_/g, " ") })), [allTypes]);
  const roleOptions = useMemo(() => USER_ROLES.map((r) => ({ value: r, label: (ROLE_ALIASES[r] || r).replace(/_/g, " ") })), []);

  const exportToCSV = () => {
    if (!data.activities.length) { addToast({ type: "warning", title: "Nothing to export", message: "No activities match the current filters." }); return; }
    const rows = data.activities.map((a) => [new Date(a.createdAt).toLocaleString(), a.user?.email || a.userEmail || "System", a.type, a.description, a.ipAddress || "N/A"]);
    const csv = [["Timestamp", "User", "Type", "Details", "IP"], ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    link.download = `activity-log-${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
  };

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div>
      <AdminPageHeader title="Activity Log" breadcrumb={["Admin", "Audit", "Activity log"]} subtitle={`${data.total.toLocaleString()} total events`} />

      <div className="mb-4">
        <AdminFilterBar hasActiveFilters={hasActiveFilters} onClearAll={clearAll}>
          <DateRangeChip label="Range" selected={filters.dateRange} options={DATE_OPTS} onChange={(v) => setFilters((f) => ({ ...f, dateRange: v }))} />
          <MultiSelectFilter label="Type" options={typeOptions} selected={filters.typeFilters} onChange={(v) => setFilters((f) => ({ ...f, typeFilters: v }))} placeholder="All Activities" accentColor="blue" />
          <MultiSelectFilter label="Role" options={roleOptions} selected={filters.roleFilters} onChange={(v) => setFilters((f) => ({ ...f, roleFilters: v }))} placeholder="All Roles" accentColor="purple" />
          <FilterSearch value={filters.emailQuery} onChange={(v) => setFilters((f) => ({ ...f, emailQuery: v }))} placeholder="Filter by email…" widthClass="w-48" />
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setFilters((f) => ({ ...f, autoRefresh: !f.autoRefresh }))}
              aria-label={filters.autoRefresh ? "Disable auto-refresh" : "Enable auto-refresh"}
              title={filters.autoRefresh ? "Disable auto-refresh" : "Enable auto-refresh (every 30s)"}
              className={`rounded p-1.5 transition-colors ${filters.autoRefresh ? "bg-green-600/20 text-green-400 border border-green-600/50" : "text-muted hover:text-foreground hover:bg-surface-2"}`}
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
            <button type="button" onClick={() => fetchActivities(false, 0)} aria-label="Refresh" title="Refresh" className="rounded p-1.5 text-muted hover:text-foreground hover:bg-surface-2 transition-colors">
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
            <button type="button" onClick={exportToCSV} title="Export CSV" className="rounded px-2 py-1 text-xs text-muted hover:text-foreground hover:bg-surface-2 transition-colors">CSV</button>
          </div>
        </AdminFilterBar>
      </div>

      <AdminTable
        caption="Activity log entries"
        rows={data.activities}
        rowKey={(r) => r.id}
        columns={COLUMNS}
        loading={loading}
        error={error ? <AdminError error={error} onRetry={() => fetchActivities(false, 0)} /> : undefined}
        empty={<AdminEmpty label="No activities match your filters" description="Try adjusting your search criteria or date range" />}
        onRowClick={setSelected}
      />

      {!loading && !error && hasMore && (
        <div className="mt-4 flex justify-center">
          <button onClick={handleLoadMore} disabled={loadingMore} className="flex items-center gap-2 rounded-lg bg-surface-2 px-4 py-2 text-sm text-foreground transition-colors hover:bg-surface-elevated disabled:opacity-50">
            {loadingMore ? <><span className="h-3.5 w-3.5 animate-spin rounded-full border-b-2 border-foreground" /> Loading…</> : `Load more (${data.activities.length.toLocaleString()} of ${data.total.toLocaleString()})`}
          </button>
        </div>
      )}
      {!loading && !error && data.activities.length > 0 && (
        <p className="mt-3 text-center text-xs text-muted">Showing {data.activities.length.toLocaleString()} of {data.total.toLocaleString()} activities</p>
      )}

      <AdminDetailDrawer open={selected !== null} onClose={() => setSelected(null)} wide title={selected ? selected.type.replace(/_/g, " ") : ""}>
        {selected && <ActivityDrawerBody a={selected} />}
      </AdminDetailDrawer>
    </div>
  );
}
