"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { MiniStat } from "@/components/ui/MetricCard";

interface ItemRow {
  itemId: string;
  name: string;
  sku: string | null;
  vendor: string | null;
  category: string | null;
  storedCost: number | null;
  storedPrice: number | null;
  marginPct: number | null;
  latestBillDate: string | null;
  latestBillPrice: number | null;
  latestBillVendor: string | null;
  avgBillPrice: number;
  minBillPrice: number;
  maxBillPrice: number;
  billCount: number;
  totalQty: number;
  variancePct: number | null;
  varianceAbs: number | null;
  status: "match" | "mismatch" | "no_stored_cost" | "large_swing";
  linkedInternal: boolean;
  linkedHubSpot: boolean;
  linkedZuper: boolean;
  internalProductId: string | null;
}

interface UnmatchedRow {
  description: string;
  vendor: string | null;
  latestDate: string;
  billCount: number;
  totalQty: number;
  avgRate: number;
}

interface AuditResponse {
  dateStart: string;
  dateEnd: string;
  billsScanned: number;
  billsWithErrors: number;
  itemsAnalyzed: number;
  unmatchedLineItems: number;
  rows: ItemRow[];
  unmatchedRows: UnmatchedRow[];
  lastUpdated: string;
  cached?: boolean;
}

const STATUS_BADGE: Record<ItemRow["status"], { label: string; className: string }> = {
  match: {
    label: "Match",
    className: "bg-green-500/15 text-green-400 border-green-500/30",
  },
  mismatch: {
    label: "Mismatch",
    className: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  },
  large_swing: {
    label: "Large swing",
    className: "bg-red-500/15 text-red-400 border-red-500/30",
  },
  no_stored_cost: {
    label: "No cost set",
    className: "bg-zinc-500/15 text-muted border-t-border",
  },
};

const STATUS_OPTIONS: ItemRow["status"][] = [
  "large_swing",
  "mismatch",
  "no_stored_cost",
  "match",
];

