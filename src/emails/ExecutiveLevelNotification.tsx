import { Section, Text } from "@react-email/components";
import * as React from "react";
import { EmailShell } from "./_components/EmailShell";

export interface ExecutiveLevelNotificationProps {
  title: string;
  reportWindow: string;
  summary: string;
  highlights: string[];
  risks?: string[];
  decisionsNeeded?: string[];
}

export function ExecutiveLevelNotification({
  title,
  reportWindow,
  summary,
  highlights,
  risks,
  decisionsNeeded,
}: ExecutiveLevelNotificationProps) {
  const riskItems = risks || [];
  const decisionItems = decisionsNeeded || [];

  return (
    <EmailShell
      preview={`Executive Alert: ${title}`}
      subtitle="Executive-Level Notification"
      maxWidth={620}
    >
      <Section style={card}>
        <Text style={titleText}>{title}</Text>
        <Text style={metaText}>{reportWindow}</Text>
        <Text style={summaryText}>{summary}</Text>
      </Section>

      <Section style={card}>
        <Text style={sectionTitle}>Top Highlights</Text>
        {highlights.map((item, index) => (
          <Text key={`highlight-${index}`} style={itemText}>
            • {item}
          </Text>
        ))}
      </Section>

      {riskItems.length > 0 && (
        <Section style={card}>
          <Text style={sectionTitle}>Risks To Watch</Text>
          {riskItems.map((item, index) => (
            <Text key={`risk-${index}`} style={itemText}>
              • {item}
            </Text>
          ))}
        </Section>
      )}

      {decisionItems.length > 0 && (
        <Section style={card}>
          <Text style={sectionTitle}>Decisions Needed</Text>
          {decisionItems.map((item, index) => (
            <Text key={`decision-${index}`} style={itemText}>
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
  margin: "0 0 12px 0",
};

const summaryText: React.CSSProperties = {
  color: "#e4e4e7",
  fontSize: "14px",
  margin: 0,
  lineHeight: "1.5",
};

const sectionTitle: React.CSSProperties = {
  color: "#fb923c",
  fontSize: "14px",
  fontWeight: 700,
  margin: "0 0 8px 0",
};

const itemText: React.CSSProperties = {
  color: "#e4e4e7",
  fontSize: "13px",
  margin: "0 0 6px 0",
  lineHeight: "1.5",
};

ExecutiveLevelNotification.PreviewProps = {
  title: "Weekly Executive Snapshot",
  reportWindow: "Week of February 16-20, 2026",
  summary:
    "Scheduling throughput remained strong this week, with site surveys and inspections on plan. Two install dates need executive confirmation due to weather and permit timing.",
  highlights: [
    "19 surveys scheduled, 18 completed on time",
    "7 installs confirmed for next week",
    "Inspection backlog reduced by 22%",
  ],
  risks: [
    "Two Colorado Springs installs may slip by one day due to weather",
    "One permit package still awaiting AHJ correction",
  ],
  decisionsNeeded: [
    "Approve overtime on Friday to clear remaining inspection backlog",
  ],
} satisfies ExecutiveLevelNotificationProps;

export default ExecutiveLevelNotification;
