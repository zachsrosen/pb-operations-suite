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

  return (
    <div style={{ position: "relative", height: "8px", backgroundColor: "rgba(255,255,255,0.06)", borderRadius: "4px", overflow: "hidden", width: "100%" }}>
      <div style={{
        position: "absolute", top: 0, left: 0, bottom: 0,
        width: `${baseFillPct}%`,
        backgroundColor: paceColors[pace],
        borderRadius: "4px 0 0 4px",
      }} />
      {goldFillPct > 0 && (
        <div style={{
          position: "absolute", top: 0, bottom: 0,
          left: `${baseMarkerPct}%`,
          width: `${goldFillPct}%`,
          backgroundColor: GOLD_COLOR,
          borderRadius: "0 4px 4px 0",
        }} />
      )}
      {hasStretch && (
        <div style={{
          position: "absolute", top: 0, bottom: 0,
          left: `${baseMarkerPct}%`,
          width: "2px",
          backgroundColor: "rgba(255,255,255,0.3)",
        }} />
      )}
    </div>
  );
}

function GoalRow({ goal }: { goal: GoalLineItem }) {
  const badge = PACE_BADGE[goal.pace];
  const valueColor = goal.inStretchZone ? GOLD_COLOR : badge.text;
  const deltaColor = goal.weekDelta >= 0 ? "#34d399" : "#f87171";

  return (
    <div style={{ marginBottom: "16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "4px" }}>
        <Text style={{ ...goalLabel, margin: 0 }}>{goal.label}</Text>
        <div>
          <span style={{ fontSize: "18px", fontWeight: 700, color: valueColor }}>
            {fmtValue(goal.current, goal.format)}
          </span>
          <span style={{ fontSize: "12px", color: "#6b7280", marginLeft: "4px" }}>
            / {fmtValue(goal.baseTarget, goal.format)}
            {goal.stretchTarget > goal.baseTarget && (
              <span style={{ color: "rgba(245,158,11,0.5)", marginLeft: "2px" }}>
                / {fmtValue(goal.stretchTarget, goal.format)}
              </span>
            )}
          </span>
          <span style={{
            display: "inline-block",
            fontSize: "10px",
            fontWeight: 600,
            padding: "1px 6px",
            borderRadius: "4px",
            marginLeft: "8px",
            backgroundColor: badge.bg,
            color: badge.text,
          }}>
            {goal.percent}%
          </span>
        </div>
      </div>
      <ProgressBar
        percent={goal.percent}
        pace={goal.pace}
        inStretchZone={goal.inStretchZone}
        baseTarget={goal.baseTarget}
        stretchTarget={goal.stretchTarget}
      />
      <Text style={{ fontSize: "11px", color: deltaColor, margin: "4px 0 0 0" }}>
        {fmtDelta(goal.weekDelta, goal.format)} this week
      </Text>
    </div>
  );
}

/** Compact row used in the company-wide context section */
function CompactGoalRow({ goal }: { goal: GoalLineItem }) {
  const badge = PACE_BADGE[goal.pace];
  const valueColor = goal.inStretchZone ? GOLD_COLOR : badge.text;
  const deltaColor = goal.weekDelta >= 0 ? "#34d399" : "#f87171";

  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
      <Text style={{ fontSize: "11px", color: "#94a3b8", margin: 0, width: "40%" }}>{goal.label}</Text>
      <span style={{ fontSize: "13px", fontWeight: 600, color: valueColor }}>
        {fmtValue(goal.current, goal.format)}
      </span>
      <span style={{ fontSize: "11px", color: "#6b7280" }}>
        / {fmtValue(goal.baseTarget, goal.format)}
      </span>
      <span style={{
        display: "inline-block",
        fontSize: "9px",
        fontWeight: 600,
        padding: "1px 4px",
        borderRadius: "3px",
        backgroundColor: badge.bg,
        color: badge.text,
        minWidth: "32px",
        textAlign: "center" as const,
      }}>
        {goal.percent}%
      </span>
      <span style={{ fontSize: "10px", color: deltaColor, minWidth: "40px", textAlign: "right" as const }}>
        {fmtDelta(goal.weekDelta, goal.format)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Highlights — scoped to the focused office
// ---------------------------------------------------------------------------

function Highlights({ officeName, officeGoals }: { officeName: string; officeGoals: GoalLineItem[] }) {
  const stars: string[] = [];
  const warnings: string[] = [];

  for (const g of officeGoals) {
    if (g.inStretchZone) stars.push(`${g.label} is in stretch territory! (${g.percent}%)`);
    if (g.pace === "red") warnings.push(`${g.label} is at risk — ${g.percent}% with pace behind`);
  }

  const greenCount = officeGoals.filter((g) => g.pace === "green").length;
  if (greenCount === officeGoals.length) {
    stars.unshift(`${officeName} is on pace across all ${greenCount} metrics`);
  }

  if (stars.length === 0 && warnings.length === 0) return null;

  return (
    <Section style={card}>
      <Text style={sectionTitle}>Highlights</Text>
      {stars.map((s, i) => (
        <Text key={`star-${i}`} style={{ ...metricRow, color: GOLD_COLOR }}>
          ★ {s}
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
  dashboardUrl,
}: GoalsWeeklyDigestProps) {
  const elapsedPct = Math.round((dayOfMonth / daysInMonth) * 100);

  return (
    <EmailShell
      preview={`${officeName} Goals — ${weekLabel}`}
      subtitle={`${officeName} Weekly Goals`}
      maxWidth={600}
    >
      {/* Month progress context */}
      <Section style={card}>
        <Text style={heading}>{officeName}</Text>
        <Text style={subtle}>
          {weekLabel} · Day {dayOfMonth} of {daysInMonth} — {elapsedPct}% of {monthName} {year} elapsed
        </Text>
      </Section>

      {/* Highlights for this office */}
      <Highlights officeName={officeName} officeGoals={officeGoals} />

      {/* This office's goals — full detail with progress bars */}
      <Section style={card}>
        <Text style={sectionTitle}>{officeName} Goals</Text>
        {officeGoals.map((goal) => (
          <GoalRow key={goal.label} goal={goal} />
        ))}
      </Section>

      <Hr style={hr} />

      {/* Company-wide context — compact rows */}
      <Section style={card}>
        <Text style={sectionTitle}>Company-Wide (All Locations)</Text>
        {companyGoals.map((goal) => (
          <CompactGoalRow key={goal.label} goal={goal} />
        ))}
      </Section>

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
  padding: "16px 24px",
};

const heading: React.CSSProperties = {
  fontSize: "20px",
  fontWeight: 600,
  margin: "0 0 4px 0",
  color: "#ffffff",
};

const sectionTitle: React.CSSProperties = {
  fontSize: "13px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "1px",
  margin: "0 0 16px 0",
  color: "#94a3b8",
};

const goalLabel: React.CSSProperties = {
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "1px",
  textTransform: "uppercase",
  color: "#94a3b8",
};

const metricRow: React.CSSProperties = {
  fontSize: "13px",
  margin: "0 0 6px 0",
};

const subtle: React.CSSProperties = {
  color: "#6b7280",
  fontSize: "12px",
  margin: "0",
};

const hr: React.CSSProperties = {
  margin: "8px 24px",
  border: "0",
  borderTop: "1px solid #1e1e2e",
};

// ---------------------------------------------------------------------------
// Default export with mock preview data (for `npm run email:preview`)
// ---------------------------------------------------------------------------

const MOCK_OFFICE_GOALS: GoalLineItem[] = [
  { label: "Sales",                    current: 137000,  baseTarget: 1000000, stretchTarget: 1100000, percent: 14, weekDelta: 55000,  pace: "red",    inStretchZone: false, format: "currency" },
  { label: "Site Surveys",             current: 109000,  baseTarget: 1000000, stretchTarget: 1100000, percent: 11, weekDelta: 42000,  pace: "red",    inStretchZone: false, format: "currency" },
  { label: "Design Approvals",         current: 281000,  baseTarget: 1000000, stretchTarget: 1100000, percent: 28, weekDelta: 95000,  pace: "yellow", inStretchZone: false, format: "currency" },
  { label: "Construction Completions", current: 187000,  baseTarget: 1000000, stretchTarget: 1100000, percent: 19, weekDelta: 72000,  pace: "red",    inStretchZone: false, format: "currency" },
  { label: "Inspections",              current: 104000,  baseTarget: 1000000, stretchTarget: 1100000, percent: 10, weekDelta: 38000,  pace: "red",    inStretchZone: false, format: "currency" },
  { label: "PTO Granted",              current: 223000,  baseTarget: 1000000, stretchTarget: 1100000, percent: 22, weekDelta: 85000,  pace: "yellow", inStretchZone: false, format: "currency" },
  { label: "5-Star Reviews",           current: 1,       baseTarget: 15,      stretchTarget: 15,      percent: 7,  weekDelta: 1,      pace: "red",    inStretchZone: false, format: "count" },
];

const MOCK_COMPANY_GOALS: GoalLineItem[] = [
  { label: "Sales",                    current: 794000,  baseTarget: 3100000, stretchTarget: 3500000, percent: 26, weekDelta: 312000,  pace: "yellow", inStretchZone: false, format: "currency" },
  { label: "Site Surveys",             current: 422000,  baseTarget: 3100000, stretchTarget: 3500000, percent: 14, weekDelta: 185000,  pace: "red",    inStretchZone: false, format: "currency" },
  { label: "Design Approvals",         current: 758000,  baseTarget: 3100000, stretchTarget: 3500000, percent: 24, weekDelta: 276000,  pace: "yellow", inStretchZone: false, format: "currency" },
  { label: "Construction Completions", current: 438000,  baseTarget: 3100000, stretchTarget: 3500000, percent: 14, weekDelta: 198000,  pace: "red",    inStretchZone: false, format: "currency" },
  { label: "Inspections",              current: 427000,  baseTarget: 3100000, stretchTarget: 3500000, percent: 14, weekDelta: 165000,  pace: "red",    inStretchZone: false, format: "currency" },
  { label: "PTO Granted",              current: 359000,  baseTarget: 3100000, stretchTarget: 3500000, percent: 12, weekDelta: 142000,  pace: "red",    inStretchZone: false, format: "currency" },
  { label: "5-Star Reviews",           current: 3,       baseTarget: 55,      stretchTarget: 55,      percent: 5,  weekDelta: 2,       pace: "red",    inStretchZone: false, format: "count" },
];

export default function GoalsWeeklyDigestPreview() {
  return (
    <GoalsWeeklyDigest
      weekLabel="Week of May 5, 2026"
      dayOfMonth={8}
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
