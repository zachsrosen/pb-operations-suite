import { Hr, Section, Text } from "@react-email/components";
import * as React from "react";
import { EmailShell } from "./_components/EmailShell";

export interface EstimatorManualQuoteEmailProps {
  firstName: string;
}

export function EstimatorManualQuoteEmail({ firstName }: EstimatorManualQuoteEmailProps) {
  return (
    <EmailShell
      preview="Got it — a Photon Brothers rep will reach out."
      subtitle="Manual quote request received"
    >
      <Section style={card}>
        <Text style={greeting}>Hi {firstName},</Text>
        <Text style={body}>
          Thanks — we got your info. Your utility isn't in our quick-quote list yet, so a real person from our team will
          put together a tailored estimate and reach out within one business day.
        </Text>
        <Text style={body}>
          If there's anything extra you want us to know before then, just reply to this email.
        </Text>
        <Hr style={hr} />
        <Text style={small}>Talk soon. — The Photon Brothers team</Text>
      </Section>
    </EmailShell>
  );
}

const card: React.CSSProperties = { backgroundColor: "#15151d", padding: "24px", borderRadius: "8px" };
const greeting: React.CSSProperties = { color: "#ffffff", fontSize: "16px", marginBottom: "12px" };
const body: React.CSSProperties = { color: "#e6e6f0", fontSize: "14px", lineHeight: "1.6", marginBottom: "12px" };
const hr: React.CSSProperties = { borderColor: "#2a2a34", margin: "16px 0" };
const small: React.CSSProperties = { color: "#a0a0b0", fontSize: "12px" };
