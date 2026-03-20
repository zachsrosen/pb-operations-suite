import { Hr, Link, Row, Section, Text } from "@react-email/components";
import * as React from "react";
import { EmailShell } from "./_components/EmailShell";

export interface AvailabilityApprovalRequestProps {
  crewMemberName: string;
  requestType: "add" | "modify" | "delete";
  dayOfWeek?: number | null; // 0-6
  startTime?: string | null; // "HH:MM"
  endTime?: string | null; // "HH:MM"
  location?: string | null;
  jobType?: string | null;
  reason?: string | null;
  requestedAt: string; // Pre-formatted date string
  approvalQueueUrl: string; // Link to the approval queue dashboard
}

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const REQUEST_TYPE_LABELS: Record<
  AvailabilityApprovalRequestProps["requestType"],
  string
> = {
  add: "Add",
  modify: "Modify",
  delete: "Delete",
};

export function AvailabilityApprovalRequest({
  crewMemberName,
  requestType,
  dayOfWeek,
  startTime,
  endTime,
  location,
  jobType,
  reason,
  requestedAt,
  approvalQueueUrl,
}: AvailabilityApprovalRequestProps) {
  const dayLabel =
    dayOfWeek != null ? (DAY_NAMES[dayOfWeek] ?? "—") : "—";

  const timeLabel =
    startTime && endTime ? `${startTime} – ${endTime}` : "—";

  return (
    <EmailShell
      preview={`Availability request from ${crewMemberName} — ${REQUEST_TYPE_LABELS[requestType]}`}
      subtitle="Availability Approval Request"
    >
      <Section style={card}>
        {/* Badge */}
        <Text style={badge}>AVAILABILITY REQUEST</Text>

        {/* Crew member name as title */}
        <Text style={titleText}>{crewMemberName}</Text>

        <Hr style={divider} />

        {/* Detail rows */}
        <DetailRow label="Request type" value={REQUEST_TYPE_LABELS[requestType]} />
        <DetailRow label="Day" value={dayLabel} />
        <DetailRow label="Time" value={timeLabel} />
        <DetailRow label="Location" value={location ?? "—"} />
        <DetailRow label="Job type" value={jobType ?? "—"} />
        <DetailRow label="Requested at" value={requestedAt} />

        {/* Reason block */}
        {reason && (
          <Section style={detailBlock}>
            <Text style={detailBlockLabel}>Reason</Text>
            <Text style={detailBlockText}>{reason}</Text>
          </Section>
        )}

        {/* Approval queue link */}
        <Section style={detailBlock}>
          <Text style={detailBlockText}>
            <Link href={approvalQueueUrl} style={link}>
              Review in PB Ops
            </Link>
          </Text>
        </Section>
      </Section>

      <Text style={footer}>
        This request requires manager approval before taking effect.
      </Text>

      {/* Invisible: used for plain-text only */}
      <Text style={hidden}>{crewMemberName}</Text>
    </EmailShell>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <Row style={row}>
      <Text style={rowLabel}>{label}</Text>
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
  background: "linear-gradient(to right, #3b82f6, #60a5fa)",
  color: "#ffffff",
  padding: "4px 12px",
  borderRadius: "4px",
  fontSize: "12px",
  fontWeight: 600,
  marginBottom: "16px",
};

const titleText: React.CSSProperties = {
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

AvailabilityApprovalRequest.PreviewProps = {
  crewMemberName: "Drew Perry",
  requestType: "add",
  dayOfWeek: 1,
  startTime: "08:00",
  endTime: "17:00",
  location: "Westminster",
  jobType: "construction",
  reason: "Adding Monday availability for next month",
  requestedAt: "Wednesday, March 19, 2026 at 2:30 PM",
  approvalQueueUrl:
    "https://pbtechops.com/dashboards/availability-approvals",
} satisfies AvailabilityApprovalRequestProps;

export default AvailabilityApprovalRequest;
