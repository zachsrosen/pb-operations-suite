"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { StatCard } from "@/components/ui/MetricCard";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";
import { queryKeys } from "@/lib/query-keys";
import { useSSE } from "@/hooks/useSSE";
import type {
  AccountsReceivableEntry,
  AgingBucket,
  Milestone,
  PaymentTrackingResponse,
} from "@/lib/payment-tracking-types";

const MILESTONE_LABEL: Record<Milestone, string> = {
  da: "DA",
  cc: "CC",
  pto: "PTO",
  peM1: "PE M1",
  peM2: "PE M2",
};

const BUCKET_ORDER: AgingBucket[] = ["90+", "61-90", "31-60", "0-30"];

const BUCKET_LABEL: Record<AgingBucket, string> = {
  "90+": "90+ days overdue",
  "61-90": "61–90 days overdue",
  "31-60": "31–60 days overdue",
  "0-30": "0–30 days",
};

const BUCKET_COLOR: Record<AgingBucket, "red" | "amber" | "blue" | "green"> = {
  "90+": "red",
  "61-90": "amber",
  "31-60": "blue",
  "0-30": "green",
};

function fmtMoney(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export default function AccountsReceivableClient() {
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
  const [typeFilter, setTypeFilter] = useState<"all" | "pe" | "std">("all");
  const [milestoneFilter, setMilestoneFilter] = useState<Milestone[]>([]);
  const [search, setSearch] = useState("");

  const entries = useMemo(
    () => data?.accountsReceivable ?? [],
    [data?.accountsReceivable]
  );

  const allLocations = useMemo(
    () => Array.from(new Set(entries.map((e) => e.pbLocation).filter(Boolean))).sort(),
    [entries]
  );

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (locationFilter.length && !locationFilter.includes(e.pbLocation)) return false;
      if (typeFilter === "pe" && !e.isPE) return false;
      if (typeFilter === "std" && e.isPE) return false;
      if (milestoneFilter.length && !milestoneFilter.includes(e.milestone)) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!e.dealName.toLowerCase().includes(q) && !e.dealId.includes(q)) return false;
      }
      return true;
    });
  }, [entries, locationFilter, typeFilter, milestoneFilter, search]);

  const grouped = useMemo(() => {
    const byBucket = new Map<AgingBucket, AccountsReceivableEntry[]>();
    for (const b of BUCKET_ORDER) byBucket.set(b, []);
    for (const e of filtered) byBucket.get(e.agingBucket)?.push(e);
    for (const [, list] of byBucket) list.sort((a, b) => b.daysOverdue - a.daysOverdue);
    return byBucket;
  }, [filtered]);

  const totalOutstanding = useMemo(
    () => filtered.reduce((sum, e) => sum + (e.invoice.balanceDue ?? 0), 0),
    [filtered]
  );
  const bucketTotal = (b: AgingBucket) =>
    (grouped.get(b) ?? []).reduce((sum, e) => sum + (e.invoice.balanceDue ?? 0), 0);

  const csvRows = useMemo(
    () =>
      filtered.map((e) => ({
        dealId: e.dealId,
        name: e.dealName,
        location: e.pbLocation,
        type: e.isPE ? "PE" : "STD",
        milestone: MILESTONE_LABEL[e.milestone],
        invoiceNumber: e.invoice.number ?? "",
        billed: e.invoice.amountBilled ?? "",
        paid: e.invoice.amountPaid ?? "",
        balanceDue: e.invoice.balanceDue ?? "",
        daysOverdue: e.daysOverdue,
        agingBucket: e.agingBucket,
      })),
    [filtered]
  );

  return (
    <DashboardShell
      title="Accounts Receivable"
      subtitle="Invoices sent but unpaid — grouped by aging bucket"
      accentColor="red"
      lastUpdated={data?.lastUpdated}
      exportData={{ data: csvRows, filename: "accounts-receivable.csv" }}
      fullWidth
      headerRight={
        <a
          href="/dashboards/ready-to-invoice"
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20 text-xs font-medium transition-colors"
        >
          🧾 Ready to Invoice →
        </a>
      }
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard
          label="Total Outstanding"
          value={fmtMoney(totalOutstanding)}
          subtitle={`${filtered.length} invoices`}
          color="red"
        />
        <StatCard
          label="90+ Days"
          value={fmtMoney(bucketTotal("90+"))}
          subtitle={`${(grouped.get("90+") ?? []).length} invoices`}
          color="red"
        />
        <StatCard
          label="61–90 Days"
          value={fmtMoney(bucketTotal("61-90"))}
          subtitle={`${(grouped.get("61-90") ?? []).length} invoices`}
          color="amber"
        />
        <StatCard
          label="0–60 Days"
          value={fmtMoney(bucketTotal("0-30") + bucketTotal("31-60"))}
          subtitle={`${((grouped.get("0-30") ?? []).length + (grouped.get("31-60") ?? []).length)} invoices`}
          color="blue"
        />
      </div>

      <div className="bg-surface border border-t-border rounded-lg p-3 mb-4 flex flex-wrap gap-3 items-center">
        <MultiSelectFilter
          label="Location"
          options={allLocations.map((l) => ({ value: l, label: l }))}
          selected={locationFilter}
          onChange={setLocationFilter}
        />
        <div className="flex items-center gap-1 text-xs">
          <span className="text-muted">Type:</span>
          {(["all", "pe", "std"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-2 py-1 rounded ${
                typeFilter === t
                  ? "bg-foreground text-background"
                  : "bg-surface-2 text-muted hover:text-foreground"
              }`}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>
        <MultiSelectFilter
          label="Milestone"
          options={(Object.keys(MILESTONE_LABEL) as Milestone[]).map((m) => ({
            value: m,
            label: MILESTONE_LABEL[m],
          }))}
          selected={milestoneFilter}
          onChange={(v) => setMilestoneFilter(v as Milestone[])}
        />
        <input
          type="text"
          placeholder="Search deal / ID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[160px] px-3 py-1.5 rounded bg-surface-2 border border-t-border text-xs"
        />
      </div>

      <div className="space-y-6">
        {BUCKET_ORDER.map((b) => {
          const list = grouped.get(b) ?? [];
          if (list.length === 0) return null;
          const total = bucketTotal(b);
          return (
            <section key={b}>
              <div className="flex items-center gap-2 mb-2">
                <h2 className={`text-sm font-semibold text-${BUCKET_COLOR[b]}-300`}>
                  {BUCKET_LABEL[b]}
                </h2>
                <span className="text-xs text-muted">
                  {list.length} invoices · {fmtMoney(total)}
                </span>
              </div>
              <div className="bg-surface border border-t-border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-surface-2 text-muted text-[11px] uppercase">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Deal</th>
                      <th className="px-3 py-2 text-left font-medium">Milestone</th>
                      <th className="px-3 py-2 text-left font-medium">Invoice #</th>
                      <th className="px-3 py-2 text-right font-medium">Billed</th>
                      <th className="px-3 py-2 text-right font-medium">Paid</th>
                      <th className="px-3 py-2 text-right font-medium">Balance</th>
                      <th className="px-3 py-2 text-right font-medium">Days Overdue</th>
                      <th className="px-3 py-2 text-center font-medium">HubSpot</th>
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
                        <td className="px-3 py-2 text-muted">{e.invoice.number ?? "—"}</td>
                        <td className="px-3 py-2 text-right text-foreground">
                          {fmtMoney(e.invoice.amountBilled)}
                        </td>
                        <td className="px-3 py-2 text-right text-foreground">
                          {fmtMoney(e.invoice.amountPaid)}
                        </td>
                        <td className="px-3 py-2 text-right text-red-300 font-medium">
                          {fmtMoney(e.invoice.balanceDue)}
                        </td>
                        <td className="px-3 py-2 text-right text-foreground">{e.daysOverdue}</td>
                        <td className="px-3 py-2 text-center">
                          <a
                            href={e.invoice.hubspotUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-red-400 hover:text-red-300"
                          >
                            Invoice →
                          </a>
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
            No outstanding invoices — all sent invoices are paid in full.
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
