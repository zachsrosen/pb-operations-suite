import { Hr, Link, Row, Section, Text } from "@react-email/components";
import * as React from "react";
import { EmailShell } from "./_components/EmailShell";

export type OnCallPtoEvent = "requested" | "approved" | "denied";

export interface OnCallPtoNotificationProps {
  event: OnCallPtoEvent;
  crewMemberName: string;
  /** Pre-formatted PTO date range, e.g. "Mon, Aug 10 – Sun, Aug 16" */
  ptoRange: string;
  poolName: string;
  reason?: string | null;
  denialReason?: string | null;
  shortNotice: boolean;
  actionUrl: string;
  actionLabel: string;
}

const EVENT_META: Record<OnCallPtoEvent, { badge: string; badgeGradient: string; title: (p: OnCallPtoNotificationProps) => string; blurb: (p: OnCallPtoNotificationProps) => string }> = {
  requested: {
    badge: "NEEDS APPROVAL",
    badgeGradient: "linear-gradient(to right, #f97316, #fb923c)",
    title: (p) => `${p.crewMemberName} requested on-call PTO`,
    blurb: (p) =>
      `${p.crewMemberName} is asking to be taken off on-call for ${p.ptoRange}. Their shifts stay as published until a manager approves the request and reassigns coverage.`,
  },
  approved: {
    badge: "PTO APPROVED",
    badgeGradient: "linear-gradient(to right, #10b981, #34d399)",
    title: (p) => `Your on-call PTO is approved: ${p.ptoRange}`,
    blurb: () =>
      `A manager approved your PTO request and reassigned your on-call shifts. Google Calendar invites have been updated for the affected days.`,
  },
  denied: {
    badge: "PTO DENIED",
    badgeGradient: "linear-gradient(to right, #f43f5e, #fb7185)",
    title: (p) => `Your on-call PTO was denied: ${p.ptoRange}`,
    blurb: () => `A manager denied this PTO request, so your on-call shifts stay as published.`,
  },
};

export function OnCallPtoNotification(props: OnCallPtoNotificationProps) {
  const meta = EVENT_META[props.event];
  return (
    <EmailShell preview={meta.title(props)} subtitle="On-Call PTO">
      <Section style={card}>
        <Text style={{ ...badge, background: meta.badgeGradient }}>{meta.badge}</Text>
        {props.shortNotice && props.event !== "denied" && (
          <Text style={shortNoticeBadge}>SHORT NOTICE — WITHIN 2 WEEKS</Text>
        )}

        <Text style={titleText}>{meta.title(props)}</Text>
        <Text style={blurbText}>{meta.blurb(props)}</Text>

        <Hr style={divider} />

        <DetailRow label="Pool" value={props.poolName} />
        <DetailRow label="Electrician" value={props.crewMemberName} />
        <DetailRow label="PTO dates" value={props.ptoRange} />

        {props.reason && (
          <Section style={detailBlock}>
            <Text style={detailBlockLabel}>Reason</Text>
            <Text style={detailBlockText}>{props.reason}</Text>
          </Section>
        )}

        {props.event === "denied" && props.denialReason && (
          <Section style={detailBlock}>
            <Text style={detailBlockLabel}>Denial reason</Text>
            <Text style={detailBlockText}>{props.denialReason}</Text>
          </Section>
        )}

        <Section style={detailBlock}>
          <Text style={detailBlockText}>
            <Link href={props.actionUrl} style={link}>
              {props.actionLabel}
            </Link>
          </Text>
        </Section>
      </Section>

      <Text style={footer}>
        {props.event === "requested"
          ? "PTO only takes effect after a manager approves it and reassigns coverage."
          : "No further action is needed."}
      </Text>
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
  color: "#ffffff",
  padding: "4px 12px",
  borderRadius: "4px",
  fontSize: "12px",
  fontWeight: 600,
  marginBottom: "16px",
};

const shortNoticeBadge: React.CSSProperties = {
  display: "inline-block",
  backgroundColor: "#78350f",
  color: "#fcd34d",
  padding: "4px 12px",
  borderRadius: "4px",
  fontSize: "11px",
  fontWeight: 600,
  marginBottom: "16px",
  marginLeft: "8px",
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

// ─── Preview defaults ─────────────────────────────────────────────────────────

OnCallPtoNotification.PreviewProps = {
  event: "requested",
  crewMemberName: "Terrell Sanks",
  ptoRange: "Mon, Aug 10 – Sun, Aug 16",
  poolName: "Colorado",
  reason: "Family vacation",
  shortNotice: true,
  actionUrl: "https://www.pbtechops.com/dashboards/on-call/activity",
  actionLabel: "Review on the Activity page",
} satisfies OnCallPtoNotificationProps;

export default OnCallPtoNotification;
