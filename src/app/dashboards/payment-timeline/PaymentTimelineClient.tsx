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
  PaymentTrackingDeal,
  PaymentTrackingResponse,
  InvoiceSummary,
} from "@/lib/payment-tracking-types";

type Tab = "received" | "outstanding";

const MILESTONE_LABEL: Record<Milestone, string> = {
  da: "DA",
  cc: "CC",
  pto: "PTO",
  peM1: "PE M1",
  peM2: "PE M2",
};

interface ReceivedRow {
  dealId: string;
  dealName: string;
  pbLocation: string;
  isPE: boolean;
  milestone: Milestone;
  amount: number;
  paidDate: string;
  invoiceNumber: string | null;
  hubspotUrl: string;
}

interface OutstandingRow {
  dealId: string;
  dealName: string;
  pbLocation: string;
  isPE: boolean;
  milestone: Milestone;
  balanceDue: number;
  amountBilled: number;
  invoiceDate: string | null;
  dueDate: string | null;
  daysOverdue: number;
  invoiceNumber: string | null;
  hubspotUrl: string;
  invoiceUrl: string;
}

function fmtMoney(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function monthKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  const d = new Date(Number(y), Number(m) - 1);
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function extractReceivedRows(deals: PaymentTrackingDeal[]): ReceivedRow[] {
  const rows: ReceivedRow[] = [];
  for (const d of deals) {
    const tryInvoice = (ms: Milestone, inv: InvoiceSummary | undefined, fallbackDate: string | null) => {
      const paid = inv?.amountPaid ?? 0;
      // Date cascade: invoice paymentDate → deal-property fallback → invoiceDate
      // (last resort — invoice exists and is paid, but HubSpot never got a
      // payment date stamped; using the billing date is better than hiding it).
      const date = inv?.paymentDate ?? fallbackDate ?? (paid > 0 ? inv?.invoiceDate : null);
      if (paid > 0 && date) {
        rows.push({
          dealId: d.dealId,
          dealName: d.dealName,
          pbLocation: d.pbLocation,
          isPE: d.isPE,
          milestone: ms,
          amount: paid,
          paidDate: date,
          invoiceNumber: inv?.number ?? null,
          hubspotUrl: d.hubspotUrl,
        });
      }
    };
    tryInvoice("da", d.invoices?.da, d.daPaidDate);
    tryInvoice("cc", d.invoices?.cc, d.ccPaidDate);
    tryInvoice("pto", d.invoices?.pto, d.ptoGrantedDate);
    tryInvoice("peM1", d.invoices?.peM1, d.peM1ApprovalDate);
    tryInvoice("peM2", d.invoices?.peM2, d.peM2ApprovalDate);
  }
  rows.sort((a, b) => new Date(b.paidDate).getTime() - new Date(a.paidDate).getTime());
  return rows;
}

function extractOutstandingRows(deals: PaymentTrackingDeal[]): OutstandingRow[] {
  const rows: OutstandingRow[] = [];
  for (const d of deals) {
    const tryInvoice = (ms: Milestone, inv: InvoiceSummary | undefined) => {
      if (!inv) return;
      const balance = inv.balanceDue ?? 0;
      if (balance <= 0) return;
      rows.push({
        dealId: d.dealId,
        dealName: d.dealName,
        pbLocation: d.pbLocation,
        isPE: d.isPE,
        milestone: ms,
        balanceDue: balance,
        amountBilled: inv.amountBilled ?? 0,
        invoiceDate: inv.invoiceDate,
        dueDate: inv.dueDate,
        daysOverdue: inv.daysOverdue ?? 0,
        invoiceNumber: inv.number,
        hubspotUrl: d.hubspotUrl,
        invoiceUrl: inv.hubspotUrl,
      });
    };
    tryInvoice("da", d.invoices?.da);
    tryInvoice("cc", d.invoices?.cc);
    tryInvoice("pto", d.invoices?.pto);
    tryInvoice("peM1", d.invoices?.peM1);
    tryInvoice("peM2", d.invoices?.peM2);
  }
  rows.sort((a, b) => b.daysOverdue - a.daysOverdue);
  return rows;
}

export default function PaymentTimelineClient() {
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

  const [tab, setTab] = useState<Tab>("received");
  const [locationFilter, setLocationFilter] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState<"all" | "pe" | "std">("all");
  const [search, setSearch] = useState("");

  const deals = useMemo(() => {
    const all = data?.deals ?? [];
    return all.filter((d) => {
      if (locationFilter.length && !locationFilter.includes(d.pbLocation)) return false;
      if (typeFilter === "pe" && !d.isPE) return false;
      if (typeFilter === "std" && d.isPE) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!d.dealName.toLowerCase().includes(q) && !d.dealId.includes(q)) return false;
      }
      return true;
    });
  }, [data?.deals, locationFilter, typeFilter, search]);

  const allLocations = useMemo(
    () => Array.from(new Set((data?.deals ?? []).map((d) => d.pbLocation).filter(Boolean))).sort(),
    [data?.deals],
  );

  const receivedRows = useMemo(() => extractReceivedRows(deals), [deals]);
  const outstandingRows = useMemo(() => extractOutstandingRows(deals), [deals]);

  const totalReceived = useMemo(() => receivedRows.reduce((s, r) => s + r.amount, 0), [receivedRows]);
  const totalOutstanding = useMemo(() => outstandingRows.reduce((s, r) => s + r.balanceDue, 0), [outstandingRows]);

  const receivedByMonth = useMemo(() => {
    const map = new Map<string, ReceivedRow[]>();
    for (const r of receivedRows) {
      const k = monthKey(r.paidDate);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [receivedRows]);

  const thisMonthReceived = useMemo(() => {
    const now = new Date();
    const k = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    return receivedRows.filter((r) => monthKey(r.paidDate) === k).reduce((s, r) => s + r.amount, 0);
  }, [receivedRows]);

  const overdue30 = useMemo(
    () => outstandingRows.filter((r) => r.daysOverdue > 30).reduce((s, r) => s + r.balanceDue, 0),
    [outstandingRows],
  );

  const csvRows = useMemo(() => {
    if (tab === "received") {
      return receivedRows.map((r) => ({
        dealId: r.dealId,
        name: r.dealName,
        location: r.pbLocation,
        type: r.isPE ? "PE" : "STD",
        milestone: MILESTONE_LABEL[r.milestone],
        amount: r.amount,
        paidDate: r.paidDate,
        invoiceNumber: r.invoiceNumber ?? "",
      }));
    }
    return outstandingRows.map((r) => ({
      dealId: r.dealId,
      name: r.dealName,
      location: r.pbLocation,
      type: r.isPE ? "PE" : "STD",
      milestone: MILESTONE_LABEL[r.milestone],
      balanceDue: r.balanceDue,
      amountBilled: r.amountBilled,
      invoiceDate: r.invoiceDate ?? "",
      dueDate: r.dueDate ?? "",
      daysOverdue: r.daysOverdue,
      invoiceNumber: r.invoiceNumber ?? "",
    }));
  }, [tab, receivedRows, outstandingRows]);

  return (
    <DashboardShell
      title="Payment Timeline"
      subtitle="Received and outstanding payments by date"
      accentColor="emerald"
      lastUpdated={data?.lastUpdated}
      exportData={{ data: csvRows, filename: `payment-timeline-${tab}.csv` }}
      fullWidth
    >
      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard
          label="Total Received"
          value={fmtMoney(totalReceived)}
          subtitle={`${receivedRows.length} payments`}
          color="emerald"
        />
        <StatCard
          label="This Month"
          value={fmtMoney(thisMonthReceived)}
          subtitle="received"
          color="green"
        />
        <StatCard
          label="Outstanding"
          value={fmtMoney(totalOutstanding)}
          subtitle={`${outstandingRows.length} invoices`}
          color="amber"
        />
        <StatCard
          label="Overdue 30+ Days"
          value={fmtMoney(overdue30)}
          subtitle={`${outstandingRows.filter((r) => r.daysOverdue > 30).length} invoices`}
          color="red"
        />
      </div>

      {/* Filters */}
      <div className="bg-surface border border-t-border rounded-lg p-3 mb-4 flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-1 text-xs">
          {(["received", "outstanding"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                tab === t
                  ? t === "received"
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                    : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                  : "bg-surface-2 text-muted hover:text-foreground border border-transparent"
              }`}
            >
              {t === "received" ? "Received" : "Outstanding"}
            </button>
          ))}
        </div>
        <div className="w-px h-5 bg-t-border" />
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
        <input
          type="text"
          placeholder="Search deal / ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[160px] px-3 py-1.5 rounded bg-surface-2 border border-t-border text-xs"
        />
      </div>

      {/* Tab Content */}
      {tab === "received" ? (
        <ReceivedTab rows={receivedRows} byMonth={receivedByMonth} />
      ) : (
        <OutstandingTab rows={outstandingRows} />
      )}
    </DashboardShell>
  );
}

function ReceivedTab({
  rows,
  byMonth,
}: {
  rows: ReceivedRow[];
  byMonth: [string, ReceivedRow[]][];
}) {
  if (rows.length === 0) {
    return (
      <div className="text-center text-muted py-12">
        No received payments match the current filters.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {byMonth.map(([key, monthRows]) => {
        const monthTotal = monthRows.reduce((s, r) => s + r.amount, 0);
        return (
          <section key={key}>
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-sm font-semibold text-emerald-300">
                {monthLabel(key)}
              </h2>
              <span className="text-xs text-muted">
                {monthRows.length} payments · {fmtMoney(monthTotal)}
              </span>
            </div>
            <div className="bg-surface border border-t-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-muted text-[11px] uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Deal</th>
                    <th className="px-3 py-2 text-left font-medium">Milestone</th>
                    <th className="px-3 py-2 text-left font-medium">Invoice #</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                    <th className="px-3 py-2 text-right font-medium">Paid Date</th>
                    <th className="px-3 py-2 text-center font-medium">HubSpot</th>
                  </tr>
                </thead>
                <tbody>
                  {monthRows.map((r) => (
                    <tr
                      key={`${r.dealId}-${r.milestone}`}
                      className="border-t border-t-border hover:bg-surface-2"
                    >
                      <td className="px-3 py-2 text-foreground">
                        <div className="font-medium">{r.dealName}</div>
                        <div className="text-muted text-[11px]">
                          {r.pbLocation} · {r.isPE ? "PE" : "STD"}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-muted">{MILESTONE_LABEL[r.milestone]}</td>
                      <td className="px-3 py-2 text-muted">{r.invoiceNumber ?? "—"}</td>
                      <td className="px-3 py-2 text-right text-emerald-300 font-medium">
                        {fmtMoney(r.amount)}
                      </td>
                      <td className="px-3 py-2 text-right text-foreground">{fmtDate(r.paidDate)}</td>
                      <td className="px-3 py-2 text-center">
                        <a
                          href={r.hubspotUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-emerald-400 hover:text-emerald-300"
                        >
                          Deal →
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
    </div>
  );
}

function OutstandingTab({ rows }: { rows: OutstandingRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="text-center text-muted py-12">
        No outstanding invoices — everything has been paid.
      </div>
    );
  }

  return (
    <div className="bg-surface border border-t-border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-muted text-[11px] uppercase">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Deal</th>
            <th className="px-3 py-2 text-left font-medium">Milestone</th>
            <th className="px-3 py-2 text-left font-medium">Invoice #</th>
            <th className="px-3 py-2 text-right font-medium">Billed</th>
            <th className="px-3 py-2 text-right font-medium">Balance Due</th>
            <th className="px-3 py-2 text-right font-medium">Due Date</th>
            <th className="px-3 py-2 text-right font-medium">Days Overdue</th>
            <th className="px-3 py-2 text-center font-medium">HubSpot</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={`${r.dealId}-${r.milestone}`}
              className="border-t border-t-border hover:bg-surface-2"
            >
              <td className="px-3 py-2 text-foreground">
                <div className="font-medium">{r.dealName}</div>
                <div className="text-muted text-[11px]">
                  {r.pbLocation} · {r.isPE ? "PE" : "STD"}
                </div>
              </td>
              <td className="px-3 py-2 text-muted">{MILESTONE_LABEL[r.milestone]}</td>
              <td className="px-3 py-2 text-muted">{r.invoiceNumber ?? "—"}</td>
              <td className="px-3 py-2 text-right text-foreground">
                {fmtMoney(r.amountBilled)}
              </td>
              <td className="px-3 py-2 text-right text-amber-300 font-medium">
                {fmtMoney(r.balanceDue)}
              </td>
              <td className="px-3 py-2 text-right text-foreground">{fmtDate(r.dueDate)}</td>
              <td className="px-3 py-2 text-right">
                <span
                  className={
                    r.daysOverdue > 60
                      ? "text-red-400 font-medium"
                      : r.daysOverdue > 30
                        ? "text-amber-400"
                        : "text-foreground"
                  }
                >
                  {r.daysOverdue > 0 ? r.daysOverdue : "—"}
                </span>
              </td>
              <td className="px-3 py-2 text-center">
                <a
                  href={r.invoiceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-amber-400 hover:text-amber-300"
                >
                  Invoice →
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
