"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { StatCard } from "@/components/ui/MetricCard";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";
import { queryKeys } from "@/lib/query-keys";
import { useSSE } from "@/hooks/useSSE";
import type {
  Milestone,
  MismatchType,
  PaymentDataMismatchEntry,
  PaymentTrackingResponse,
} from "@/lib/payment-tracking-types";

const MILESTONE_LABEL: Record<Milestone, string> = {
  da: "DA",
  cc: "CC",
  pto: "PTO",
  peM1: "PE M1",
  peM2: "PE M2",
};

const MISMATCH_ORDER: MismatchType[] = [
  "property_says_unpaid_invoice_paid",
  "property_says_paid_invoice_unpaid",
  "property_missing_invoice_present",
];

const MISMATCH_LABEL: Record<MismatchType, string> = {
  property_says_unpaid_invoice_paid: "Deal property says unpaid, invoice IS paid",
  property_says_paid_invoice_unpaid: "Deal property says paid, invoice is UNPAID",
  property_missing_invoice_present: "Deal property missing, paid invoice exists",
};

const MISMATCH_HINT: Record<MismatchType, string> = {
  property_says_unpaid_invoice_paid:
    "Most common. Accounting marked the invoice paid; HubSpot workflow hasn't updated the deal property yet.",
  property_says_paid_invoice_unpaid:
    "Suspicious. Deal property was flipped to Paid but the invoice still has a balance. Likely manual data-entry error.",
  property_missing_invoice_present:
    "Deal has a paid invoice record but no corresponding status property set.",
};

