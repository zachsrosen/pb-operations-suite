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
  const bClass = better ? trend(bv, av, better) : "";
  const cClass = better && compareLast ? trend(cv, bv, better) : "";
  return (
    <span className="whitespace-nowrap">
      <span className="text-muted">{a}</span>
      <span className="text-muted mx-0.5">→</span>
      <span className={"text-muted" + bClass}>{b}</span>
      <span className="text-muted mx-0.5">→</span>
      <span className={"font-semibold text-foreground" + cClass}>{c}</span>
    </span>
  );
}

function SectionCard({ title, sub, actions, children }: { title: string; sub?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        {actions}
      </div>
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

      {/* ---- Sales / DA / CC by month ---- */}
      <SectionCard
        title={`${cy} sales, DAs, and CCs by month`}
        sub="Sales closed (net revenue, with total incl. later-cancelled below), design approvals (net revenue), and construction completes (all deals) reached each month."
      >
        <table className="w-full min-w-[560px]">
          <thead>
            <tr>
              <th className={th}>Month</th>
              {data.salesByMonth.map((m) => (
                <th key={m.month} className={thR}>{m.month.slice(5)}</th>
              ))}
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
            </tr>
            <tr>
              <td className={td}>DAs (net)</td>
              {data.daByMonth.map((m) => (
                <td key={m.month} className={tdR}>{m.count} · {$(m.revenue)}</td>
              ))}
            </tr>
            <tr>
              <td className={td}>CCs</td>
              {data.ccByMonth.map((m) => (
                <td key={m.month} className={tdR}>{m.count} · {$(m.revenue)}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </SectionCard>

      {/* ---- Capacity by office ---- */}
      <SectionCard
        title="CC capacity by office"
        sub={`Fuel (backlog), conversion, burn, cover, and the net sales pace (${meta.l3mLabel}) needed to sustain completions. Total = incl. later-cancelled/rejected/on-hold.`}
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
              <th className={thR}>Net selling /mo</th>
            </tr>
          </thead>
          <tbody>
            {capacity.byOffice.map((o) => (
              <tr key={o.office} className={o.office === "Company" ? "font-semibold" : o.office === "Colorado" || o.office === "California" ? "font-medium border-t-2" : ""}>
                <td className={td}>{o.office}</td>
                <td className={tdR}>{$(o.backlogRev)} ({o.backlogCount})</td>
                <td className={tdR}>{pct(o.conversionPct)}</td>
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
              <tr key={r.office} className={r.office === "Company" ? "font-semibold" : r.office === "Colorado" || r.office === "California" ? "font-medium border-t-2" : ""}>
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
                <td className={tdR + trend(r.ytdAnnualized, r.pyRev, "higher")}>{$(r.ytdAnnualized)}</td>
                <td className={tdR}>{$(r.l3mAnnualized)}</td>
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
              <tr key={r.office} className={r.office === "Company" ? "font-semibold" : r.office === "Colorado" || r.office === "California" ? "font-medium border-t-2" : ""}>
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
              <tr key={r.office} className={r.office === "Company" ? "font-semibold" : r.office === "Colorado" || r.office === "California" ? "font-medium border-t-2" : ""}>
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
              <tr key={r.office} className={r.office === "Company" ? "font-semibold" : r.office === "Colorado" || r.office === "California" ? "font-medium border-t-2" : ""}>
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
            ? `Full-year ${py2} and ${py}, ${cy} YTD, and projected full-year ${cy} at current YTD pace (CC revenue from the capacity model). Counts include every deal reaching the milestone; revenue is net. Consults include all consult types (solar, battery, D&R, repeats), so they can exceed leads — use the trend, not the ratio.`
            : `Milestones reached Jan 1 → ${meta.monthDayLabel} of each year — like-for-like — plus the projected full year. Counts include every deal reaching the milestone; revenue is net. Consults include all consult types, so they can exceed leads.`
        }
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
                    <div className={trend(b.revenue, a.revenue, "higher")}>{num(b.count)} · {$(b.revenue)}</div>
                    <div className="text-[11px] text-muted">{$(b.grossRevenue)} total</div>
                  </td>
                  <td className={tdR}>
                    <div className={fy ? "" : trend(r.ytd.revenue, b.revenue, "higher")}>{num(r.ytd.count)} · {$(r.ytd.revenue)}</div>
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
        sub={`${turnStat === "median" ? "Median (typical deal)" : "Average (includes the stalled-deal tail, so runs higher than the typical deal)"} days per step, sold-year cohorts ${py2} → ${py} → ${cy}. Same-day DA approvals: ${efficiency.sameDayDaPct.py2 ?? "—"}% → ${efficiency.sameDayDaPct.py ?? "—"}% → ${efficiency.sameDayDaPct.cy ?? "—"}%. Sale → DA and Sale → CC only count deals that have reached the milestone, so recent cohorts skew fast.`}
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
              <tr key={r.office} className={r.office === "Company" ? "font-semibold" : r.office === "Colorado" || r.office === "California" ? "font-medium border-t-2" : ""}>
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
