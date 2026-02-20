import { Section, Text } from "@react-email/components";
import * as React from "react";
import { EmailShell } from "./_components/EmailShell";

export interface AvailabilityConflictItem {
  projectId: string;
  customerName: string;
  customerAddress: string;
  formattedDate: string; // Pre-formatted
  timeSlot: string; // Pre-formatted: "8:00 AM - 9:00 AM" | "Time not set"
}

export interface AvailabilityConflictProps {
  recipientName: string;
  surveyorName: string;
  blockedByName: string;
  blockedByEmail?: string;
  overrideTypeLabel: string; // "Full Day" | "Time Range"
  overrideDate: string; // Pre-formatted
  overrideWindow: string; // Pre-formatted
  overrideReason?: string;
  conflicts: AvailabilityConflictItem[];
}

export function AvailabilityConflict({
  recipientName,
  surveyorName,
  blockedByName,
  blockedByEmail,
  overrideTypeLabel,
  overrideDate,
  overrideWindow,
  overrideReason,
  conflicts,
}: AvailabilityConflictProps) {
  const count = conflicts.length;

  return (
    <EmailShell
      preview={`${count} survey conflict${count === 1 ? "" : "s"} for ${surveyorName} — action needed`}
      maxWidth={760}
    >
      {/* Title */}
      <Text style={title}>Availability Conflict Alert</Text>
      <Text style={intro}>
        {recipientName}, {surveyorName} added an availability block that overlaps
        existing scheduled site surveys.
      </Text>

      {/* Override summary */}
      <Section style={summaryBlock}>
        <Text style={summaryRow}>
          <strong>Blocked By:</strong> {blockedByName}
          {blockedByEmail ? ` (${blockedByEmail})` : ""}
        </Text>
        <Text style={summaryRow}>
          <strong>Surveyor:</strong> {surveyorName}
        </Text>
        <Text style={summaryRow}>
          <strong>Override:</strong> {overrideTypeLabel} on {overrideDate} (
          {overrideWindow})
        </Text>
        {overrideReason && (
          <Text style={summaryRow}>
            <strong>Reason:</strong> {overrideReason}
          </Text>
        )}
      </Section>

      {/* Conflict table header */}
      <Section style={tableHeader}>
        <Text style={colHead}>Customer</Text>
        <Text style={colHead}>Address</Text>
        <Text style={colHead}>Date</Text>
        <Text style={colHead}>Time</Text>
        <Text style={colHead}>Project</Text>
      </Section>

      {/* Conflict rows */}
      {conflicts.map((conflict) => (
        <Section key={conflict.projectId} style={tableRow}>
          <Text style={colPrimary}>{conflict.customerName}</Text>
          <Text style={colSecondary}>{conflict.customerAddress}</Text>
          <Text style={colSecondary}>{conflict.formattedDate}</Text>
          <Text style={colSecondary}>{conflict.timeSlot}</Text>
          <Text style={colSecondary}>{conflict.projectId}</Text>
        </Section>
      ))}

      <Text style={actionNote}>
        Please review and reschedule/cancel impacted surveys as needed.
      </Text>
    </EmailShell>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const title: React.CSSProperties = {
  fontSize: "22px",
  fontWeight: "bold",
  color: "#ffffff",
  margin: "0 0 8px 0",
};

const intro: React.CSSProperties = {
  color: "#a1a1aa",
  fontSize: "13px",
  margin: "0 0 20px 0",
};

const summaryBlock: React.CSSProperties = {
  backgroundColor: "#1e1e2e",
  borderRadius: "8px",
  padding: "12px",
  marginBottom: "16px",
};

const summaryRow: React.CSSProperties = {
  fontSize: "13px",
  color: "#e4e4e7",
  margin: "0 0 6px 0",
};

const tableHeader: React.CSSProperties = {
  display: "flex",
  borderBottom: "1px solid #1e1e2e",
  paddingBottom: "6px",
  marginBottom: "0",
};

const tableRow: React.CSSProperties = {
  display: "flex",
  borderBottom: "1px solid #1e1e2e",
  padding: "8px 0",
};

const colHead: React.CSSProperties = {
  color: "#71717a",
  fontSize: "11px",
  flex: 1,
  margin: 0,
  fontWeight: 600,
  textTransform: "uppercase",
};

const colPrimary: React.CSSProperties = {
  color: "#ffffff",
  fontSize: "13px",
  flex: 1,
  margin: 0,
};

const colSecondary: React.CSSProperties = {
  color: "#a1a1aa",
  fontSize: "12px",
  flex: 1,
  margin: 0,
};

const actionNote: React.CSSProperties = {
  color: "#a1a1aa",
  fontSize: "12px",
  marginTop: "18px",
};

// ─── Preview defaults ─────────────────────────────────────────────────────────

AvailabilityConflict.PreviewProps = {
  recipientName: "Sarah",
  surveyorName: "Alex Johnson",
  blockedByName: "Mike Chen",
  blockedByEmail: "mike@photonbrothers.com",
  overrideTypeLabel: "Full Day",
  overrideDate: "Friday, February 21, 2025",
  overrideWindow: "Full day",
  overrideReason: "Doctor appointment",
  conflicts: [
    {
      projectId: "12345678",
      customerName: "Williams, Robert",
      customerAddress: "1234 Solar Lane, Denver, CO 80202",
      formattedDate: "Friday, February 21, 2025",
      timeSlot: "9:00 AM - 10:00 AM",
    },
    {
      projectId: "87654321",
      customerName: "Garcia, Maria",
      customerAddress: "567 Sunshine Blvd, Lakewood, CO 80214",
      formattedDate: "Friday, February 21, 2025",
      timeSlot: "1:00 PM - 2:00 PM",
    },
  ],
} satisfies AvailabilityConflictProps;

export default AvailabilityConflict;
