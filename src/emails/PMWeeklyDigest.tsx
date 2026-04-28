import { Hr, Section, Text } from "@react-email/components";
import * as React from "react";
import { EmailShell } from "./_components/EmailShell";

export interface PmDigestRow {
  pmName: string;
  portfolioCount: number;
  ghostRate: number;
  ghostRateDelta: number | null; // week-over-week
  stuckCountNow: number;
  stuckCountDelta: number | null;
  readinessScore: number;
  readinessScoreDelta: number | null;
  fieldPopulationScore: number;
}

export interface AtRiskRow {
  pmName: string;
  dealName: string;
  reason: string;
  detail: string;
  daysAtRisk: number;
  url: string;
}

export interface PMWeeklyDigestProps {
  weekLabel: string; // e.g., "Week of April 28, 2026"
  rows: PmDigestRow[];
  atRisk: AtRiskRow[]; // top N items, pre-sorted
  dashboardUrl: string;
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatDelta(delta: number | null, kind: "pct" | "int"): string {
  if (delta == null) return "";
  const sign = delta > 0 ? "+" : "";
  if (kind === "pct") return ` (${sign}${(delta * 100).toFixed(1)}pp)`;
  return ` (${sign}${delta})`;
}

export function PMWeeklyDigest({
  weekLabel,
  rows,
  atRisk,
  dashboardUrl,
}: PMWeeklyDigestProps) {
  return (
    <EmailShell
      preview={`PM Accountability — ${weekLabel}`}
      subtitle="PM Accountability Digest"
    >
      <Section style={card}>
        <Text style={heading}>{weekLabel}</Text>
        <Text style={subtle}>
          Per-PM scorecards. Deltas are vs. last week&apos;s snapshot.
        </Text>
      </Section>

      <Section style={card}>
        <Text style={sectionTitle}>Per-PM scorecards</Text>
        {rows.length === 0 ? (
          <Text style={subtle}>No snapshots yet — first cron run pending.</Text>
        ) : (
          rows.map((r) => (
            <div key={r.pmName} style={pmBlock}>
              <Text style={pmName}>
                {r.pmName} <span style={subtle}>· {r.portfolioCount} active deals</span>
              </Text>
              <Text style={metricRow}>
                Ghost rate: <strong>{formatPct(r.ghostRate)}</strong>
                <span style={subtle}>{formatDelta(r.ghostRateDelta, "pct")}</span>
              </Text>
              <Text style={metricRow}>
                Stuck deals: <strong>{r.stuckCountNow}</strong>
                <span style={subtle}>{formatDelta(r.stuckCountDelta, "int")}</span>
              </Text>
              <Text style={metricRow}>
                Readiness: <strong>{formatPct(r.readinessScore)}</strong>
                <span style={subtle}>{formatDelta(r.readinessScoreDelta, "pct")}</span>
              </Text>
              <Text style={metricRow}>
                Data hygiene: <strong>{formatPct(r.fieldPopulationScore)}</strong>
              </Text>
            </div>
          ))
        )}
      </Section>

      {atRisk.length > 0 && (
        <Section style={card}>
          <Text style={sectionTitle}>At-risk deals (top {atRisk.length})</Text>
          {atRisk.map((d) => (
            <Text key={`${d.pmName}-${d.dealName}-${d.reason}`} style={metricRow}>
              <strong>{d.pmName}</strong> · {d.dealName} · <em>{d.reason}</em>
              <br />
              <span style={subtle}>{d.detail}</span>
            </Text>
          ))}
        </Section>
      )}

      <Hr style={hr} />
      <Section style={card}>
        <Text style={subtle}>
          Open the dashboard for drill-in:{" "}
          <a href={dashboardUrl}>{dashboardUrl}</a>
        </Text>
      </Section>
    </EmailShell>
  );
}

const card: React.CSSProperties = {
  padding: "16px 24px",
};

const heading: React.CSSProperties = {
  fontSize: "20px",
  fontWeight: 600,
  margin: "0 0 4px 0",
};

const sectionTitle: React.CSSProperties = {
  fontSize: "14px",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.5px",
  margin: "0 0 12px 0",
};

const pmBlock: React.CSSProperties = {
  marginBottom: "16px",
  borderLeft: "3px solid #06b6d4",
  paddingLeft: "12px",
};

const pmName: React.CSSProperties = {
  fontSize: "16px",
  fontWeight: 600,
  margin: "0 0 6px 0",
};

const metricRow: React.CSSProperties = {
  fontSize: "14px",
  margin: "0 0 4px 0",
};

const subtle: React.CSSProperties = {
  color: "#6b7280",
  fontSize: "12px",
};

const hr: React.CSSProperties = {
  margin: "16px 0",
  border: "0",
  borderTop: "1px solid #e5e7eb",
};

export default PMWeeklyDigest;
