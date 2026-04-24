import { Section, Text } from "@react-email/components";
import * as React from "react";
import { EmailShell } from "./_components/EmailShell";
import { EmailButton } from "./_components/EmailButton";

export interface SalesProductRequestNotificationProps {
  requestId: string;
  type: "EQUIPMENT" | "ADDER";
  title: string;
  requestedBy: string;
  salesRequestNote: string;
  dealId: string | null;
  reviewUrl: string;
}

export function SalesProductRequestNotification({
  type,
  title,
  requestedBy,
  salesRequestNote,
  dealId,
  reviewUrl,
}: SalesProductRequestNotificationProps) {
  const typeLabel = type === "EQUIPMENT" ? "Product" : "Adder";
  return (
    <EmailShell
      preview={`New ${typeLabel.toLowerCase()} request: ${title}`}
      subtitle={`New ${typeLabel} Request`}
      maxWidth={620}
    >
      <Section style={card}>
        <Text style={badge}>{type}</Text>
        <Text style={titleText}>{title}</Text>

        <Section style={row}>
          <Text style={label}>Requested by</Text>
          <Text style={value}>{requestedBy}</Text>
        </Section>

        {dealId ? (
          <Section style={row}>
            <Text style={label}>Deal</Text>
            <Text style={value}>{dealId}</Text>
          </Section>
        ) : null}

        <Section style={row}>
          <Text style={label}>Why they need this</Text>
          <Text style={noteValue}>{salesRequestNote}</Text>
        </Section>
      </Section>

      <Section style={ctaSection}>
        <EmailButton href={reviewUrl}>Review Request</EmailButton>
      </Section>
    </EmailShell>
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
  color: "#22d3ee",
  fontWeight: 700,
  margin: "0 0 8px 0",
  fontSize: "12px",
  letterSpacing: "0.08em",
};

const titleText: React.CSSProperties = {
  fontSize: "20px",
  color: "#ffffff",
  margin: "0 0 16px 0",
  fontWeight: 600,
};

const row: React.CSSProperties = {
  marginBottom: "12px",
};

const label: React.CSSProperties = {
  color: "#71717a",
  fontSize: "11px",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  margin: "0 0 4px 0",
};

const value: React.CSSProperties = {
  color: "#e4e4e7",
  fontSize: "14px",
  margin: "0",
};

const noteValue: React.CSSProperties = {
  color: "#e4e4e7",
  fontSize: "14px",
  lineHeight: "1.5",
  margin: "0",
  whiteSpace: "pre-wrap",
};

const ctaSection: React.CSSProperties = {
  textAlign: "center",
  margin: "0",
};

SalesProductRequestNotification.PreviewProps = {
  requestId: "eq_abc123",
  type: "EQUIPMENT",
  title: "REC Alpha Pure-R 410W",
  requestedBy: "rep@photonbrothers.com",
  salesRequestNote:
    "Customer specifically asked for REC Alpha Pure-R. They saw it on another proposal and wants this exact model.",
  dealId: "12345678",
  reviewUrl: "https://www.pbtechops.com/dashboards/catalog/review?focus=eq_abc123",
} satisfies SalesProductRequestNotificationProps;

export default SalesProductRequestNotification;
