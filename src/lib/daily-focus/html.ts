// src/lib/daily-focus/html.ts
import { getHubSpotDealUrl } from "@/lib/external-links";
import { trimDealName, getStatusDisplayName, sortDealRows } from "./format";
import type { SectionResult, DealRow } from "./queries";

// ── Pill color classification ──────────────────────────────────────────

type PillColor = { bg: string; text: string };

const PI_PILL_COLORS: Record<string, PillColor> = {
  ready: { bg: "#dcfce7", text: "#166534" },
  resubmit: { bg: "#fef3c7", text: "#92400e" },
};

function getDesignPillColor(rawStatus: string, statusProperty: string): PillColor {
  if (statusProperty === "layout_status") {
    if (rawStatus === "Ready") return { bg: "#dbeafe", text: "#1d4ed8" };
    if (rawStatus === "Draft Created") return { bg: "#f3f4f6", text: "#6b7280" };
    if (rawStatus === "Revision Returned From Design") return { bg: "#ede9fe", text: "#6d28d9" };
    return { bg: "#f3f4f6", text: "#6b7280" };
  }
  if (rawStatus.startsWith("Revision Needed")) return { bg: "#fee2e2", text: "#b91c1c" };
  if (rawStatus.includes("Revision In Progress") || rawStatus === "In Revision" || rawStatus === "Revision In Engineering")
    return { bg: "#fef9c3", text: "#854d0e" };
  if (rawStatus === "Initial Review" || rawStatus === "Revision Initial Review")
    return { bg: "#ffedd5", text: "#c2410c" };
  if (rawStatus === "DA Approved") return { bg: "#dcfce7", text: "#15803d" };
  if (rawStatus === "Ready for Review" || rawStatus === "Revision Final Review")
    return { bg: "#ccfbf1", text: "#0f766e" };
  return { bg: "#f3f4f6", text: "#6b7280" };
}

function getPillColor(row: DealRow, emailType: "pi" | "design"): PillColor {
  if (emailType === "pi") {
    return PI_PILL_COLORS[row.subsection] ?? PI_PILL_COLORS.ready;
  }
  return getDesignPillColor(row.statusValue, row.statusProperty);
}

// ── Render primitives ──────────────────────────────────────────────────

const PILL_BASE = "padding:1px 8px;border-radius:999px;font-size:10px;font-weight:700;display:inline-block;";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderStatusPill(
  rawStatus: string,
  statusProperty: string,
  emailType: "pi" | "design" = "pi",
  subsection: "ready" | "resubmit" = "ready"
): string {
  const display = getStatusDisplayName(rawStatus, statusProperty);
  const dummyRow: DealRow = {
    dealId: "", dealname: "", dealstage: "", pipeline: "",
    statusValue: rawStatus, statusProperty, subsection,
  };
  const color = getPillColor(dummyRow, emailType);
  return `<span style="${PILL_BASE}background:${color.bg};color:${color.text};">${escapeHtml(display)}</span>`;
}

export function renderSectionHeader(
  label: string,
  count: number,
  color: { bg: string; border: string; text: string },
  sublabel?: string
): string {
  const headerStyle = `padding:5px 10px;margin:16px 0 4px 0;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;background:${color.bg};border-left:3px solid ${color.border};color:${color.text};`;
  const sub = sublabel ? ` \u2014 ${sublabel}` : "";
  return `<div style="${headerStyle}">${escapeHtml(label.toUpperCase())}${sub} (${count})</div>`;
}

export function renderDealRow(opts: {
  dealId: string;
  dealname: string;
  stageName: string;
  statusDisplay: string;
  statusPillHtml: string;
  isAlternate: boolean;
  crossSectionTag?: string;
}): string {
  const bg = opts.isAlternate ? "#f9fafb" : "#ffffff";
  const rowStyle = `padding:5px 8px;border-bottom:1px solid #f0f0f0;background:${bg};`;
  const nameStyle = "font-size:12px;font-weight:700;color:#1e40af;text-decoration:none;";
  const stageStyle = "font-size:11px;color:#9ca3af;";
  const tagHtml = opts.crossSectionTag ?? "";
  const url = getHubSpotDealUrl(opts.dealId);
  const displayName = trimDealName(opts.dealname);
  return `<div style="${rowStyle}"><a href="${url}" style="${nameStyle}">${escapeHtml(displayName)}</a> ${tagHtml}<span style="${stageStyle}">${escapeHtml(opts.stageName)}</span> \u00b7 ${opts.statusPillHtml}</div>`;
}

