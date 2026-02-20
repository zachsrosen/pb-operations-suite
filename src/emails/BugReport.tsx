import { Hr, Section, Text } from "@react-email/components";
import * as React from "react";
import { EmailShell } from "./_components/EmailShell";

export interface BugReportProps {
  reportId: string;
  title: string;
  description: string;
  pageUrl?: string;
  reporterName?: string;
  reporterEmail: string;
  timestamp: string; // Pre-formatted
}

export function BugReport({
  reportId,
  title,
  description,
  pageUrl,
  reporterName,
  reporterEmail,
  timestamp,
}: BugReportProps) {
  return (
    <EmailShell
      preview={`Bug Report: ${title}`}
      subtitle="New Bug Report Submitted"
    >
      <Section style={card}>
        {/* Severity badge */}
        <Text style={badge}>BUG REPORT</Text>

        {/* Title */}
        <Text style={titleText}>{title}</Text>

        {/* Description */}
        <Section style={descriptionBlock}>
          <Text style={descriptionText}>{description}</Text>
        </Section>

        <Hr style={divider} />

        {/* Metadata */}
        {pageUrl && <MetaRow label="Page" value={pageUrl} valueStyle={urlStyle} />}
        <MetaRow label="Reported by" value={reporterName || reporterEmail} />
        <MetaRow label="Email" value={reporterEmail} />
        <MetaRow label="Time" value={timestamp} />
      </Section>

      <Text style={ticketId}>Ticket ID: {reportId}</Text>
    </EmailShell>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MetaRow({
  label,
  value,
  valueStyle,
}: {
  label: string;
  value: string;
  valueStyle?: React.CSSProperties;
}) {
  return (
    <Section style={metaRow}>
      <Text style={metaLabel}>{label}</Text>
      <Text style={{ ...metaValue, ...valueStyle }}>{value}</Text>
    </Section>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  backgroundColor: "#0a0a0f",
  border: "1px solid #1e1e2e",
  borderRadius: "8px",
  padding: "20px",
  marginBottom: "16px",
};

const badge: React.CSSProperties = {
  display: "inline-block",
  backgroundColor: "#dc2626",
  color: "#ffffff",
  padding: "4px 12px",
  borderRadius: "4px",
  fontSize: "12px",
  fontWeight: 600,
  marginBottom: "16px",
};

const titleText: React.CSSProperties = {
  fontSize: "18px",
  color: "#ffffff",
  margin: "0 0 16px 0",
  fontWeight: 600,
};

const descriptionBlock: React.CSSProperties = {
  backgroundColor: "#1e1e2e",
  borderRadius: "6px",
  padding: "12px",
  marginBottom: "16px",
};

const descriptionText: React.CSSProperties = {
  color: "#ffffff",
  fontSize: "13px",
  margin: 0,
  whiteSpace: "pre-wrap",
};

const divider: React.CSSProperties = {
  borderColor: "#1e1e2e",
  margin: "0 0 8px 0",
};

const metaRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  padding: "8px 0",
  borderBottom: "1px solid #1e1e2e",
};

const metaLabel: React.CSSProperties = {
  color: "#71717a",
  fontSize: "13px",
  margin: 0,
};

const metaValue: React.CSSProperties = {
  color: "#ffffff",
  fontSize: "13px",
  margin: 0,
  textAlign: "right",
};

const urlStyle: React.CSSProperties = {
  color: "#60a5fa",
  wordBreak: "break-all",
};

const ticketId: React.CSSProperties = {
  color: "#71717a",
  fontSize: "12px",
  textAlign: "center",
  margin: 0,
};

// ─── Preview defaults ─────────────────────────────────────────────────────────

BugReport.PreviewProps = {
  reportId: "bug_abc123xyz",
  title: "Calendar doesn't load on mobile Safari",
  description:
    "When I open the construction scheduler on my iPhone (Safari 17), the calendar grid renders blank. Refreshing doesn't help. Only happens in Safari — Chrome on the same phone works fine.",
  pageUrl: "https://www.pbtechops.com/dashboards/construction-scheduler",
  reporterName: "Alex Johnson",
  reporterEmail: "alex@photonbrothers.com",
  timestamp: "Wed, Feb 19, 2025, 2:34 PM MST",
} satisfies BugReportProps;

export default BugReport;
