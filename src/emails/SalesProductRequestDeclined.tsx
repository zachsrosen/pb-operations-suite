import { Section, Text } from "@react-email/components";
import * as React from "react";
import { EmailShell } from "./_components/EmailShell";

export interface SalesProductRequestDeclinedProps {
  title: string;
  reviewerNote: string;
}

export function SalesProductRequestDeclined({
  title,
  reviewerNote,
}: SalesProductRequestDeclinedProps) {
  return (
    <EmailShell
      preview={`Your product request was declined: ${title}`}
      subtitle="Product Request Declined"
      maxWidth={620}
    >
      <Section style={card}>
        <Text style={headingText}>Your product request was declined</Text>
        <Text style={titleText}>{title}</Text>
        <Text style={label}>Note from Tech Ops</Text>
        <Text style={noteValue}>{reviewerNote}</Text>
        <Text style={bodyText}>
          Reply to this email if you have questions or want to discuss
          alternatives.
        </Text>
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

const headingText: React.CSSProperties = {
  color: "#f59e0b",
  fontWeight: 700,
  margin: "0 0 8px 0",
  fontSize: "14px",
  letterSpacing: "0.04em",
};

const titleText: React.CSSProperties = {
  fontSize: "20px",
  color: "#ffffff",
  margin: "0 0 16px 0",
  fontWeight: 600,
};

const label: React.CSSProperties = {
  color: "#71717a",
  fontSize: "11px",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  margin: "0 0 4px 0",
};

const noteValue: React.CSSProperties = {
  color: "#e4e4e7",
  fontSize: "14px",
  lineHeight: "1.5",
  margin: "0 0 16px 0",
  whiteSpace: "pre-wrap",
  paddingLeft: "12px",
  borderLeft: "2px solid #f59e0b",
};

const bodyText: React.CSSProperties = {
  color: "#a1a1aa",
  fontSize: "13px",
  lineHeight: "1.5",
  margin: "0",
};

SalesProductRequestDeclined.PreviewProps = {
  title: "REC Alpha Pure-R 410W",
  reviewerNote:
    "We already carry the REC Alpha Pure-R 400W which is functionally equivalent. Please use that one instead.",
} satisfies SalesProductRequestDeclinedProps;

export default SalesProductRequestDeclined;
