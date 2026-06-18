"use client";

import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { queryKeys } from "@/lib/query-keys";

// ---------------------------------------------------------------------------
// Milestone-first PE payments view.
//
// Every deal has TWO milestone payments: IC (20% of EPC) and PC (10%). Both are
// always present, so the totals reflect full expected PE revenue, and nothing is
// hidden just because a milestone hasn't gone "active" yet.
//
// Within IC and PC, payments are grouped into a single mutually-exclusive
// pipeline: by construction STAGE while the milestone isn't active yet
// (Pre Construction -> In Construction -> Waiting on Inspection -> [PC only:
// Waiting on PTO]), then by that milestone's own STATUS once it's active
// (Waiting -> Ready -> Action Required -> Under Review -> Approved -> Paid).
//
// IC goes active at the PTO stage (M1 status); PC goes active at Close Out
// (M2 status). Zero-count subgroups auto-hide, so IC omits "Waiting on PTO".
// ---------------------------------------------------------------------------

interface PeDeal {
  dealId: string;
  dealName: string;
  pbLocation: string;
  dealStageLabel: string;
  pePaymentIC: number | null;
  pePaymentPC: number | null;
  peM1Status: string | null;
  peM2Status: string | null;
  hubspotUrl: string;
  pePortalUrl: string | null;
  peProjectId: string | null;
}

type MilestoneTab = "all" | "ic" | "pc";

const MILESTONE_TABS: { key: MilestoneTab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "ic", label: "IC" },
  { key: "pc", label: "PC" },
];

type SubGroup =
  | "preconstruction"
  | "construction"
  | "inspection"
  | "waiting_pto"
  | "waiting"
  | "ready"
  | "action"
  | "review"
  | "approved"
  | "paid"
  | "other";

const PHASE_ACCENT = "text-sky-300 border-sky-500/40 bg-sky-500/10";

