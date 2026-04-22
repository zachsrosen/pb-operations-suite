"use client";

import { useMemo, useState } from "react";
import type { PaymentTrackingDeal } from "@/lib/payment-tracking-types";
import { StatusPill } from "./StatusPill";
import { PaidInFullIndicator } from "./PaidInFullIndicator";

function fmt(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

const LOCATION_SHORT: Record<string, string> = {
  Centennial: "DTC",
  Westminster: "WST",
  "Colorado Springs": "CSP",
  "San Luis Obispo": "SLO",
  Camarillo: "CAM",
};
const shortLocation = (loc: string) => LOCATION_SHORT[loc] ?? loc.slice(0, 3).toUpperCase();

function truncate(s: string, n = 22) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// Sortable column keys correspond to deal fields or computed accessors.
type SortKey =
  | "dealName"
  | "pbLocation"
  | "dealStageLabel"
  | "isPE"
  | "closeDate"
  | "customerContractTotal"
  | "daStatus"
  | "daAmount"
  | "daPaidDate"
  | "ccStatus"
  | "ccAmount"
  | "ccPaidDate"
  | "ptoStatus"
  | "peM1Status"
  | "peM1Amount"
  | "peM2Status"
  | "peM2Amount"
  | "totalPBRevenue"
  | "outstanding"
  | "collectedPct"
  | "paidInFullFlag";

type SortDir = "asc" | "desc";

function getSortValue(d: PaymentTrackingDeal, key: SortKey): string | number | null {
  switch (key) {
    case "outstanding":
      return d.customerOutstanding + (d.peBonusOutstanding ?? 0);
    case "isPE":
      return d.isPE ? 1 : 0;
    case "paidInFullFlag":
      return d.paidInFullFlag === null ? -1 : d.paidInFullFlag ? 1 : 0;
    default:
      return (d[key as keyof PaymentTrackingDeal] as string | number | null) ?? null;
  }
}

function compareDeals(a: PaymentTrackingDeal, b: PaymentTrackingDeal, key: SortKey, dir: SortDir): number {
  const av = getSortValue(a, key);
  const bv = getSortValue(b, key);
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  if (typeof av === "number" && typeof bv === "number") {
    return dir === "asc" ? av - bv : bv - av;
  }
  return dir === "asc"
    ? String(av).localeCompare(String(bv))
    : String(bv).localeCompare(String(av));
}

interface Props {
  title: string;
  accent: "red" | "amber" | "blue" | "cyan" | "emerald";
  deals: PaymentTrackingDeal[];
  defaultCollapsed?: boolean;
  rowLimit?: number;
}

const ACCENT_BORDER: Record<Props["accent"], string> = {
  red: "border-l-red-400",
  amber: "border-l-amber-400",
  blue: "border-l-blue-400",
  cyan: "border-l-cyan-400",
  emerald: "border-l-emerald-400",
};

const COLUMNS: { key: SortKey; label: string; align?: "left" | "right" | "center" }[] = [
  { key: "dealName", label: "Deal" },
  { key: "pbLocation", label: "Loc" },
  { key: "dealStageLabel", label: "Stage" },
  { key: "isPE", label: "Type", align: "center" },
  { key: "closeDate", label: "Close" },
  { key: "customerContractTotal", label: "Contract", align: "right" },
  { key: "daStatus", label: "DA" },
  { key: "daAmount", label: "DA $", align: "right" },
  { key: "daPaidDate", label: "DA Paid" },
  { key: "ccStatus", label: "CC" },
  { key: "ccAmount", label: "CC $", align: "right" },
  { key: "ccPaidDate", label: "CC Paid" },
  { key: "ptoStatus", label: "PTO" },
  { key: "peM1Status", label: "PE M1" },
  { key: "peM1Amount", label: "PE M1 $", align: "right" },
  { key: "peM2Status", label: "PE M2" },
  { key: "peM2Amount", label: "PE M2 $", align: "right" },
  { key: "totalPBRevenue", label: "Total Rev", align: "right" },
  { key: "outstanding", label: "Outstanding", align: "right" },
  { key: "collectedPct", label: "%", align: "right" },
  { key: "paidInFullFlag", label: "Paid?", align: "center" },
];

const ALIGN_CLASS = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

export function DealSection({
  title,
  accent,
  deals,
  defaultCollapsed = false,
  rowLimit,
}: Props) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [showAll, setShowAll] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("closeDate");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sortedDeals = useMemo(() => {
    return [...deals].sort((a, b) => compareDeals(a, b, sortKey, sortDir));
  }, [deals, sortKey, sortDir]);

  const effectiveDeals = rowLimit && !showAll ? sortedDeals.slice(0, rowLimit) : sortedDeals;
  const hidden = sortedDeals.length - effectiveDeals.length;

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sortArrow = (key: SortKey) => {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  };

  return (
    <div className="mb-6">
      <div className={`flex items-baseline gap-3 mb-2 border-l-2 ${ACCENT_BORDER[accent]} pl-3`}>
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="text-sm font-semibold text-foreground hover:text-muted"
        >
          {collapsed ? "▶" : "▼"} {title}
        </button>
        <span className="text-xs text-muted">
          {deals.length} deal{deals.length === 1 ? "" : "s"}
        </span>
      </div>
      {!collapsed && (
        <div className="bg-surface rounded-lg border border-border shadow-card overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    onClick={() => toggleSort(col.key)}
                    className={`px-2 py-1.5 font-medium text-muted whitespace-nowrap cursor-pointer hover:text-foreground select-none ${ALIGN_CLASS[col.align ?? "left"]}`}
                  >
                    {col.label}
                    {sortArrow(col.key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {effectiveDeals.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-3 py-6 text-center text-muted">
                    No deals
                  </td>
                </tr>
              ) : (
                effectiveDeals.map((d) => (
                  <tr key={d.dealId} className="border-b border-border/50 hover:bg-surface-2/50">
                    <td className="px-2 py-1.5">
                      <a
                        href={d.hubspotUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-orange-400 hover:text-orange-300 hover:underline"
                        title={d.dealName}
                      >
                        {truncate(d.dealName)}
                      </a>
                      {d.attentionReasons.length > 0 && (
                        <span
                          className="ml-1 text-amber-400"
                          title={d.attentionReasons.join("\n")}
                        >
                          ⚠️
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-muted" title={d.pbLocation}>
                      {shortLocation(d.pbLocation)}
                    </td>
                    <td className="px-2 py-1.5 text-muted" title={d.dealStageLabel}>
                      {truncate(d.dealStageLabel, 14)}
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      {d.isPE ? (
                        <span className="text-blue-400">PE</span>
                      ) : (
                        <span className="text-muted">STD</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-muted">
                      {d.closeDate
                        ? new Date(d.closeDate).toLocaleDateString("en-US", {
                            month: "numeric",
                            day: "numeric",
                            year: "2-digit",
                          })
                        : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right font-medium">
                      {fmt(d.customerContractTotal)}
                    </td>
                    <td className="px-2 py-1.5">
                      <StatusPill status={d.daStatus} />
                    </td>
                    <td className="px-2 py-1.5 text-right text-muted">{fmt(d.daAmount)}</td>
                    <td className="px-2 py-1.5 text-muted">{d.daPaidDate ?? "—"}</td>
                    <td className="px-2 py-1.5">
                      <StatusPill status={d.ccStatus} />
                    </td>
                    <td className="px-2 py-1.5 text-right text-muted">{fmt(d.ccAmount)}</td>
                    <td className="px-2 py-1.5 text-muted">{d.ccPaidDate ?? "—"}</td>
                    <td className="px-2 py-1.5">
                      <StatusPill status={d.ptoStatus} />
                    </td>
                    <td className="px-2 py-1.5">
                      {d.isPE ? (
                        <StatusPill status={d.peM1Status} />
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right text-muted">
                      {d.isPE ? fmt(d.peM1Amount) : "—"}
                    </td>
                    <td className="px-2 py-1.5">
                      {d.isPE ? (
                        <StatusPill status={d.peM2Status} />
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right text-muted">
                      {d.isPE ? fmt(d.peM2Amount) : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right font-medium text-emerald-400">
                      {fmt(d.totalPBRevenue)}
                    </td>
                    <td className="px-2 py-1.5 text-right text-muted">
                      {fmt(d.customerOutstanding + (d.peBonusOutstanding ?? 0))}
                    </td>
                    <td className="px-2 py-1.5 text-right text-muted">
                      {d.collectedPct.toFixed(0)}%
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <PaidInFullIndicator flag={d.paidInFullFlag} computedPct={d.collectedPct} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {hidden > 0 && (
            <div className="px-3 py-2 text-center text-xs text-muted border-t border-border">
              <button
                onClick={() => setShowAll(true)}
                className="text-blue-400 hover:underline"
              >
                Show {hidden} more…
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
