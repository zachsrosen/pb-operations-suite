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
  PaymentTrackingResponse,
  ReadyToInvoiceEntry,
} from "@/lib/payment-tracking-types";

const MILESTONE_LABELS: Record<Milestone, string> = {
  da: "Design Approved — ready to invoice DA",
  cc: "Construction Complete — ready to invoice CC",
  pto: "PTO Granted — ready to invoice PTO",
  peM1: "PE M1 Ready — inspection passed + PE approved",
  peM2: "PE M2 Ready — PTO granted + PE approved",
};

const MILESTONE_ORDER: Milestone[] = ["da", "cc", "pto", "peM1", "peM2"];

function fmtMoney(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export default function ReadyToInvoiceClient() {
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

  const entries = useMemo(() => data?.readyToInvoice ?? [], [data?.readyToInvoice]);

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
    const byMilestone = new Map<Milestone, ReadyToInvoiceEntry[]>();
    for (const m of MILESTONE_ORDER) byMilestone.set(m, []);
    for (const e of filtered) {
      byMilestone.get(e.milestone)?.push(e);
    }
    // Sort each section by daysReady desc
    for (const [, list] of byMilestone) {
      list.sort((a, b) => (b.daysReady ?? 0) - (a.daysReady ?? 0));
    }
    return byMilestone;
  }, [filtered]);

  const totalDollars = useMemo(
    () => filtered.reduce((sum, e) => sum + (e.expectedAmount ?? 0), 0),
    [filtered]
  );
  const oldestDays = useMemo(
    () => filtered.reduce((max, e) => Math.max(max, e.daysReady ?? 0), 0),
    [filtered]
  );
  const readyToday = useMemo(
    () => filtered.filter((e) => e.daysReady === 0).length,
    [filtered]
  );

  const csvRows = useMemo(
    () =>
      filtered.map((e) => ({
        dealId: e.dealId,
        name: e.dealName,
        location: e.pbLocation,
        stage: e.dealStageLabel,
        type: e.isPE ? "PE" : "STD",
        milestone: e.milestone,
        triggerDate: e.triggerDate ?? "",
        daysReady: e.daysReady ?? "",
        expectedAmount: e.expectedAmount ?? "",
      })),
    [filtered]
  );

  return (
    <DashboardShell
      title="Ready to Invoice"
      subtitle="Work milestones hit but no invoice created yet — grouped by milestone"
      accentColor="emerald"
      lastUpdated={data?.lastUpdated}
      exportData={{ data: csvRows, filename: "ready-to-invoice.csv" }}
      fullWidth
      headerRight={
        <a
          href="/dashboards/accounts-receivable"
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 hover:bg-red-500/20 text-xs font-medium transition-colors"
        >
          ⏳ Accounts Receivable →
        </a>
      }
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard
          label="Milestones Ready"
          value={filtered.length.toString()}
          subtitle="Awaiting invoice creation"
          color="emerald"
        />
        <StatCard
          label="Total $ to Invoice"
          value={fmtMoney(totalDollars)}
          subtitle="Expected invoice total"
          color="green"
        />
        <StatCard
          label="Oldest Ready"
          value={`${oldestDays}d`}
          subtitle="Longest waiting for invoice"
          color="amber"
        />
        <StatCard
          label="Ready Today"
          value={readyToday.toString()}
          subtitle="Triggered on today's date"
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
          options={MILESTONE_ORDER.map((m) => ({ value: m, label: m.toUpperCase() }))}
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
        {MILESTONE_ORDER.map((m) => {
          const list = grouped.get(m) ?? [];
          if (list.length === 0) return null;
          return (
            <section key={m}>
              <div className="flex items-center gap-2 mb-2">
                <h2 className="text-sm font-semibold text-foreground">{MILESTONE_LABELS[m]}</h2>
                <span className="text-xs text-muted">{list.length} deals</span>
              </div>
              <div className="bg-surface border border-t-border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-surface-2 text-muted text-[11px] uppercase">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Deal</th>
                      <th className="px-3 py-2 text-left font-medium">Stage</th>
                      <th className="px-3 py-2 text-right font-medium">Expected</th>
                      <th className="px-3 py-2 text-right font-medium">Days Ready</th>
                      <th className="px-3 py-2 text-left font-medium">Trigger Date</th>
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
                        <td className="px-3 py-2 text-muted">{e.dealStageLabel}</td>
                        <td className="px-3 py-2 text-right text-foreground">
                          {fmtMoney(e.expectedAmount)}
                        </td>
                        <td className="px-3 py-2 text-right text-foreground">
                          {e.daysReady ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-muted">{e.triggerDate ?? "—"}</td>
                        <td className="px-3 py-2 text-center">
                          <a
                            href={e.hubspotUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-emerald-400 hover:text-emerald-300"
                          >
                            Open →
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
            No milestones ready to invoice — everything has been billed or work is still in progress.
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
