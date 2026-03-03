import { Button, Hr, Section, Text } from "@react-email/components";
import * as React from "react";
import { EmailShell } from "./_components/EmailShell";

export interface SurveyConfirmationEmailProps {
  customerName: string;
  propertyAddress: string;
  formattedDate: string;   // "Friday, March 15, 2026"
  formattedTime: string;   // "9:00 AM MT"
  portalUrl: string;       // Link back to portal (for reschedule/cancel)
  calendarUrl?: string;    // Google Calendar add URL
}

export function SurveyConfirmationEmail({
  customerName,
  propertyAddress,
  formattedDate,
  formattedTime,
  portalUrl,
  calendarUrl,
}: SurveyConfirmationEmailProps) {
  const firstName = customerName.split(" ")[0] || customerName;

  return (
    <EmailShell
      preview={`Your site survey is confirmed for ${formattedDate}`}
      subtitle="Survey Confirmed"
    >
      <Section style={card}>
        {/* Success badge */}
        <Text style={successBadge}>CONFIRMED</Text>

        <Text style={greeting}>Hi {firstName},</Text>

        <Text style={paragraph}>
          Your site survey has been scheduled. Here are the details:
        </Text>

        <Hr style={divider} />

        <DetailRow label="Date" value={formattedDate} />
        <DetailRow label="Time" value={`${formattedTime} (approx. 1 hour)`} />
        <DetailRow label="Location" value={propertyAddress} />

        <Hr style={divider} />

        {calendarUrl && (
          <Section style={buttonContainer}>
            <Button style={calendarButton} href={calendarUrl}>
              Add to Google Calendar
            </Button>
          </Section>
        )}

        <Text style={subheading}>What to Expect</Text>
        <Text style={paragraph}>
          A Photon Brothers surveyor will visit your property to assess your roof condition,
          electrical panel, and sun exposure. Please ensure access to your main electrical panel.
        </Text>

        <Hr style={divider} />

        <Text style={smallText}>
          Need to make changes?{" "}
          <a href={portalUrl} style={link}>
            Reschedule or cancel
          </a>{" "}
          (up to 24 hours before your appointment).
        </Text>
      </Section>
    </EmailShell>
  );
}

// ─── Detail row ──────────────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <table style={{ width: "100%", marginBottom: "8px" }} cellPadding={0} cellSpacing={0}>
      <tbody>
        <tr>
          <td style={detailLabel}>{label}</td>
          <td style={detailValue}>{value}</td>
        </tr>
      </tbody>
    </table>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: "#ffffff",
  borderRadius: "8px",
  padding: "24px",
  border: "1px solid #e4e4e7",
};

const successBadge: React.CSSProperties = {
  display: "inline-block",
  backgroundColor: "#dcfce7",
  color: "#15803d",
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.05em",
  borderRadius: "4px",
  padding: "4px 10px",
  margin: "0 0 16px",
};

const greeting: React.CSSProperties = {
  fontSize: "18px",
  fontWeight: 600,
  color: "#171717",
  margin: "0 0 12px",
};

const paragraph: React.CSSProperties = {
  fontSize: "14px",
  lineHeight: "22px",
  color: "#3f3f46",
  margin: "0 0 12px",
};

const subheading: React.CSSProperties = {
  fontSize: "14px",
  fontWeight: 600,
  color: "#171717",
  margin: "0 0 8px",
};

const divider: React.CSSProperties = {
  borderColor: "#e4e4e7",
  margin: "16px 0",
};

const detailLabel: React.CSSProperties = {
  fontSize: "11px",
  fontWeight: 600,
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
  color: "#71717a",
  width: "80px",
  verticalAlign: "top",
  paddingTop: "2px",
};

const detailValue: React.CSSProperties = {
  fontSize: "14px",
  color: "#171717",
  fontWeight: 500,
};

const buttonContainer: React.CSSProperties = {
  textAlign: "center" as const,
  margin: "16px 0",
};

const calendarButton: React.CSSProperties = {
  backgroundColor: "#ffffff",
  borderRadius: "6px",
  border: "1px solid #d4d4d8",
  color: "#171717",
  fontSize: "13px",
  fontWeight: 500,
  textDecoration: "none",
  padding: "8px 20px",
  display: "inline-block",
};

const smallText: React.CSSProperties = {
  fontSize: "12px",
  color: "#a1a1aa",
  margin: "0",
  textAlign: "center" as const,
};

const link: React.CSSProperties = {
  color: "#f97316",
  textDecoration: "underline",
};
