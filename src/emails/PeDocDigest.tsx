import { Hr, Section, Text } from "@react-email/components";
import * as React from "react";
import { EmailShell } from "./_components/EmailShell";

export interface PeDocChange {
  dealId: string;
  dealName: string | null;
  docName: string;
  oldStatus: string;
  newStatus: string;
}

export interface PeDocDigestProps {
  date: string; // "May 19, 2026"
  changes: PeDocChange[];
  totalDealsTracked: number;
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

export function PeDocDigest({
  date,
  changes,
  totalDealsTracked,
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
      preview={`${changes.length} PE doc status change${changes.length !== 1 ? "s" : ""} on ${date}`}
      subtitle="PE Document Status Changes"
      maxWidth={600}
    >
      {/* Summary card */}
      <Section style={summaryCard}>
        <Text style={summaryDate}>{date}</Text>
        <Text style={summaryCount}>
          {changes.length} change{changes.length !== 1 ? "s" : ""} across{" "}
          {dealEntries.length} deal{dealEntries.length !== 1 ? "s" : ""}
        </Text>
        <Text style={summaryMeta}>
          {totalDealsTracked} PE deals tracked
        </Text>
      </Section>

      {/* Per-deal changes */}
      {dealEntries.map(([dealKey, dealChanges]) => (
        <Section key={dealKey} style={dealCard}>
          <Text style={dealName}>{dealKey}</Text>
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
      ))}

      {changes.length === 0 && (
        <Section style={emptyCard}>
          <Text style={emptyText}>No document status changes today.</Text>
        </Section>
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

const dealCard: React.CSSProperties = {
  backgroundColor: "#1a1a2e",
  border: "1px solid #2a2a3e",
  borderRadius: "8px",
  padding: "16px",
  marginBottom: "12px",
};

const dealName: React.CSSProperties = {
  color: "#ffffff",
  fontSize: "14px",
  fontWeight: "bold",
  margin: "0 0 8px 0",
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

const emptyCard: React.CSSProperties = {
  backgroundColor: "#1a1a2e",
  border: "1px solid #2a2a3e",
  borderRadius: "8px",
  padding: "24px",
  textAlign: "center",
};

const emptyText: React.CSSProperties = {
  color: "#71717a",
  fontSize: "14px",
  margin: 0,
};

export default PeDocDigest;
