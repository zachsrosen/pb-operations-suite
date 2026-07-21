import { Hr, Link, Row, Section, Text } from "@react-email/components";
import * as React from "react";
import { EmailShell } from "./_components/EmailShell";
import type { ReminderVariant } from "@/lib/on-call-reminders";

export interface OnCallReminderProps {
  variant: ReminderVariant;
  memberName: string;
  poolName: string;
  /** Pre-formatted, e.g. "Mon, Nov 2 – Sun, Nov 8" (only the member's own days). */
  dateRange: string;
  /** Pre-formatted, e.g. "4:00 PM – 8:00 AM". */
  weekdayWindow: string;
  weekendWindow: string;
  /** False for pools with no Sunday coverage (California) — weekend label becomes Saturday-only. */
  coversSundays: boolean;
  /** IANA tz shown next to the shift windows, e.g. "America/Denver". */
  timezone: string;
  dashboardUrl: string;
}

const VARIANT_META: Record<ReminderVariant, { badge: string; badgeGradient: string; title: string; blurb: string }> = {
  "week-of": {
    badge: "ON CALL THIS WEEK",
    badgeGradient: "linear-gradient(to right, #10b981, #34d399)",
    title: "You're on call this week",
    blurb: "Your on-call shift starts today. The shifts are on your Google Calendar with reminders before each one.",
  },
  "week-ahead": {
    badge: "ON CALL NEXT WEEK",
    badgeGradient: "linear-gradient(to right, #f97316, #fb923c)",
    title: "You're on call next week",
    blurb: "Heads up — your on-call week starts Monday. If you need someone to cover, request a swap on your on-call page before your week begins.",
  },
};

export function OnCallReminder(props: OnCallReminderProps) {
  const meta = VARIANT_META[props.variant];
  const weekendLabel = props.coversSundays ? "Weekend hours (Sat & Sun)" : "Weekend hours (Sat)";
  return (
    <EmailShell preview={`${meta.title} — ${props.poolName} (${props.dateRange})`} subtitle="On-Call Rotation">
      <Section style={card}>
        <Text style={{ ...badge, background: meta.badgeGradient }}>{meta.badge}</Text>

        <Text style={titleText}>
          {meta.title}, {props.memberName}
        </Text>
        <Text style={blurbText}>{meta.blurb}</Text>

        <Hr style={divider} />

        <DetailRow label="Pool" value={props.poolName} />
        <DetailRow label="Your days" value={props.dateRange} />
        <DetailRow label="Weekday hours (Mon–Fri)" value={props.weekdayWindow} />
        <DetailRow label={weekendLabel} value={props.weekendWindow} />
        <DetailRow label="Timezone" value={props.timezone} />
        {!props.coversSundays && <Text style={noSundayNote}>This pool has no Sunday on-call coverage — your week runs Monday through Saturday.</Text>}

        <Section style={detailBlock}>
          <Text style={detailBlockText}>
            <Link href={props.dashboardUrl} style={link}>
              View the schedule or request a swap on your on-call page
            </Link>
          </Text>
        </Section>
      </Section>

      <Text style={footer}>Sent by the PB Tech Ops Suite on-call rotation.</Text>
    </EmailShell>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <Row style={rowStyle}>
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
  margin: "0 0 8px 0",
  fontWeight: 600,
};

const blurbText: React.CSSProperties = {
  fontSize: "14px",
  color: "#a1a1aa",
  margin: "0 0 16px 0",
  lineHeight: "20px",
};

const divider: React.CSSProperties = {
  borderColor: "#1e1e2e",
  margin: "0 0 8px 0",
};

const rowStyle: React.CSSProperties = {
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

const noSundayNote: React.CSSProperties = {
  color: "#71717a",
  fontSize: "12px",
  margin: "8px 0 0 0",
  lineHeight: "18px",
};

const detailBlock: React.CSSProperties = {
  backgroundColor: "#1e1e2e",
  borderRadius: "6px",
  padding: "12px",
  marginTop: "16px",
};

const detailBlockText: React.CSSProperties = {
  color: "#ffffff",
  fontSize: "13px",
  margin: 0,
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

// ─── Preview defaults ─────────────────────────────────────────────────────────

OnCallReminder.PreviewProps = {
  variant: "week-ahead",
  memberName: "Daniel Kelly",
  poolName: "Colorado",
  dateRange: "Mon, Nov 2 – Sun, Nov 8",
  weekdayWindow: "4:00 PM – 8:00 AM",
  weekendWindow: "8:00 AM – 12:00 PM",
  coversSundays: true,
  timezone: "America/Denver",
  dashboardUrl: "https://www.pbtechops.com/dashboards/on-call/me",
} satisfies OnCallReminderProps;

export default OnCallReminder;
