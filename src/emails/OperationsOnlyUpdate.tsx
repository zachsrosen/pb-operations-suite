import { Section, Text } from "@react-email/components";
import * as React from "react";
import { EmailShell } from "./_components/EmailShell";

export interface OperationsOnlyUpdateProps {
  title: string;
  dateLabel: string;
  focus: string;
  completed: string[];
  nextUp: string[];
  blockers?: string[];
  owner?: string;
}

export function OperationsOnlyUpdate({
  title,
  dateLabel,
  focus,
  completed,
  nextUp,
  blockers,
  owner,
}: OperationsOnlyUpdateProps) {
  const blockerItems = blockers || [];

  return (
    <EmailShell
      preview={`Operations Only: ${title}`}
      subtitle="Operations-Only Update"
      maxWidth={620}
    >
      <Section style={heroCard}>
        <Text style={opsBadge}>OPERATIONS ONLY</Text>
        <Text style={titleText}>{title}</Text>
        <Text style={metaText}>{dateLabel}</Text>
        <Text style={focusText}>
          <strong>Focus:</strong> {focus}
        </Text>
        {owner ? (
          <Text style={ownerText}>
            <strong>Owner:</strong> {owner}
          </Text>
        ) : null}
      </Section>

      <Section style={card}>
        <Text style={sectionTitle}>Completed</Text>
        {completed.map((item, index) => (
          <Text key={`done-${index}`} style={itemText}>
            • {item}
          </Text>
        ))}
      </Section>

      <Section style={card}>
        <Text style={sectionTitle}>Next Up</Text>
        {nextUp.map((item, index) => (
          <Text key={`next-${index}`} style={itemText}>
            • {item}
          </Text>
        ))}
      </Section>

      {blockerItems.length > 0 && (
        <Section style={card}>
          <Text style={sectionTitle}>Blockers / Risks</Text>
          {blockerItems.map((item, index) => (
            <Text key={`blocker-${index}`} style={itemText}>
              • {item}
            </Text>
          ))}
        </Section>
      )}
    </EmailShell>
  );
}

const heroCard: React.CSSProperties = {
  backgroundColor: "#0a0a0f",
  border: "1px solid #1e1e2e",
  borderRadius: "8px",
  padding: "16px",
  marginBottom: "16px",
};

const card: React.CSSProperties = {
  backgroundColor: "#0a0a0f",
  border: "1px solid #1e1e2e",
  borderRadius: "8px",
  padding: "16px",
  marginBottom: "16px",
};

const opsBadge: React.CSSProperties = {
  display: "inline-block",
  backgroundColor: "#ea580c",
  color: "#ffffff",
  borderRadius: "4px",
  padding: "3px 10px",
  fontSize: "11px",
  fontWeight: 700,
  margin: "0 0 10px 0",
};

const titleText: React.CSSProperties = {
  color: "#ffffff",
  fontSize: "20px",
  fontWeight: 700,
  margin: "0 0 4px 0",
};

const metaText: React.CSSProperties = {
  color: "#a1a1aa",
  fontSize: "12px",
  margin: "0 0 10px 0",
};

const focusText: React.CSSProperties = {
  color: "#e4e4e7",
  fontSize: "14px",
  margin: "0 0 6px 0",
  lineHeight: "1.5",
};

const ownerText: React.CSSProperties = {
  color: "#a1a1aa",
  fontSize: "13px",
  margin: 0,
};

const sectionTitle: React.CSSProperties = {
  color: "#fb923c",
  fontSize: "14px",
  fontWeight: 700,
  margin: "0 0 8px 0",
};

const itemText: React.CSSProperties = {
  color: "#e4e4e7",
  fontSize: "13px",
  margin: "0 0 6px 0",
  lineHeight: "1.5",
};

OperationsOnlyUpdate.PreviewProps = {
  title: "Operations Weekly Coordination",
  dateLabel: "Friday, February 20, 2026",
  focus: "Close open scheduling gaps and confirm Monday install crews.",
  completed: [
    "Inspection assignee notification fallback deployed.",
    "Install detail block added to install emails.",
    "Denver survey shared calendar sync verified.",
  ],
  nextUp: [
    "Run Zuper vs Google calendar diff for next 7 days.",
    "Validate install director recipients by location.",
  ],
  blockers: [
    "One crew profile still missing in local CrewMember table (email fallback now mitigates).",
  ],
  owner: "PB Operations Team",
} satisfies OperationsOnlyUpdateProps;

export default OperationsOnlyUpdate;
