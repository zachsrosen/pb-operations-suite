import { Hr, Link, Row, Section, Text } from "@react-email/components";
import * as React from "react";
import { EmailShell } from "./_components/EmailShell";

export type OnCallSwapEvent = "requested" | "accepted" | "approved" | "denied";

export interface OnCallSwapNotificationProps {
  event: OnCallSwapEvent;
  requesterName: string;
  counterpartyName: string;
  /** Pre-formatted week/day range the requester is giving up, e.g. "Mon, Aug 10 – Sun, Aug 16" */
  requesterRange: string;
  /** Pre-formatted week/day range the counterparty currently holds */
  counterpartyRange: string;
  poolName: string;
  reason?: string | null;
  denialReason?: string | null;
  shortNotice: boolean;
  actionUrl: string;
  actionLabel: string;
}

const EVENT_META: Record<OnCallSwapEvent, { badge: string; badgeGradient: string; title: (p: OnCallSwapNotificationProps) => string; blurb: (p: OnCallSwapNotificationProps) => string }> = {
  requested: {
    badge: "SWAP REQUEST",
    badgeGradient: "linear-gradient(to right, #f97316, #fb923c)",
    title: (p) => `${p.requesterName} wants to swap on-call shifts with you`,
    blurb: (p) =>
      `${p.requesterName} is asking to cover your shift (${p.counterpartyRange}) and have you cover theirs (${p.requesterRange}). Accept or decline on your on-call page.`,
  },
  accepted: {
    badge: "NEEDS APPROVAL",
    badgeGradient: "linear-gradient(to right, #f97316, #fb923c)",
    title: (p) => `${p.requesterName} ↔ ${p.counterpartyName} swap needs a manager's approval`,
    blurb: (p) =>
      `${p.counterpartyName} accepted the swap. Nothing changes until a manager approves it on the on-call Activity page.`,
  },
  approved: {
    badge: "SWAP CONFIRMED",
    badgeGradient: "linear-gradient(to right, #10b981, #34d399)",
    title: (p) => `On-call swap confirmed: ${p.requesterName} ↔ ${p.counterpartyName}`,
    blurb: (p) =>
      `${p.counterpartyName} now covers ${p.requesterRange}, and ${p.requesterName} now covers ${p.counterpartyRange}. Google Calendar invites have been updated for both weeks.`,
  },
  denied: {
    badge: "SWAP DENIED",
    badgeGradient: "linear-gradient(to right, #f43f5e, #fb7185)",
    title: (p) => `On-call swap denied: ${p.requesterName} ↔ ${p.counterpartyName}`,
    blurb: () => `A manager denied this swap, so the schedule stays as published.`,
  },
};

export function OnCallSwapNotification(props: OnCallSwapNotificationProps) {
  const meta = EVENT_META[props.event];
  return (
    <EmailShell preview={meta.title(props)} subtitle="On-Call Swap">
      <Section style={card}>
        <Text style={{ ...badge, background: meta.badgeGradient }}>{meta.badge}</Text>
        {props.shortNotice && props.event !== "denied" && (
          <Text style={shortNoticeBadge}>SHORT NOTICE — WITHIN 2 WEEKS</Text>
        )}

        <Text style={titleText}>{meta.title(props)}</Text>
        <Text style={blurbText}>{meta.blurb(props)}</Text>

        <Hr style={divider} />

        <DetailRow label="Pool" value={props.poolName} />
        <DetailRow label={`${props.requesterName}'s shift`} value={props.requesterRange} />
        <DetailRow label={`${props.counterpartyName}'s shift`} value={props.counterpartyRange} />

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
        {props.event === "approved" || props.event === "denied"
          ? "No further action is needed."
          : "Swaps only take effect after a manager approves them."}
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

OnCallSwapNotification.PreviewProps = {
  event: "requested",
  requesterName: "Terrell Sanks",
  counterpartyName: "Christian White",
  requesterRange: "Mon, Aug 10 – Sun, Aug 16",
  counterpartyRange: "Mon, Jul 13 – Sun, Jul 19",
  poolName: "Colorado",
  reason: "Out of town that week",
  shortNotice: true,
  actionUrl: "https://www.pbtechops.com/dashboards/on-call/me",
  actionLabel: "Review on your on-call page",
} satisfies OnCallSwapNotificationProps;

export default OnCallSwapNotification;
