import { Button, Hr, Section, Text } from "@react-email/components";
import * as React from "react";
import { EmailShell } from "./_components/EmailShell";

export interface SurveyInviteEmailProps {
  customerName: string;
  propertyAddress: string;
  portalUrl: string;
}

export function SurveyInviteEmail({
  customerName,
  propertyAddress,
  portalUrl,
}: SurveyInviteEmailProps) {
  const firstName = customerName.split(" ")[0] || customerName;

  return (
    <EmailShell
      preview={`Schedule your site survey — ${propertyAddress}`}
      subtitle="Site Survey Scheduling"
    >
      <Section style={card}>
        <Text style={greeting}>Hi {firstName},</Text>

        <Text style={paragraph}>
          Thank you for choosing Photon Brothers for your solar project! The next step
          is a quick site survey where we&apos;ll assess your property for the best possible
          solar installation.
        </Text>

        <Text style={paragraph}>
          The survey takes about <strong>1 hour</strong> and is completely free. One of our
          surveyors will visit your property to evaluate your roof, electrical panel, and
          sun exposure.
        </Text>

        <Hr style={divider} />

        <Text style={addressLabel}>Survey Location</Text>
        <Text style={addressText}>{propertyAddress}</Text>

        <Hr style={divider} />

        <Text style={paragraph}>
          Click the button below to pick a date and time that works for you:
        </Text>

        <Section style={buttonContainer}>
          <Button style={button} href={portalUrl}>
            Schedule Your Survey
          </Button>
        </Section>

        <Text style={smallText}>
          This link is valid for 14 days. If it expires, contact your Photon Brothers
          representative for a new one.
        </Text>
      </Section>
    </EmailShell>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: "#ffffff",
  borderRadius: "8px",
  padding: "24px",
  border: "1px solid #e4e4e7",
};

const greeting: React.CSSProperties = {
  fontSize: "18px",
  fontWeight: 600,
  color: "#171717",
  margin: "0 0 16px",
};

const paragraph: React.CSSProperties = {
  fontSize: "14px",
  lineHeight: "22px",
  color: "#3f3f46",
  margin: "0 0 12px",
};

const divider: React.CSSProperties = {
  borderColor: "#e4e4e7",
  margin: "16px 0",
};

const addressLabel: React.CSSProperties = {
  fontSize: "11px",
  fontWeight: 600,
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
  color: "#71717a",
  margin: "0 0 4px",
};

const addressText: React.CSSProperties = {
  fontSize: "14px",
  color: "#171717",
  margin: "0",
};

const buttonContainer: React.CSSProperties = {
  textAlign: "center" as const,
  margin: "24px 0",
};

const button: React.CSSProperties = {
  backgroundColor: "#f97316",
  borderRadius: "8px",
  color: "#ffffff",
  fontSize: "16px",
  fontWeight: 600,
  textDecoration: "none",
  textAlign: "center" as const,
  padding: "12px 32px",
  display: "inline-block",
};

const smallText: React.CSSProperties = {
  fontSize: "12px",
  color: "#a1a1aa",
  margin: "0",
  textAlign: "center" as const,
};
