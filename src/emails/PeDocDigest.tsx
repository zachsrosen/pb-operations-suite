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
}

export interface NotUploadedDeal {
  dealId: string;
  dealName: string | null;
  stage: string;
  missingDocs: string[];
  hubspotUrl?: string;
  pePortalUrl?: string | null;
}

export interface ActionRequiredDeal {
  dealId: string;
  dealName: string | null;
  stage: string;
  issues: { docName: string; status: string; notes: string | null }[];
  hubspotUrl?: string;
  pePortalUrl?: string | null;
}

export interface PeDocDigestProps {
  date: string;
  totalDealsTracked: number;
  nearlyComplete: NearlyCompleteDeal[];
  notUploaded: NotUploadedDeal[];
  actionRequired: ActionRequiredDeal[];
  changes: PeDocChange[];
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

      {/* Section 1: Nearly Complete */}
      {nearlyComplete.length > 0 && (
        <>
          <Section style={sectionHeader}>
            <Text style={sectionHeaderText}>
              Nearly Complete ({nearlyComplete.length})
            </Text>
          </Section>
          {nearlyComplete.map((deal) => {
            const hs = deal.hubspotUrl || `https://app.hubspot.com/contacts/${portalId}/record/0-3/${deal.dealId}`;
            return (
              <Section key={deal.dealId} style={nearlyCard}>
                <Text style={dealNameStyle}>
                  <Link href={hs} style={dealLink}>{deal.dealName || deal.dealId}</Link>
                  <span style={stageTag}>{deal.stage}</span>
                  {deal.pePortalUrl && (
                    <>{" "}<Link href={deal.pePortalUrl} style={portalLink}>PE Portal ↗</Link></>
                  )}
                </Text>
                <Text style={progressText}>
                  {deal.approvedCount}/{deal.totalDocs} approved
                  {deal.inProgressCount > 0 && (
                    <span style={{ color: "#3b82f6" }}>{" "}· {deal.inProgressCount} in review</span>
                  )}
                  {" "}· <span style={{ color: "#fbbf24" }}>{deal.missingDocs.length} need action</span>
                </Text>
                <Hr style={thinDivider} />
                {deal.missingDocs.map((doc, i) => (
                  <Text key={i} style={missingDocText}>{doc}</Text>
                ))}
              </Section>
            );
          })}
        </>
      )}

      {/* Section 2: Not Uploaded */}
      {notUploaded.length > 0 && (
        <>
          <Section style={sectionHeader}>
            <Text style={sectionHeaderText}>
              Not Uploaded ({notUploaded.length})
            </Text>
          </Section>
          {notUploaded.map((deal) => {
            const hs = deal.hubspotUrl || `https://app.hubspot.com/contacts/${portalId}/record/0-3/${deal.dealId}`;
            return (
              <Section key={deal.dealId} style={notUploadedCard}>
                <Text style={dealNameStyle}>
                  <Link href={hs} style={dealLink}>{deal.dealName || deal.dealId}</Link>
                  <span style={stageTag}>{deal.stage}</span>
                  {deal.pePortalUrl && (
                    <>{" "}<Link href={deal.pePortalUrl} style={portalLink}>PE Portal ↗</Link></>
                  )}
                </Text>
                <Text style={countBadge}>
                  {deal.missingDocs.length} doc{deal.missingDocs.length !== 1 ? "s" : ""} not uploaded
                </Text>
                <Hr style={thinDivider} />
                {deal.missingDocs.map((doc, i) => (
                  <Text key={i} style={missingDocText}>{doc}</Text>
                ))}
              </Section>
            );
          })}
        </>
      )}

      {/* Section 3: Action Required */}
      {actionRequired.length > 0 && (
        <>
          <Section style={sectionHeader}>
            <Text style={sectionHeaderText}>
              Action Required ({actionRequired.length})
            </Text>
          </Section>
          {actionRequired.map((deal) => {
            const hs = deal.hubspotUrl || `https://app.hubspot.com/contacts/${portalId}/record/0-3/${deal.dealId}`;
            return (
              <Section key={deal.dealId} style={attentionCard}>
                <Text style={dealNameStyle}>
                  <Link href={hs} style={dealLink}>{deal.dealName || deal.dealId}</Link>
                  <span style={stageTag}>{deal.stage}</span>
                  {deal.pePortalUrl && (
                    <>{" "}<Link href={deal.pePortalUrl} style={portalLink}>PE Portal ↗</Link></>
                  )}
                </Text>
                <Text style={countBadge}>
                  <span style={{ color: "#ef4444" }}>
                    {deal.issues.length} rejection{deal.issues.length !== 1 ? "s" : ""}
                  </span>
                </Text>
                <Hr style={thinDivider} />
                {deal.issues.map((issue, i) => (
                  <Section key={i} style={issueBlock}>
                    <Text style={issueDocName}>
                      <span style={{ color: statusColor(issue.status) }}>●</span>
                      {" "}{issue.docName}
                    </Text>
                    {issue.notes && (
                      <Text style={issueNotes}>{issue.notes}</Text>
                    )}
                  </Section>
                ))}
              </Section>
            );
          })}
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

const nearlyCard: React.CSSProperties = {
  backgroundColor: "#1a1a2e",
  border: "1px solid #14532d",
  borderRadius: "8px",
  padding: "16px",
  marginBottom: "12px",
};

const progressText: React.CSSProperties = {
  color: "#22c55e",
  fontSize: "12px",
  fontWeight: "bold",
  margin: "2px 0 0 0",
};

const missingDocText: React.CSSProperties = {
  color: "#fbbf24",
  fontSize: "13px",
  margin: "2px 0",
};

const notUploadedCard: React.CSSProperties = {
  backgroundColor: "#1a1a2e",
  border: "1px solid #854d0e",
  borderRadius: "8px",
  padding: "16px",
  marginBottom: "12px",
};

const attentionCard: React.CSSProperties = {
  backgroundColor: "#1a1a2e",
  border: "1px solid #7f1d1d",
  borderRadius: "8px",
  padding: "16px",
  marginBottom: "12px",
};

const issueBlock: React.CSSProperties = {
  padding: "6px 0",
  borderBottom: "1px solid #1e1e30",
};

const issueDocName: React.CSSProperties = {
  color: "#ffffff",
  fontSize: "13px",
  fontWeight: "bold",
  margin: "0 0 4px 0",
};

const issueNotes: React.CSSProperties = {
  color: "#a1a1aa",
  fontSize: "12px",
  lineHeight: "1.4",
  margin: "0",
  paddingLeft: "14px",
  whiteSpace: "pre-wrap" as const,
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

const stageTag: React.CSSProperties = {
  color: "#71717a",
  fontSize: "11px",
  fontWeight: "normal",
  marginLeft: "6px",
};

const countBadge: React.CSSProperties = {
  color: "#a1a1aa",
  fontSize: "12px",
  margin: "2px 0 0 0",
};

export default PeDocDigest;
