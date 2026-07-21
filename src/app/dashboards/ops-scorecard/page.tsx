"use client";

import { useEffect, useRef, useState } from "react";
import DashboardShell from "@/components/DashboardShell";
import { StatCard, MiniStat } from "@/components/ui/MetricCard";
import { formatCurrencyCompact } from "@/lib/format";
import { useProjectData } from "@/hooks/useProjectData";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import type { OpsScorecardData } from "@/lib/ops-scorecard";

/**
 * Operations Scorecard — living version of the 7/17–7/18 analysis package
 * built for Matt. All computation is server-side (/api/ops-scorecard);
 * this page only renders. Conventions (gross vs net, cancellation cohorts,
 * time-metric exclusions) are documented in the method footnote and in
 * docs/superpowers/specs/2026-07-18-ops-scorecard-dashboard-design.md.
 */

type CountRevT = { count: number; revenue: number; grossRevenue: number };

const $ = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : formatCurrencyCompact(n);
const pct = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `${n.toFixed(1)}%`;
const days = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n.toFixed(1);
const num = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n.toLocaleString();

/** Green when the year-over-year move is an improvement, red when a setback. */
const trend = (
  cur: number | null | undefined,
  prev: number | null | undefined,
  better: "higher" | "lower"
) => {
  if (cur == null || prev == null || cur === prev) return "";
  const good = better === "higher" ? cur > prev : cur < prev;
  return good ? " text-emerald-400" : " text-red-400";
};

function Arrow3({
  a, b, c, av, bv, cv, better, compareLast = true,
}: {
  a: string; b: string; c: string;
  /** Numeric values behind a/b/c — enables improvement/setback coloring. */
  av?: number | null; bv?: number | null; cv?: number | null;
  better?: "higher" | "lower";
  /** Set false when c isn't like-for-like with b (e.g. YTD vs full year). */
  compareLast?: boolean;
}) {
  // Trend color must REPLACE the base color, not stack with it — Tailwind emits
  // color utilities alphabetically, so text-emerald-400 loses to text-foreground
  // while text-red-400 beats it (greens silently never rendered).
  const bClass = (better ? trend(bv, av, better) : "").trim();
  const cClass = (better && compareLast ? trend(cv, bv, better) : "").trim();
  return (
    <span className="whitespace-nowrap">
      <span className="text-muted">{a}</span>
      <span className="text-muted mx-0.5">→</span>
      <span className={bClass || "text-muted"}>{b}</span>
      <span className="text-muted mx-0.5">→</span>
      <span className={"font-semibold " + (cClass || "text-foreground")}>{c}</span>
    </span>
  );
}

/** Collapsible per-section methodology note. Items render as "term — definition". */
function Explain({ items }: { items: Array<[string, string]> }) {
  return (
    <details className="mt-3 text-xs text-muted">
      <summary className="cursor-pointer select-none hover:text-foreground transition-colors">
        How these numbers are calculated
      </summary>
      <ul className="mt-2 space-y-1.5 pl-4 list-disc leading-relaxed">
        {items.map(([term, def]) => (
          <li key={term}>
            <span className="font-semibold text-foreground/80">{term}</span> — {def}
          </li>
        ))}
      </ul>
    </details>
  );
}

function SectionCard({ title, sub, actions, explain, children }: { title: string; sub?: string; actions?: React.ReactNode; explain?: Array<[string, string]>; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        {actions}
      </div>
      {sub && <p className="text-sm text-muted mb-3">{sub}</p>}
      <div className="bg-surface border border-t-border rounded-xl shadow-card p-4 overflow-x-auto">
        {children}
        {explain && <Explain items={explain} />}
      </div>
    </section>
  );
}