function renderCrossSectionTag(text: string): string {
  return `<span style="font-size:10px;color:#5b21b6;background:#ede9fe;padding:1px 6px;border-radius:8px;margin-left:3px;font-weight:600;">${escapeHtml(text)}</span> `;
}

export function renderEmailWrapper(bodyHtml: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:640px;margin:0 auto;padding:16px;">
<div style="background:#ffffff;border-radius:8px;padding:20px;border:1px solid #e4e4e7;">
${bodyHtml}
</div>
<div style="text-align:center;padding:12px 0;font-size:10px;color:#a1a1aa;">
PB Tech Ops Suite \u00b7 Daily Focus Email
</div>
</div>
</body>
</html>`;
}

// ── Build section HTML ─────────────────────────────────────────────────

export function buildSectionHtml(
  section: SectionResult,
  stageMap: Record<string, string>,
  emailType: "pi" | "design",
  crossSectionDealIds?: Map<string, string>
): string {
  if (section.total === 0) return "";

  const parts: string[] = [];

  const renderRows = (rows: DealRow[], subsectionLabel: string | null) => {
    const sorted = sortDealRows(rows);
    if (sorted.length === 0) return;

    if (subsectionLabel) {
      parts.push(`<div style="padding:3px 10px;font-size:10px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.3px;margin-top:8px;">${subsectionLabel} (${sorted.length})</div>`);
    }

    sorted.forEach((row, i) => {
      const stageName = stageMap[row.dealstage] ?? row.dealstage;
      const displayStatus = getStatusDisplayName(row.statusValue, row.statusProperty);
      const color = getPillColor(row, emailType);
      const pillHtml = `<span style="${PILL_BASE}background:${color.bg};color:${color.text};">${escapeHtml(displayStatus)}</span>`;
      const tag = crossSectionDealIds?.has(row.dealId)
        ? renderCrossSectionTag(crossSectionDealIds.get(row.dealId)!)
        : undefined;

      parts.push(renderDealRow({
        dealId: row.dealId,
        dealname: row.dealname,
        stageName,
        statusDisplay: displayStatus,
        statusPillHtml: pillHtml,
        isAlternate: i % 2 === 1,
        crossSectionTag: tag,
      }));
    });
  };

  parts.push(renderSectionHeader(section.label, section.total, section.headerColor));

  if (section.ready.length > 0 && section.resubmit.length > 0) {
    renderRows(section.ready, "Ready to Submit");
    renderRows(section.resubmit, "Resubmissions Needed");
  } else {
    renderRows([...section.ready, ...section.resubmit], null);
  }

  return parts.join("\n");
}

// ── Error banner for individual emails ─────────────────────────────────

export function renderErrorBanner(failedSections: string[]): string {
  if (failedSections.length === 0) return "";
  return `<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:4px;padding:8px 12px;margin-bottom:12px;font-size:11px;color:#991b1b;"><strong>\u26a0 Some sections may be incomplete:</strong> ${failedSections.join(", ")}</div>`;
}

// ── Individual email ───────────────────────────────────────────────────

export function buildIndividualEmail(
  firstName: string,
  sections: SectionResult[],
  stageMap: Record<string, string>,
  emailType: "pi" | "design"
): string {
  const grandTotal = sections.reduce((sum, s) => sum + s.total, 0);
  if (grandTotal === 0) return "";

  const crossMap = buildCrossSectionMap(sections);

  // Check for section-level query failures
  const failedSections = sections.filter((s) => s.error).map((s) => s.label);

  const parts: string[] = [];
  parts.push(`<p style="margin:0 0 12px;font-size:14px;">Good morning ${escapeHtml(firstName)},</p>`);
  parts.push(`<p style="margin:0 0 16px;font-size:13px;color:#6b7280;">Here's what's ready for action today:</p>`);

  // Show error banner if any sections had query failures
  if (failedSections.length > 0) {
    parts.push(renderErrorBanner(failedSections));
  }

  for (const section of sections) {
    const sectionHtml = buildSectionHtml(section, stageMap, emailType, crossMap.get(section.key));
    if (sectionHtml) parts.push(sectionHtml);
  }

  parts.push(`<hr style="border:none;border-top:1px solid #e4e4e7;margin:16px 0;">`);
  parts.push(`<p style="margin:0;font-size:12px;font-weight:700;color:#3f3f46;">Total action items: ${grandTotal}</p>`);

  return renderEmailWrapper(parts.join("\n"));
}

// ── Rollup email ───────────────────────────────────────────────────────

interface LeadSummary {
  name: string;
  sections: SectionResult[];
  grandTotal: number;
}

