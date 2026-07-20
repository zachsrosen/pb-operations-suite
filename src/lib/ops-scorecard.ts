/**
 * Ops Scorecard — pure computation module.
 *
 * Computes every metric for /dashboards/ops-scorecard from a Project[] snapshot.
 * All conventions here were ratified with Zach on 7/17–7/18 (see
 * docs/superpowers/specs/2026-07-18-ops-scorecard-dashboard-design.md):
 *
 * - Gross = every deal reaching a milestone (a cancelled deal was still a sale).
 * - Net   = excludes deals *currently* Cancelled / Rejected / On-Hold.
 * - Cancellation cohorts key on the year SOLD; same-yr vs eventual lenses.
 * - Time metrics exclude Cancelled-stage deals; spans <0 or >400 days dropped.
 * - Monthly/quarterly turnarounds are medians bucketed by completion date;
 *   by-office turnarounds are means over sold-year cohorts.
 * - Pueblo is counted as Colorado Springs (rename mid-rollout).
 * - Year framing: FY py2 / FY py / cy YTD (+ model-based cy projection).
 */

import type { Project } from "./hubspot";

// Stage IDs (Project Pipeline)
const CANCELLED = "68229433";
const REJECTED = "20461935";
const ON_HOLD = "20440344";
const NET_EXCLUDED = new Set([CANCELLED, REJECTED, ON_HOLD]);
/** Stages between sale and CC — the deliverable backlog when no CC date yet. */
const BACKLOG_STAGE_IDS = new Set([
  "20461936", // Site Survey
  "20461937", // Design & Engineering
  "20461938", // Permitting & Interconnection
  "71052436", // RTB - Blocked
  "22580871", // Ready To Build
  "20440342", // Construction
]);

export const SCORECARD_OFFICES = [
  "Westminster",
  "Centennial",
  "Colorado Springs",
  "San Luis Obispo",
  "Camarillo",
] as const;
export type ScorecardOffice = (typeof SCORECARD_OFFICES)[number];

const CO_OFFICES = new Set(["Westminster", "Centennial", "Colorado Springs"]);

