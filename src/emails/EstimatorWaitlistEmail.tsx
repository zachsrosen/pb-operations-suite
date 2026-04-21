import { Hr, Section, Text } from "@react-email/components";
import * as React from "react";
import { EmailShell } from "./_components/EmailShell";

export interface EstimatorWaitlistEmailProps {
  firstName: string;
  zip: string;
}

export function EstimatorWaitlistEmail({ firstName, zip }: EstimatorWaitlistEmailProps) {
  return (
    <EmailShell preview="Thanks for your interest in solar — we'll let you know." subtitle="You're on the list">
      <Section style={card}>
        <Text style={greeting}>Hi {firstName},</Text>
        <Text style={body}>
          Thanks for your interest in Photon Brothers. Unfortunately, {zip} is currently outside our service area.
        </Text>
        <Text style={body}>
          We've saved your info and will reach out if and when we expand to your area. No other solar company needs to
          know — we won't share your details.
        </Text>
        <Hr style={hr} />
        <Text style={small}>
          If your area has changed hands or you'd like to opt out, reply to this email and we'll take care of it.
        </Text>
      </Section>
    </EmailShell>
  );
}

const card: React.CSSProperties = { backgroundColor: "#15151d", padding: "24px", borderRadius: "8px" };
const greeting: React.CSSProperties = { color: "#ffffff", fontSize: "16px", marginBottom: "12px" };
const body: React.CSSProperties = { color: "#e6e6f0", fontSize: "14px", lineHeight: "1.6", marginBottom: "12px" };
const hr: React.CSSProperties = { borderColor: "#2a2a34", margin: "16px 0" };
const small: React.CSSProperties = { color: "#a0a0b0", fontSize: "12px" };