export function buildRollupEmail(
  leads: LeadSummary[],
  allDefs: { key: string; label: string }[],
  stageMap: Record<string, string>,
  emailType: "pi" | "design"
): string {
  const sortedLeads = [...leads].sort((a, b) => b.grandTotal - a.grandTotal);
  const teamTotal = sortedLeads.reduce((s, l) => s + l.grandTotal, 0);

  const parts: string[] = [];

  parts.push(`<p style="margin:0 0 12px;font-size:14px;font-weight:700;">TEAM SUMMARY</p>`);
  const headerRow = allDefs.map((d) => `<th style="padding:6px 8px;text-align:right;font-size:11px;">${escapeHtml(d.label)}</th>`).join("");
  parts.push(`<table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:12px;">`);
  parts.push(`<tr style="background:#1e293b;color:#fff;"><th style="padding:6px 8px;text-align:left;font-size:11px;">Name</th>${headerRow}<th style="padding:6px 8px;text-align:right;font-size:11px;">Total</th></tr>`);

  for (const lead of sortedLeads) {
    const cells = allDefs
      .map((d) => {
        const sec = lead.sections.find((s) => s.key === d.key);
        const val = sec?.total ?? 0;
        return `<td style="padding:4px 8px;text-align:right;border-bottom:1px solid #f0f0f0;">${val || "\u2014"}</td>`;
      })
      .join("");
    parts.push(`<tr><td style="padding:4px 8px;font-weight:600;border-bottom:1px solid #f0f0f0;">${escapeHtml(lead.name)}</td>${cells}<td style="padding:4px 8px;text-align:right;font-weight:700;border-bottom:1px solid #f0f0f0;">${lead.grandTotal}</td></tr>`);
  }

  const totalCells = allDefs
    .map((d) => {
      const colTotal = sortedLeads.reduce((s, l) => {
        const sec = l.sections.find((s2) => s2.key === d.key);
        return s + (sec?.total ?? 0);
      }, 0);
      return `<td style="padding:4px 8px;text-align:right;font-weight:700;border-top:2px solid #1e293b;">${colTotal}</td>`;
    })
    .join("");
  parts.push(`<tr style="background:#f8fafc;"><td style="padding:4px 8px;font-weight:700;border-top:2px solid #1e293b;">TEAM TOTAL</td>${totalCells}<td style="padding:4px 8px;text-align:right;font-weight:700;border-top:2px solid #1e293b;">${teamTotal}</td></tr>`);
  parts.push(`</table>`);

  parts.push(`<p style="margin:20px 0 12px;font-size:14px;font-weight:700;">FULL DETAIL BY LEAD</p>`);

  for (const lead of sortedLeads) {
    if (lead.grandTotal === 0) continue;
    parts.push(`<div style="margin:16px 0 4px;padding:6px 10px;background:#f8fafc;border-radius:4px;font-size:13px;font-weight:700;">${escapeHtml(lead.name)} <span style="font-weight:400;color:#6b7280;">(${lead.grandTotal} items)</span></div>`);

    const crossMap = buildCrossSectionMap(lead.sections);
    for (const section of lead.sections) {
      const sectionHtml = buildSectionHtml(section, stageMap, emailType, crossMap.get(section.key));
      if (sectionHtml) parts.push(sectionHtml);
    }
  }

  return renderEmailWrapper(parts.join("\n"));
}

// ── Cross-section tag builder ──────────────────────────────────────────

function buildCrossSectionMap(
  sections: SectionResult[]
): Map<string, Map<string, string>> {
  const dealSections = new Map<string, string[]>();

  for (const section of sections) {
    for (const row of [...section.ready, ...section.resubmit]) {
      const existing = dealSections.get(row.dealId) ?? [];
      if (!existing.includes(section.key)) {
        existing.push(section.key);
        dealSections.set(row.dealId, existing);
      }
    }
  }

  const result = new Map<string, Map<string, string>>();
  const sectionLabels = new Map(sections.map((s) => [s.key, s.label]));

  for (const [dealId, sectionKeys] of dealSections) {
    if (sectionKeys.length < 2) continue;

    for (let i = 0; i < sectionKeys.length; i++) {
      const thisKey = sectionKeys[i];
      const otherLabels = sectionKeys
        .filter((k) => k !== thisKey)
        .map((k) => sectionLabels.get(k) ?? k);

      if (!result.has(thisKey)) result.set(thisKey, new Map());
      const direction = i === 0 ? "\u2193" : "\u2191";
      result.get(thisKey)!.set(dealId, `${direction} also in ${otherLabels.join(", ")}`);
    }
  }

  return result;
}
