import { Hr, Link, Section, Text } from "@react-email/components";
import * as React from "react";
import { EmailShell } from "./_components/EmailShell";

export interface PeDocChange {
  dealId: string;
  dealName: string | null;
  docName: string;
  oldStatus: string;
  newStatus: string;
  hubspotUrl?: string;
  pePortalUrl?: string | null;
}

export interface NearlyCompleteDeal {
  dealId: string;
  dealName: string | null;
  stage: string;
  approvedCount: number;
  inProgressCount: number;
  totalDocs: number;
  missingDocs: string[];
  hubspotUrl?: string;
  pePortalUrl?: string | null;
  driveUrl?: string | null;
}

export interface NotUploadedDeal {
  dealId: string;
  dealName: string | null;
  stage: string;
  missingDocs: string[];
  hubspotUrl?: string;
  pePortalUrl?: string | null;
  driveUrl?: string | null;
}

export interface ActionRequiredDeal {
  dealId: string;
  dealName: string | null;
  stage: string;
  issues: { docName: string; status: string; notes: string | null }[];
  hubspotUrl?: string;
  pePortalUrl?: string | null;
  driveUrl?: string | null;
}

export interface PeDocDigestProps {
  date: string;
  totalDealsTracked: number;
  nearlyComplete: NearlyCompleteDeal[];
  notUploaded: NotUploadedDeal[];
  actionRequired: ActionRequiredDeal[];
  changes: PeDocChange[];
  /**
   * Daily-digest only. When set, the email renders a compact actionable
   * summary + a button to the full PE Document Tracker instead of inlining
   * every deal (Gmail clips messages over ~102KB; the full list is 300KB+).
   * The real-time alert path (pe-doc-notify) omits this and renders changes.
   */
  reportUrl?: string;
}

const STATUS_LABELS: Record<string, string> = {
  NOT_UPLOADED: "Not Uploaded",
  UPLOADED: "Uploaded",
  UNDER_REVIEW: "Under Review",
  ACTION_REQUIRED: "Action Required",
  REJECTED: "Rejected",
  APPROVED: "Approved",
};

function statusLabel(s: string) {
  return STATUS_LABELS[s] || s;
}

function statusColor(s: string): string {
  switch (s) {
    case "APPROVED":
      return "#22c55e";
    case "ACTION_REQUIRED":
    case "REJECTED":
      return "#ef4444";
    case "UNDER_REVIEW":
      return "#f59e0b";
    case "UPLOADED":
      return "#3b82f6";
    default:
      return "#71717a";
  }
}

const portalId = "21710069";