function GoalPlanner({ data }: { data: OpsScorecardData }) {
  const { goalModel, capacity } = data;
  const [targetM, setTargetM] = useState<number>(
    () => Math.round(((capacity.sustainSalesPerMo ?? 3_000_000) / 1_000_000) * 10) / 10
  );
  const S = targetM * 1_000_000;
  const daConv = (goalModel.daConversionPct ?? 0) / 100;
  const ccConv = (goalModel.ccConversionPct ?? 0) / 100;
  const fmt = (n: number) => formatCurrencyCompact(n);
  const cnt = (rev: number) =>
    goalModel.avgNetDeal ? Math.round(rev / goalModel.avgNetDeal) : null;

  const months: string[] = [];
  const nowD = new Date();
  for (let k = 1; k <= 6; k++) {
    const d = new Date(Date.UTC(nowD.getUTCFullYear(), nowD.getUTCMonth() + k, 1));
    months.push(d.toLocaleString("en-US", { month: "short", timeZone: "UTC" }));
  }
  const cover = capacity.coverMonths ?? 0;
  const burn = capacity.burnPerMo ?? 0;
  const daPace = goalModel.daPacePerMo ?? 0;
  const rows = months.map((label, i) => {
    const k = i + 1;
    const daNew = S * daConv * (goalModel.daMonthlyCdf[k - 1] ?? 1);
    const daExisting = daPace * Math.max(0, Math.min(1, 1 - (k - 1) / 2));
    const ccNew = S * ccConv * (goalModel.ccMonthlyCdf[k - 1] ?? 1);
    const ccBacklog = burn * Math.max(0, Math.min(1, cover - (k - 1)));
    return { label, da: daNew + daExisting, ccNew, ccBacklog, cc: ccNew + ccBacklog };
  });

  const presets: Array<[string, number | null]> = [
    ["Current pace", capacity.grossSalesPacePerMo],
    ["Sustain", capacity.sustainSalesPerMo],
    ["$3.5M", 3_500_000],
  ];

  return (
    <SectionCard
      title="Goal planner — what a sales pace produces downstream"
      sub={`Set a TOTAL signed-sales target (all deals, including ones that will later cancel) and see the expected DA and CC flow. The conversion rates (DA ${pct(goalModel.daConversionPct)}, CC ${pct(goalModel.ccConversionPct)}) already discount cancellations — entering a net figure would subtract them twice.`}
      explain={[
        ["Why total, not net", "conversion is measured as CC dollars ÷ ALL sold dollars (81% — cancels already baked in). Survivors complete at ~99%, so if you think in net-mature terms, a net target × ~0.99 gives the same CC answer. Enter what the team signs, and the model handles the leak."],
        ["Expected DAs", "target × DA conversion × share of deals that historically reach DA within k months of sale, plus today's sold-but-not-yet-DA'd pipeline fading out over ~2 months."],
        ["CCs from new sales", "target × CC conversion × the sale → CC arrival curve — new sales barely contribute for ~2 months, then ramp to steady state (~month 4–5)."],
        ["CCs from today's backlog", `the current $${((capacity.backlogRev) / 1e6).toFixed(1)}M backlog keeps completing at the current burn rate for ~${capacity.coverMonths ?? "—"} months of cover, then is spent.`],
        ["Counts", "revenue ÷ trailing average net deal size."],
        ["Steady state", "once the ramp completes, DAs/mo ≈ target × DA conversion and CCs/mo ≈ target × CC conversion. Selling below sustain means the total CC line sags once the backlog is spent — exactly what the capacity section warns about."],
      ]}
    >
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <label className="text-sm text-muted">Total sales target (signed):</label>
        <div className="flex items-center gap-1">
          <span className="text-sm text-muted">$</span>
          <input
            type="number"
            min={0.5}
            max={10}
            step={0.1}
            value={targetM}
            onChange={(e) => setTargetM(parseFloat(e.target.value) || 0)}
            className="w-20 bg-surface-2 border border-t-border rounded-lg px-2 py-1.5 text-sm text-foreground text-right"
          />
          <span className="text-sm text-muted">M / month</span>
        </div>
        {presets.map(([label, v]) =>
          v ? (
            <button
              key={label}
              onClick={() => setTargetM(Math.round((v / 1_000_000) * 10) / 10)}
              className="px-3 py-1.5 rounded-lg text-xs border border-t-border text-muted hover:text-foreground transition-colors"
            >
              {label} ({fmt(v)})
            </button>
          ) : null
        )}
        <span className="text-xs text-muted ml-auto">
          steady state: ~{fmt(S * daConv)}/mo DAs · ~{fmt(S * ccConv)}/mo CCs ({cnt(S * ccConv) ?? "—"} installs)
        </span>
      </div>
      <table className="w-full min-w-[720px]">
        <thead>
          <tr>
            <th className={th}>Expected flow</th>
            {rows.map((r) => (
              <th key={r.label} className={thR}>{r.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className={td}>Total sales signed (target)</td>
            {rows.map((r) => (
              <td key={r.label} className={tdR}>{fmt(S)}</td>
            ))}
          </tr>
          <tr>
            <td className={td}>DAs expected</td>
            {rows.map((r) => (
              <td key={r.label} className={tdR}>{cnt(r.da) ?? "—"} · {fmt(r.da)}</td>
            ))}
          </tr>
          <tr>
            <td className={td + " text-muted"}>CCs — from new sales</td>
            {rows.map((r) => (
              <td key={r.label} className={tdR + " text-muted"}>{fmt(r.ccNew)}</td>
            ))}
          </tr>
          <tr>
            <td className={td + " text-muted"}>CCs — from today&apos;s backlog</td>
            {rows.map((r) => (
              <td key={r.label} className={tdR + " text-muted"}>{fmt(r.ccBacklog)}</td>
            ))}
          </tr>
          <tr className="font-semibold">
            <td className={td}>CCs total</td>
            {rows.map((r) => (
              <td key={r.label} className={tdR}>{cnt(r.cc) ?? "—"} · {fmt(r.cc)}</td>
            ))}
          </tr>
        </tbody>
      </table>
    </SectionCard>
  );
}

const th = "text-left text-[11px] uppercase tracking-wide text-muted font-semibold pb-2 pr-4 whitespace-nowrap";
const thR = th + " text-right";
const td = "py-1.5 pr-4 text-sm whitespace-nowrap border-t border-t-border/50";
const tdR = td + " text-right tabular-nums";

export default function OpsScorecardPage() {
  const { trackDashboardView } = useActivityTracking();
  const tracked = useRef(false);
  /** "fy" compares full prior years; "samePoint" compares prior years through today's month-day. */
  const [yearView, setYearView] = useState<"fy" | "samePoint">("fy");
  /** Turnaround table format — one stat at a time keeps the rows readable. */
  const [turnStat, setTurnStat] = useState<"median" | "mean">("median");

  const { data, loading, error, lastUpdated, refetch } = useProjectData<OpsScorecardData>({
    endpoint: "/api/ops-scorecard",
    pollInterval: 15 * 60 * 1000,
    transform: (raw: unknown) => (raw as { scorecard: OpsScorecardData }).scorecard,
  });

  useEffect(() => {
    if (!loading && data && !tracked.current) {
      tracked.current = true;
      trackDashboardView("ops-scorecard", { projectCount: data.meta.projectCount });
    }
  }, [loading, data, trackDashboardView]);

  if (error) {
    return (
      <DashboardShell title="Operations Scorecard" accentColor="orange">
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 text-center">
          <p className="text-red-400 font-medium">{error}</p>
          <button
            onClick={() => refetch()}
            className="mt-3 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 rounded-lg text-red-300 text-sm transition-colors"
          >
            Retry
          </button>
        </div>
      </DashboardShell>
    );
  }

  if (loading || !data) {
    return (
      <DashboardShell title="Operations Scorecard" accentColor="orange">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-28 bg-surface rounded-xl animate-pulse" />
          ))}
        </div>
      </DashboardShell>
    );
  }

  const { meta, capacity, runRateByOffice, throughputByOffice, cancellations, funnelFy, efficiency } = data;
  const { cy, py, py2 } = meta;

  return (
    <DashboardShell
      title="Operations Scorecard"
      accentColor="orange"
      lastUpdated={lastUpdated}
      fullWidth
    >
      {/* ---- Hero ---- */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8 stagger-grid">
        <StatCard
          label={`Projected full-year ${cy} CC revenue`}
          value={`${$(capacity.projectedFyCcLow)}–${$(capacity.projectedFyCcHigh)}`}
          subtitle={`${$(capacity.ytdCcRev)} completed YTD + backlog + in-year sales`}
          color="orange"
        />
        <StatCard
          label="Net sales needed to sustain CC pace"
          value={`${$(capacity.sustainSalesPerMo)}/mo`}
          subtitle={`selling ${$(capacity.netSalesPacePerMo)}/mo net (${$(capacity.grossSalesPacePerMo)} total) · burning ${$(capacity.burnPerMo)}/mo (${meta.l3mLabel})`}
          color="red"
        />
        <StatCard
          label="Live backlog (no CC yet)"
          value={$(capacity.backlogRev)}
          subtitle={`${capacity.backlogCount} deals · ~${days(capacity.coverMonths)} months cover · conv ${pct(capacity.conversionPct)} (median ${days(capacity.convMedianDays)}d)`}
          color="orange"
        />
      </div>
      <div className="-mt-6 mb-8 px-1">
        <Explain
          items={[
            ["Projected CC revenue", `${cy} completed so far + 80–90% of the live backlog converting + sales still to close that can complete in-year (net sales pace × months before October × conversion rate). A range because backlog conversion isn't certain.`],
            ["Sustain rate", "current CC burn ÷ conversion rate — the net sales/month needed to keep completions flat, because only ~81% of sold dollars ever reach CC. Selling below it means today's completion pace is borrowed from the backlog."],
            ["Live backlog", "open deals between sale and construction-complete. Cover = backlog ÷ burn: how long completions can hold with zero new sales. Conversion and its median days come from the fully-baked cohort sold Jan–Sep last year."],
          ]}
        />
      </div>

      {/* ---- Consult-driven sales forecast ---- */}
      {data.salesForecast && (
        <SectionCard
          title="Sales forecast from consults"
          sub="A leading indicator: consults already held predict the sales that follow them."
          explain={[
            ["Median lag", "days from a deal's first consult meeting to its close date, median over deals sold in the last 12 months (stamped on every deal as first_consult_date). Half of buyers sign within ~2 weeks."],
            ["Close rate", "deals sold in the last 90 days ÷ consults held in the 90-day window ending [lag] days ago — so consults are compared against the sales they had time to become."],
            ["Predicted sales", "consults held in the last 30 days × close rate. These consults' sales land over the next ~30 days (offset by the lag)."],
            ["Predicted net revenue", "predicted sales × average net deal size over the last 90 days."],
            ["What it can miss", "the ~20% of sales that close 60+ days after their consult (the nurture tail), and consults on a spouse's contact record."],
          ]}
        >
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-center">
            <div>
              <div className="text-2xl font-semibold text-orange-400">~{num(data.salesForecast.predictedCount30)}</div>
              <div className="text-xs text-muted mt-1">predicted sales, next ~30 days</div>
            </div>
            <div>
              <div className="text-2xl font-semibold text-orange-400">{$(data.salesForecast.predictedRev30)}</div>
              <div className="text-xs text-muted mt-1">predicted net revenue</div>
            </div>
            <div>
              <div className="text-2xl font-semibold text-foreground">{num(data.salesForecast.consultsLast30)}</div>
              <div className="text-xs text-muted mt-1">consults, last 30 days</div>
            </div>
            <div>
              <div className="text-2xl font-semibold text-foreground">{pct(data.salesForecast.closeRatePct)}</div>
              <div className="text-xs text-muted mt-1">consult → sale close rate</div>
            </div>
            <div>
              <div className="text-2xl font-semibold text-foreground">{data.salesForecast.lagDays}d</div>
              <div className="text-xs text-muted mt-1">median consult → sale (avg deal {$(data.salesForecast.avgNetDeal)})</div>
            </div>
          </div>
        </SectionCard>
      )}

      {/* ---- Sales / DA / CC by month ---- */}
      <SectionCard
        title={`${cy} sales, DAs, and CCs by month`}
        sub="Sales closed (net revenue, with total incl. later-cancelled below), design approvals (net revenue), and construction completes (all deals) reached each month."
        explain={[
          ["Sales (net)", "deals with a close date in the month; count includes every deal, revenue excludes deals now Cancelled / Rejected / On-Hold. The small 'total' line is all sold dollars — the gap between the two lines is revenue that has since fallen out."],
          ["DAs (net)", "deals whose design approval date lands in the month; revenue is net."],
          ["CCs", "deals whose construction complete date lands in the month; a completed install counts even if the deal later cancelled, so no net/total split is shown."],
        ]}
      >
        <table className="w-full min-w-[560px]">
          <thead>
            <tr>
              <th className={th}>Month</th>
              {data.salesByMonth.map((m) => (
                <th key={m.month} className={thR}>{m.month.slice(5)}</th>
              ))}
              <th className={thR}>Total YTD</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={td}>Sales (net)</td>
              {data.salesByMonth.map((m) => (
                <td key={m.month} className={tdR}>
                  <div>{m.count} · {$(m.revenue)}</div>
                  <div className="text-[11px] text-muted">{$(m.grossRevenue)} total</div>
                </td>
              ))}
              <td className={tdR + " font-semibold"}>
                <div>{data.salesByMonth.reduce((a, m) => a + m.count, 0)} · {$(data.salesByMonth.reduce((a, m) => a + m.revenue, 0))}</div>
                <div className="text-[11px] text-muted font-normal">{$(data.salesByMonth.reduce((a, m) => a + m.grossRevenue, 0))} total</div>
              </td>
            </tr>
            <tr>
              <td className={td}>DAs (net)</td>
              {data.daByMonth.map((m) => (
                <td key={m.month} className={tdR}>{m.count} · {$(m.revenue)}</td>
              ))}
              <td className={tdR + " font-semibold"}>{data.daByMonth.reduce((a, m) => a + m.count, 0)} · {$(data.daByMonth.reduce((a, m) => a + m.revenue, 0))}</td>
            </tr>
            <tr>
              <td className={td}>CCs</td>
              {data.ccByMonth.map((m) => (
                <td key={m.month} className={tdR}>{m.count} · {$(m.revenue)}</td>
              ))}
              <td className={tdR + " font-semibold"}>{data.ccByMonth.reduce((a, m) => a + m.count, 0)} · {$(data.ccByMonth.reduce((a, m) => a + m.revenue, 0))}</td>
            </tr>
          </tbody>
        </table>
      </SectionCard>

      {/* ---- Capacity by office ---- */}
      <SectionCard
        title="CC capacity by office"
        sub="Can each office keep completing at its current pace? Fuel (backlog) ÷ burn = how long, and sustain vs selling = whether sales refill it."
        explain={[
          ["Backlog", "open deals sitting between sale and construction-complete (Survey → Construction stages, no CC date yet) — the fuel available to burn."],
          ["Conversion (trend)", `share of sold dollars that eventually reach CC — the ${py2} full-year cohort → the fully-baked Jan–Sep ${py} cohort. Conversion is the cancellation rate seen from the other side: survivors complete at ~99%, so a falling conversion means rising cancellations, not slower ops.`],
          ["CC pace /mo", `${cy} completed revenue ÷ months elapsed — the current burn rate.`],
          ["Cover", "backlog ÷ CC pace — months the office can sustain its pace with zero new sales."],
          ["Sustain /mo", "CC pace ÷ conversion — the net sales needed per month to keep completions flat, since only [conversion]% of sold dollars ever complete."],
          ["Net selling /mo", `actual net sales per month over ${meta.l3mLabel} (green = at/above sustain, red = below). The muted 'total' line includes deals that later cancelled.`],
        ]}
      >
        <table className="w-full min-w-[720px]">
          <thead>
            <tr>
              <th className={th}>Office</th>
              <th className={thR}>Backlog</th>
              <th className={thR}>Conversion (trend)</th>
              <th className={thR}>CC pace /mo</th>
              <th className={thR}>Cover</th>
              <th className={thR}>Sustain /mo</th>
              <th className={thR}>Net selling /mo</th>
            </tr>
          </thead>
          <tbody>
            {capacity.byOffice.map((o) => (
              <tr key={o.office} className={o.office === "Company" ? "font-semibold" : o.office === "Colorado" ? "font-medium [&>td]:border-t-2" : o.office === "California" ? "font-medium" : ""}>
                <td className={td}>{o.office}</td>
                <td className={tdR}>{$(o.backlogRev)} ({o.backlogCount})</td>
                <td className={tdR}>
                  <span className="text-muted text-xs">{pct(o.conversionPy2Pct)} → </span>
                  <span className={trend(o.conversionPct, o.conversionPy2Pct, "higher")}>{pct(o.conversionPct)}</span>
                </td>
                <td className={tdR}>{$(o.ccPacePerMo)}</td>
                <td className={tdR}>{o.coverMonths === null ? "—" : `~${o.coverMonths} mo`}</td>
                <td className={tdR}>{$(o.sustainPerMo)}</td>
                <td className={tdR}>
                  <div className={(o.sustainPerMo !== null && o.sellingPacePerMo !== null && o.sellingPacePerMo < o.sustainPerMo ? "text-red-400 font-semibold" : "text-emerald-400")}>
                    {$(o.sellingPacePerMo)}
                  </div>
                  <div className="text-[11px] text-muted">{$(o.grossSellingPacePerMo)} total</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>

      {/* ---- Goal planner ---- */}
      <GoalPlanner data={data} />

      {/* ---- Year-view toggle ---- */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className="text-xs text-muted">Prior-year comparison:</span>
        {([
          ["fy", "Full year"],
          ["samePoint", `Same point (thru ${meta.monthDayLabel})`],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setYearView(key)}
            className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
              yearView === key
                ? "bg-orange-500/20 border-orange-500/50 text-orange-300 font-semibold"
                : "border-t-border text-muted hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
        <span className="text-xs text-muted ml-2">
          <span className="text-emerald-400">green</span> = improvement · <span className="text-red-400">red</span> = setback (only like-for-like periods are colored)
        </span>
      </div>

      {/* ---- Run rate by office ---- */}
      <SectionCard
        title="Sales run rate by office (net, with total below)"
        sub={
          yearView === "fy"
            ? `Full-year ${py2}/${py} actuals, ${cy} YTD, and two forward paces — YTD-annualized and trailing-3-calendar-month (${meta.l3mLabel}).`
            : `Apples-to-apples: net sales through ${meta.monthDayLabel} of each year, plus the two forward paces.`
        }
        explain={[
          ["Net (big number)", "revenue from deals closed in the period, excluding deals now Cancelled / Rejected / On-Hold — the same basis as the Revenue Breakdowns dashboard. Older years drift down over time as their cohorts accumulate cancellations."],
          ["Total (small number)", "all sold dollars including later-cancelled — what was actually signed."],
          ["YTD run rate", `${cy} net YTD ÷ fraction of the year elapsed — the full-year pace if the whole year looks like the year so far.`],
          ["3-mo rate", `net sales over ${meta.l3mLabel} ÷ 3 × 12 — current momentum. When it disagrees with the YTD rate, momentum is shifting.`],
        ]}
      >
        <table className="w-full min-w-[680px]">
          <thead>
            <tr>
              <th className={th}>Office</th>
              <th className={thR}>{yearView === "fy" ? `Full year ${py2}` : `${py2} thru ${meta.monthDayLabel}`}</th>
              <th className={thR}>{yearView === "fy" ? `Full year ${py}` : `${py} thru ${meta.monthDayLabel}`}</th>
              <th className={thR}>{cy} YTD</th>
              <th className={thR}>YTD run rate</th>
              <th className={thR}>3-mo rate ({meta.l3mLabel})</th>
            </tr>
          </thead>
          <tbody>
            {runRateByOffice.map((r) => {
              const fy = yearView === "fy";
              const aN = fy ? r.py2Rev : r.py2SamePointRev;
              const bN = fy ? r.pyRev : r.pySamePointRev;
              const aG = fy ? r.py2GrossRev : r.py2SamePointGrossRev;
              const bG = fy ? r.pyGrossRev : r.pySamePointGrossRev;
              return (
              <tr key={r.office} className={r.office === "Company" ? "font-semibold" : r.office === "Colorado" ? "font-medium [&>td]:border-t-2" : r.office === "California" ? "font-medium" : ""}>
                <td className={td}>
                  <div>{r.office}</div>
                  <div className="text-[11px] text-muted font-normal">net · total</div>
                </td>
                <td className={tdR}>
                  <div>{$(aN)}</div>
                  <div className="text-[11px] text-muted">{$(aG)}</div>
                </td>
                <td className={tdR}>
                  <div className={trend(bN, aN, "higher")}>{$(bN)}</div>
                  <div className="text-[11px] text-muted">{$(bG)}</div>
                </td>
                <td className={tdR}>
                  <div className={fy ? "" : trend(r.ytdRev, bN, "higher")}>{$(r.ytdRev)}</div>
                  <div className="text-[11px] text-muted">{$(r.ytdGrossRev)}</div>
                </td>
                <td className={tdR}>
                  <div className={trend(r.ytdAnnualized, r.pyRev, "higher")}>{$(r.ytdAnnualized)}</div>
                  <div className="text-[11px] text-muted">{$(r.ytdGrossAnnualized)}</div>
                </td>
                <td className={tdR}>
                  <div>{$(r.l3mAnnualized)}</div>
                  <div className="text-[11px] text-muted">{$(r.l3mGrossAnnualized)}</div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </SectionCard>

      {/* ---- Throughput by office ---- */}
      <SectionCard
        title="Throughput by office: sales → DAs → CCs"
        sub={
          yearView === "fy"
            ? `Counts (all deals) and net revenue — full year ${py2} → full year ${py} → ${cy} YTD.`
            : `Counts (all deals) and net revenue through ${meta.monthDayLabel} of each year — like-for-like.`
        }
        explain={[
          ["Counts", "every deal whose milestone date (close / design approval / construction complete) falls in the period — including deals that later cancelled, because the work happened."],
          ["Revenue", "net — excludes deals now Cancelled / Rejected / On-Hold. Sales revenue also shows the all-deals total beneath."],
          ["Each stage stands alone", "a 2025 CC usually comes from a 2024–2025 sale, so columns are volume per period, not one cohort flowing through."],
          ["Full year vs same point", `the toggle above switches prior-year columns between full-year totals and Jan 1 → ${meta.monthDayLabel} — only same-point columns are fair to compare against ${cy} YTD, which is why full-year mode doesn't color the last arrow.`],
        ]}
      >
        <table className="w-full min-w-[860px]">
          <thead>
            <tr>
              <th className={th}>Office</th>
              <th className={thR}>Sales count</th>
              <th className={thR}>Sales revenue (net · total)</th>
              <th className={thR}>DAs count</th>
              <th className={thR}>DAs revenue</th>
              <th className={thR}>CCs count</th>
              <th className={thR}>CCs revenue</th>
            </tr>
          </thead>
          <tbody>
            {throughputByOffice.map((r) => {
              const fy = yearView === "fy";
              const cell = (stage: { py2: CountRevT; py: CountRevT; ytd: CountRevT; py2SamePoint: CountRevT; pySamePoint: CountRevT }) => {
                const a = fy ? stage.py2 : stage.py2SamePoint;
                const b = fy ? stage.py : stage.pySamePoint;
                return { a, b, c: stage.ytd };
              };
              const sales = cell(r.sales); const das = cell(r.das); const ccs = cell(r.ccs);
              return (
              <tr key={r.office} className={r.office === "Company" ? "font-semibold" : r.office === "Colorado" ? "font-medium [&>td]:border-t-2" : r.office === "California" ? "font-medium" : ""}>
                <td className={td}>{r.office}</td>
                <td className={tdR}><Arrow3 a={num(sales.a.count)} b={num(sales.b.count)} c={num(sales.c.count)} av={sales.a.count} bv={sales.b.count} cv={sales.c.count} better="higher" compareLast={!fy} /></td>
                <td className={tdR}>
                  <div><Arrow3 a={$(sales.a.revenue)} b={$(sales.b.revenue)} c={$(sales.c.revenue)} av={sales.a.revenue} bv={sales.b.revenue} cv={sales.c.revenue} better="higher" compareLast={!fy} /></div>
                  <div className="text-[11px] text-muted font-normal">{$(sales.a.grossRevenue)} → {$(sales.b.grossRevenue)} → {$(sales.c.grossRevenue)} total</div>
                </td>
                <td className={tdR}><Arrow3 a={num(das.a.count)} b={num(das.b.count)} c={num(das.c.count)} av={das.a.count} bv={das.b.count} cv={das.c.count} better="higher" compareLast={!fy} /></td>
                <td className={tdR}><Arrow3 a={$(das.a.revenue)} b={$(das.b.revenue)} c={$(das.c.revenue)} av={das.a.revenue} bv={das.b.revenue} cv={das.c.revenue} better="higher" compareLast={!fy} /></td>
                <td className={tdR}><Arrow3 a={num(ccs.a.count)} b={num(ccs.b.count)} c={num(ccs.c.count)} av={ccs.a.count} bv={ccs.b.count} cv={ccs.c.count} better="higher" compareLast={!fy} /></td>
                <td className={tdR}><Arrow3 a={$(ccs.a.revenue)} b={$(ccs.b.revenue)} c={$(ccs.c.revenue)} av={ccs.a.revenue} bv={ccs.b.revenue} cv={ccs.c.revenue} better="higher" compareLast={!fy} /></td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </SectionCard>

      {/* ---- Cancellations ---- */}
      <SectionCard
        title="Cancellations by location"
        sub={
          yearView === "fy"
            ? `Cohorts keyed on year sold. Same-yr = cancelled within that calendar year; eventual = cancelled as of today. ${cy}'s columns are equal because the year is still open.`
            : `Same-age lens: deals sold Jan 1 → ${meta.monthDayLabel} of each year and cancelled by ${meta.monthDayLabel} of that year — the truest like-for-like. 2024's rate is understated (cancels were processed late that year).`
        }
        explain={[
          ["Cohort", "every deal SOLD in the year (gross — a cancelled deal was still a sale, so it stays in the denominator)."],
          ["Same-yr", "of those, cancelled before that calendar year ended — shows timing. Shown as cancelled/sold · % of sold dollars."],
          ["Eventual", "cancelled as of today, whenever the cancellation happened — the true loss rate. It only grows: 2025 was 11.4% at year-end and is 18.5% now. The dollar line is the revenue lost."],
          ["Same point (toggle)", `sold Jan 1 → ${meta.monthDayLabel} AND cancelled by ${meta.monthDayLabel} of the same year — the only view where ${cy} compares fairly against prior years at the same age.`],
          ["Why rates differ from the funnel", "cancellation %s divide by gross sold; the funnel's revenue figures are net. Both are correct — different denominators for different questions."],
        ]}
      >
        {yearView === "fy" ? (
        <table className="w-full min-w-[860px]">
          <thead>
            <tr>
              <th className={th}>Office</th>
              <th className={thR}>{py2} full-yr same-yr</th>
              <th className={thR}>{py2} eventual</th>
              <th className={thR}>{py} full-yr same-yr</th>
              <th className={thR}>{py} eventual</th>
              <th className={thR}>{cy} to date</th>
              <th className={thR}>{cy} revenue lost</th>
            </tr>
          </thead>
          <tbody>
            {cancellations.map((r) => (
              <tr key={r.office} className={r.office === "Company" ? "font-semibold" : r.office === "Colorado" ? "font-medium [&>td]:border-t-2" : r.office === "California" ? "font-medium" : ""}>
                <td className={td}>{r.office}</td>
                <td className={tdR}>{r.py2.sameYrCount}/{r.py2.sold} · {pct(r.py2.sameYrRevPct)}</td>
                <td className={tdR}>
                  <div>{r.py2.eventualCount} · {pct(r.py2.eventualRevPct)}</div>
                  <div className="text-[11px] text-muted font-normal">{$(r.py2.eventualRevLost)} lost</div>
                </td>
                <td className={tdR + trend(r.py.sameYrRevPct, r.py2.sameYrRevPct, "lower")}>{r.py.sameYrCount}/{r.py.sold} · {pct(r.py.sameYrRevPct)}</td>
                <td className={tdR}>
                  <div className={trend(r.py.eventualRevPct, r.py2.eventualRevPct, "lower")}>{r.py.eventualCount} · {pct(r.py.eventualRevPct)}</div>
                  <div className="text-[11px] text-muted font-normal">{$(r.py.eventualRevLost)} lost</div>
                </td>
                <td className={tdR + ((r.cy.revPct ?? 0) > 15 ? " text-red-400 font-semibold" : "")}>
                  {r.cy.count}/{r.cy.sold} · {pct(r.cy.revPct)}
                </td>
                <td className={tdR}>{$(r.cy.revLost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        ) : (
        <table className="w-full min-w-[680px]">
          <thead>
            <tr>
              <th className={th}>Office</th>
              <th className={thR}>{py2} thru {meta.monthDayLabel}</th>
              <th className={thR}>{py} thru {meta.monthDayLabel}</th>
              <th className={thR}>{cy} thru {meta.monthDayLabel}</th>
            </tr>
          </thead>
          <tbody>
            {cancellations.map((r) => (
              <tr key={r.office} className={r.office === "Company" ? "font-semibold" : r.office === "Colorado" ? "font-medium [&>td]:border-t-2" : r.office === "California" ? "font-medium" : ""}>
                <td className={td}>{r.office}</td>
                <td className={tdR}>
                  <div>{r.samePoint.py2.count}/{r.samePoint.py2.sold} · {pct(r.samePoint.py2.revPct)}</div>
                  <div className="text-[11px] text-muted font-normal">{$(r.samePoint.py2.revLost)} lost</div>
                </td>
                <td className={tdR}>
                  <div className={trend(r.samePoint.py.revPct, r.samePoint.py2.revPct, "lower")}>{r.samePoint.py.count}/{r.samePoint.py.sold} · {pct(r.samePoint.py.revPct)}</div>
                  <div className="text-[11px] text-muted font-normal">{$(r.samePoint.py.revLost)} lost</div>
                </td>
                <td className={tdR}>
                  <div className={trend(r.samePoint.cy.revPct, r.samePoint.py.revPct, "lower") || ((r.samePoint.cy.revPct ?? 0) > 15 ? " text-red-400 font-semibold" : "")}>
                    {r.samePoint.cy.count}/{r.samePoint.cy.sold} · {pct(r.samePoint.cy.revPct)}
                  </div>
                  <div className="text-[11px] text-muted font-normal">{$(r.samePoint.cy.revLost)} lost</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        )}
      </SectionCard>

      {/* ---- Funnel FY ---- */}
      <SectionCard
        title={data.topFunnel ? "Funnel: leads → consults → sales → DAs → CCs → inspections → PTO" : "Funnel: sales → DAs → CCs → inspections → PTO"}
        sub={
          yearView === "fy"
            ? `Full-year ${py2} and ${py}, ${cy} YTD, and the projected full year. Counts include every deal reaching the milestone; revenue is net.`
            : `Milestones reached Jan 1 → ${meta.monthDayLabel} of each year — like-for-like — plus the projected full year. Counts include every deal reaching the milestone; revenue is net.`
        }
        explain={[
          ["Leads created", "deal records created in the Sales Pipeline during the period — every prospect that got far enough to become a deal record."],
          ["Consults set", "meeting engagements titled Consult/Consultation (excluding canceled) held during the period. Includes all consult types — solar, battery, D&R, repeats — so it can exceed leads; use the trend, not the ratio."],
          ["Sales → PTO rows", "deals whose milestone date (close, design approval, construction complete, inspection pass, PTO) falls in the period. Counts are all deals; revenue is net (excludes now-Cancelled/Rejected/On-Hold); the small line is the all-deals total."],
          ["Projected (most rows)", `${cy} YTD ÷ ${(meta.yearFrac * 100).toFixed(0)}% of the year elapsed — 'if the rest of the year looks like the year so far.' The ~ means model output, not commitment.`],
          ["Projected CCs", "the one row NOT on straight pace: completed YTD + 80–90% of the live backlog + new sales that can still complete in-year at the trailing conversion rate. Pace math would ignore the backlog draining in Q4."],
          ["Projected inspections & PTO — read with care", `straight pace math, but ${cy} YTD includes the record Q1 PTO quarter ($10.8M) from the ${py} tax-credit cohort clearing. Annualizing that assumes the record repeats; the capacity model suggests the real number lands lower (~$30–32M PTO).`],
        ]}
      >
        <table className="w-full min-w-[620px]">
          <thead>
            <tr>
              <th className={th}>Stage</th>
              <th className={thR}>{yearView === "fy" ? `Full year ${py2}` : `${py2} thru ${meta.monthDayLabel}`}</th>
              <th className={thR}>{yearView === "fy" ? `Full year ${py}` : `${py} thru ${meta.monthDayLabel}`}</th>
              <th className={thR}>{cy} YTD</th>
              <th className={thR}>Full year {cy} (projected)</th>
            </tr>
          </thead>
          <tbody>
            {data.topFunnel && ([
              ["Leads created (Sales Pipeline)", data.topFunnel.leads],
              ["Consults set", data.topFunnel.consults],
            ] as const).map(([label, tf]) => {
              const fy = yearView === "fy";
              const a = fy ? tf.py2 : tf.py2SamePoint;
              const b = fy ? tf.py : tf.pySamePoint;
              return (
                <tr key={label}>
                  <td className={td}>{label}</td>
                  <td className={tdR}>{num(a)}</td>
                  <td className={tdR + trend(b, a, "higher")}>{num(b)}</td>
                  <td className={tdR + (fy ? "" : trend(tf.ytd, b, "higher"))}>{num(tf.ytd)}</td>
                  <td className={tdR + " text-muted"}>~{num(Math.round(tf.ytd / meta.yearFrac))}</td>
                </tr>
              );
            })}
            {funnelFy.map((r) => {
              const fy = yearView === "fy";
              const a = fy ? r.py2 : r.py2SamePoint;
              const b = fy ? r.py : r.pySamePoint;
              return (
                <tr key={r.stage}>
                  <td className={td}>{r.stage}</td>
                  <td className={tdR}>
                    <div>{num(a.count)} · {$(a.revenue)}</div>
                    <div className="text-[11px] text-muted">{$(a.grossRevenue)} total</div>
                  </td>
                  <td className={tdR}>
                    <div>
                      <span className={trend(b.count, a.count, "higher")}>{num(b.count)}</span>
                      {" · "}
                      <span className={trend(b.revenue, a.revenue, "higher")}>{$(b.revenue)}</span>
                    </div>
                    <div className="text-[11px] text-muted">{$(b.grossRevenue)} total</div>
                  </td>
                  <td className={tdR}>
                    <div>
                      <span className={fy ? "" : trend(r.ytd.count, b.count, "higher")}>{num(r.ytd.count)}</span>
                      {" · "}
                      <span className={fy ? "" : trend(r.ytd.revenue, b.revenue, "higher")}>{$(r.ytd.revenue)}</span>
                    </div>
                    <div className="text-[11px] text-muted">{$(r.ytd.grossRevenue)} total</div>
                  </td>
                  <td className={tdR + " text-muted"}>
                    {r.stage === "CCs"
                      ? <>~{num(r.projected.count)} · {$(capacity.projectedFyCcLow)}–{$(capacity.projectedFyCcHigh)}</>
                      : <>~{num(r.projected.count)} · {$(r.projected.revenue)}</>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </SectionCard>

      {/* ---- Efficiency ---- */}
      {/* ---- 2026 funnel, month by month ---- */}
      <SectionCard
        title={`${cy} funnel, month by month`}
        sub="Counts reaching each milestone per month. Leads and consults come from the Sales Pipeline / meetings; the rest from the Project pipeline."
        explain={[
          ["Reading it", "each row is independent volume per month — a June CC came from a much earlier sale. The current month is partial."],
          ["The row to watch", "leads vs consults: lead intake has been climbing while consults hold flat — the set rate, not demand, is the funnel's weakest link."],
        ]}
      >
        <table className="w-full min-w-[680px]">
          <thead>
            <tr>
              <th className={th}>Stage — count</th>
              {Object.keys(data.funnelMonthly[0]?.byMonth ?? {}).map((m) => (
                <th key={m} className={thR}>{m.slice(5)}</th>
              ))}
              <th className={thR}>Total YTD</th>
            </tr>
          </thead>
          <tbody>
            {data.topFunnel && ([
              ["Leads created", data.topFunnel.monthly.leads],
              ["Consults set", data.topFunnel.monthly.consults],
            ] as const).map(([label, byMonth]) => (
              <tr key={label}>
                <td className={td}>{label}</td>
                {Object.keys(data.funnelMonthly[0]?.byMonth ?? {}).map((m) => (
                  <td key={m} className={tdR}>{byMonth[m] ?? "—"}</td>
                ))}
                <td className={tdR + " font-semibold"}>{Object.values(byMonth).reduce((a, v) => a + v, 0)}</td>
              </tr>
            ))}
            {data.funnelMonthly.map((r) => (
              <tr key={r.stage}>
                <td className={td}>{r.stage}</td>
                {Object.entries(r.byMonth).map(([m, v]) => (
                  <td key={m} className={tdR}>{v}</td>
                ))}
                <td className={tdR + " font-semibold"}>{Object.values(r.byMonth).reduce((a, v) => a + v, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>

      {/* ---- Quarter over quarter ---- */}
      <SectionCard
        title="Quarter over quarter — net revenue by stage"
        sub={`Net revenue reaching each stage per quarter, ${py2}Q1 → today. The ${py}Q3 tax-credit rush and ${py}Q4 crash distort simple QoQ reads — compare like quarters across years.`}
        explain={[
          ["Cells", "net revenue whose milestone date falls in the quarter. The current quarter is partial."],
          ["Known distortions", `${py}Q3 sales ($11.2M) were pulled forward by the tax-credit deadline and crashed ${py}Q4 ($3.2M); that cohort then powered the big ${py}Q3–Q4 CC quarters and the record ${cy}Q1 PTO. ${cy}Q1 CC was low ($4.9M) from the Participate rollout. Compare Q2-to-Q2, not Q-to-Q.`],
        ]}
      >
        <table className="w-full min-w-[860px]">
          <thead>
            <tr>
              <th className={th}>Stage</th>
              {Object.keys(data.funnelQuarterly[0]?.byQuarter ?? {}).map((q) => (
                <th key={q} className={thR}>{q.slice(2)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.funnelQuarterly.map((r) => (
              <tr key={r.stage}>
                <td className={td}>{r.stage}</td>
                {Object.entries(r.byQuarter).map(([q, v]) => (
                  <td key={q} className={tdR}>{$(v)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>

      <SectionCard
        title={`Operational efficiency — ${cy} monthly medians`}
        sub="Median days per step, bucketed by when the step completed. Cancelled deals excluded from all time metrics."
        explain={[
          ["Bucketing", "a deal counts in the month its step COMPLETED (e.g. permit issued in June → June column), so each month reflects the work finished then."],
          ["Median", "the typical deal — half faster, half slower. Immune to the stalled-deal tail that inflates averages."],
          ["Exclusions", "cancelled deals, deals missing either date, and spans over 400 days. The current month is partial and can move."],
        ]}
      >
        <table className="w-full min-w-[560px]">
          <thead>
            <tr>
              <th className={th}>Leg</th>
              {Object.keys(efficiency.monthlyMedians[0]?.byMonth ?? {}).map((m) => (
                <th key={m} className={thR}>{m.slice(5)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {efficiency.monthlyMedians.map((r) => (
              <tr key={r.leg}>
                <td className={td}>{r.leg}</td>
                {Object.entries(r.byMonth).map(([m, v]) => (
                  <td key={m} className={tdR}>{days(v)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>

      <SectionCard
        title="Operational efficiency — quarterly medians"
        sub={`Median days per step, bucketed by the quarter the step completed, ${py2}Q1 → today. Cancelled deals excluded.`}
        explain={[
          ["Same method as the monthly table", "just bucketed by quarter — the long view of the same three legs. Q2'26 is the best quarter on record for all three."],
        ]}
      >
        <table className="w-full min-w-[860px]">
          <thead>
            <tr>
              <th className={th}>Leg</th>
              {Object.keys(efficiency.quarterlyMedians[0]?.byQuarter ?? {}).map((q) => (
                <th key={q} className={thR}>{q.slice(2)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {efficiency.quarterlyMedians.map((r) => (
              <tr key={r.leg}>
                <td className={td}>{r.leg}</td>
                {Object.entries(r.byQuarter).map(([q, v]) => (
                  <td key={q} className={tdR}>{v === null ? "—" : v.toFixed(1)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>

      <SectionCard
        title="Turnaround times by office"
        actions={
          <div className="flex items-center gap-2">
            {([["median", "Median"], ["mean", "Average"]] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTurnStat(key)}
                className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                  turnStat === key
                    ? "bg-orange-500/20 border-orange-500/50 text-orange-300 font-semibold"
                    : "border-t-border text-muted hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        }
        sub={`${turnStat === "median" ? "Median (typical deal)" : "Average (includes the stalled-deal tail, so runs higher than the typical deal)"} days per step, sold-year cohorts ${py2} → ${py} → ${cy}. Same-day DA approvals: ${efficiency.sameDayDaPct.py2 ?? "—"}% → ${efficiency.sameDayDaPct.py ?? "—"}% → ${efficiency.sameDayDaPct.cy ?? "—"}%.`}
        explain={[
          ["Cohorts", `deals are grouped by the year SOLD (close date), so each column follows one vintage of deals through the process. Cancelled deals and spans over 400 days are excluded.`],
          ["Median vs Average (toggle)", "median = the typical deal. Average includes the stalled-deal tail so it runs higher — a growing average over a flat median means more stragglers, not slower typical work. Consult → sale shows this sharply: median ~2 weeks, average ~6 weeks, because ~20% of sales close 60+ days after their first consult (the nurture tail)."],
          ["Survivorship on long legs", `Consult → sale, Sale → DA and Sale → CC only count deals that already reached the end milestone — a ${cy} deal that will CC in November isn't in the ${cy} number yet, so recent cohorts read faster than they'll finish.`],
          ["Colors", "green = improvement vs the prior cohort (fewer days), red = setback."],
        ]}
      >
        <table className="w-full min-w-[1200px]">
          <thead>
            <tr>
              <th className={th}>Office</th>
              {Object.keys(efficiency.turnaroundsByOffice[0]?.legs ?? {}).map((leg) => (
                <th key={leg} className={thR}>{leg}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {efficiency.turnaroundsByOffice.map((r) => (
              <tr key={r.office} className={r.office === "Company" ? "font-semibold" : r.office === "Colorado" ? "font-medium [&>td]:border-t-2" : r.office === "California" ? "font-medium" : ""}>
                <td className={td}>{r.office}</td>
                {Object.entries(r.legs).map(([leg, v]) => (
                  <td key={leg} className={tdR}>
                    <Arrow3 a={days(v.py2[turnStat])} b={days(v.py[turnStat])} c={days(v.cy[turnStat])} av={v.py2[turnStat]} bv={v.py[turnStat]} cv={v.cy[turnStat]} better="lower" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>

      {/* ---- Method ---- */}
      <div className="text-xs text-muted leading-relaxed border-t border-t-border pt-4 mb-4">
        <strong>Method.</strong> Computed from the full Project-pipeline population (all stages,
        completed and cancelled included) as of {meta.dataThrough}. Gross counts include every deal
        reaching a milestone; net revenue excludes deals currently Cancelled / Rejected / On-Hold —
        matching the Revenue Breakdowns dashboard. Cancellation cohorts key on the year sold
        (denominator is gross sold). Time metrics exclude cancelled-stage deals; spans over 400 days
        are dropped. Conversion and lag come from the fully-baked cohort sold Jan–Sep {py}. Pueblo is
        counted as Colorado Springs. FY projections use current pace (sales) and the backlog capacity
        model (completions) — model outputs, not commitments.
      </div>
      <MiniStat label="Deals in computation" value={num(meta.projectCount)} />
    </DashboardShell>
  );
}
