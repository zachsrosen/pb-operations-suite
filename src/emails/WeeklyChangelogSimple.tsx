import { Section, Text } from "@react-email/components";
import * as React from "react";
import { EmailShell } from "./_components/EmailShell";
import { EmailButton } from "./_components/EmailButton";

export interface WeeklyChangelogSimpleProps {
  weekLabel: string;
  plainLanguageSummary: string;
  whatChanged: string[];
  whyItMatters: string[];
  actionItems?: string[];
  updatesUrl?: string;
}

export function WeeklyChangelogSimple({
  weekLabel,
  plainLanguageSummary,
  whatChanged,
  whyItMatters,
  actionItems,
  updatesUrl,
}: WeeklyChangelogSimpleProps) {
  const actions = actionItems || [];

  return (
    <EmailShell
      preview={`Weekly PB Ops Update (${weekLabel})`}
      subtitle="Weekly Changelog (Plain Language)"
      maxWidth={620}
    >
      <Section style={card}>
        <Text style={titleText}>This Week In PB Operations</Text>
        <Text style={metaText}>{weekLabel}</Text>
        <Text style={summaryText}>{plainLanguageSummary}</Text>
      </Section>

      <Section style={card}>
        <Text style={sectionTitle}>What Changed</Text>
        {whatChanged.map((item, index) => (
          <Text key={`changed-${index}`} style={itemText}>
            • {item}
          </Text>
        ))}
      </Section>

      <Section style={card}>
        <Text style={sectionTitle}>Why It Matters</Text>
        {whyItMatters.map((item, index) => (
          <Text key={`matters-${index}`} style={itemText}>
            • {item}
          </Text>
        ))}
      </Section>

      {actions.length > 0 && (
        <Section style={card}>
          <Text style={sectionTitle}>What You Need To Do</Text>
          {actions.map((item, index) => (
            <Text key={`action-${index}`} style={itemText}>
              • {item}
            </Text>
          ))}
        </Section>
      )}

      {updatesUrl ? (
        <Section style={ctaSection}>
          <EmailButton href={updatesUrl}>View Full Update Log</EmailButton>
        </Section>
      ) : null}
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

const ctaSection: React.CSSProperties = {
  textAlign: "center",
  marginTop: "8px",
};

WeeklyChangelogSimple.PreviewProps = {
  weekLabel: "Week of February 16-20, 2026",
  plainLanguageSummary:
    "We improved schedule notifications and fixed a few timing issues. Things should feel more consistent and easier to trust this week.",
  whatChanged: [
    "Inspection assignee email lookup now falls back to Zuper user data.",
    "Install notifications now include install details and equipment summary.",
    "Calendar sync now writes to the Denver survey and install calendars by location.",
  ],
  whyItMatters: [
    "Fewer missed notifications for assignees.",
    "Less back-and-forth to gather install context.",
    "Master schedule and shared calendars stay aligned.",
  ],
  actionItems: [
    "Use normal scheduling flow; no extra steps needed.",
    "Flag any email/calendar mismatch with deal ID.",
  ],
  updatesUrl: "https://www.pbtechops.com/updates",
} satisfies WeeklyChangelogSimpleProps;

export default WeeklyChangelogSimple;
