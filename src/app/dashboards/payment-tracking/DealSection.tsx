"use client";

import { useMemo, useState } from "react";
import type { PaymentTrackingDeal } from "@/lib/payment-tracking-types";
import { MilestoneStrip } from "./MilestoneStrip";

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

function truncate(s: string, n = 28) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

type SortKey =
  | "dealName"
  | "pbLocation"
  | "dealStageLabel"
  | "isPE"
  | "customerContractTotal"
  | "outstanding"
  | "collectedPct"
  | "attentionReasons";
type SortDir = "asc" | "desc";

function getSortValue(d: PaymentTrackingDeal, k: SortKey): string | number {
  if (k === "outstanding") return d.customerOutstanding + (d.peBonusOutstanding ?? 0);
  if (k === "isPE") return d.isPE ? 1 : 0;
  if (k === "attentionReasons") return d.attentionReasons.length;
  const v = d[k as keyof PaymentTrackingDeal];
  return (v as string | number | null) ?? 0;
}

function compareDeals(a: PaymentTrackingDeal, b: PaymentTrackingDeal, k: SortKey, dir: SortDir): number {
  const av = getSortValue(a, k);
  const bv = getSortValue(b, k);
  if (typeof av === "number" && typeof bv === "number") {
    return dir === "asc" ? av - bv : bv - av;
  }
  return dir === "asc"
    ? String(av).localeCompare(String(bv))
    : String(bv).localeCompare(String(av));
}

interface Props {
  title: string;
  accent: "red" | "amber" | "blue" | "emerald";
  deals: PaymentTrackingDeal[];
  defaultCollapsed?: boolean;
  rowLimit?: number;
  showWhy?: boolean;
}

const ACCENT_BORDER: Record<Props["accent"], string> = {
  red: "border-l-red-400",
  amber: "border-l-amber-400",
  blue: "border-l-blue-400",
  emerald: "border-l-emerald-400",
};

const COLUMNS: { key: SortKey; label: string; align?: "left" | "right" | "center" }[] = [
  { key: "dealName", label: "Deal" },
  { key: "dealStageLabel", label: "Stage" },
  { key: "customerContractTotal", label: "Contract", align: "right" },
  // Milestones column (not sortable; just visual). Special-cased in render.
  { key: "outstanding", label: "Outstanding", align: "right" },
  { key: "collectedPct", label: "%", align: "right" },
];

const ALIGN: Record<string, string> = {
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
  showWhy = false,
}: Props) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [showAll, setShowAll] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>(showWhy ? "attentionReasons" : "customerContractTotal");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sorted = useMemo(
    () => [...deals].sort((a, b) => compareDeals(a, b, sortKey, sortDir)),
    [deals, sortKey, sortDir]
  );
  const effective = rowLimit && !showAll ? sorted.slice(0, rowLimit) : sorted;
  const hidden = sorted.length - effective.length;

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("desc");
    }
  };
  const arrow = (k: SortKey) => (sortKey !== k ? "" : sortDir === "asc" ? " ↑" : " ↓");

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
                {COLUMNS.slice(0, 3).map((c) => (
                  <th
                    key={c.key}
                    onClick={() => toggleSort(c.key)}
                    className={`px-3 py-2 font-medium text-muted cursor-pointer hover:text-foreground select-none ${ALIGN[c.align ?? "left"]}`}
                  >
                    {c.label}
                    {arrow(c.key)}
                  </th>
                ))}
                <th className="px-3 py-2 font-medium text-muted text-left">
                  Milestones
                </th>
                {COLUMNS.slice(3).map((c) => (
                  <th
                    key={c.key}
                    onClick={() => toggleSort(c.key)}
                    className={`px-3 py-2 font-medium text-muted cursor-pointer hover:text-foreground select-none ${ALIGN[c.align ?? "left"]}`}
                  >
                    {c.label}
                    {arrow(c.key)}
                  </th>
                ))}
                {showWhy && (
                  <th className="px-3 py-2 font-medium text-muted text-left">Why</th>
                )}
              </tr>
            </thead>
            <tbody>
              {effective.length === 0 ? (
                <tr>
                  <td colSpan={showWhy ? 7 : 6} className="px-3 py-6 text-center text-muted">
                    No deals
                  </td>
                </tr>
              ) : (
                effective.map((d) => {
                  const outstanding = d.customerOutstanding + (d.peBonusOutstanding ?? 0);
                  return (
                    <tr key={d.dealId} className="border-b border-border/50 hover:bg-surface-2/50">
                      <td className="px-3 py-2">
                        <a
                          href={d.hubspotUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-orange-400 hover:text-orange-300 hover:underline"
                          title={d.dealName}
                        >
                          {truncate(d.dealName)}
                        </a>
                        <span className="ml-1.5 text-[10px] text-muted">{shortLocation(d.pbLocation)}</span>
                        {d.isPE && (
                          <span className="ml-1 text-[10px] px-1 rounded bg-blue-500/20 text-blue-300">PE</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted" title={d.dealStageLabel}>
                        {d.dealStageLabel}
                      </td>
                      <td className="px-3 py-2 text-right font-medium">
                        {fmt(d.customerContractTotal)}
                      </td>
                      <td className="px-3 py-2">
                        <MilestoneStrip deal={d} />
                      </td>
                      <td className="px-3 py-2 text-right text-muted">{fmt(outstanding)}</td>
                      <td className="px-3 py-2 text-right text-muted">{d.collectedPct.toFixed(0)}%</td>
                      {showWhy && (
                        <td className="px-3 py-2 text-amber-300/90 text-[11px]" title={d.attentionReasons.join("\n")}>
                          {d.attentionReasons[0] ?? ""}
                          {d.attentionReasons.length > 1 ? ` (+${d.attentionReasons.length - 1})` : ""}
                        </td>
                      )}
                    </tr>
                  );
                })
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