function fmtMoney(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export default function PaymentDataMismatchClient() {
  const { data, refetch } = useQuery<PaymentTrackingResponse>({
    queryKey: queryKeys.paymentTracking.list(),
    queryFn: async () => {
      const res = await fetch("/api/accounting/payment-tracking");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 60_000,
  });

  useSSE(() => { refetch(); }, { url: "/api/stream", cacheKeyFilter: "accounting:payment-tracking" });

  const [locationFilter, setLocationFilter] = useState<string[]>([]);
  const [milestoneFilter, setMilestoneFilter] = useState<Milestone[]>([]);

  const entries = useMemo(
    () => data?.paymentDataMismatch ?? [],
    [data?.paymentDataMismatch]
  );
  const totalDeals = data?.deals.length ?? 0;

  const allLocations = useMemo(
    () => Array.from(new Set(entries.map((e) => e.pbLocation).filter(Boolean))).sort(),
    [entries]
  );

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (locationFilter.length && !locationFilter.includes(e.pbLocation)) return false;
      if (milestoneFilter.length && !milestoneFilter.includes(e.milestone)) return false;
      return true;
    });
  }, [entries, locationFilter, milestoneFilter]);

  const grouped = useMemo(() => {
    const byType = new Map<MismatchType, PaymentDataMismatchEntry[]>();
    for (const t of MISMATCH_ORDER) byType.set(t, []);
    for (const e of filtered) byType.get(e.mismatchType)?.push(e);
    return byType;
  }, [filtered]);

  const distinctDealCount = useMemo(
    () => new Set(filtered.map((e) => e.dealId)).size,
    [filtered]
  );
  const mismatchRate = totalDeals > 0 ? (distinctDealCount / totalDeals) * 100 : 0;

  const mostMismatchedMilestone = useMemo(() => {
    const counts: Record<Milestone, number> = { da: 0, cc: 0, pto: 0, peM1: 0, peM2: 0 };
    for (const e of filtered) counts[e.milestone]++;
    let top: Milestone = "da";
    let max = -1;
    for (const m of Object.keys(counts) as Milestone[]) {
      if (counts[m] > max) {
        top = m;
        max = counts[m];
      }
    }
    return { milestone: top, count: max > 0 ? max : 0 };
  }, [filtered]);

  const csvRows = useMemo(
    () =>
      filtered.map((e) => ({
        dealId: e.dealId,
        name: e.dealName,
        location: e.pbLocation,
        type: e.isPE ? "PE" : "STD",
        milestone: MILESTONE_LABEL[e.milestone],
        mismatchType: e.mismatchType,
        dealPropertyStatus: e.dealPropertyStatus ?? "",
        invoiceStatus: e.invoice.status ?? "",
        invoiceBalanceDue: e.invoice.balanceDue ?? "",
        invoicePaymentDate: e.invoice.paymentDate ?? "",
      })),
    [filtered]
  );

  return (
    <DashboardShell
      title="Payment Data Mismatch"
      subtitle="Diagnostic — deal properties that disagree with their invoice records"
      accentColor="yellow"
      lastUpdated={data?.lastUpdated}
      exportData={{ data: csvRows, filename: "payment-data-mismatch.csv" }}
      fullWidth
    >
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        <StatCard
          label="Total Mismatches"
          value={filtered.length.toString()}
          subtitle={`${distinctDealCount} deals affected`}
          color="amber"
        />
        <StatCard
          label="Mismatch Rate"
          value={`${mismatchRate.toFixed(1)}%`}
          subtitle={`${distinctDealCount} of ${totalDeals} deals`}
          color="blue"
        />
        <StatCard
          label="Most Mismatched"
          value={MILESTONE_LABEL[mostMismatchedMilestone.milestone]}
          subtitle={`${mostMismatchedMilestone.count} mismatches`}
          color="red"
        />
      </div>

      <div className="bg-surface border border-t-border rounded-lg p-3 mb-4 flex flex-wrap gap-3 items-center">
        <MultiSelectFilter
          label="Location"
          options={allLocations.map((l) => ({ value: l, label: l }))}
          selected={locationFilter}
          onChange={setLocationFilter}
        />
        <MultiSelectFilter
          label="Milestone"
          options={(Object.keys(MILESTONE_LABEL) as Milestone[]).map((m) => ({
            value: m,
            label: MILESTONE_LABEL[m],
          }))}
          selected={milestoneFilter}
          onChange={(v) => setMilestoneFilter(v as Milestone[])}
        />
      </div>

      <div className="space-y-6">
        {MISMATCH_ORDER.map((t) => {
          const list = grouped.get(t) ?? [];
          if (list.length === 0) return null;
          return (
            <section key={t}>
              <div className="mb-2">
                <h2 className="text-sm font-semibold text-foreground">{MISMATCH_LABEL[t]}</h2>
                <p className="text-xs text-muted">
                  {list.length} entries · {MISMATCH_HINT[t]}
                </p>
              </div>
              <div className="bg-surface border border-t-border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-surface-2 text-muted text-[11px] uppercase">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Deal</th>
                      <th className="px-3 py-2 text-left font-medium">Milestone</th>
                      <th className="px-3 py-2 text-left font-medium">Property Status</th>
                      <th className="px-3 py-2 text-left font-medium">Invoice Status</th>
                      <th className="px-3 py-2 text-right font-medium">Balance</th>
                      <th className="px-3 py-2 text-left font-medium">Paid Date</th>
                      <th className="px-3 py-2 text-center font-medium">Links</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((e) => (
                      <tr
                        key={`${e.dealId}-${e.milestone}`}
                        className="border-t border-t-border hover:bg-surface-2"
                      >
                        <td className="px-3 py-2 text-foreground">
                          <div className="font-medium">{e.dealName}</div>
                          <div className="text-muted text-[11px]">
                            {e.pbLocation} · {e.isPE ? "PE" : "STD"}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-muted">{MILESTONE_LABEL[e.milestone]}</td>
                        <td className="px-3 py-2 text-muted">{e.dealPropertyStatus ?? "(null)"}</td>
                        <td className="px-3 py-2 text-muted">{e.invoice.status ?? "—"}</td>
                        <td className="px-3 py-2 text-right text-foreground">
                          {fmtMoney(e.invoice.balanceDue)}
                        </td>
                        <td className="px-3 py-2 text-muted">{e.invoice.paymentDate ?? "—"}</td>
                        <td className="px-3 py-2 text-center">
                          <div className="flex gap-2 justify-center text-xs">
                            <a
                              href={e.hubspotUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-400 hover:text-blue-300"
                            >
                              Deal
                            </a>
                            <a
                              href={e.invoice.hubspotUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-amber-400 hover:text-amber-300"
                            >
                              Invoice
                            </a>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
        {filtered.length === 0 && (
          <div className="text-center text-muted py-12">
            No mismatches found — deal properties and invoice records agree.
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
