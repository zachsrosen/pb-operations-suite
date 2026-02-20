import {
  Body,
  Container,
  Head,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";

interface EmailShellProps {
  preview: string;
  subtitle?: string;
  maxWidth?: number;
  children: React.ReactNode;
}

export function EmailShell({
  preview,
  subtitle,
  maxWidth = 500,
  children,
}: EmailShellProps) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={body}>
        <Container style={{ ...container, maxWidth }}>
          {/* Header */}
          <Section style={header}>
            <Text style={logoText}>PB Operations Suite</Text>
            {subtitle && <Text style={subtitleText}>{subtitle}</Text>}
          </Section>

          {/* Content */}
          {children}

          {/* Footer */}
          <Text style={footer}>Photon Brothers Operations Suite</Text>
        </Container>
      </Body>
    </Html>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const body: React.CSSProperties = {
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  backgroundColor: "#0a0a0f",
  color: "#ffffff",
  padding: "40px 20px",
  margin: 0,
};

const container: React.CSSProperties = {
  margin: "0 auto",
  backgroundColor: "#12121a",
  border: "1px solid #1e1e2e",
  borderRadius: "12px",
  padding: "32px",
};

const header: React.CSSProperties = {
  textAlign: "center",
  marginBottom: "32px",
};

const logoText: React.CSSProperties = {
  fontSize: "24px",
  fontWeight: "bold",
  background: "linear-gradient(to right, #f97316, #fb923c)",
  WebkitBackgroundClip: "text",
  WebkitTextFillColor: "transparent",
  margin: "0 0 8px 0",
  textAlign: "center",
};

const subtitleText: React.CSSProperties = {
  color: "#71717a",
  fontSize: "14px",
  textAlign: "center",
  margin: 0,
};

const footer: React.CSSProperties = {
  color: "#3f3f46",
  fontSize: "11px",
  textAlign: "center",
  marginTop: "24px",
};
