"use client";

import { useEffect, useRef } from "react";
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

const $ = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : formatCurrencyCompact(n);
const pct = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `${n.toFixed(1)}%`;
const days = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n.toFixed(1);
const num = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n.toLocaleString();

function Arrow3({ a, b, c }: { a: string; b: string; c: string }) {
  return (
    <span className="whitespace-nowrap">
      <span className="text-muted">{a}</span>
      <span className="text-muted mx-0.5">→</span>
      <span className="text-muted">{b}</span>
      <span className="text-muted mx-0.5">→</span>
      <span className="font-semibold text-foreground">{c}</span>
    </span>
  );
}

function SectionCard({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold text-foreground mb-1">{title}</h2>
      {sub && <p className="text-sm text-muted mb-3">{sub}</p>}
      <div className="bg-surface border border-t-border rounded-xl shadow-card p-4 overflow-x-auto">
        {children}
      </div>
    </section>
  );
}

const th = "text-left text-[11px] uppercase tracking-wide text-muted font-semibold pb-2 pr-4 whitespace-nowrap";
const thR = th + " text-right";
const td = "py-1.5 pr-4 text-sm whitespace-nowrap border-t border-t-border/50";
const tdR = td + " text-right tabular-nums";

export default function OpsScorecardPage() {
  const { trackDashboardView } = useActivityTracking();
  const tracked = useRef(false);

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
          label={`Projected FY ${cy} CC revenue`}
          value={`${$(capacity.projectedFyCcLow)}–${$(capacity.projectedFyCcHigh)}`}
          subtitle={`${$(capacity.ytdCcRev)} completed YTD + backlog + in-year sales`}
          color="orange"
        />
        <StatCard
          label="Net sales needed to sustain CC pace"
          value={`${$(capacity.sustainSalesPerMo)}/mo`}
          subtitle={`selling ${$(capacity.netSalesPacePerMo)}/mo · burning ${$(capacity.burnPerMo)}/mo`}
          color="red"
        />
        <StatCard
          label="Live backlog (no CC yet)"
          value={$(capacity.backlogRev)}
          subtitle={`${capacity.backlogCount} deals · ~${days(capacity.coverMonths)} months cover · conv ${pct(capacity.conversionPct)} (median ${days(capacity.convMedianDays)}d)`}
          color="orange"
        />
      </div>

      {/* ---- CC / DA by month ---- */}
      <SectionCard
        title={`${cy} CCs and DAs by month`}
        sub="Construction completes (all deals) and design approvals (net revenue) reached each month."
      >
        <table className="w-full min-w-[560px]">
          <thead>
            <tr>
              <th className={th}>Month</th>
              {data.ccByMonth.map((m) => (
                <th key={m.month} className={thR}>{m.month.slice(5)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={td}>CCs</td>
              {data.ccByMonth.map((m) => (
                <td key={m.month} className={tdR}>{m.count} · {$(m.revenue)}</td>
              ))}
            </tr>
            <tr>
              <td className={td}>DAs</td>
              {data.daByMonth.map((m) => (
                <td key={m.month} className={tdR}>{m.count} · {$(m.revenue)}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </SectionCard>

      {/* ---- Capacity by office ---- */}
      <SectionCard
        title="CC capacity by office"
        sub="Fuel (backlog), conversion, burn, cover, and the sales pace needed to sustain completions."
      >
        <table className="w-full min-w-[720px]">
          <thead>
            <tr>
              <th className={th}>Office</th>
              <th className={thR}>Backlog</th>
              <th className={thR}>Conversion</th>
              <th className={thR}>CC pace /mo</th>
              <th className={thR}>Cover</th>
              <th className={thR}>Sustain /mo</th>
              <th className={thR}>Selling /mo</th>
            </tr>
          </thead>
          <tbody>
            {capacity.byOffice.map((o) => (
              <tr key={o.office}>
                <td className={td}>{o.office}</td>
                <td className={tdR}>{$(o.backlogRev)} ({o.backlogCount})</td>
                <td className={tdR}>{pct(o.conversionPct)}</td>
                <td className={tdR}>{$(o.ccPacePerMo)}</td>
                <td className={tdR}>{o.coverMonths === null ? "—" : `~${o.coverMonths} mo`}</td>
                <td className={tdR}>{$(o.sustainPerMo)}</td>
                <td className={tdR + (o.sustainPerMo !== null && o.sellingPacePerMo !== null && o.sellingPacePerMo < o.sustainPerMo ? " text-red-400 font-semibold" : " text-emerald-400")}>
                  {$(o.sellingPacePerMo)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>

      {/* ---- Run rate by office ---- */}
      <SectionCard
        title="Net sales run rate, by office"
        sub={`Full-year ${py2}/${py} actuals, ${cy} YTD, and two forward paces — YTD-annualized and trailing-3-month.`}
      >
        <table className="w-full min-w-[680px]">
          <thead>
            <tr>
              <th className={th}>Office</th>
              <th className={thR}>FY {py2}</th>
              <th className={thR}>FY {py}</th>
              <th className={thR}>{cy} YTD</th>
              <th className={thR}>YTD run rate</th>
              <th className={thR}>Trailing-3mo rate</th>
            </tr>
          </thead>
          <tbody>
            {runRateByOffice.map((r) => (
              <tr key={r.office} className={r.office === "Company" ? "font-semibold" : ""}>
                <td className={td}>{r.office}</td>
                <td className={tdR}>{$(r.py2Rev)}</td>
                <td className={tdR}>{$(r.pyRev)}</td>
                <td className={tdR}>{$(r.ytdRev)}</td>
                <td className={tdR}>{$(r.ytdAnnualized)}</td>
                <td className={tdR}>{$(r.l3mAnnualized)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>

      {/* ---- Throughput by office ---- */}
      <SectionCard
        title="Throughput by office: sales → DAs → CCs"
        sub={`Counts (all deals) and net revenue — FY ${py2} → FY ${py} → ${cy} YTD.`}
      >
        <table className="w-full min-w-[860px]">
          <thead>
            <tr>
              <th className={th}>Office</th>
              <th className={thR}>Sales count</th>
              <th className={thR}>Sales revenue</th>
              <th className={thR}>DAs count</th>
              <th className={thR}>DAs revenue</th>
              <th className={thR}>CCs count</th>
              <th className={thR}>CCs revenue</th>
            </tr>
          </thead>
          <tbody>
            {throughputByOffice.map((r) => (
              <tr key={r.office} className={r.office === "Company" ? "font-semibold" : ""}>
                <td className={td}>{r.office}</td>
                <td className={tdR}><Arrow3 a={num(r.sales.py2.count)} b={num(r.sales.py.count)} c={num(r.sales.ytd.count)} /></td>
                <td className={tdR}><Arrow3 a={$(r.sales.py2.revenue)} b={$(r.sales.py.revenue)} c={$(r.sales.ytd.revenue)} /></td>
                <td className={tdR}><Arrow3 a={num(r.das.py2.count)} b={num(r.das.py.count)} c={num(r.das.ytd.count)} /></td>
                <td className={tdR}><Arrow3 a={$(r.das.py2.revenue)} b={$(r.das.py.revenue)} c={$(r.das.ytd.revenue)} /></td>
                <td className={tdR}><Arrow3 a={num(r.ccs.py2.count)} b={num(r.ccs.py.count)} c={num(r.ccs.ytd.count)} /></td>
                <td className={tdR}><Arrow3 a={$(r.ccs.py2.revenue)} b={$(r.ccs.py.revenue)} c={$(r.ccs.ytd.revenue)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>

      {/* ---- Cancellations ---- */}
      <SectionCard
        title="Cancellations by location"
        sub={`Cohorts keyed on year sold. Same-yr = cancelled within that calendar year; eventual = cancelled as of today. ${cy}'s columns are equal because the year is still open.`}
      >
        <table className="w-full min-w-[860px]">
          <thead>
            <tr>
              <th className={th}>Office</th>
              <th className={thR}>FY{py2.slice(2)} same-yr</th>
              <th className={thR}>FY{py2.slice(2)} eventual</th>
              <th className={thR}>FY{py.slice(2)} same-yr</th>
              <th className={thR}>FY{py.slice(2)} eventual</th>
              <th className={thR}>{cy} to date</th>
              <th className={thR}>{cy} revenue lost</th>
            </tr>
          </thead>
          <tbody>
            {cancellations.map((r) => (
              <tr key={r.office} className={r.office === "Company" ? "font-semibold" : ""}>
                <td className={td}>{r.office}</td>
                <td className={tdR}>{r.py2.sameYrCount}/{r.py2.sold} · {pct(r.py2.sameYrRevPct)}</td>
                <td className={tdR}>{r.py2.eventualCount} · {pct(r.py2.eventualRevPct)}</td>
                <td className={tdR}>{r.py.sameYrCount}/{r.py.sold} · {pct(r.py.sameYrRevPct)}</td>
                <td className={tdR}>{r.py.eventualCount} · {pct(r.py.eventualRevPct)}</td>
                <td className={tdR + ((r.cy.revPct ?? 0) > 15 ? " text-red-400 font-semibold" : "")}>
                  {r.cy.count}/{r.cy.sold} · {pct(r.cy.revPct)}
                </td>
                <td className={tdR}>{$(r.cy.revLost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>

      {/* ---- Funnel FY ---- */}
      <SectionCard
        title="Funnel: sales → DAs → CCs → inspections → PTO"
        sub={`Full-year ${py2} and ${py}, ${cy} YTD. Counts include every deal reaching the milestone; revenue is net. Leads & appointments land in phase 2.`}
      >
        <table className="w-full min-w-[620px]">
          <thead>
            <tr>
              <th className={th}>Stage</th>
              <th className={thR}>FY {py2}</th>
              <th className={thR}>FY {py}</th>
              <th className={thR}>{cy} YTD</th>
            </tr>
          </thead>
          <tbody>
            {funnelFy.map((r) => (
              <tr key={r.stage}>
                <td className={td}>{r.stage}</td>
                <td className={tdR}>{num(r.py2.count)} · {$(r.py2.revenue)}</td>
                <td className={tdR}>{num(r.py.count)} · {$(r.py.revenue)}</td>
                <td className={tdR}>{num(r.ytd.count)} · {$(r.ytd.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>

      {/* ---- Efficiency ---- */}
      <SectionCard
        title={`Operational efficiency — ${cy} monthly medians`}
        sub="Median days per step, bucketed by when the step completed. Cancelled deals excluded from all time metrics."
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
        title="Turnaround times by office"
        sub={`Average days per step, sold-year cohorts ${py2} → ${py} → ${cy}. Averages include the stalled-deal tail — medians run lower. Same-day DA approvals: ${efficiency.sameDayDaPct.py2 ?? "—"}% → ${efficiency.sameDayDaPct.py ?? "—"}% → ${efficiency.sameDayDaPct.cy ?? "—"}%.`}
      >
        <table className="w-full min-w-[900px]">
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
              <tr key={r.office} className={r.office === "Company" ? "font-semibold" : ""}>
                <td className={td}>{r.office}</td>
                {Object.entries(r.legs).map(([leg, v]) => (
                  <td key={leg} className={tdR}>
                    <Arrow3 a={days(v.py2)} b={days(v.py)} c={days(v.cy)} />
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
