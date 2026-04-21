import { Button, Hr, Section, Text } from "@react-email/components";
import * as React from "react";
import { EmailShell } from "./_components/EmailShell";

export interface EstimatorResultsEmailProps {
  firstName: string;
  resultsUrl: string;
  systemSizeKw: number;
  panelCount: number;
  finalUsd: number;
  monthlyPaymentUsd: number;
  offsetPercent: number;
}

export function EstimatorResultsEmail({
  firstName,
  resultsUrl,
  systemSizeKw,
  panelCount,
  finalUsd,
  monthlyPaymentUsd,
  offsetPercent,
}: EstimatorResultsEmailProps) {
  return (
    <EmailShell
      preview={`Your solar estimate — ${systemSizeKw.toFixed(1)} kW, ~$${Math.round(monthlyPaymentUsd)}/mo`}
      subtitle="Your Solar Estimate"
    >
      <Section style={card}>
        <Text style={greeting}>Hi {firstName},</Text>
        <Text style={body}>
          Thanks for using the Photon Brothers estimator. Here's a quick look at what we pulled together for your home:
        </Text>
        <Hr style={hr} />
        <Text style={row}>
          <strong>System size:</strong> {systemSizeKw.toFixed(1)} kW DC ({panelCount} panels)
        </Text>
        <Text style={row}>
          <strong>Expected offset:</strong> {Math.round(offsetPercent)}% of your annual usage
        </Text>
        <Text style={row}>
          <strong>Estimated final price:</strong> ${Math.round(finalUsd).toLocaleString()}
        </Text>
        <Text style={row}>
          <strong>Estimated monthly payment:</strong> ${Math.round(monthlyPaymentUsd).toLocaleString()} /mo
        </Text>
        <Hr style={hr} />
        <Text style={body}>
          Want the full breakdown with all incentives applied, or ready to tweak add-ons? Open your estimate:
        </Text>
        <Button href={resultsUrl} style={button}>
          View my estimate
        </Button>
        <Text style={small}>
          This link is good for 90 days. Numbers are an instant estimate — a final design is confirmed during a short
          consultation.
        </Text>
      </Section>
    </EmailShell>
  );
}

const card: React.CSSProperties = { backgroundColor: "#15151d", padding: "24px", borderRadius: "8px" };
const greeting: React.CSSProperties = { color: "#ffffff", fontSize: "16px", marginBottom: "12px" };
const body: React.CSSProperties = { color: "#e6e6f0", fontSize: "14px", lineHeight: "1.6" };
const row: React.CSSProperties = { color: "#e6e6f0", fontSize: "14px", margin: "6px 0" };
const hr: React.CSSProperties = { borderColor: "#2a2a34", margin: "16px 0" };
const button: React.CSSProperties = {
  backgroundColor: "#ff6b1f",
  color: "#ffffff",
  padding: "12px 20px",
  borderRadius: "6px",
  fontSize: "15px",
  textDecoration: "none",
  display: "inline-block",
  margin: "12px 0",
};
const small: React.CSSProperties = { color: "#a0a0b0", fontSize: "12px", marginTop: "16px" };
