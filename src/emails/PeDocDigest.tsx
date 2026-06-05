import { Hr, Link, Section, Text } from "@react-email/components";
import * as React from "react";
import { EmailShell } from "./_components/EmailShell";

export interface PeDocChange {
  dealId: string;
  dealName: string | null;
  docName: string;
  oldStatus: string;
  newStatus: string;
  /** PE reviewer comment attached to the new status, when present. */
  notes?: string | null;
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

// UPLOADED is merged into UNDER_REVIEW and shown as a single "In Review"
// status. Normalize before labeling/counting so the two never appear as
// distinct buckets (or as a meaningless "In Review → In Review" transition).
function canonStatus(s: string): string {
  return s === "UPLOADED" ? "UNDER_REVIEW" : s;
}

const STATUS_LABELS: Record<string, string> = {
  NOT_UPLOADED: "Not Uploaded",
  UPLOADED: "In Review",
  UNDER_REVIEW: "In Review",
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
  // Changes mode (real-time alert): the email is built around status changes
  // rather than the daily snapshot. Detected by the absence of snapshot data.
  const isChangesMode = changes.length > 0;

  // Group changes by deal ID (not name — names can repeat / be missing), while
  // keeping the resolved display name for the card title.
  const byDeal = new Map<string, { name: string | null; changes: PeDocChange[] }>();
  for (const c of changes) {
    let entry = byDeal.get(c.dealId);
    if (!entry) {
      entry = { name: c.dealName, changes: [] };
      byDeal.set(c.dealId, entry);
    }
    if (!entry.name && c.dealName) entry.name = c.dealName;
    entry.changes.push(c);
  }

  const dealEntries = [...byDeal.entries()].sort((a, b) =>
    (a[1].name || a[0]).localeCompare(b[1].name || b[0]),
  );

  // High-level rollup of all changes by resulting status, e.g.
  // "5 Approved · 20 Rejected · 3 Under Review". Rows where the status didn't
  // move (only the notes/dates changed) aren't real transitions, so they're
  // tallied separately as "Note updated" rather than inflating a status count.
  const STATUS_ORDER = [
    "APPROVED",
    "ACTION_REQUIRED",
    "REJECTED",
    "UNDER_REVIEW",
    "UPLOADED",
    "NOT_UPLOADED",
  ];
  const statusCounts = new Map<string, number>();
  let noteUpdateCount = 0;
  for (const c of changes) {
    // A row counts as a real transition only if the canonical status moved —
    // e.g. UPLOADED → UNDER_REVIEW is a no-op now that both are "In Review".
    if (canonStatus(c.oldStatus) === canonStatus(c.newStatus)) {
      noteUpdateCount++;
      continue;
    }
    statusCounts.set(canonStatus(c.newStatus), (statusCounts.get(canonStatus(c.newStatus)) || 0) + 1);
  }
  const overviewCounts = STATUS_ORDER.filter((s) => statusCounts.has(s)).map(
    (s) => ({ status: s, count: statusCounts.get(s)! }),
  );

  return (
    <EmailShell
      preview={
        isChangesMode
          ? `PE Doc Changes — ${date} | ${[
              ...overviewCounts.map((o) => `${o.count} ${statusLabel(o.status)}`),
              ...(noteUpdateCount > 0 ? [`${noteUpdateCount} note updated`] : []),
            ].join(", ")}`
          : `PE Doc Digest — ${date} | ${nearlyComplete.length} nearly done, ${notUploaded.length} not uploaded, ${actionRequired.length} need action`
      }
      subtitle={isChangesMode ? "PE Document Changes" : "PE Document Status Digest"}
      maxWidth={600}
    >
      {/* Summary card */}
      <Section style={summaryCard}>
        <Text style={summaryDate}>{date}</Text>
        {isChangesMode ? (
          <Text style={summaryCount}>
            {changes.length} document change{changes.length !== 1 ? "s" : ""} across{" "}
            {dealEntries.length} deal{dealEntries.length !== 1 ? "s" : ""}
          </Text>
        ) : (
          <>
            <Text style={summaryCount}>{totalDealsTracked} PE deals tracked</Text>
            <Text style={summaryMeta}>
              {nearlyComplete.length} nearly complete · {notUploaded.length} not uploaded · {actionRequired.length} need action
            </Text>
          </>
        )}
      </Section>

      {/* Overview — high-level rollup of all changes by resulting status,
          with note-only updates (no status move) tallied separately. */}
      {isChangesMode && (overviewCounts.length > 0 || noteUpdateCount > 0) && (
        <Section style={attentionSummaryCard}>
          <Text style={overviewHeader}>Overview</Text>
          {overviewCounts.map(({ status, count }) => (
            <Text key={status} style={summaryLine}>
              <span style={{ color: statusColor(status) }}>●</span>{" "}
              <b style={{ color: "#ffffff" }}>{count}</b>{" "}
              <span style={summaryLabel}>{statusLabel(status)}</span>
            </Text>
          ))}
          {noteUpdateCount > 0 && (
            <Text style={summaryLine}>
              <span style={{ color: "#71717a" }}>●</span>{" "}
              <b style={{ color: "#ffffff" }}>{noteUpdateCount}</b>{" "}
              <span style={summaryLabel}>Note updated</span>{" "}
              <span style={{ color: "#71717a" }}>(no status change)</span>
            </Text>
          )}
        </Section>
      )}

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
          {dealEntries.map(([dealId, { name, changes: dealChanges }]) => {
        const first = dealChanges[0];
        const hs = first.hubspotUrl || `https://app.hubspot.com/contacts/${portalId}/record/0-3/${dealId}`;
        const displayName = name || `Deal ${dealId}`;
        return (
          <Section key={dealId} style={dealCard}>
            <Text style={dealNameStyle}>
              <Link href={hs} style={dealLink}>{displayName}</Link>
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
                {canonStatus(c.oldStatus) === canonStatus(c.newStatus) ? (
                  // Notes/metadata changed but the (canonical) review status
                  // didn't move — label it as a note update instead of a
                  // same-status arrow like "In Review → In Review".
                  <Text style={statusLine}>
                    <span style={{ color: "#a1a1aa" }}>Note updated</span>{" "}
                    <span style={{ color: statusColor(c.newStatus) }}>
                      ({statusLabel(c.newStatus)})
                    </span>
                  </Text>
                ) : (
                  <Text style={statusLine}>
                    <span style={{ color: statusColor(c.oldStatus) }}>
                      {statusLabel(c.oldStatus)}
                    </span>
                    <span style={{ color: "#71717a" }}>{" "}→{" "}</span>
                    <span style={{ color: statusColor(c.newStatus) }}>
                      {statusLabel(c.newStatus)}
                    </span>
                  </Text>
                )}
                {c.notes && <Text style={noteText}>“{c.notes}”</Text>}
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

const noteText: React.CSSProperties = {
  color: "#a1a1aa",
  fontSize: "12px",
  fontStyle: "italic",
  lineHeight: "1.4",
  margin: "2px 0 0 0",
  paddingLeft: "8px",
  borderLeft: "2px solid #2a2a3e",
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

const overviewHeader: React.CSSProperties = {
  color: "#f97316",
  fontSize: "12px",
  fontWeight: "bold",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  margin: "0 0 8px 0",
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
