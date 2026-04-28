import { Hr, Link, Row, Section, Text } from "@react-email/components";
import * as React from "react";
import { EmailShell } from "./_components/EmailShell";

export interface PmFlagAssignedProps {
  assigneeName: string;
  dealName: string;
  hubspotDealId: string;
  type: string;        // e.g. "STAGE_STUCK"
  severity: string;    // LOW|MEDIUM|HIGH|CRITICAL
  reason: string;
  raisedByName?: string | null;
  flagUrl: string;     // Deep-link to /dashboards/pm-action-queue?flag=...
  hubSpotDealUrl?: string;
}

const SEVERITY_COLORS: Record<string, { bg: string; fg: string; border: string }> = {
  CRITICAL: { bg: "#1f0f10", fg: "#fca5a5", border: "#ef4444" },
  HIGH:     { bg: "#1f1810", fg: "#fdba74", border: "#f97316" },
  MEDIUM:   { bg: "#1f1c10", fg: "#fcd34d", border: "#eab308" },
  LOW:      { bg: "#0f1a1f", fg: "#7dd3fc", border: "#0ea5e9" },
};

function humanizeType(type: string): string {
  return type.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

export function PmFlagAssigned({
  assigneeName,
  dealName,
  hubspotDealId,
  type,
  severity,
  reason,
  raisedByName,
  flagUrl,
  hubSpotDealUrl,
}: PmFlagAssignedProps) {
  const palette = SEVERITY_COLORS[severity] ?? SEVERITY_COLORS.MEDIUM;
  const severityLabel = `${severity} severity`;
  const typeLabel = humanizeType(type);

  return (
    <EmailShell
      preview={`[${severity}] PM flag on ${dealName}: ${typeLabel}`}
      subtitle="PM Flag Assignment"
    >
      <Section style={card}>
        <Text style={{ ...badge, background: palette.border }}>{severityLabel.toUpperCase()}</Text>
        <Text style={dealNameText}>{dealName}</Text>
        <Text style={typeText}>{typeLabel}</Text>

        <Hr style={divider} />

        <DetailRow label="Assigned to" value={assigneeName} />
        <DetailRow label="Deal" value={dealName} />
        <DetailRow label="Issue type" value={typeLabel} />
        <DetailRow label="Severity" value={severity} />
        {raisedByName && <DetailRow label="Raised by" value={raisedByName} />}

        <Section style={{ ...reasonBlock, borderLeft: `3px solid ${palette.border}`, backgroundColor: palette.bg }}>
          <Text style={reasonLabel}>Reason</Text>
          <Text style={{ ...reasonText, color: palette.fg }}>{reason}</Text>
        </Section>

        <Section style={detailBlock}>
          <Text style={detailBlockLabel}>Open</Text>
          <Text style={detailBlockText}>
            <Link href={flagUrl} style={primaryLink}>
              View this flag in PB Operations →
            </Link>
          </Text>
          {hubSpotDealUrl && (
            <Text style={detailBlockText}>
              <Link href={hubSpotDealUrl} style={link}>
                Open HubSpot deal
              </Link>
            </Text>
          )}
        </Section>
      </Section>

      <Text style={footer}>
        You were auto-assigned via round-robin. Acknowledge or resolve the flag in PB Operations to detach.
      </Text>
      <Text style={hidden}>{hubspotDealId}</Text>
    </EmailShell>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <Row style={row}>
      <Text style={rowLabel}>{label}</Text>
      <Text style={rowValue}>{value}</Text>
    </Row>
  );
}

const card: React.CSSProperties = {
  backgroundColor: "#0a0a0f",
  border: "1px solid #1e1e2e",
  borderRadius: "8px",
  padding: "20px",
  marginBottom: "24px",
};
const badge: React.CSSProperties = {
  display: "inline-block",
  color: "#ffffff",
  padding: "4px 12px",
  borderRadius: "4px",
  fontSize: "12px",
  fontWeight: 600,
  marginBottom: "12px",
};
const dealNameText: React.CSSProperties = {
  fontSize: "20px",
  color: "#ffffff",
  margin: "0 0 4px 0",
  fontWeight: 600,
};
const typeText: React.CSSProperties = {
  fontSize: "14px",
  color: "#a1a1aa",
  margin: "0 0 12px 0",
};
const divider: React.CSSProperties = { borderColor: "#1e1e2e", margin: "0 0 8px 0" };
const row: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  padding: "8px 0",
  borderBottom: "1px solid #1e1e2e",
};
const rowLabel: React.CSSProperties = { color: "#71717a", fontSize: "13px", margin: 0, minWidth: "110px" };
const rowValue: React.CSSProperties = { color: "#ffffff", fontSize: "13px", margin: 0, textAlign: "right" };
const reasonBlock: React.CSSProperties = { borderRadius: "6px", padding: "12px", marginTop: "16px" };
const reasonLabel: React.CSSProperties = { color: "#71717a", fontSize: "12px", margin: "0 0 6px 0", fontWeight: 600 };
const reasonText: React.CSSProperties = { fontSize: "14px", margin: 0, whiteSpace: "pre-line", lineHeight: 1.5 };
const detailBlock: React.CSSProperties = {
  backgroundColor: "#1e1e2e",
  borderRadius: "6px",
  padding: "12px",
  marginTop: "16px",
};
const detailBlockLabel: React.CSSProperties = { color: "#71717a", fontSize: "12px", margin: "0 0 6px 0" };
const detailBlockText: React.CSSProperties = {
  color: "#ffffff",
  fontSize: "13px",
  margin: "4px 0",
  whiteSpace: "pre-line",
};
const link: React.CSSProperties = { color: "#60a5fa", textDecoration: "underline" };
const primaryLink: React.CSSProperties = { color: "#fbbf24", textDecoration: "underline", fontWeight: 600 };
const footer: React.CSSProperties = { color: "#71717a", fontSize: "12px", textAlign: "center", margin: 0 };
const hidden: React.CSSProperties = { display: "none", maxHeight: 0, overflow: "hidden" };

PmFlagAssigned.PreviewProps = {
  assigneeName: "Sarah Miller",
  dealName: "Williams, Robert",
  hubspotDealId: "12345678",
  type: "STAGE_STUCK",
  severity: "HIGH",
  reason: "Deal has been in 'Permitting' for 14 days with no activity. Customer called twice this week asking for status.",
  raisedByName: "Mike Chen",
  flagUrl: "https://pbtechops.com/dashboards/pm-action-queue?flag=cmtest123",
  hubSpotDealUrl: "https://app.hubspot.com/contacts/123/record/0-3/12345678",
} satisfies PmFlagAssignedProps;

export default PmFlagAssigned;