export function normalizeLocation(loc: string | null | undefined): string {
  if (!loc) return "Unknown";
  return loc === "Pueblo" ? "Colorado Springs" : loc;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const yearOf = (d: string | null) => (d ? d.slice(0, 4) : null);
const monthOf = (d: string | null) => (d ? d.slice(0, 7) : null);
const quarterOf = (d: string | null): string | null => {
  if (!d) return null;
  const m = parseInt(d.slice(5, 7), 10);
  if (!m) return null;
  return `${d.slice(0, 4)}Q${Math.ceil(m / 3)}`;
};

/** Calendar-day span, clipped to [0, 400); null when either date is missing. */
export function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (isNaN(ta) || isNaN(tb)) return null;
  const d = (tb - ta) / 86_400_000;
  return d >= 0 && d < 400 ? d : null;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

const sumAmount = (ps: Project[]) => ps.reduce((s, p) => s + (p.amount || 0), 0);
const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

interface CountRev {
  count: number;
  revenue: number;
}

const isNet = (p: Project) => !NET_EXCLUDED.has(p.stageId);
const notCancelled = (p: Project) => p.stageId !== CANCELLED;

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface StageYearRow {
  /** Counts include every deal reaching the milestone; revenue is net. */
  py2: CountRev;
  py: CountRev;
  ytd: CountRev;
  /** Same point in prior years: milestones reached Jan 1 → meta.monthDay. */
  py2SamePoint: CountRev;
  pySamePoint: CountRev;
}

export interface SameAgeCohort {
  count: number;
  sold: number;
  revPct: number | null;
}

export interface OfficeCancellation {
  office: string;
  /** Same-age lens: sold Jan1→monthDay of the year, cancelled by monthDay same year. */
  samePoint: { py2: SameAgeCohort; py: SameAgeCohort; cy: SameAgeCohort };
  py2: { sameYrCount: number; sold: number; sameYrRevPct: number | null; eventualCount: number; eventualRevPct: number | null };
  py: { sameYrCount: number; sold: number; sameYrRevPct: number | null; eventualCount: number; eventualRevPct: number | null };
  cy: { count: number; sold: number; revPct: number | null; revLost: number };
}

export interface MeanMed {
  mean: number | null;
  median: number | null;
}

export interface TurnaroundLegYearMeans {
  py2: MeanMed;
  py: MeanMed;
  cy: MeanMed;
}

export interface OpsScorecardData {
  meta: {
    generatedAt: string;
    dataThrough: string;
    cy: string;
    py: string;
    py2: string;
    /** MM-DD cutoff used for YTD and same-point comparisons. */
    monthDay: string;
    /** Human form of monthDay, e.g. "Jul 18". */
    monthDayLabel: string;
    /** Label for the trailing-3-calendar-month window, e.g. "Apr–Jun". */
    l3mLabel: string;
    projectCount: number;
  };
  capacity: {
    backlogRev: number;
    backlogCount: number;
    onHoldRev: number;
    conversionPct: number | null;
    convMedianDays: number | null;
    burnPerMo: number | null;
    netSalesPacePerMo: number | null;
    sustainSalesPerMo: number | null;
    coverMonths: number | null;
    ytdCcRev: number;
    projectedFyCcLow: number;
    projectedFyCcHigh: number;
    byOffice: Array<{
      office: string;
      backlogRev: number;
      backlogCount: number;
      conversionPct: number | null;
      ccPacePerMo: number | null;
      coverMonths: number | null;
      sellingPacePerMo: number | null;
      sustainPerMo: number | null;
    }>;
  };
  ccByMonth: Array<{ month: string; count: number; revenue: number }>;
  daByMonth: Array<{ month: string; count: number; revenue: number }>;
  runRateByOffice: Array<{
    office: string;
    py2Rev: number;
    pyRev: number;
    py2SamePointRev: number;
    pySamePointRev: number;
    ytdRev: number;
    ytdAnnualized: number;
    l3mAnnualized: number;
  }>;
  throughputByOffice: Array<{
    office: string;
    sales: StageYearRow;
    das: StageYearRow;
    ccs: StageYearRow;
  }>;
  cancellations: OfficeCancellation[];
  funnelFy: Array<{ stage: string } & StageYearRow>;
  funnelMonthly: Array<{ stage: string; byMonth: Record<string, number> }>;
  efficiency: {
    monthlyMedians: Array<{ leg: string; byMonth: Record<string, number | null> }>;
    quarterlyMedians: Array<{ leg: string; byQuarter: Record<string, number | null> }>;
    turnaroundsByOffice: Array<{ office: string; legs: Record<string, TurnaroundLegYearMeans> }>;
    sameDayDaPct: { py2: number | null; py: number | null; cy: number | null };
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function computeOpsScorecard(projects: Project[], now = new Date()): OpsScorecardData {
  const dataThrough = now.toISOString().slice(0, 10);
  const cy = String(now.getUTCFullYear());
  const py = String(now.getUTCFullYear() - 1);
  const py2 = String(now.getUTCFullYear() - 2);
  const dayOfYear = Math.max(
    1,
    Math.floor((now.getTime() - Date.parse(`${cy}-01-01`)) / 86_400_000)
  );
  const yearFrac = Math.min(1, dayOfYear / 365);
  const monthDay = dataThrough.slice(5, 10);

  // Trailing 3 COMPLETE calendar months (e.g. on Jul 20 → Apr 1–Jun 30),
  // matching the approved analysis; a rolling 92-day window whipsaws with
  // partial-month surges.
  const mStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1));
  const mEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const l3mLo = mStart.toISOString().slice(0, 10);
  const l3mHi = mEnd.toISOString().slice(0, 10);
  const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const monthDayLabel = `${MONTH_NAMES[Number(monthDay.slice(0, 2)) - 1]} ${Number(monthDay.slice(3, 5))}`;
  const l3mLabel = `${MONTH_NAMES[mStart.getUTCMonth()]}–${MONTH_NAMES[mEnd.getUTCMonth()]}`;

  const loc = (p: Project) => normalizeLocation(p.pbLocation);
  const inOffice = (o: string) => (p: Project) => loc(p) === o;

  // ---- Milestone accessors --------------------------------------------------
  const MILESTONES: Array<{ key: string; label: string; date: (p: Project) => string | null }> = [
    { key: "sales", label: "Sales", date: (p) => p.closeDate },
    { key: "das", label: "DAs", date: (p) => p.designApprovalDate },
    { key: "ccs", label: "CCs", date: (p) => p.constructionCompleteDate },
    { key: "insp", label: "Inspections passed", date: (p) => p.inspectionPassDate },
    { key: "pto", label: "PTO", date: (p) => p.ptoGrantedDate },
  ];

  const reached = (date: (p: Project) => string | null, year: string, throughMonthDay?: string) =>
    projects.filter((p) => {
      const d = date(p);
      if (!d || yearOf(d) !== year) return false;
      if (throughMonthDay && d.slice(5, 10) > throughMonthDay) return false;
      return true;
    });

  const stageYearRow = (date: (p: Project) => string | null): StageYearRow => {
    const mk = (year: string, throughMonthDay?: string): CountRev => {
      const all = reached(date, year, throughMonthDay);
      return { count: all.length, revenue: sumAmount(all.filter(isNet)) };
    };
    return {
      py2: mk(py2),
      py: mk(py),
      ytd: mk(cy),
      py2SamePoint: mk(py2, monthDay),
      pySamePoint: mk(py, monthDay),
    };
  };

  // ---- Funnel (FY + monthly) ------------------------------------------------
  const funnelFy = MILESTONES.map((m) => ({ stage: m.label, ...stageYearRow(m.date) }));

  const cyMonths: string[] = [];
  for (let mo = 1; mo <= now.getUTCMonth() + 1; mo++) {
    cyMonths.push(`${cy}-${String(mo).padStart(2, "0")}`);
  }
  const funnelMonthly = MILESTONES.map((m) => {
    const byMonth: Record<string, number> = {};
    for (const month of cyMonths) {
      byMonth[month] = projects.filter((p) => monthOf(m.date(p)) === month).length;
    }
    return { stage: m.label, byMonth };
  });

  // ---- CC / DA by month (cy) ------------------------------------------------
  const monthBars = (date: (p: Project) => string | null, net: boolean) =>
    cyMonths.map((month) => {
      const ps = projects.filter((p) => monthOf(date(p)) === month);
      const rev = sumAmount(net ? ps.filter(isNet) : ps);
      return { month, count: ps.length, revenue: rev };
    });
  const ccByMonth = monthBars((p) => p.constructionCompleteDate, false);
  const daByMonth = monthBars((p) => p.designApprovalDate, true);

  // ---- Run rate by office ---------------------------------------------------
  const runRateRow = (ps: Project[]) => {
    const sold = (year: string, throughMonthDay?: string) =>
      sumAmount(
        ps.filter((p) => {
          if (yearOf(p.closeDate) !== year || !isNet(p)) return false;
          if (throughMonthDay && p.closeDate!.slice(5, 10) > throughMonthDay) return false;
          return true;
        })
      );
    const ytdRev = sold(cy);
    const l3mRev = sumAmount(
      ps.filter((p) => p.closeDate && p.closeDate >= l3mLo && p.closeDate <= l3mHi && isNet(p))
    );
    return {
      py2Rev: sold(py2),
      pyRev: sold(py),
      py2SamePointRev: sold(py2, monthDay),
      pySamePointRev: sold(py, monthDay),
      ytdRev,
      ytdAnnualized: yearFrac > 0 ? ytdRev / yearFrac : 0,
      l3mAnnualized: (l3mRev / 3) * 12,
    };
  };
  const runRateByOffice = [
    ...SCORECARD_OFFICES.map((o) => ({ office: o, ...runRateRow(projects.filter(inOffice(o))) })),
    { office: "Company", ...runRateRow(projects) },
  ];

  // ---- Throughput by office -------------------------------------------------
  const throughputByOffice = [
    ...SCORECARD_OFFICES.map((o) => {
      const ps = projects.filter(inOffice(o));
      const row = (date: (p: Project) => string | null): StageYearRow => {
        const mk = (year: string, throughMonthDay?: string): CountRev => {
          const all = ps.filter((p) => {
            const d = date(p);
            if (!d || yearOf(d) !== year) return false;
            if (throughMonthDay && d.slice(5, 10) > throughMonthDay) return false;
            return true;
          });
          return { count: all.length, revenue: sumAmount(all.filter(isNet)) };
        };
        return {
          py2: mk(py2),
          py: mk(py),
          ytd: mk(cy),
          py2SamePoint: mk(py2, monthDay),
          pySamePoint: mk(py, monthDay),
        };
      };
      return {
        office: o,
        sales: row((p) => p.closeDate),
        das: row((p) => p.designApprovalDate),
        ccs: row((p) => p.constructionCompleteDate),
      };
    }),
    {
      office: "Company",
      sales: stageYearRow((p) => p.closeDate),
      das: stageYearRow((p) => p.designApprovalDate),
      ccs: stageYearRow((p) => p.constructionCompleteDate),
    },
  ];

  // ---- Cancellation cohorts (keyed on year SOLD) ----------------------------
  const cohort = (ps: Project[], soldYear: string) => {
    const sold = ps.filter((p) => yearOf(p.closeDate) === soldYear);
    const soldRev = sumAmount(sold);
    const cancelled = sold.filter((p) => p.stageId === CANCELLED);
    const sameYr = cancelled.filter((p) => yearOf(p.cancelledDate) === soldYear);
    const pct = (xs: Project[]) => (soldRev > 0 ? (sumAmount(xs) / soldRev) * 100 : null);
    return {
      sold: sold.length,
      sameYrCount: sameYr.length,
      sameYrRevPct: pct(sameYr),
      eventualCount: cancelled.length,
      eventualRevPct: pct(cancelled),
      sameYrRev: sumAmount(sameYr),
    };
  };

  const sameAge = (ps: Project[], soldYear: string): SameAgeCohort => {
    const sold = ps.filter(
      (p) =>
        yearOf(p.closeDate) === soldYear && p.closeDate!.slice(5, 10) <= monthDay
    );
    const soldRev = sumAmount(sold);
    const cancelled = sold.filter(
      (p) =>
        p.stageId === CANCELLED &&
        yearOf(p.cancelledDate) === soldYear &&
        (p.cancelledDate ?? "9999").slice(5, 10) <= monthDay
    );
    return {
      count: cancelled.length,
      sold: sold.length,
      revPct: soldRev > 0 ? (sumAmount(cancelled) / soldRev) * 100 : null,
    };
  };

  const cancellationFor = (ps: Project[], office: string): OfficeCancellation => {
    const a = cohort(ps, py2);
    const b = cohort(ps, py);
    const c = cohort(ps, cy);
    return {
      office,
      samePoint: { py2: sameAge(ps, py2), py: sameAge(ps, py), cy: sameAge(ps, cy) },
      py2: { sameYrCount: a.sameYrCount, sold: a.sold, sameYrRevPct: a.sameYrRevPct, eventualCount: a.eventualCount, eventualRevPct: a.eventualRevPct },
      py: { sameYrCount: b.sameYrCount, sold: b.sold, sameYrRevPct: b.sameYrRevPct, eventualCount: b.eventualCount, eventualRevPct: b.eventualRevPct },
      cy: { count: c.sameYrCount, sold: c.sold, revPct: c.sameYrRevPct, revLost: c.sameYrRev },
    };
  };

  const coProjects = projects.filter((p) => CO_OFFICES.has(loc(p)));
  const caProjects = projects.filter((p) => !CO_OFFICES.has(loc(p)) && (SCORECARD_OFFICES as readonly string[]).includes(loc(p)));
  const cancellations = [
    ...SCORECARD_OFFICES.map((o) => cancellationFor(projects.filter(inOffice(o)), o)),
    cancellationFor(coProjects, "Colorado"),
    cancellationFor(caProjects, "California"),
    cancellationFor(projects, "Company"),
  ];

  // ---- Efficiency (time metrics — cancelled excluded everywhere) ------------
  const live = projects.filter(notCancelled);

  const LEGS: Array<{ key: string; from: (p: Project) => string | null; to: (p: Project) => string | null }> = [
    { key: "Sale → day of survey", from: (p) => p.closeDate, to: (p) => p.siteSurveyScheduleDate },
    { key: "Survey day → completion", from: (p) => p.siteSurveyScheduleDate, to: (p) => p.siteSurveyCompletionDate },
    { key: "Survey completed → DA sent", from: (p) => p.siteSurveyCompletionDate, to: (p) => p.designApprovalSentDate },
    { key: "DA sent → approved", from: (p) => p.designApprovalSentDate, to: (p) => p.designApprovalDate },
    { key: "Permit submitted → issued", from: (p) => p.permitSubmitDate, to: (p) => p.permitIssueDate },
    { key: "Sale → permit issued", from: (p) => p.closeDate, to: (p) => p.permitIssueDate },
    // End-to-end forecasting legs. Recent sold-year cohorts only include
    // deals that already reached the milestone, so they skew fast.
    { key: "Sale → DA approved", from: (p) => p.closeDate, to: (p) => p.designApprovalDate },
    { key: "Sale → CC", from: (p) => p.closeDate, to: (p) => p.constructionCompleteDate },
  ];

  /** Median per bucket (month/quarter of the completing event). */
  const bucketedMedians = (
    leg: (typeof LEGS)[number],
    buckets: string[],
    bucketOf: (d: string | null) => string | null
  ): Record<string, number | null> => {
    const acc: Record<string, number[]> = {};
    for (const p of live) {
      const v = daysBetween(leg.from(p), leg.to(p));
      const b = bucketOf(leg.to(p));
      if (v === null || !b) continue;
      (acc[b] ??= []).push(v);
    }
    const out: Record<string, number | null> = {};
    for (const b of buckets) out[b] = round1(median(acc[b] ?? []));
    return out;
  };

  const EFFICIENCY_LEGS = LEGS.filter((l) =>
    ["Sale → day of survey", "DA sent → approved", "Permit submitted → issued"].includes(l.key)
  );
  const monthlyMedians = EFFICIENCY_LEGS.map((leg) => ({
    leg: leg.key,
    byMonth: bucketedMedians(leg, cyMonths, monthOf),
  }));

  const quarters: string[] = [];
  for (const y of [py2, py, cy]) {
    for (let q = 1; q <= 4; q++) {
      const label = `${y}Q${q}`;
      if (y === cy && q > Math.ceil((now.getUTCMonth() + 1) / 3)) continue;
      quarters.push(label);
    }
  }
  const quarterlyMedians = EFFICIENCY_LEGS.map((leg) => ({
    leg: leg.key,
    byQuarter: bucketedMedians(leg, quarters, quarterOf),
  }));

  /** Mean per sold-year cohort (by office). */
  const turnaroundsByOffice = [...SCORECARD_OFFICES, "Company"].map((o) => {
    const ps = o === "Company" ? live : live.filter(inOffice(o));
    const legs: Record<string, TurnaroundLegYearMeans> = {};
    for (const leg of LEGS) {
      const forYear = (year: string): MeanMed => {
        const vals = ps
          .filter((p) => yearOf(p.closeDate) === year)
          .map((p) => daysBetween(leg.from(p), leg.to(p)))
          .filter((v): v is number => v !== null);
        return { mean: round1(mean(vals)), median: round1(median(vals)) };
      };
      legs[leg.key] = { py2: forYear(py2), py: forYear(py), cy: forYear(cy) };
    }
    return { office: o, legs };
  });

  const sameDayDa = (year: string): number | null => {
    const withBoth = live.filter(
      (p) => p.designApprovalSentDate && p.designApprovalDate && yearOf(p.closeDate) === year
    );
    if (!withBoth.length) return null;
    const same = withBoth.filter(
      (p) => p.designApprovalSentDate!.slice(0, 10) === p.designApprovalDate!.slice(0, 10)
    );
    return Math.round((same.length / withBoth.length) * 100);
  };

  // ---- Capacity model -------------------------------------------------------
  const backlog = projects.filter(
    (p) => BACKLOG_STAGE_IDS.has(p.stageId) && !p.constructionCompleteDate
  );
  const onHoldNoCc = projects.filter((p) => p.stageId === ON_HOLD && !p.constructionCompleteDate);

  // Conversion from the last fully-baked cohort: sold Jan–Sep of prior year.
  const convCohort = projects.filter(
    (p) => p.closeDate !== null && p.closeDate >= `${py}-01-01` && p.closeDate < `${py}-10-01`
  );
  const convCohortRev = sumAmount(convCohort);
  const convCc = convCohort.filter((p) => p.constructionCompleteDate);
  const conversionPct = convCohortRev > 0 ? (sumAmount(convCc) / convCohortRev) * 100 : null;
  const convMedianDays = round1(
    median(
      convCc
        .map((p) => daysBetween(p.closeDate, p.constructionCompleteDate))
        .filter((v): v is number => v !== null)
    )
  );

  const last3Mo = (date: (p: Project) => string | null, net: boolean) => {
    const ps = projects.filter((p) => {
      const d = date(p);
      return d !== null && d >= l3mLo && d <= l3mHi && (!net || isNet(p));
    });
    return sumAmount(ps) / 3; // $/month over 3 complete calendar months
  };
  const burnPerMo = last3Mo((p) => p.constructionCompleteDate, false);
  const netSalesPacePerMo = last3Mo((p) => p.closeDate, true);
  const conv = conversionPct !== null ? conversionPct / 100 : null;
  const sustainSalesPerMo = conv && conv > 0 ? burnPerMo / conv : null;

  const ytdCcRev = sumAmount(projects.filter((p) => yearOf(p.constructionCompleteDate) === cy));
  const backlogRev = sumAmount(backlog);
  // Remaining-year new-sales CC contribution: sales through ~Sep can still CC in-year
  // given the ~84-day median lag.
  const monthsOfNewSalesConverting = Math.max(
    0,
    (Date.parse(`${cy}-10-01`) - now.getTime()) / (30.4 * 86_400_000)
  );
  const newSalesCc = netSalesPacePerMo * monthsOfNewSalesConverting * (conv ?? 0.8);
  const projectedFyCcLow = Math.round(ytdCcRev + backlogRev * 0.8 + newSalesCc * 0.85);
  const projectedFyCcHigh = Math.round(ytdCcRev + backlogRev * 0.9 + newSalesCc * 1.1);

  const capacityByOffice = SCORECARD_OFFICES.map((o) => {
    const ps = projects.filter(inOffice(o));
    const oBacklog = ps.filter((p) => BACKLOG_STAGE_IDS.has(p.stageId) && !p.constructionCompleteDate);
    const oCohort = ps.filter(
      (p) => p.closeDate !== null && p.closeDate >= `${py}-01-01` && p.closeDate < `${py}-10-01`
    );
    const oCohortRev = sumAmount(oCohort);
    const oConvPct =
      oCohortRev > 0
        ? (sumAmount(oCohort.filter((p) => p.constructionCompleteDate)) / oCohortRev) * 100
        : null;
    const ccYtd = sumAmount(ps.filter((p) => yearOf(p.constructionCompleteDate) === cy));
    const ccPacePerMo = dayOfYear >= 30 ? ccYtd / (dayOfYear / 30.4) : null;
    const sellingPacePerMo =
      sumAmount(
        ps.filter((p) => p.closeDate && p.closeDate >= l3mLo && p.closeDate <= l3mHi && isNet(p))
      ) / 3;
    const oConv = oConvPct !== null ? oConvPct / 100 : null;
    return {
      office: o,
      backlogRev: sumAmount(oBacklog),
      backlogCount: oBacklog.length,
      conversionPct: round1(oConvPct),
      ccPacePerMo: ccPacePerMo !== null ? Math.round(ccPacePerMo) : null,
      coverMonths:
        ccPacePerMo && ccPacePerMo > 0 ? round1(sumAmount(oBacklog) / ccPacePerMo) : null,
      sellingPacePerMo: Math.round(sellingPacePerMo),
      sustainPerMo:
        oConv && oConv > 0 && ccPacePerMo !== null ? Math.round(ccPacePerMo / oConv) : null,
    };
  });

  return {
    meta: {
      generatedAt: now.toISOString(),
      dataThrough,
      cy,
      py,
      py2,
      monthDay,
      monthDayLabel,
      l3mLabel,
      projectCount: projects.length,
    },
    capacity: {
      backlogRev,
      backlogCount: backlog.length,
      onHoldRev: sumAmount(onHoldNoCc),
      conversionPct: round1(conversionPct),
      convMedianDays,
      burnPerMo: Math.round(burnPerMo),
      netSalesPacePerMo: Math.round(netSalesPacePerMo),
      sustainSalesPerMo: sustainSalesPerMo !== null ? Math.round(sustainSalesPerMo) : null,
      coverMonths: burnPerMo > 0 ? round1(backlogRev / burnPerMo) : null,
      ytdCcRev,
      projectedFyCcLow,
      projectedFyCcHigh,
      byOffice: capacityByOffice,
    },
    ccByMonth,
    daByMonth,
    runRateByOffice,
    throughputByOffice,
    cancellations,
    funnelFy,
    funnelMonthly,
    efficiency: {
      monthlyMedians,
      quarterlyMedians,
      turnaroundsByOffice,
      sameDayDaPct: { py2: sameDayDa(py2), py: sameDayDa(py), cy: sameDayDa(cy) },
    },
  };
}
