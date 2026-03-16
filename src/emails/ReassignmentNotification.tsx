import { Hr, Link, Row, Section, Text } from "@react-email/components";
import * as React from "react";
import { EmailShell } from "./_components/EmailShell";

export interface ReassignmentNotificationProps {
  crewMemberName: string;
  reassignedByName: string;
  otherSurveyorName: string;
  direction: "outgoing" | "incoming";
  customerName: string;
  customerAddress: string;
  formattedDate: string;
  timeSlot: string;
  dealOwnerName?: string | null;
  notes?: string;
  hubSpotDealUrl?: string;
  zuperJobUrl?: string;
  googleCalendarEventUrl?: string;
}

export function ReassignmentNotification({
  crewMemberName,
  reassignedByName,
  otherSurveyorName,
  direction,
  customerName,
  customerAddress,
  formattedDate,
  timeSlot,
  dealOwnerName,
  notes,
  hubSpotDealUrl,
  zuperJobUrl,
  googleCalendarEventUrl,
}: ReassignmentNotificationProps) {
  const isOutgoing = direction === "outgoing";
  const contextLabel = isOutgoing
    ? `Now assigned to ${otherSurveyorName}`
    : `Previously assigned to ${otherSurveyorName}`;
  const hasLinks = !!hubSpotDealUrl || !!zuperJobUrl || (!isOutgoing && !!googleCalendarEventUrl);

  return (
    <EmailShell
      preview={`Site Survey Reassigned - ${customerName}`}
      subtitle={isOutgoing ? "Survey Reassigned Away" : "Survey Reassigned To You"}
    >
      <Section style={card}>
        <Text style={badge}>SITE SURVEY REASSIGNED</Text>
        <Text style={customerNameText}>{customerName}</Text>

        <Hr style={divider} />

        <DetailRow icon="Address" label="Address" value={customerAddress} />
        <DetailRow icon="Date" label="Date" value={formattedDate} />
        <DetailRow icon="Time" label="Time" value={timeSlot} />
        <DetailRow icon="Reassigned by" label="Reassigned by" value={reassignedByName} />
        {dealOwnerName && (
          <DetailRow icon="Deal owner" label="Deal owner" value={dealOwnerName} />
        )}

        <Section style={reassignmentBlock}>
          <Text style={reassignmentText}>{contextLabel}</Text>
        </Section>

        {notes && (
          <Section style={detailBlock}>
            <Text style={detailBlockLabel}>Notes</Text>
            <Text style={detailBlockText}>{notes}</Text>
          </Section>
        )}

        {hasLinks && (
          <Section style={detailBlock}>
            <Text style={detailBlockLabel}>Links</Text>
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
            {!isOutgoing && googleCalendarEventUrl && (
              <Text style={detailBlockText}>
                <Link href={googleCalendarEventUrl} style={link}>
                  Open Google Calendar Event
                </Link>
              </Text>
            )}
          </Section>
        )}
      </Section>

      <Text style={footer}>Please check your Zuper app for complete details.</Text>

      <Text style={hidden}>{crewMemberName}</Text>
    </EmailShell>
  );
}

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
        {icon}
      </Text>
      <Text style={rowValue}>
        <span style={rowValueLabel}>{label}: </span>
        {value}
      </Text>
    </Row>
  );
}

const card: React.CSSProperties = {
  backgroundColor: "#0a0a0f",
  border: "1px solid #1e1e2e",
  borderRadius: "8px",
  padding: "20px",
  marginBottom: "24px",
};

const badge: React.CSSProperties = {
  display: "inline-block",
  background: "linear-gradient(to right, #f59e0b, #fbbf24)",
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
  minWidth: "110px",
};

const rowValue: React.CSSProperties = {
  color: "#ffffff",
  fontSize: "13px",
  margin: 0,
  textAlign: "right",
};

const rowValueLabel: React.CSSProperties = {
  color: "#71717a",
};

const reassignmentBlock: React.CSSProperties = {
  backgroundColor: "#1e1e2e",
  borderRadius: "6px",
  borderLeft: "3px solid #f59e0b",
  padding: "12px",
  marginTop: "16px",
};

const reassignmentText: React.CSSProperties = {
  color: "#fbbf24",
  fontSize: "14px",
  fontWeight: 600,
  margin: 0,
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

ReassignmentNotification.PreviewProps = {
  crewMemberName: "Derek Thompson",
  reassignedByName: "Sarah Miller",
  otherSurveyorName: "Sam Paro",
  direction: "outgoing",
  customerName: "Williams, Robert",
  customerAddress: "1234 Solar Lane, Denver, CO 80202",
  formattedDate: "Monday, March 16, 2026",
  timeSlot: "9:00 AM - 10:00 AM",
  dealOwnerName: "Mike Chen",
  notes: "Gate code 2468. Call on arrival.",
  hubSpotDealUrl: "https://app.hubspot.com/contacts/123/record/0-3/456",
  zuperJobUrl: "https://app.zuperpro.com/jobs/789",
} satisfies ReassignmentNotificationProps;

export default ReassignmentNotification;
