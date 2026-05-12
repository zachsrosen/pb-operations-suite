import { Hr, Section, Text } from "@react-email/components";
import * as React from "react";
import { EmailShell } from "./_components/EmailShell";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GoalLineItem {
  label: string;
  current: number;
  baseTarget: number;
  stretchTarget: number;
  /** 0–999, percent of base target */
  percent: number;
  /** Week-over-week change in current value */
  weekDelta: number;
  /** "green" | "yellow" | "red" — pace vs base target */
  pace: "green" | "yellow" | "red";
  /** Whether current exceeds base target */
  inStretchZone: boolean;
  format: "currency" | "count";
}

export interface OfficeBreakdown {
  officeName: string;
  goals: GoalLineItem[];
}

export interface GoalsWeeklyDigestProps {
  weekLabel: string; // e.g., "Week of May 5, 2026"
  dayOfMonth: number;
  daysInMonth: number;
  monthName: string;
  year: number;
  /** The focused office name */
  officeName: string;
  /** This office's goals — the hero section */
  officeGoals: GoalLineItem[];
  /** Company-wide rolled-up goals — secondary context */
  companyGoals: GoalLineItem[];
  /** Per-office breakdowns for the executive "All Locations" email */
  officeBreakdowns?: OfficeBreakdown[];
  /** Dashboard URL for this office */
  dashboardUrl: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}k`;
  return `$${value}`;
}

function fmtValue(value: number, format: "currency" | "count"): string {
  return format === "count" ? String(value) : fmtCurrency(value);
}

function fmtDelta(delta: number, format: "currency" | "count"): string {
  const sign = delta >= 0 ? "+" : "";
  if (format === "count") return `${sign}${delta}`;
  if (Math.abs(delta) >= 1_000) return `${sign}$${Math.round(delta / 1_000)}k`;
  return `${sign}$${delta}`;
}

const PACE_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  green:  { bg: "#064e3b", text: "#34d399", label: "On Pace" },
  yellow: { bg: "#713f12", text: "#fbbf24", label: "Behind" },
  red:    { bg: "#7f1d1d", text: "#f87171", label: "At Risk" },
};

const GOLD_COLOR = "#f59e0b";

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ProgressBar({ percent, pace, inStretchZone, baseTarget, stretchTarget }: {
  percent: number;
  pace: "green" | "yellow" | "red";
  inStretchZone: boolean;
  baseTarget: number;
  stretchTarget: number;
}) {
  const paceColors: Record<string, string> = {
    green: "#22c55e",
    yellow: "#eab308",
    red: "#ef4444",
  };

  const hasStretch = stretchTarget > baseTarget;
  const barMax = hasStretch ? stretchTarget : baseTarget;
  const baseMarkerPct = hasStretch ? Math.round((baseTarget / barMax) * 100) : 100;
  const currentAsPctOfMax = hasStretch ? Math.round((percent / 100) * (baseTarget / barMax) * 100) : Math.min(percent, 100);
  const fillPct = Math.min(currentAsPctOfMax, 100);
  const baseFillPct = Math.min(fillPct, baseMarkerPct);
  const goldFillPct = inStretchZone ? Math.max(fillPct - baseMarkerPct, 0) : 0;
  const emptyPct = 100 - baseFillPct - goldFillPct;

  // Table-based progress bar for email client compatibility (no position:absolute)
  return (
    <table cellPadding={0} cellSpacing={0} style={{ width: "100%", borderCollapse: "collapse" as const }}>
      <tbody>
        <tr>
          {baseFillPct > 0 && (
            <td style={{
              width: `${baseFillPct}%`,
              height: "8px",
              backgroundColor: paceColors[pace],
              borderRadius: baseFillPct >= 100 ? "4px" : "4px 0 0 4px",
            }} />
          )}
          {goldFillPct > 0 && (
            <td style={{
              width: `${goldFillPct}%`,
              height: "8px",
              backgroundColor: GOLD_COLOR,
              borderRadius: goldFillPct + baseFillPct >= 100 ? "0 4px 4px 0" : "0",
            }} />
          )}
          {emptyPct > 0 && (
            <td style={{
              width: `${emptyPct}%`,
              height: "8px",
              backgroundColor: "rgba(255,255,255,0.06)",
              borderRadius: baseFillPct === 0 && goldFillPct === 0 ? "4px" : "0 4px 4px 0",
            }} />
          )}
        </tr>
      </tbody>
    </table>
  );
}

function GoalRow({ goal }: { goal: GoalLineItem }) {
  const badge = PACE_BADGE[goal.pace];
  const valueColor = goal.inStretchZone ? GOLD_COLOR : badge.text;
  const deltaColor = goal.weekDelta >= 0 ? "#34d399" : "#f87171";

  return (
    <div style={{ marginBottom: "24px", paddingBottom: "20px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
      {/* Label row */}
      <Text style={{ ...goalLabel, margin: "0 0 8px 0" }}>{goal.label}</Text>
      {/* Value + status row — table layout for email compatibility */}
      <table cellPadding={0} cellSpacing={0} style={{ width: "100%", marginBottom: "12px" }}>
        <tbody>
          <tr>
            <td style={{ verticalAlign: "baseline" }}>
              <span style={{ fontSize: "24px", fontWeight: 700, color: valueColor }}>
                {fmtValue(goal.current, goal.format)}
              </span>
              <span style={{ fontSize: "13px", color: "#6b7280", marginLeft: "10px" }}>
                / {fmtValue(goal.baseTarget, goal.format)}
              </span>
              {goal.stretchTarget > goal.baseTarget && (
                <span style={{ fontSize: "12px", color: GOLD_COLOR, marginLeft: "8px", fontWeight: 600 }}>
                  ★ {fmtValue(goal.stretchTarget, goal.format)}
                </span>
              )}
            </td>
            <td style={{ verticalAlign: "baseline", textAlign: "right" as const, whiteSpace: "nowrap" as const }}>
              <span style={{
                display: "inline-block",
                fontSize: "12px",
                fontWeight: 600,
                padding: "3px 10px",
                borderRadius: "4px",
                backgroundColor: badge.bg,
                color: badge.text,
              }}>
                {goal.percent}%
              </span>
              <span style={{ fontSize: "13px", fontWeight: 500, color: deltaColor, marginLeft: "12px" }}>
                {fmtDelta(goal.weekDelta, goal.format)}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
      {/* Progress bar */}
      <ProgressBar
        percent={goal.percent}
        pace={goal.pace}
        inStretchZone={goal.inStretchZone}
        baseTarget={goal.baseTarget}
        stretchTarget={goal.stretchTarget}
      />
    </div>
  );
}

/** Compact row used in the company-wide context section */
function CompactGoalRow({ goal }: { goal: GoalLineItem }) {
  const badge = PACE_BADGE[goal.pace];
  const valueColor = goal.inStretchZone ? GOLD_COLOR : badge.text;
  const deltaColor = goal.weekDelta >= 0 ? "#34d399" : "#f87171";

  return (
    <table cellPadding={0} cellSpacing={0} style={{ width: "100%", marginBottom: "12px", paddingBottom: "10px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
      <tbody>
        <tr>
          <td style={{ width: "40%", verticalAlign: "middle", paddingRight: "12px" }}>
            <Text style={{ fontSize: "13px", color: "#94a3b8", margin: 0 }}>{goal.label}</Text>
          </td>
          <td style={{ verticalAlign: "middle", paddingRight: "8px" }}>
            <span style={{ fontSize: "15px", fontWeight: 600, color: valueColor }}>
              {fmtValue(goal.current, goal.format)}
            </span>
            <span style={{ fontSize: "12px", color: "#6b7280", marginLeft: "6px" }}>
              / {fmtValue(goal.baseTarget, goal.format)}
            </span>
          </td>
          <td style={{ verticalAlign: "middle", textAlign: "center" as const, paddingLeft: "8px", paddingRight: "8px" }}>
            <span style={{
              display: "inline-block",
              fontSize: "11px",
              fontWeight: 600,
              padding: "3px 8px",
              borderRadius: "4px",
              backgroundColor: badge.bg,
              color: badge.text,
              minWidth: "40px",
              textAlign: "center" as const,
            }}>
              {goal.percent}%
            </span>
          </td>
          <td style={{ verticalAlign: "middle", textAlign: "right" as const, paddingLeft: "8px", whiteSpace: "nowrap" as const }}>
            <span style={{ fontSize: "12px", fontWeight: 500, color: deltaColor }}>
              {fmtDelta(goal.weekDelta, goal.format)}
            </span>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Highlights — scoped to the focused office
// ---------------------------------------------------------------------------

function Highlights({ officeName, officeGoals }: { officeName: string; officeGoals: GoalLineItem[] }) {
  const stars: string[] = [];
  const wins: string[] = [];
  const warnings: string[] = [];

  for (const g of officeGoals) {
    if (g.inStretchZone) {
      stars.push(`${g.label} is in stretch territory! (${g.percent}%)`);
    } else if (g.pace === "green") {
      wins.push(`${g.label} is on pace (${g.percent}%)`);
    }
    if (g.pace === "red") warnings.push(`${g.label} is at risk — ${g.percent}% with pace behind`);
  }

  const greenCount = officeGoals.filter((g) => g.pace === "green").length;
  if (greenCount === officeGoals.length) {
    stars.unshift(`${officeName} is on pace across all ${greenCount} metrics!`);
  }

  if (stars.length === 0 && wins.length === 0 && warnings.length === 0) return null;

  return (
    <Section style={card}>
      <Text style={sectionTitle}>Highlights</Text>
      {stars.map((s, i) => (
        <Text key={`star-${i}`} style={{ ...metricRow, color: GOLD_COLOR }}>
          ★ {s}
        </Text>
      ))}
      {wins.map((w, i) => (
        <Text key={`win-${i}`} style={{ ...metricRow, color: "#34d399" }}>
          ✓ {w}
        </Text>
      ))}
      {warnings.map((w, i) => (
        <Text key={`warn-${i}`} style={{ ...metricRow, color: "#f87171" }}>
          ⚠ {w}
        </Text>
      ))}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Legend — explains colors, gold goal, and delta
// ---------------------------------------------------------------------------

const MONTH_TO_INDEX: Record<string, number> = {
  January: 0, February: 1, March: 2, April: 3, May: 4, June: 5,
  July: 6, August: 7, September: 8, October: 9, November: 10, December: 11,
};

function Legend({ priorDateStr }: { priorDateStr: string }) {
  const dotStyle = (color: string): React.CSSProperties => ({
    display: "inline-block",
    width: "10px",
    height: "10px",
    borderRadius: "50%",
    backgroundColor: color,
    marginRight: "6px",
    verticalAlign: "middle",
  });

  const rowStyle: React.CSSProperties = {
    fontSize: "12px",
    color: "#94a3b8",
    margin: "0 0 6px 0",
    lineHeight: "18px",
  };

  return (
    <Section style={{ padding: "12px 32px 4px 32px" }}>
      <table cellPadding={0} cellSpacing={0} style={{ width: "100%" }}>
        <tbody>
          <tr>
            <td style={{ verticalAlign: "top", paddingRight: "24px" }}>
              <Text style={{ ...rowStyle, margin: "0 0 4px 0", fontWeight: 700, color: "#6b7280", fontSize: "11px", textTransform: "uppercase" as const, letterSpacing: "1px" }}>Pace</Text>
              <Text style={rowStyle}><span style={dotStyle("#22c55e")} /> On Pace — tracking to hit goal</Text>
              <Text style={rowStyle}><span style={dotStyle("#eab308")} /> Behind — below expected pace</Text>
              <Text style={rowStyle}><span style={dotStyle("#ef4444")} /> At Risk — significantly behind</Text>
            </td>
            <td style={{ verticalAlign: "top" }}>
              <Text style={{ ...rowStyle, margin: "0 0 4px 0", fontWeight: 700, color: "#6b7280", fontSize: "11px", textTransform: "uppercase" as const, letterSpacing: "1px" }}>Key</Text>
              <Text style={rowStyle}>
                <span style={{ color: GOLD_COLOR, fontWeight: 600 }}>★ Gold</span> — stretch target beyond the base goal
              </Text>
              <Text style={rowStyle}>
                <span style={{ color: "#34d399", fontWeight: 600 }}>+$Xk</span> — change since {priorDateStr}
              </Text>
            </td>
          </tr>
        </tbody>
      </table>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Main component — per-office focused
// ---------------------------------------------------------------------------

export function GoalsWeeklyDigest({
  weekLabel,
  dayOfMonth,
  daysInMonth,
  monthName,
  year,
  officeName,
  officeGoals,
  companyGoals,
  officeBreakdowns,
  dashboardUrl,
}: GoalsWeeklyDigestProps) {
  const elapsedPct = Math.round((dayOfMonth / daysInMonth) * 100);

  // Compute prior week date for legend
  const monthIdx = MONTH_TO_INDEX[monthName] ?? 0;
  const priorDate = new Date(year, monthIdx, dayOfMonth - 7);
  const priorDateStr = priorDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <EmailShell
      preview={`${officeName} Goals — ${weekLabel}`}
      subtitle={`${officeName} Weekly Goals`}
      maxWidth={700}
    >
      {/* Month progress context */}
      <Section style={card}>
        <Text style={heading}>{officeName}</Text>
        <Text style={subtle}>
          {weekLabel} · Day {dayOfMonth} of {daysInMonth} — {elapsedPct}% of {monthName} {year} elapsed
        </Text>
      </Section>

      {/* Legend */}
      <Legend priorDateStr={priorDateStr} />

      {/* Highlights for this office */}
      <Highlights officeName={officeName} officeGoals={officeGoals} />

      {/* This office's goals — full detail with progress bars */}
      <Section style={card}>
        <Text style={sectionTitle}>{officeName} Goals</Text>
        {officeGoals.map((goal) => (
          <GoalRow key={goal.label} goal={goal} />
        ))}
      </Section>

      {companyGoals.length > 0 && (
        <>
          <Hr style={hr} />

          {/* Company-wide context — compact rows */}
          <Section style={card}>
            <Text style={sectionTitle}>Company-Wide (All Locations)</Text>
            {companyGoals.map((goal) => (
              <CompactGoalRow key={goal.label} goal={goal} />
            ))}
          </Section>
        </>
      )}

      {officeBreakdowns && officeBreakdowns.length > 0 && officeBreakdowns.map((office) => (
        <React.Fragment key={office.officeName}>
          <Hr style={hr} />
          <Section style={card}>
            <Text style={sectionTitle}>{office.officeName}</Text>
            {office.goals.map((goal) => (
              <CompactGoalRow key={goal.label} goal={goal} />
            ))}
          </Section>
        </React.Fragment>
      ))}

      <Hr style={hr} />

      <Section style={card}>
        <Text style={subtle}>
          View the live dashboard:{" "}
          <a href={dashboardUrl} style={{ color: "#f97316" }}>{dashboardUrl}</a>
        </Text>
      </Section>
    </EmailShell>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const card: React.CSSProperties = {
  padding: "20px 32px",
};

const heading: React.CSSProperties = {
  fontSize: "24px",
  fontWeight: 600,
  margin: "0 0 6px 0",
  color: "#ffffff",
};

const sectionTitle: React.CSSProperties = {
  fontSize: "13px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "1.5px",
  margin: "0 0 20px 0",
  color: "#94a3b8",
};

const goalLabel: React.CSSProperties = {
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "1.5px",
  textTransform: "uppercase",
  color: "#94a3b8",
};

const metricRow: React.CSSProperties = {
  fontSize: "14px",
  margin: "0 0 8px 0",
};

const subtle: React.CSSProperties = {
  color: "#6b7280",
  fontSize: "13px",
  margin: "0",
};

const hr: React.CSSProperties = {
  margin: "12px 32px",
  border: "0",
  borderTop: "1px solid #1e1e2e",
};

// ---------------------------------------------------------------------------
// Default export with mock preview data (for `npm run email:preview`)
// ---------------------------------------------------------------------------

const MOCK_OFFICE_GOALS: GoalLineItem[] = [
  { label: "Sales Closed",             current: 137000,  baseTarget: 1000000, stretchTarget: 1100000, percent: 14, weekDelta: 55000,  pace: "red",    inStretchZone: false, format: "currency" },
  { label: "Surveys Completed",        current: 109000,  baseTarget: 1000000, stretchTarget: 1100000, percent: 11, weekDelta: 42000,  pace: "red",    inStretchZone: false, format: "currency" },
  { label: "Design Approvals",         current: 281000,  baseTarget: 1000000, stretchTarget: 1100000, percent: 28, weekDelta: 95000,  pace: "yellow", inStretchZone: false, format: "currency" },
  { label: "Permits Issued",           current: 195000,  baseTarget: 1000000, stretchTarget: 1100000, percent: 20, weekDelta: 68000,  pace: "red",    inStretchZone: false, format: "currency" },
  { label: "Construction Completions", current: 187000,  baseTarget: 1000000, stretchTarget: 1100000, percent: 19, weekDelta: 72000,  pace: "red",    inStretchZone: false, format: "currency" },
  { label: "Inspections Passed",       current: 104000,  baseTarget: 1000000, stretchTarget: 1100000, percent: 10, weekDelta: 38000,  pace: "red",    inStretchZone: false, format: "currency" },
  { label: "PTO Granted",              current: 223000,  baseTarget: 1000000, stretchTarget: 1100000, percent: 22, weekDelta: 85000,  pace: "yellow", inStretchZone: false, format: "currency" },
  { label: "5-Star Reviews",           current: 1,       baseTarget: 15,      stretchTarget: 15,      percent: 7,  weekDelta: 1,      pace: "red",    inStretchZone: false, format: "count" },
];

const MOCK_COMPANY_GOALS: GoalLineItem[] = [
  { label: "Sales Closed",             current: 794000,  baseTarget: 3100000, stretchTarget: 3500000, percent: 26, weekDelta: 312000,  pace: "yellow", inStretchZone: false, format: "currency" },
  { label: "Surveys Completed",        current: 422000,  baseTarget: 3100000, stretchTarget: 3500000, percent: 14, weekDelta: 185000,  pace: "red",    inStretchZone: false, format: "currency" },
  { label: "Design Approvals",         current: 758000,  baseTarget: 3100000, stretchTarget: 3500000, percent: 24, weekDelta: 276000,  pace: "yellow", inStretchZone: false, format: "currency" },
  { label: "Permits Issued",           current: 615000,  baseTarget: 3100000, stretchTarget: 3500000, percent: 20, weekDelta: 230000,  pace: "yellow", inStretchZone: false, format: "currency" },
  { label: "Construction Completions", current: 438000,  baseTarget: 3100000, stretchTarget: 3500000, percent: 14, weekDelta: 198000,  pace: "red",    inStretchZone: false, format: "currency" },
  { label: "Inspections Passed",       current: 427000,  baseTarget: 3100000, stretchTarget: 3500000, percent: 14, weekDelta: 165000,  pace: "red",    inStretchZone: false, format: "currency" },
  { label: "PTO Granted",              current: 359000,  baseTarget: 3100000, stretchTarget: 3500000, percent: 12, weekDelta: 142000,  pace: "red",    inStretchZone: false, format: "currency" },
  { label: "5-Star Reviews",           current: 3,       baseTarget: 55,      stretchTarget: 55,      percent: 5,  weekDelta: 2,       pace: "red",    inStretchZone: false, format: "count" },
];

export default function GoalsWeeklyDigestPreview() {
  return (
    <GoalsWeeklyDigest
      weekLabel="Week of May 11, 2026"
      dayOfMonth={11}
      daysInMonth={31}
      monthName="May"
      year={2026}
      officeName="Westminster"
      officeGoals={MOCK_OFFICE_GOALS}
      companyGoals={MOCK_COMPANY_GOALS}
      dashboardUrl="https://pbtechops.com/dashboards/office-performance/westminster"
    />
  );
}
