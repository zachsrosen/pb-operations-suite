"use client";

/**
 * Inventory Sync Health
 *
 * Focused "what's broken between systems?" rollup. Reuses the heavy
 * /api/products/comparison response (which already joins Internal ↔
 * HubSpot ↔ Zuper ↔ Zoho and emits drift reasons) and presents it as
 * issue tiles + a worst-offenders list. Each tile deep-links to the
 * product-comparison page with the right filter pre-applied.
 *
 * This is intentionally read-only — fixing drift happens in
 * /dashboards/product-comparison where the linking/cleanup machinery lives.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { MiniStat } from "@/components/ui/MetricCard";

type SourceName = "internal" | "hubspot" | "zuper" | "zoho";

interface ComparableProduct {
  id: string;
  name: string | null;
  sku: string | null;
  price: number | null;
  status: string | null;
  description: string | null;
  url: string | null;
}

interface ComparisonRow {
  key: string;
  reasons: string[];
  isMismatch: boolean;
  internal: ComparableProduct | null;
  hubspot: ComparableProduct | null;
  zuper: ComparableProduct | null;
  zoho: ComparableProduct | null;
  internalDuplicates?: ComparableProduct[];
}

interface SourceHealth {
  configured: boolean;
  count: number;
  error: string | null;
}

interface ComparisonResponse {
  rows: ComparisonRow[];
  summary: {
    totalRows: number;
    mismatchRows: number;
    fullyMatchedRows: number;
    missingBySource: Record<SourceName, number>;
    sourceCounts: Record<SourceName, number>;
  };
  health: Record<SourceName, SourceHealth>;
  warnings: string[];
  lastUpdated: string;
}

const SOURCE_LABEL: Record<SourceName, string> = {
  internal: "Internal",
  hubspot: "HubSpot",
  zuper: "Zuper",
  zoho: "Zoho",
};

interface IssueDef {
  /** Stable key used for React, not shown */
  key: string;
  /** Headline copy */
  label: string;
  /** Sub-copy explaining the rule */
  detail: string;
  /** Predicate against a row's reasons[] */
  match: (reason: string) => boolean;
  /** Filter values to seed product-comparison with on drill-down */
  reasons?: string[];
  missing?: SourceName[];
  /** Tailwind accent class for the count number */
  accent: string;
}

const ISSUES: IssueDef[] = [
  {
    key: "name",
    label: "Name mismatches",
    detail: "Same product, different names across systems",
    match: (r) => r === "Product name mismatch",
    reasons: ["Product name mismatch"],
    accent: "text-orange-400",
  },
  {
    key: "sku",
    label: "SKU mismatches",
    detail: "Different SKUs registered for the same product",
    match: (r) => r === "SKU mismatch",
    reasons: ["SKU mismatch"],
    accent: "text-orange-400",
  },
  {
    key: "price",
    label: "Price mismatches",
    detail: "Different prices stored across systems",
    match: (r) => r === "Price mismatch",
    reasons: ["Price mismatch"],
    accent: "text-red-400",
  },
  {
    key: "link",
    label: "Broken / missing internal links",
    detail: "InternalProduct's stored ID points to nothing or the wrong row",
    match: (r) => r.startsWith("Internal link mismatch") || r.startsWith("Internal link missing"),
    accent: "text-red-400",
  },
  {
    key: "missing-hubspot",
    label: "Missing in HubSpot",
    detail: "Product exists elsewhere but not in HubSpot Products",
    match: (r) => r === "Missing in HubSpot",
    missing: ["hubspot"],
    accent: "text-amber-400",
  },
  {
    key: "missing-zuper",
    label: "Missing in Zuper",
    detail: "Product exists elsewhere but not in Zuper",
    match: (r) => r === "Missing in Zuper",
    missing: ["zuper"],
    accent: "text-amber-400",
  },
  {
    key: "missing-zoho",
    label: "Missing in Zoho",
    detail: "Product exists elsewhere but not in Zoho Inventory",
    match: (r) => r === "Missing in Zoho",
    missing: ["zoho"],
    accent: "text-amber-400",
  },
  {
    key: "missing-internal",
    label: "Orphaned (no Internal row)",
    detail: "Lives in HubSpot/Zuper/Zoho but no InternalProduct claims it",
    match: (r) => r === "Missing in Internal",
    missing: ["internal"],
    accent: "text-purple-400",
  },
  {
    key: "duplicates",
    label: "Duplicates",
    detail: "Multiple entries for the same product within a single system",
    match: (r) => r.startsWith("Duplicate "),
    accent: "text-fuchsia-400",
  },
];