function fmtMoney(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function fmtPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

type SortField =
  | "variancePct"
  | "name"
  | "storedCost"
  | "storedPrice"
  | "marginPct"
  | "latestBillPrice"
  | "billCount"
  | "totalQty"
  | "latestBillDate";

const LINK_BADGE_BASE =
  "text-[10px] font-semibold leading-none px-1.5 py-0.5 rounded border w-7 text-center";

function LinkBadges({
  internal,
  hubspot,
  zuper,
}: {
  internal: boolean;
  hubspot: boolean;
  zuper: boolean;
}) {
  return (
    <div className="flex gap-1 items-center">
      <span
        title={internal ? "Linked to InternalProduct" : "Not in InternalProduct catalog"}
        className={`${LINK_BADGE_BASE} ${
          internal
            ? "bg-cyan-500/15 text-cyan-400 border-cyan-500/30"
            : "bg-transparent text-muted/40 border-t-border"
        }`}
      >
        IP
      </span>
      <span
        title={hubspot ? "Synced to HubSpot Products" : "Not synced to HubSpot"}
        className={`${LINK_BADGE_BASE} ${
          hubspot
            ? "bg-orange-500/15 text-orange-400 border-orange-500/30"
            : "bg-transparent text-muted/40 border-t-border"
        }`}
      >
        HS
      </span>
      <span
        title={zuper ? "Synced to Zuper" : "Not synced to Zuper"}
        className={`${LINK_BADGE_BASE} ${
          zuper
            ? "bg-purple-500/15 text-purple-400 border-purple-500/30"
            : "bg-transparent text-muted/40 border-t-border"
        }`}
      >
        ZP
      </span>
    </div>
  );
}

function SortHeader({
  field,
  label,
  align,
  activeField,
  dir,
  onSort,
}: {
  field: SortField;
  label: string;
  align?: "right";
  activeField: SortField;
  dir: "asc" | "desc";
  onSort: (field: SortField) => void;
}) {
  return (
    <th
      className={`px-3 py-2 text-xs font-medium text-muted uppercase tracking-wider cursor-pointer select-none ${
        align === "right" ? "text-right" : "text-left"
      }`}
      onClick={() => onSort(field)}
    >
      {label}
      <span className="ml-1 text-[10px]">
        {activeField === field ? (dir === "asc" ? "↑" : "↓") : ""}
      </span>
    </th>
  );
}

export default function CostAuditPage() {
  const [days, setDays] = useState(90);
  const [statusFilter, setStatusFilter] = useState<Set<ItemRow["status"]>>(
    new Set(["large_swing", "mismatch"]),
  );
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("variancePct");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [activeTab, setActiveTab] = useState<"items" | "unmatched">("items");

  const { data, isLoading, isFetching, error, refetch } = useQuery<AuditResponse>({
    queryKey: ["inventory-cost-audit", days],
    queryFn: async () => {
      const res = await fetch(`/api/inventory/cost-audit?days=${days}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const summary = useMemo(() => {
    if (!data) {
      return { match: 0, mismatch: 0, large: 0, missing: 0 };
    }
    const counts = { match: 0, mismatch: 0, large: 0, missing: 0 };
    for (const r of data.rows) {
      if (r.status === "match") counts.match += 1;
      else if (r.status === "mismatch") counts.mismatch += 1;
      else if (r.status === "large_swing") counts.large += 1;
      else counts.missing += 1;
    }
    return counts;
  }, [data]);

  const filteredRows = useMemo(() => {
    if (!data) return [] as ItemRow[];
    const q = search.trim().toLowerCase();
    const filtered = data.rows.filter((r) => {
      if (!statusFilter.has(r.status)) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        (r.sku || "").toLowerCase().includes(q) ||
        (r.vendor || "").toLowerCase().includes(q) ||
        (r.category || "").toLowerCase().includes(q)
      );
    });
    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "variancePct": {
          const av = a.variancePct == null ? -Infinity : Math.abs(a.variancePct);
          const bv = b.variancePct == null ? -Infinity : Math.abs(b.variancePct);
          cmp = av - bv;
          break;
        }
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "storedCost":
          cmp = (a.storedCost ?? -Infinity) - (b.storedCost ?? -Infinity);
          break;
        case "storedPrice":
          cmp = (a.storedPrice ?? -Infinity) - (b.storedPrice ?? -Infinity);
          break;
        case "marginPct":
          cmp = (a.marginPct ?? -Infinity) - (b.marginPct ?? -Infinity);
          break;
        case "latestBillPrice":
          cmp = (a.latestBillPrice ?? 0) - (b.latestBillPrice ?? 0);
          break;
        case "billCount":
          cmp = a.billCount - b.billCount;
          break;
        case "totalQty":
          cmp = a.totalQty - b.totalQty;
          break;
        case "latestBillDate":
          cmp = (a.latestBillDate || "").localeCompare(b.latestBillDate || "");
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [data, search, statusFilter, sortField, sortDir]);

  const exportRows = useMemo(() => {
    return filteredRows.map((r) => ({
      Item: r.name,
      SKU: r.sku || "",
      Category: r.category || "",
      Vendor: r.vendor || "",
      "Stored Cost": r.storedCost ?? "",
      "Sales Price": r.storedPrice ?? "",
      "Margin %": r.marginPct == null ? "" : r.marginPct.toFixed(2),
      "Latest Bill Price": r.latestBillPrice ?? "",
      "Latest Bill Date": r.latestBillDate || "",
      "Avg Bill Price": Number.isFinite(r.avgBillPrice) ? r.avgBillPrice.toFixed(2) : "",
      "Min Bill Price": Number.isFinite(r.minBillPrice) ? r.minBillPrice.toFixed(2) : "",
      "Max Bill Price": Number.isFinite(r.maxBillPrice) ? r.maxBillPrice.toFixed(2) : "",
      "Bill Count": r.billCount,
      "Total Qty": r.totalQty,
      "Variance %": r.variancePct == null ? "" : r.variancePct.toFixed(2),
      Status: STATUS_BADGE[r.status].label,
      "Linked InternalProduct": r.linkedInternal ? "yes" : "",
      "Linked HubSpot": r.linkedHubSpot ? "yes" : "",
      "Linked Zuper": r.linkedZuper ? "yes" : "",
    }));
  }, [filteredRows]);

  function toggleStatus(s: ItemRow["status"]) {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  const sortProps = { activeField: sortField, dir: sortDir, onSort: handleSort };

  return (
    <DashboardShell
      title="Cost Audit"
      accentColor="cyan"
      lastUpdated={data?.lastUpdated}
      exportData={
        activeTab === "items"
          ? { data: exportRows, filename: `cost-audit-${data?.dateStart || "all"}.csv` }
          : undefined
      }
      fullWidth
    >
      {/* Controls row */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-2 text-xs text-muted">
          <span>Window:</span>
          <select
            className="bg-surface-2 border border-t-border rounded px-2 py-1 text-foreground"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            <option value={30}>Last 30 days</option>
            <option value={60}>Last 60 days</option>
            <option value={90}>Last 90 days</option>
            <option value={180}>Last 180 days</option>
            <option value={365}>Last 365 days</option>
          </select>
        </div>
        <button
          className="text-xs bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 rounded px-3 py-1 hover:bg-cyan-500/25 disabled:opacity-50"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          {isFetching ? "Refreshing…" : "Refresh"}
        </button>
        {data && (
          <span className="text-xs text-muted ml-auto">
            {data.dateStart} → {data.dateEnd} · {data.billsScanned.toLocaleString()} bills scanned
            {data.billsWithErrors > 0 && ` · ${data.billsWithErrors} bill errors`}
          </span>
        )}
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        <MiniStat label="Items Analyzed" value={data?.itemsAnalyzed ?? 0} />
        <MiniStat label="Match" value={summary.match} />
        <MiniStat label="Mismatch" value={summary.mismatch} alert={summary.mismatch > 0} />
        <MiniStat
          label="Large Swing (≥25%)"
          value={summary.large}
          alert={summary.large > 0}
        />
        <MiniStat label="No Cost Set" value={summary.missing} />
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-t-border mb-4">
        <button
          className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "items"
              ? "border-cyan-500 text-foreground"
              : "border-transparent text-muted hover:text-foreground"
          }`}
          onClick={() => setActiveTab("items")}
        >
          Item costs ({data?.rows.length ?? 0})
        </button>
        <button
          className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "unmatched"
              ? "border-cyan-500 text-foreground"
              : "border-transparent text-muted hover:text-foreground"
          }`}
          onClick={() => setActiveTab("unmatched")}
        >
          Free-text bill lines ({data?.unmatchedLineItems ?? 0})
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg p-3 mb-4 text-sm">
          {(error as Error).message}
        </div>
      )}

      {isLoading && (
        <div className="text-muted text-sm py-12 text-center">
          Scanning bills and items… this can take 30–60 seconds for large windows.
        </div>
      )}

      {!isLoading && data && activeTab === "items" && (
        <>
          {/* Filters row */}
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <input
              type="search"
              placeholder="Search name / SKU / vendor / category…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-surface-2 border border-t-border rounded px-3 py-1.5 text-sm text-foreground placeholder:text-muted flex-1 min-w-[240px] max-w-md"
            />
            <div className="flex gap-1.5">
              {STATUS_OPTIONS.map((s) => {
                const active = statusFilter.has(s);
                const badge = STATUS_BADGE[s];
                return (
                  <button
                    key={s}
                    onClick={() => toggleStatus(s)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                      active ? badge.className : "border-t-border text-muted hover:text-foreground"
                    }`}
                  >
                    {badge.label}
                  </button>
                );
              })}
            </div>
            <span className="text-xs text-muted ml-auto">
              {filteredRows.length} of {data.rows.length}
            </span>
          </div>

          {/* Table */}
          <div className="bg-surface/50 border border-t-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-surface-2/50">
                  <tr>
                    <SortHeader field="name" label="Item" {...sortProps} />
                    <th className="px-3 py-2 text-xs font-medium text-muted uppercase tracking-wider">
                      Linked
                    </th>
                    <th className="px-3 py-2 text-xs font-medium text-muted uppercase tracking-wider">
                      Vendor
                    </th>
                    <SortHeader field="storedCost" label="Stored Cost" align="right" {...sortProps} />
                    <SortHeader field="storedPrice" label="Sales Price" align="right" {...sortProps} />
                    <SortHeader field="marginPct" label="Margin" align="right" {...sortProps} />
                    <SortHeader field="latestBillPrice" label="Latest Bill" align="right" {...sortProps} />
                    <SortHeader field="variancePct" label="Variance" align="right" {...sortProps} />
                    <SortHeader field="billCount" label="Bills" align="right" {...sortProps} />
                    <SortHeader field="totalQty" label="Qty" align="right" {...sortProps} />
                    <SortHeader field="latestBillDate" label="Last Bill" {...sortProps} />
                    <th className="px-3 py-2 text-xs font-medium text-muted uppercase tracking-wider">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((r) => {
                    const badge = STATUS_BADGE[r.status];
                    const varianceColor =
                      r.variancePct == null
                        ? "text-muted"
                        : Math.abs(r.variancePct) >= 25
                          ? "text-red-400"
                          : Math.abs(r.variancePct) >= 2
                            ? "text-amber-400"
                            : "text-green-400";
                    const marginColor =
                      r.marginPct == null
                        ? "text-muted"
                        : r.marginPct < 5
                          ? "text-red-400"
                          : r.marginPct < 15
                            ? "text-amber-400"
                            : "text-green-400";
                    return (
                      <tr key={r.itemId} className="border-t border-t-border hover:bg-surface-2/30">
                        <td className="px-3 py-2">
                          <div className="text-sm text-foreground">{r.name}</div>
                          <div className="text-[11px] text-muted">
                            {r.sku || "—"}
                            {r.category ? ` · ${r.category}` : ""}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <LinkBadges
                            internal={r.linkedInternal}
                            hubspot={r.linkedHubSpot}
                            zuper={r.linkedZuper}
                          />
                        </td>
                        <td className="px-3 py-2 text-sm text-muted">{r.vendor || "—"}</td>
                        <td className="px-3 py-2 text-sm text-foreground text-right tabular-nums">
                          {fmtMoney(r.storedCost)}
                        </td>
                        <td className="px-3 py-2 text-sm text-foreground text-right tabular-nums">
                          {fmtMoney(r.storedPrice)}
                        </td>
                        <td className={`px-3 py-2 text-sm text-right tabular-nums ${marginColor}`}>
                          {fmtPct(r.marginPct)}
                        </td>
                        <td
                          className="px-3 py-2 text-sm text-foreground text-right tabular-nums"
                          title={`avg ${fmtMoney(r.avgBillPrice)} · range ${fmtMoney(
                            r.minBillPrice,
                          )}–${fmtMoney(r.maxBillPrice)}`}
                        >
                          {fmtMoney(r.latestBillPrice)}
                        </td>
                        <td className={`px-3 py-2 text-sm text-right tabular-nums ${varianceColor}`}>
                          {fmtPct(r.variancePct)}
                          {r.varianceAbs != null && (
                            <div className="text-[11px] text-muted">{fmtMoney(r.varianceAbs)}</div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-sm text-muted text-right tabular-nums">
                          {r.billCount}
                        </td>
                        <td className="px-3 py-2 text-sm text-muted text-right tabular-nums">
                          {r.totalQty.toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted">{r.latestBillDate || "—"}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`text-[11px] px-2 py-0.5 rounded-full border ${badge.className}`}
                          >
                            {badge.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filteredRows.length === 0 && (
              <div className="text-muted text-sm text-center py-12">
                No items match the current filters.
              </div>
            )}
          </div>
        </>
      )}

      {!isLoading && data && activeTab === "unmatched" && (
        <div className="bg-surface/50 border border-t-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-t-border text-xs text-muted">
            Bill line items not linked to a Zoho item — these bypass cost tracking entirely.
            Top 100 by frequency.
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-surface-2/50">
                <tr>
                  <th className="px-3 py-2 text-xs font-medium text-muted uppercase tracking-wider">
                    Description
                  </th>
                  <th className="px-3 py-2 text-xs font-medium text-muted uppercase tracking-wider">
                    Vendor
                  </th>
                  <th className="px-3 py-2 text-xs font-medium text-muted uppercase tracking-wider text-right">
                    Bills
                  </th>
                  <th className="px-3 py-2 text-xs font-medium text-muted uppercase tracking-wider text-right">
                    Qty
                  </th>
                  <th className="px-3 py-2 text-xs font-medium text-muted uppercase tracking-wider text-right">
                    Avg Rate
                  </th>
                  <th className="px-3 py-2 text-xs font-medium text-muted uppercase tracking-wider">
                    Last Bill
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.unmatchedRows.map((u) => (
                  <tr key={u.description} className="border-t border-t-border hover:bg-surface-2/30">
                    <td className="px-3 py-2 text-sm text-foreground max-w-[400px] truncate">
                      {u.description}
                    </td>
                    <td className="px-3 py-2 text-sm text-muted">{u.vendor || "—"}</td>
                    <td className="px-3 py-2 text-sm text-muted text-right tabular-nums">
                      {u.billCount}
                    </td>
                    <td className="px-3 py-2 text-sm text-muted text-right tabular-nums">
                      {u.totalQty.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-sm text-foreground text-right tabular-nums">
                      {fmtMoney(u.avgRate)}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted">{u.latestDate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.unmatchedRows.length === 0 && (
            <div className="text-muted text-sm text-center py-12">
              No free-text bill lines in this window.
            </div>
          )}
        </div>
      )}
    </DashboardShell>
  );
}
