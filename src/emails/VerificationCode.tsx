import { Section, Text } from "@react-email/components";
import * as React from "react";
import { EmailShell } from "./_components/EmailShell";

interface VerificationCodeProps {
  code: string;
}

export function VerificationCode({ code }: VerificationCodeProps) {
  return (
    <EmailShell
      preview={`Your PB Operations login code: ${code}`}
      subtitle="Your login verification code"
      maxWidth={400}
    >
      {/* Code display */}
      <Section style={codeBox}>
        <Text style={codeText}>{code}</Text>
      </Section>

      <Text style={expiry}>This code expires in 10 minutes.</Text>
      <Text style={ignoreNote}>
        If you didn&apos;t request this code, you can safely ignore this email.
      </Text>
    </EmailShell>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const codeBox: React.CSSProperties = {
  backgroundColor: "#0a0a0f",
  border: "1px solid #1e1e2e",
  borderRadius: "8px",
  padding: "24px",
  textAlign: "center",
  marginBottom: "24px",
};

const codeText: React.CSSProperties = {
  fontSize: "36px",
  fontWeight: "bold",
  letterSpacing: "8px",
  color: "#ffffff",
  fontFamily: "monospace",
  margin: 0,
};

const expiry: React.CSSProperties = {
  color: "#71717a",
  fontSize: "13px",
  textAlign: "center",
  margin: "0 0 8px 0",
};

const ignoreNote: React.CSSProperties = {
  color: "#52525b",
  fontSize: "12px",
  textAlign: "center",
  margin: 0,
};

// ─── Preview defaults ─────────────────────────────────────────────────────────

VerificationCode.PreviewProps = {
  code: "847291",
} satisfies VerificationCodeProps;

export default VerificationCode;