function rowDisplayName(row: ComparisonRow): string {
  return (
    row.internal?.name ||
    row.zoho?.name ||
    row.hubspot?.name ||
    row.zuper?.name ||
    row.key ||
    "(no name)"
  );
}

function rowSeverity(row: ComparisonRow): number {
  // Mirrors the heuristic in product-comparison's computeRowSeverity:
  // give priority to broken links + price/sku mismatches over plain naming drift
  let score = 0;
  for (const r of row.reasons) {
    if (r.startsWith("Internal link mismatch") || r.startsWith("Internal link missing")) score += 4;
    else if (r === "Price mismatch") score += 3;
    else if (r === "SKU mismatch") score += 3;
    else if (r === "Product name mismatch") score += 2;
    else if (r.startsWith("Missing in ")) score += 2;
    else if (r.startsWith("Duplicate ")) score += 1;
    else score += 1;
  }
  return score;
}

function buildDrillDownHref(issue: IssueDef): string {
  const params = new URLSearchParams();
  if (issue.reasons && issue.reasons.length > 0) {
    params.set("reasons", issue.reasons.join(","));
  }
  if (issue.missing && issue.missing.length > 0) {
    params.set("missing", issue.missing.join(","));
  }
  const qs = params.toString();
  return `/dashboards/product-comparison${qs ? `?${qs}` : ""}`;
}