// Ordered pipeline: construction phases first, then status buckets.
const SUBGROUPS: { key: SubGroup; label: string; accent: string }[] = [
  { key: "preconstruction", label: "Pre Construction", accent: PHASE_ACCENT },
  { key: "construction", label: "In Construction", accent: PHASE_ACCENT },
  { key: "inspection", label: "Waiting on Inspection", accent: PHASE_ACCENT },
  { key: "waiting_pto", label: "Waiting on PTO", accent: PHASE_ACCENT },
  { key: "waiting", label: "Waiting", accent: "text-zinc-300 border-zinc-500/40 bg-zinc-500/10" },
  { key: "ready", label: "Ready to Submit", accent: "text-cyan-300 border-cyan-500/40 bg-cyan-500/10" },
  { key: "action", label: "Action Required", accent: "text-orange-300 border-orange-500/40 bg-orange-500/10" },
  { key: "review", label: "Under Review", accent: "text-blue-300 border-blue-500/40 bg-blue-500/10" },
  { key: "approved", label: "Approved", accent: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10" },
  { key: "paid", label: "Paid", accent: "text-green-300 border-green-500/40 bg-green-500/10" },
  { key: "other", label: "Other", accent: "text-zinc-400 border-zinc-600/40 bg-zinc-600/10" },
];
const SUBGROUP_LABEL = new Map(SUBGROUPS.map((s) => [s.key, s.label]));

// pe_m1_status / pe_m2_status raw value -> status subgroup
function statusBucket(status: string | null | undefined): SubGroup {
  switch ((status ?? "").trim()) {
    case "Waiting on Information":
    case "Waiting on Customer Payment":
    case "Waiting on Safe Harbor":
    case "Waiting on RBC":
      return "waiting";
    case "Ready to Submit":
    case "Ready for Onboarding":
      return "ready";
    case "Rejected":
    case "Ready to Resubmit":
    case "Onboarding Rejected":
    case "Onboarding Ready to Resubmit":
    case "Internally Rejected":
      return "action";
    case "Submitted":
    case "Resubmitted":
    case "Onboarding Submitted":
    case "Onboarding Resubmitted":
      return "review";
    case "Approved":
      return "approved";
    case "Paid":
      return "paid";
    default:
      return "other";
  }
}

type Phase = "preconstruction" | "construction" | "inspection" | "ic" | "pc";
function stageToPhase(stageLabel: string): Phase {
  const s = (stageLabel ?? "").toLowerCase();
  if (s.includes("complete") || s.includes("close out")) return "pc";
  if (s.includes("permission to operate") || s.includes("pto")) return "ic";
  if (s.includes("inspection")) return "inspection";
  if (s.includes("construction")) return "construction";
  return "preconstruction";
}

type Milestone = "IC" | "PC";

interface PaymentRow {
  deal: PeDeal;
  milestone: Milestone;
  status: string | null;
  amount: number;
}

// Every deal has both an IC and a PC milestone payment.
function paymentRows(deal: PeDeal): PaymentRow[] {
  return [
    { deal, milestone: "IC", status: deal.peM1Status, amount: deal.pePaymentIC ?? 0 },
    { deal, milestone: "PC", status: deal.peM2Status, amount: deal.pePaymentPC ?? 0 },
  ];
}

// A payment's subgroup: construction stage until the milestone is active, then
// that milestone's own status. IC activates at PTO; PC activates at Close Out
// (PTO-stage PC sits in "Waiting on PTO").
function subgroupFor(row: PaymentRow): SubGroup {
  const phase = stageToPhase(row.deal.dealStageLabel);
  if (phase === "preconstruction" || phase === "construction" || phase === "inspection") {
    return phase;
  }
  if (row.milestone === "IC") return statusBucket(row.status); // PTO+ -> M1 status
  if (phase === "ic") return "waiting_pto"; // PC at PTO stage, not started yet
  return statusBucket(row.status); // PC at Close Out+ -> M2 status
}

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

type SortCol = "project" | "customer" | "milestone" | "stage" | "status" | "amount";

const COLUMNS: { key: SortCol | "links"; label: string; right?: boolean; sortable?: boolean }[] = [
  { key: "project", label: "Project", sortable: true },
  { key: "customer", label: "Customer", sortable: true },
  { key: "milestone", label: "Milestone", sortable: true },
  { key: "stage", label: "Stage", sortable: true },
  { key: "status", label: "Status", sortable: true },
  { key: "amount", label: "Amount", right: true, sortable: true },
  { key: "links", label: "Links" },
];

export default function MilestonesTab({ tabsSlot }: { tabsSlot?: React.ReactNode }) {
  const [milestone, setMilestone] = useState<MilestoneTab>("all");
  // Empty set = show all. Bubbles are multi-select; the "All" bubble clears.
  const [subs, setSubs] = useState<Set<SubGroup>>(new Set());
  const [sort, setSort] = useState<{ col: SortCol; dir: "asc" | "desc" }>({
    col: "amount",
    dir: "desc",
  });

  const toggleSub = (key: SubGroup) =>
    setSubs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleSort = (col: SortCol) =>
    setSort((s) =>
      s.col === col
        ? { col, dir: s.dir === "asc" ? "desc" : "asc" }
        : { col, dir: col === "amount" ? "desc" : "asc" },
    );

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.peDeals.list(),
    queryFn: async () => {
      const res = await fetch("/api/accounting/pe-deals");
      if (!res.ok) throw new Error("Failed to load PE deals");
      return (await res.json()) as { deals: PeDeal[]; lastUpdated?: string };
    },
    staleTime: 60_000,
  });

  const deals = useMemo(() => data?.deals ?? [], [data]);

  // Payment rows for the selected milestone tab, each tagged with its subgroup.
  const scoped = useMemo(() => {
    const rows = deals.flatMap(paymentRows);
    const filtered =
      milestone === "all"
        ? rows
        : rows.filter((r) => r.milestone === (milestone === "ic" ? "IC" : "PC"));
    return filtered.map((r) => ({ ...r, sub: subgroupFor(r) }));
  }, [deals, milestone]);

  const subTotals = useMemo(() => {
    const m = new Map<SubGroup, { count: number; amount: number }>();
    for (const s of SUBGROUPS) m.set(s.key, { count: 0, amount: 0 });
    for (const row of scoped) {
      const t = m.get(row.sub)!;
      t.count += 1;
      t.amount += row.amount;
    }
    return m;
  }, [scoped]);

  const totalCount = scoped.length;
  const totalAmount = useMemo(() => scoped.reduce((s, r) => s + r.amount, 0), [scoped]);

  const visibleRows = useMemo(() => {
    const rows = subs.size === 0 ? scoped : scoped.filter((r) => subs.has(r.sub));
    const mul = sort.dir === "asc" ? 1 : -1;
    const val = (r: (typeof rows)[number]): string | number => {
      switch (sort.col) {
        case "amount":
          return r.amount;
        case "project":
          return r.deal.peProjectId ?? "";
        case "customer":
          return r.deal.dealName ?? "";
        case "milestone":
          return r.milestone;
        case "stage":
          return r.deal.dealStageLabel ?? "";
        case "status":
          return r.status ?? "";
      }
    };
    return [...rows].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * mul;
      return String(av).localeCompare(String(bv)) * mul;
    });
  }, [scoped, subs, sort]);

  const exportData = useMemo(
    () => ({
      filename: `pe-${milestone}-${subs.size ? [...subs].join("+") : "all"}.csv`,
      data: visibleRows.map((r) => ({
        project: r.deal.peProjectId ?? "",
        customer: r.deal.dealName,
        milestone: r.milestone,
        subgroup: SUBGROUP_LABEL.get(r.sub) ?? r.sub,
        stage: r.deal.dealStageLabel,
        status: r.status ?? "",
        amount: Math.round(r.amount),
        hubspot: r.deal.hubspotUrl,
        pePortal: r.deal.pePortalUrl ?? "",
      })),
    }),
    [visibleRows, milestone, subs],
  );

  if (error) {
    return (
      <DashboardShell title="PE Milestone Payments" accentColor="emerald">
        {tabsSlot}
        <div className="text-red-400 text-sm">Failed to load: {(error as Error).message}</div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell
      title="PE Milestone Payments"
      accentColor="emerald"
      lastUpdated={data?.lastUpdated}
      exportData={exportData}
    >
      {tabsSlot}

      {/* Milestone top tabs */}
      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        {MILESTONE_TABS.map((t) => {
          const active = milestone === t.key;
          return (
            <button
              key={t.key}
              onClick={() => {
                setMilestone(t.key);
                setSubs(new Set());
              }}
              className={`text-sm px-3.5 py-1.5 rounded-lg border transition-colors ${
                active
                  ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                  : "border-t-border text-muted hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          );
        })}
        <span className="ml-2 text-xs text-muted">
          {milestone === "ic" &&
            "Every deal's IC payment — pre-PTO by construction stage, PTO+ by IC status"}
          {milestone === "pc" &&
            "Every deal's PC payment — pre-Close-Out by stage, Close Out+ by PC status"}
          {milestone === "all" && "Every deal's IC + PC payment — full expected PE revenue"}
        </span>
      </div>

      {/* Subgroup cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 mb-5">
        <button
          onClick={() => setSubs(new Set())}
          className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
            subs.size === 0
              ? "border-emerald-500/50 bg-emerald-500/10"
              : "border-t-border bg-surface hover:bg-surface-2"
          }`}
        >
          <div className="text-xs text-muted">All</div>
          <div className="text-lg font-semibold text-foreground">{totalCount}</div>
          <div className="text-xs text-muted">{usd(totalAmount)}</div>
        </button>
        {SUBGROUPS.map((s) => {
          const t = subTotals.get(s.key)!;
          if (t.count === 0) return null;
          const active = subs.has(s.key);
          return (
            <button
              key={s.key}
              onClick={() => toggleSub(s.key)}
              className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                active ? s.accent : "border-t-border bg-surface hover:bg-surface-2"
              }`}
            >
              <div className="text-xs text-muted">{s.label}</div>
              <div className="text-lg font-semibold text-foreground">{t.count}</div>
              <div className="text-xs text-muted">{usd(t.amount)}</div>
            </button>
          );
        })}
      </div>

      {/* Payment table */}
      <div className="rounded-xl border border-t-border bg-surface overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-muted text-xs uppercase tracking-wide">
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  className={`font-medium px-3 py-2 ${c.right ? "text-right" : "text-left"}`}
                >
                  {c.sortable ? (
                    <button
                      onClick={() => toggleSort(c.key as SortCol)}
                      className="inline-flex items-center gap-1 hover:text-foreground"
                    >
                      {c.label}
                      <span className="text-[10px] w-2">
                        {sort.col === c.key ? (sort.dir === "asc" ? "▲" : "▼") : ""}
                      </span>
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted">
                  Loading…
                </td>
              </tr>
            )}
            {!isLoading && visibleRows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted">
                  No payments in this group.
                </td>
              </tr>
            )}
            {visibleRows.map((r) => (
              <tr
                key={`${r.deal.dealId}-${r.milestone}`}
                className="border-t border-t-border hover:bg-surface-2"
              >
                <td className="px-3 py-2 font-mono text-xs text-foreground">
                  {r.deal.peProjectId ?? "—"}
                </td>
                <td className="px-3 py-2 text-foreground">{r.deal.dealName}</td>
                <td className="px-3 py-2">
                  <span className="text-xs font-medium px-1.5 py-0.5 rounded border border-t-border text-muted">
                    {r.milestone}
                  </span>
                </td>
                <td className="px-3 py-2 text-muted">{r.deal.dealStageLabel}</td>
                <td className="px-3 py-2 text-muted">{r.status ?? "—"}</td>
                <td className="px-3 py-2 text-right text-foreground tabular-nums">{usd(r.amount)}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2 text-xs">
                    <a
                      href={r.deal.hubspotUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-orange-400 hover:underline"
                    >
                      HubSpot
                    </a>
                    {r.deal.pePortalUrl && (
                      <a
                        href={r.deal.pePortalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-emerald-400 hover:underline"
                      >
                        PE
                      </a>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DashboardShell>
  );
}