export function PeDocDigest({
  date,
  totalDealsTracked,
  nearlyComplete,
  notUploaded,
  actionRequired,
  changes,
  reportUrl,
}: PeDocDigestProps) {
  // Group changes by deal
  const byDeal = new Map<string, PeDocChange[]>();
  for (const c of changes) {
    const key = c.dealName || c.dealId;
    if (!byDeal.has(key)) byDeal.set(key, []);
    byDeal.get(key)!.push(c);
  }

  const dealEntries = [...byDeal.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  );

  return (
    <EmailShell
      preview={`PE Doc Digest — ${date} | ${nearlyComplete.length} nearly done, ${notUploaded.length} not uploaded, ${actionRequired.length} need action`}
      subtitle="PE Document Status Digest"
      maxWidth={600}
    >
      {/* Summary card */}
      <Section style={summaryCard}>
        <Text style={summaryDate}>{date}</Text>
        <Text style={summaryCount}>
          {totalDealsTracked} PE deals tracked
        </Text>
        <Text style={summaryMeta}>
          {nearlyComplete.length} nearly complete · {notUploaded.length} not uploaded · {actionRequired.length} need action
          {changes.length > 0 && ` · ${changes.length} change${changes.length !== 1 ? "s" : ""}`}
        </Text>
      </Section>

      {/* Daily-digest summary + link to the full PE Document Tracker.
          The full per-deal detail (300KB+ across ~130 deals) is intentionally
          NOT inlined — Gmail clips messages over ~102KB, which previously cut
          the email off after the first section. Detail lives in the tracker. */}
      {reportUrl && (
        <>
          <Section style={attentionSummaryCard}>
            <Text style={summaryLine}>
              <span style={{ color: "#22c55e" }}>●</span>{" "}
              <span style={summaryLabel}>Nearly Complete</span>{" — "}
              <b>{nearlyComplete.length}</b> deal{nearlyComplete.length !== 1 ? "s" : ""} just 1–3 docs from done
            </Text>
            <Text style={summaryLine}>
              <span style={{ color: "#fbbf24" }}>●</span>{" "}
              <span style={summaryLabel}>Not Uploaded</span>{" — "}
              <b>{notUploaded.length}</b> deal{notUploaded.length !== 1 ? "s" : ""} with missing documents
            </Text>
            <Text style={summaryLine}>
              <span style={{ color: "#ef4444" }}>●</span>{" "}
              <span style={summaryLabel}>Action Required</span>{" — "}
              <b>{actionRequired.length}</b> deal{actionRequired.length !== 1 ? "s" : ""} with PE rejections to fix
            </Text>
          </Section>

          <Section style={ctaWrap}>
            <Link href={reportUrl} style={ctaButton}>Open the PE Document Tracker →</Link>
            <Text style={ctaHint}>
              Full per-deal status, rejection notes, and HubSpot / PE Portal / Drive links — sorted by what needs action first.
            </Text>
          </Section>
        </>
      )}

      {/* Section 4: Today's Changes — only rendered when changes are passed.
          The daily digest omits this (passes []); the real-time alert path
          (pe-doc-notify.ts) reuses this template and populates it. */}
      {changes.length > 0 && (
        <>
          <Section style={sectionHeader}>
            <Text style={sectionHeaderText}>
              Today&apos;s Changes ({changes.length})
            </Text>
          </Section>
          {dealEntries.map(([dealKey, dealChanges]) => {
        const first = dealChanges[0];
        const hs = first.hubspotUrl || `https://app.hubspot.com/contacts/${portalId}/record/0-3/${first.dealId}`;
        return (
          <Section key={dealKey} style={dealCard}>
            <Text style={dealNameStyle}>
              <Link href={hs} style={dealLink}>{dealKey}</Link>
              {first.pePortalUrl && (
                <>
                  {" "}
                  <Link href={first.pePortalUrl} style={portalLink}>PE Portal ↗</Link>
                </>
              )}
            </Text>
            <Hr style={thinDivider} />
            {dealChanges.map((c, i) => (
              <Section key={i} style={changeRow}>
                <Text style={docNameText}>{c.docName}</Text>
                <Text style={statusLine}>
                  <span style={{ color: statusColor(c.oldStatus) }}>
                    {statusLabel(c.oldStatus)}
                  </span>
                  <span style={{ color: "#71717a" }}>{" "}→{" "}</span>
                  <span style={{ color: statusColor(c.newStatus) }}>
                    {statusLabel(c.newStatus)}
                  </span>
                </Text>
              </Section>
            ))}
          </Section>
        );
          })}
        </>
      )}
    </EmailShell>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const summaryCard: React.CSSProperties = {
  backgroundColor: "#1a1a2e",
  border: "1px solid #2a2a3e",
  borderRadius: "8px",
  padding: "20px",
  marginBottom: "20px",
  textAlign: "center",
};

const summaryDate: React.CSSProperties = {
  color: "#f97316",
  fontSize: "18px",
  fontWeight: "bold",
  margin: "0 0 4px 0",
};

const summaryCount: React.CSSProperties = {
  color: "#ffffff",
  fontSize: "14px",
  margin: "0 0 4px 0",
};

const summaryMeta: React.CSSProperties = {
  color: "#71717a",
  fontSize: "12px",
  margin: 0,
};

const sectionHeader: React.CSSProperties = {
  marginTop: "28px",
  marginBottom: "12px",
};

const sectionHeaderText: React.CSSProperties = {
  color: "#f97316",
  fontSize: "14px",
  fontWeight: "bold",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  margin: 0,
};

const dealCard: React.CSSProperties = {
  backgroundColor: "#1a1a2e",
  border: "1px solid #2a2a3e",
  borderRadius: "8px",
  padding: "16px",
  marginBottom: "12px",
};

const thinDivider: React.CSSProperties = {
  borderColor: "#2a2a3e",
  margin: "8px 0",
};

const changeRow: React.CSSProperties = {
  padding: "4px 0",
};

const docNameText: React.CSSProperties = {
  color: "#a1a1aa",
  fontSize: "12px",
  margin: "0 0 2px 0",
};

const statusLine: React.CSSProperties = {
  fontSize: "13px",
  margin: 0,
};

const dealNameStyle: React.CSSProperties = {
  color: "#ffffff",
  fontSize: "14px",
  fontWeight: "bold",
  margin: "0",
};

const dealLink: React.CSSProperties = {
  color: "#ffffff",
  textDecoration: "underline",
  textDecorationColor: "#71717a",
  textUnderlineOffset: "2px",
};

const portalLink: React.CSSProperties = {
  color: "#34d399",
  fontSize: "11px",
  textDecoration: "none",
  fontWeight: "normal",
};

const attentionSummaryCard: React.CSSProperties = {
  backgroundColor: "#1a1a2e",
  border: "1px solid #2a2a3e",
  borderRadius: "8px",
  padding: "16px 20px",
  marginTop: "8px",
  marginBottom: "20px",
};

const summaryLine: React.CSSProperties = {
  color: "#d4d4d8",
  fontSize: "14px",
  lineHeight: "1.6",
  margin: "4px 0",
};

const summaryLabel: React.CSSProperties = {
  color: "#ffffff",
  fontWeight: "bold",
};

const ctaWrap: React.CSSProperties = {
  textAlign: "center",
  marginTop: "8px",
  marginBottom: "8px",
};

const ctaButton: React.CSSProperties = {
  backgroundColor: "#f97316",
  color: "#ffffff",
  fontSize: "15px",
  fontWeight: "bold",
  textDecoration: "none",
  padding: "12px 28px",
  borderRadius: "8px",
  display: "inline-block",
};

const ctaHint: React.CSSProperties = {
  color: "#71717a",
  fontSize: "12px",
  lineHeight: "1.5",
  margin: "12px 0 0 0",
  textAlign: "center",
};

export default PeDocDigest;