export default function SyncHealthPage() {
  const { data, isLoading, isFetching, error, refetch } = useQuery<ComparisonResponse>({
    queryKey: ["product-comparison"],
    queryFn: async () => {
      const res = await fetch("/api/products/comparison", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      return res.json();
    },
    staleTime: 10 * 60 * 1000, // 10 min — the join is expensive, drift evolves slowly
    refetchOnWindowFocus: false,
  });

  const counts = useMemo(() => {
    const result: Record<string, number> = {};
    if (!data) return result;
    for (const row of data.rows) {
      for (const issue of ISSUES) {
        if (row.reasons.some(issue.match)) {
          result[issue.key] = (result[issue.key] || 0) + 1;
        }
      }
    }
    return result;
  }, [data]);

  const totalCatalog = data?.summary.totalRows ?? 0;
  const fullyMatched = data?.summary.fullyMatchedRows ?? 0;
  const consistencyPct =
    totalCatalog > 0 ? Math.round((fullyMatched / totalCatalog) * 100) : null;

  const worstOffenders = useMemo(() => {
    if (!data) return [] as Array<{ row: ComparisonRow; severity: number }>;
    return data.rows
      .filter((r) => r.isMismatch)
      .map((row) => ({ row, severity: rowSeverity(row) }))
      .sort((a, b) => b.severity - a.severity)
      .slice(0, 25);
  }, [data]);

  const sourceHealth = data?.health;

  return (
    <DashboardShell
      title="Sync Health"
      accentColor="purple"
      lastUpdated={data?.lastUpdated}
      fullWidth
    >
      <div className="flex items-center gap-3 mb-5 text-xs text-muted">
        <span>
          {totalCatalog.toLocaleString()} products joined across InternalProduct, HubSpot, Zuper, Zoho
        </span>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="text-xs bg-surface-2 border border-t-border rounded px-3 py-1 hover:bg-surface-elevated disabled:opacity-50 ml-auto"
        >
          {isFetching ? "Refreshing…" : "Refresh"}
        </button>
        <Link
          href="/dashboards/product-comparison"
          className="text-xs text-cyan-400 hover:text-cyan-300"
        >
          Open Product Comparison →
        </Link>
      </div>

      {/* Source health row — quick "is each integration working?" check */}
      {sourceHealth && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          {(Object.keys(sourceHealth) as SourceName[]).map((s) => {
            const h = sourceHealth[s];
            return (
              <div
                key={s}
                className={`bg-surface/50 border rounded-lg p-3 ${
                  h.error
                    ? "border-red-500/40"
                    : h.configured
                      ? "border-t-border"
                      : "border-amber-500/40"
                }`}
              >
                <div className="text-xs text-muted">{SOURCE_LABEL[s]}</div>
                <div className="text-xl font-semibold tabular-nums">
                  {h.count.toLocaleString()}
                </div>
                <div className="text-[11px] mt-1">
                  {h.error ? (
                    <span className="text-red-400">Error: {h.error}</span>
                  ) : h.configured ? (
                    <span className="text-muted">products fetched</span>
                  ) : (
                    <span className="text-amber-400">Not configured</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Top-line summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <MiniStat label="Total products" value={totalCatalog} />
        <MiniStat label="Fully consistent" value={fullyMatched} />
        <MiniStat
          label="With drift"
          value={data?.summary.mismatchRows ?? 0}
          alert={(data?.summary.mismatchRows ?? 0) > 0}
        />
        <MiniStat
          label="Consistency score"
          value={consistencyPct == null ? "—" : `${consistencyPct}%`}
        />
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg p-3 mb-4 text-sm">
          {(error as Error).message}
        </div>
      )}

      {isLoading && (
        <div className="text-muted text-sm py-12 text-center">
          Joining products across all four systems… this can take a minute.
        </div>
      )}

      {!isLoading && data && (
        <>
          {/* Issue tiles — clickable, drill into product-comparison */}
          <h2 className="text-sm font-medium text-muted uppercase tracking-wider mb-3">
            Drift by issue type
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
            {ISSUES.map((issue) => {
              const count = counts[issue.key] || 0;
              const pct = totalCatalog > 0 ? (count / totalCatalog) * 100 : 0;
              return (
                <Link
                  key={issue.key}
                  href={buildDrillDownHref(issue)}
                  className={`block bg-surface/50 border rounded-xl p-4 transition-colors ${
                    count > 0
                      ? "border-t-border hover:border-cyan-500/40 hover:bg-surface-2/30"
                      : "border-t-border/50 opacity-60"
                  }`}
                >
                  <div className="flex items-baseline justify-between">
                    <div className="text-sm font-medium text-foreground">{issue.label}</div>
                    <div className={`text-2xl font-semibold tabular-nums ${issue.accent}`}>
                      {count.toLocaleString()}
                    </div>
                  </div>
                  <div className="text-xs text-muted mt-1">{issue.detail}</div>
                  <div className="flex items-center justify-between mt-3">
                    <div className="text-[11px] text-muted">
                      {pct > 0 ? `${pct.toFixed(1)}% of catalog` : "—"}
                    </div>
                    {count > 0 && (
                      <span className="text-[11px] text-cyan-400">Investigate →</span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>

          {/* Worst-offender list */}
          <h2 className="text-sm font-medium text-muted uppercase tracking-wider mb-3">
            Top issues to fix first
          </h2>
          {worstOffenders.length === 0 ? (
            <div className="bg-surface/50 border border-t-border rounded-xl p-6 text-center text-sm text-muted">
              No drift detected — every joined product matches across configured systems.
            </div>
          ) : (
            <div className="bg-surface/50 border border-t-border rounded-xl overflow-hidden">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface-2/50 text-xs text-muted uppercase tracking-wider">
                  <tr>
                    <th className="px-3 py-2 w-10">#</th>
                    <th className="px-3 py-2">Product</th>
                    <th className="px-3 py-2">Issues</th>
                    <th className="px-3 py-2 text-right">Severity</th>
                    <th className="px-3 py-2 w-24" />
                  </tr>
                </thead>
                <tbody>
                  {worstOffenders.map((entry, idx) => {
                    const { row, severity } = entry;
                    const presentSources = (Object.keys(SOURCE_LABEL) as SourceName[]).filter(
                      (s) => row[s],
                    );
                    return (
                      <tr key={row.key} className="border-t border-t-border hover:bg-surface-2/30">
                        <td className="px-3 py-2 text-muted tabular-nums">{idx + 1}</td>
                        <td className="px-3 py-2">
                          <div className="text-foreground">{rowDisplayName(row)}</div>
                          <div className="text-[11px] text-muted">
                            in {presentSources.map((s) => SOURCE_LABEL[s]).join(" · ") || "—"}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {row.reasons.slice(0, 4).map((r) => (
                              <span
                                key={r}
                                className="text-[11px] px-2 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-300"
                              >
                                {r}
                              </span>
                            ))}
                            {row.reasons.length > 4 && (
                              <span className="text-[11px] text-muted self-center">
                                +{row.reasons.length - 4}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-foreground">
                          {severity}
                        </td>
                        <td className="px-3 py-2">
                          <Link
                            href={`/dashboards/product-comparison?reasons=${encodeURIComponent(
                              row.reasons[0] || "",
                            )}`}
                            className="text-xs text-cyan-400 hover:text-cyan-300"
                          >
                            Investigate →
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {data.warnings.length > 0 && (
            <div className="mt-6 bg-amber-500/5 border border-amber-500/30 rounded-lg p-3">
              <div className="text-xs font-medium text-amber-300 uppercase tracking-wider mb-2">
                Warnings from comparison
              </div>
              <ul className="text-xs text-amber-200 space-y-1">
                {data.warnings.map((w) => (
                  <li key={w}>• {w}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </DashboardShell>
  );
}
