import { Section, Text } from "@react-email/components";
import * as React from "react";
import { EmailShell } from "./_components/EmailShell";

export interface SalesProductRequestApprovedProps {
  title: string;
  dealId: string | null;
}

export function SalesProductRequestApproved({
  title,
  dealId,
}: SalesProductRequestApprovedProps) {
  return (
    <EmailShell
      preview={`Your product request is live: ${title}`}
      subtitle="Product Request Added"
      maxWidth={620}
    >
      <Section style={card}>
        <Text style={headingText}>Your product request is live</Text>
        <Text style={titleText}>{title}</Text>
        <Text style={bodyText}>
          The product has been added to our catalog and queued for OpenSolar. It
          may take a few minutes to appear in the OpenSolar component library.
        </Text>
        {dealId ? (
          <Text style={bodyText}>
            Deal: <span style={dealText}>{dealId}</span>
          </Text>
        ) : null}
        <Text style={bodyText}>
          You can now use this product in your proposals.
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
  color: "#22d3ee",
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

const bodyText: React.CSSProperties = {
  color: "#e4e4e7",
  fontSize: "14px",
  lineHeight: "1.5",
  margin: "0 0 12px 0",
};

const dealText: React.CSSProperties = {
  color: "#a1a1aa",
  fontFamily: "monospace",
};

SalesProductRequestApproved.PreviewProps = {
  title: "REC Alpha Pure-R 410W",
  dealId: "12345678",
} satisfies SalesProductRequestApprovedProps;

export default SalesProductRequestApproved;
