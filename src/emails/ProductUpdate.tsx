import { Section, Text } from "@react-email/components";
import * as React from "react";
import { EmailShell } from "./_components/EmailShell";
import { EmailButton } from "./_components/EmailButton";

export interface ProductUpdateChange {
  type: string;
  text: string;
}

export interface ProductUpdateProps {
  version: string;
  title: string;
  formattedDate: string; // Pre-formatted
  description: string;
  changes: ProductUpdateChange[];
  updatesUrl: string;
}

export function ProductUpdate({
  version,
  title,
  formattedDate,
  description,
  changes,
  updatesUrl,
}: ProductUpdateProps) {
  return (
    <EmailShell
      preview={`PB Operations v${version} — ${title}`}
      subtitle="Product Update Published"
      maxWidth={620}
    >
      <Section style={card}>
        <Text style={versionBadge}>v{version}</Text>
        <Text style={titleText}>{title}</Text>
        <Text style={dateText}>{formattedDate}</Text>
        <Text style={descriptionText}>{description}</Text>

        {/* Changes list */}
        <Section>
          {changes.map((change, i) => (
            <Text key={i} style={changeItem}>
              <strong>{change.type.toUpperCase()}:</strong> {change.text}
            </Text>
          ))}
        </Section>
      </Section>

      {/* CTA */}
      <Section style={ctaSection}>
        <EmailButton href={updatesUrl}>View Full Changelog</EmailButton>
      </Section>
    </EmailShell>
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

const versionBadge: React.CSSProperties = {
  color: "#fb923c",
  fontWeight: 700,
  margin: "0 0 8px 0",
  fontSize: "14px",
};

const titleText: React.CSSProperties = {
  fontSize: "20px",
  color: "#ffffff",
  margin: "0 0 8px 0",
  fontWeight: 600,
};

const dateText: React.CSSProperties = {
  color: "#a1a1aa",
  fontSize: "13px",
  margin: "0 0 16px 0",
};

const descriptionText: React.CSSProperties = {
  color: "#e4e4e7",
  fontSize: "14px",
  lineHeight: "1.5",
  margin: "0 0 16px 0",
};

const changeItem: React.CSSProperties = {
  color: "#e4e4e7",
  fontSize: "13px",
  lineHeight: "1.5",
  margin: "0 0 8px 0",
  paddingLeft: "12px",
};

const ctaSection: React.CSSProperties = {
  textAlign: "center",
  margin: "0",
};

// ─── Preview defaults ─────────────────────────────────────────────────────────

ProductUpdate.PreviewProps = {
  version: "2.4.1",
  title: "Scheduler Improvements & Bug Fixes",
  formattedDate: "Wednesday, February 19, 2025",
  description:
    "This release improves the construction scheduler calendar view and fixes several edge cases in the HubSpot sync.",
  changes: [
    { type: "new", text: "Calendar now shows multi-day installs spanning weekends correctly" },
    { type: "fix", text: "HubSpot deal sync no longer drops custom field values on update" },
    { type: "improvement", text: "Availability conflict detection is now 40% faster" },
  ],
  updatesUrl: "https://www.pbtechops.com/updates",
} satisfies ProductUpdateProps;

export default ProductUpdate;
