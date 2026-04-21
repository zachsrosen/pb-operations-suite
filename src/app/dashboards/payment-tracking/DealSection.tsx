"use client";

import { useState } from "react";
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

export function DealSection({
  title,
  accent,
  deals,
  defaultCollapsed = false,
  rowLimit,
}: Props) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [showAll, setShowAll] = useState(false);
  const effectiveDeals = rowLimit && !showAll ? deals.slice(0, rowLimit) : deals;
  const hidden = deals.length - effectiveDeals.length;

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
                <th className="px-2 py-1.5 text-left font-medium text-muted">Deal</th>
                <th className="px-2 py-1.5 text-left font-medium text-muted">Loc</th>
                <th className="px-2 py-1.5 text-left font-medium text-muted">Stage</th>
                <th className="px-2 py-1.5 text-center font-medium text-muted">Type</th>
                <th className="px-2 py-1.5 text-left font-medium text-muted">Close</th>
                <th className="px-2 py-1.5 text-right font-medium text-muted">Contract</th>
                <th className="px-2 py-1.5 text-left font-medium text-muted">DA</th>
                <th className="px-2 py-1.5 text-right font-medium text-muted">DA $</th>
                <th className="px-2 py-1.5 text-left font-medium text-muted">DA Paid</th>
                <th className="px-2 py-1.5 text-left font-medium text-muted">CC</th>
                <th className="px-2 py-1.5 text-right font-medium text-muted">CC $</th>
                <th className="px-2 py-1.5 text-left font-medium text-muted">CC Paid</th>
                <th className="px-2 py-1.5 text-left font-medium text-muted">PTO</th>
                <th className="px-2 py-1.5 text-left font-medium text-muted">PE M1</th>
                <th className="px-2 py-1.5 text-right font-medium text-muted">PE M1 $</th>
                <th className="px-2 py-1.5 text-left font-medium text-muted">PE M2</th>
                <th className="px-2 py-1.5 text-right font-medium text-muted">PE M2 $</th>
                <th className="px-2 py-1.5 text-right font-medium text-muted">Total Rev</th>
                <th className="px-2 py-1.5 text-right font-medium text-muted">Outstanding</th>
                <th className="px-2 py-1.5 text-right font-medium text-muted">%</th>
                <th className="px-2 py-1.5 text-center font-medium text-muted">Paid?</th>
              </tr>
            </thead>
            <tbody>
              {effectiveDeals.length === 0 ? (
                <tr>
                  <td colSpan={21} className="px-3 py-6 text-center text-muted">
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
                      {truncate(d.dealStageLabel, 12)}
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
