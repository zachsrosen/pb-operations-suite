import { Hr, Link, Row, Section, Text } from "@react-email/components";
import * as React from "react";
import { EmailShell } from "./_components/EmailShell";

export interface SchedulingNotificationProps {
  crewMemberName: string;
  scheduledByName: string;
  scheduledByEmail: string;
  dealOwnerName?: string | null;
  projectManagerName?: string | null;
  appointmentType: "survey" | "pre-sale-survey" | "installation" | "inspection";
  appointmentTypeLabel: string; // Already resolved: "Site Survey" | "Installation" | "Inspection"
  customerName: string;
  customerAddress: string;
  formattedDate: string; // Pre-formatted: "Friday, February 15, 2024"
  timeSlot: string; // Pre-formatted: "8:00 AM - 9:00 AM" | "Full day"
  notes?: string;
  installDetailLines?: string[]; // Pre-built lines from email.ts
  bomDetailLines?: string[]; // BOM snapshot summary lines (additive to installDetailLines)
  hubSpotDealUrl?: string;
  zuperJobUrl?: string;
  googleCalendarEventUrl?: string;
  zohoSoUrl?: string;
}

export function SchedulingNotification({
  crewMemberName,
  scheduledByName,
  dealOwnerName,
  projectManagerName,
  appointmentType,
  appointmentTypeLabel,
  customerName,
  customerAddress,
  formattedDate,
  timeSlot,
  notes,
  installDetailLines,
  bomDetailLines,
  hubSpotDealUrl,
  zuperJobUrl,
  googleCalendarEventUrl,
  zohoSoUrl,
}: SchedulingNotificationProps) {
  const hasInstallDetails = installDetailLines && installDetailLines.length > 0;
  const hasBomDetails = bomDetailLines && bomDetailLines.length > 0;
  const hasLinks = !!hubSpotDealUrl || !!zuperJobUrl || !!googleCalendarEventUrl || !!zohoSoUrl;
  const stakeholder =
    (appointmentType === "survey" || appointmentType === "pre-sale-survey") && dealOwnerName
      ? { icon: "🧑‍💼", label: "Deal owner", value: dealOwnerName }
      : (appointmentType === "installation" || appointmentType === "inspection") && projectManagerName
        ? { icon: "🧑‍🔧", label: "Project manager", value: projectManagerName }
        : null;

  return (
    <EmailShell
      preview={`New ${appointmentTypeLabel} scheduled — ${customerName}`}
      subtitle="New Appointment Scheduled"
    >
      <Section style={card}>
        {/* Appointment type badge */}
        <Text style={badge}>{appointmentTypeLabel.toUpperCase()}</Text>

        {/* Customer name */}
        <Text style={customerNameText}>{customerName}</Text>

        <Hr style={divider} />

        {/* Detail rows */}
        <DetailRow icon="📍" label="Address" value={customerAddress} />
        <DetailRow icon="📅" label="Date" value={formattedDate} />
        <DetailRow icon="⏰" label="Time" value={timeSlot} />
        <DetailRow icon="👤" label="Scheduled by" value={scheduledByName} />
        {stakeholder && (
          <DetailRow icon={stakeholder.icon} label={stakeholder.label} value={stakeholder.value} />
        )}

        {/* Install details block */}
        {hasInstallDetails && (
          <Section style={detailBlock}>
            <Text style={detailBlockLabel}>🔧 Install Details</Text>
            <Text style={detailBlockText}>
              {installDetailLines!.join("\n")}
            </Text>
          </Section>
        )}

        {/* BOM / Sales Order block */}
        {hasBomDetails && (
          <Section style={detailBlock}>
            <Text style={detailBlockLabel}>📦 Planset BOM / Sales Order</Text>
            <Text style={detailBlockText}>
              {bomDetailLines!.join("\n")}
            </Text>
          </Section>
        )}

        {/* Notes block */}
        {notes && (
          <Section style={detailBlock}>
            <Text style={detailBlockLabel}>📝 Notes</Text>
            <Text style={detailBlockText}>{notes}</Text>
          </Section>
        )}

        {hasLinks && (
          <Section style={detailBlock}>
            <Text style={detailBlockLabel}>🔗 Links</Text>
            {hubSpotDealUrl && (
              <Text style={detailBlockText}>
                <Link href={hubSpotDealUrl} style={link}>
                  Open HubSpot Deal
                </Link>
              </Text>
            )}
            {zuperJobUrl && (
              <Text style={detailBlockText}>
                <Link href={zuperJobUrl} style={link}>
                  Open Zuper Job
                </Link>
              </Text>
            )}
            {googleCalendarEventUrl && (
              <Text style={detailBlockText}>
                <Link href={googleCalendarEventUrl} style={link}>
                  Open Google Calendar Event
                </Link>
              </Text>
            )}
            {zohoSoUrl && (
              <Text style={detailBlockText}>
                <Link href={zohoSoUrl} style={link}>
                  Open Zoho Sales Order
                </Link>
              </Text>
            )}
          </Section>
        )}
      </Section>

      <Text style={footer}>
        Please check your Zuper app for complete details.
      </Text>

      {/* Invisible: used for plain-text only */}
      <Text style={hidden}>{crewMemberName}</Text>
    </EmailShell>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DetailRow({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: string;
}) {
  return (
    <Row style={row}>
      <Text style={rowLabel}>
        {icon} {label}
      </Text>
      <Text style={rowValue}>{value}</Text>
    </Row>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  backgroundColor: "#0a0a0f",
  border: "1px solid #1e1e2e",
  borderRadius: "8px",
  padding: "20px",
  marginBottom: "24px",
};

const badge: React.CSSProperties = {
  display: "inline-block",
  background: "linear-gradient(to right, #f97316, #fb923c)",
  color: "#ffffff",
  padding: "4px 12px",
  borderRadius: "4px",
  fontSize: "12px",
  fontWeight: 600,
  marginBottom: "16px",
};

const customerNameText: React.CSSProperties = {
  fontSize: "20px",
  color: "#ffffff",
  margin: "0 0 16px 0",
  fontWeight: 600,
};

const divider: React.CSSProperties = {
  borderColor: "#1e1e2e",
  margin: "0 0 8px 0",
};

const row: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  padding: "8px 0",
  borderBottom: "1px solid #1e1e2e",
};

const rowLabel: React.CSSProperties = {
  color: "#71717a",
  fontSize: "13px",
  margin: 0,
};

const rowValue: React.CSSProperties = {
  color: "#ffffff",
  fontSize: "13px",
  margin: 0,
  textAlign: "right",
};

const detailBlock: React.CSSProperties = {
  backgroundColor: "#1e1e2e",
  borderRadius: "6px",
  padding: "12px",
  marginTop: "16px",
};

const detailBlockLabel: React.CSSProperties = {
  color: "#71717a",
  fontSize: "12px",
  margin: "0 0 6px 0",
};

const detailBlockText: React.CSSProperties = {
  color: "#ffffff",
  fontSize: "13px",
  margin: 0,
  whiteSpace: "pre-line",
};

const link: React.CSSProperties = {
  color: "#60a5fa",
  textDecoration: "underline",
};

const footer: React.CSSProperties = {
  color: "#71717a",
  fontSize: "12px",
  textAlign: "center",
  margin: 0,
};

const hidden: React.CSSProperties = {
  display: "none",
  maxHeight: 0,
  overflow: "hidden",
};

// ─── Preview defaults ─────────────────────────────────────────────────────────

SchedulingNotification.PreviewProps = {
  crewMemberName: "Alex Johnson",
  scheduledByName: "Sarah Miller",
  scheduledByEmail: "sarah@photonbrothers.com",
  dealOwnerName: "Mike Chen",
  projectManagerName: "Jordan Lee",
  appointmentType: "survey",
  appointmentTypeLabel: "Site Survey",
  customerName: "Williams, Robert",
  customerAddress: "1234 Solar Lane, Denver, CO 80202",
  formattedDate: "Friday, February 21, 2025",
  timeSlot: "9:00 AM - 10:00 AM",
  notes: "Gate code is 4512. Dog in backyard.",
  hubSpotDealUrl: "https://app.hubspot.com/contacts/21710069/record/0-3/12345678901",
  zuperJobUrl: "https://web.zuperpro.com/jobs/123e4567-e89b-12d3-a456-426614174000/details",
  googleCalendarEventUrl: "https://calendar.google.com/calendar/event?eid=example",
} satisfies SchedulingNotificationProps;

export default SchedulingNotification;
