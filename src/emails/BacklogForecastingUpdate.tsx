import { Section, Text } from "@react-email/components";
import * as React from "react";
import { EmailShell } from "./_components/EmailShell";

export interface BacklogForecastingUpdateProps {
  title: string;
  dateLabel: string;
  backlogSummary: string;
  backlogMetrics: string[];
  forecastWindow: string;
  forecastSummary: string;
  forecastPoints: string[];
  risks?: string[];
  actions?: string[];
}

export function BacklogForecastingUpdate({
  title,
  dateLabel,
  backlogSummary,
  backlogMetrics,
  forecastWindow,
  forecastSummary,
  forecastPoints,
  risks,
  actions,
}: BacklogForecastingUpdateProps) {
  const riskItems = risks || [];
  const actionItems = actions || [];

  return (
    <EmailShell
      preview={`Backlog + Forecasting: ${title}`}
      subtitle="Backlog & Forecasting Update"
      maxWidth={640}
    >
      <Section style={card}>
        <Text style={titleText}>{title}</Text>
        <Text style={metaText}>{dateLabel}</Text>
      </Section>

      <Section style={card}>
        <Text style={sectionTitle}>Backlog Snapshot</Text>
        <Text style={summaryText}>{backlogSummary}</Text>
        {backlogMetrics.map((item, index) => (
          <Text key={`backlog-${index}`} style={itemText}>
            • {item}
          </Text>
        ))}
      </Section>

      <Section style={card}>
        <Text style={sectionTitle}>Forecast Outlook</Text>
        <Text style={metaText}>{forecastWindow}</Text>
        <Text style={summaryText}>{forecastSummary}</Text>
        {forecastPoints.map((item, index) => (
          <Text key={`forecast-${index}`} style={itemText}>
            • {item}
          </Text>
        ))}
      </Section>

      {riskItems.length > 0 && (
        <Section style={card}>
          <Text style={sectionTitle}>Risks / Watchouts</Text>
          {riskItems.map((item, index) => (
            <Text key={`risk-${index}`} style={itemText}>
              • {item}
            </Text>
          ))}
        </Section>
      )}

      {actionItems.length > 0 && (
        <Section style={card}>
          <Text style={sectionTitle}>Recommended Actions</Text>
          {actionItems.map((item, index) => (
            <Text key={`action-${index}`} style={itemText}>
              • {item}
            </Text>
          ))}
        </Section>
      )}
    </EmailShell>
  );
}

const card: React.CSSProperties = {
  backgroundColor: "#0a0a0f",
  border: "1px solid #1e1e2e",
  borderRadius: "8px",
  padding: "16px",
  marginBottom: "16px",
};

const titleText: React.CSSProperties = {
  color: "#ffffff",
  fontSize: "20px",
  fontWeight: 700,
  margin: "0 0 4px 0",
};

const metaText: React.CSSProperties = {
  color: "#a1a1aa",
  fontSize: "12px",
  margin: "0 0 10px 0",
};

const sectionTitle: React.CSSProperties = {
  color: "#fb923c",
  fontSize: "14px",
  fontWeight: 700,
  margin: "0 0 8px 0",
};

const summaryText: React.CSSProperties = {
  color: "#e4e4e7",
  fontSize: "14px",
  margin: "0 0 8px 0",
  lineHeight: "1.5",
};

const itemText: React.CSSProperties = {
  color: "#e4e4e7",
  fontSize: "13px",
  margin: "0 0 6px 0",
  lineHeight: "1.5",
};

BacklogForecastingUpdate.PreviewProps = {
  title: "Weekly Backlog & Forecasting Digest",
  dateLabel: "Friday, February 20, 2026",
  backlogSummary:
    "Backlog is stable week-over-week, but two locations are trending toward over-capacity in the next 10 business days.",
  backlogMetrics: [
    "Open install backlog: 47 projects",
    "Aged backlog (>30 days in stage): 9 projects",
    "Inspection-ready backlog: 14 projects",
  ],
  forecastWindow: "Forecast Window: Monday Feb 23 - Friday Mar 6",
  forecastSummary:
    "Forecasted installs are front-loaded next week, with lighter volume in week two.",
  forecastPoints: [
    "DTC forecast: 9 installs (capacity 8)",
    "Westy forecast: 7 installs (capacity 8)",
    "COSP forecast: 5 installs (capacity 4)",
  ],
  risks: [
    "DTC and COSP forecast currently exceed configured daily crew capacity.",
    "Two permit-dependent installs could slide into week two.",
  ],
  actions: [
    "Pre-pull one DTC install into week two to reduce week-one compression.",
    "Confirm permit timing for the two at-risk installs before Tuesday.",
  ],
} satisfies BacklogForecastingUpdateProps;

export default BacklogForecastingUpdate;
