/**
 * Site Survey Readiness — Email Builder
 *
 * Builds HTML + plaintext email for the site survey readiness report,
 * sent when a deal's design_status changes to "Initial Review".
 */

import type { SurveyReadinessReport } from "./site-survey-readiness";
import { getHubSpotDealUrl } from "@/lib/external-links";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const STATUS_EMOJI: Record<string, string> = {
  pass: "✅",
  missing: "❌",
  not_found: "⚠️",
  na: "⬜",
  unable_to_verify: "❓",
};

const STATUS_LABEL: Record<string, string> = {
  pass: "PASS",
  missing: "MISSING",
  not_found: "NOT FOUND",
  na: "N/A",
  unable_to_verify: "UNABLE TO VERIFY",
};

// ---------------------------------------------------------------------------
// HTML Builder
// ---------------------------------------------------------------------------

export function buildReadinessEmailHtml(report: SurveyReadinessReport): string {
  const dealUrl = getHubSpotDealUrl(report.dealId);
  const readyLabel = report.readyForIDR ? "YES" : "NO";
  const readyColor = report.readyForIDR ? "#22c55e" : "#ef4444";
  const errorCount = report.checklist.filter(
    (c) => c.severity === "error" && c.status !== "pass" && c.status !== "na",
  ).length;

  const driveLink = report.folderId
    ? `https://drive.google.com/drive/folders/${report.folderId}`
    : null;

  const checklistRows = report.checklist
    .map((c) => {
      const emoji = STATUS_EMOJI[c.status] ?? "—";
      const label = STATUS_LABEL[c.status] ?? c.status.toUpperCase();
      const statusColor =
        c.status === "pass"
          ? "#22c55e"
          : c.status === "missing"
            ? "#ef4444"
            : c.status === "not_found"
              ? "#f59e0b"
              : "#a1a1aa";
      return `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #2a2a3a;font-size:13px;">
          ${emoji} ${esc(c.item)}
        </td>
        <td style="padding:6px 10px;border-bottom:1px solid #2a2a3a;font-size:13px;color:${statusColor};font-weight:600;">
          ${label}
        </td>
        <td style="padding:6px 10px;border-bottom:1px solid #2a2a3a;font-size:12px;color:#a1a1aa;">
          ${c.count > 0 ? c.count : "—"}
        </td>
        <td style="padding:6px 10px;border-bottom:1px solid #2a2a3a;font-size:12px;color:#a1a1aa;">
          ${esc(c.note)}
        </td>
      </tr>`;
    })
    .join("\n");

  const actionItemsHtml =
    report.actionItems.length > 0
      ? `
    <div style="margin:16px 0 0 0;">
      <div style="margin:12px 0 6px 0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#f97316;">
        Action Items
      </div>
      <ul style="margin:0;padding:0 0 0 18px;color:#e4e4e7;font-size:13px;">
        ${report.actionItems.map((a) => `<li style="margin:4px 0;">${esc(a)}</li>`).join("\n")}
      </ul>
    </div>`
      : "";

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px;">
    <!-- Header -->
    <div style="margin-bottom:20px;">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#f97316;">
        Site Survey Readiness Check
      </div>
      <div style="font-size:18px;font-weight:700;color:#fafafa;margin-top:4px;">
        <a href="${dealUrl}" style="color:#3b82f6;text-decoration:none;">${esc(report.dealName)}</a>
      </div>
    </div>

    <!-- Ready for IDR badge -->
    <div style="background-color:${readyColor}20;border:1px solid ${readyColor}40;border-radius:8px;padding:12px 16px;margin-bottom:16px;">
      <span style="font-size:14px;font-weight:700;color:${readyColor};">
        Ready for IDR: ${readyLabel}
      </span>
      ${!report.readyForIDR ? `<span style="font-size:12px;color:#a1a1aa;margin-left:8px;">— ${errorCount} required item${errorCount !== 1 ? "s" : ""} missing</span>` : ""}
    </div>

    <!-- Deal info -->
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
      <tr>
        <td style="padding:3px 0;font-size:12px;color:#a1a1aa;width:120px;">Project Type</td>
        <td style="padding:3px 0;font-size:12px;color:#e4e4e7;">${esc(report.projectType)}</td>
      </tr>
      <tr>
        <td style="padding:3px 0;font-size:12px;color:#a1a1aa;">Survey Status</td>
        <td style="padding:3px 0;font-size:12px;color:#e4e4e7;">${esc(report.surveyStatus ?? "Not set")}</td>
      </tr>
      <tr>
        <td style="padding:3px 0;font-size:12px;color:#a1a1aa;">Survey Date</td>
        <td style="padding:3px 0;font-size:12px;color:#e4e4e7;">${esc(report.surveyDate ?? "Not set")}</td>
      </tr>
      <tr>
        <td style="padding:3px 0;font-size:12px;color:#a1a1aa;">Survey System</td>
        <td style="padding:3px 0;font-size:12px;color:#e4e4e7;">${esc(report.surveySystem === "descriptive" ? "Descriptive names (current form)" : report.surveySystem === "uuid-3422" ? "3422 app (UUID filenames)" : "Manual upload (camera names)")}</td>
      </tr>
      <tr>
        <td style="padding:3px 0;font-size:12px;color:#a1a1aa;">Total Files</td>
        <td style="padding:3px 0;font-size:12px;color:#e4e4e7;">${report.totalFiles}</td>
      </tr>
      ${driveLink ? `<tr><td style="padding:3px 0;font-size:12px;color:#a1a1aa;">Survey Folder</td><td style="padding:3px 0;font-size:12px;"><a href="${driveLink}" style="color:#3b82f6;text-decoration:none;">Open in Drive</a></td></tr>` : ""}
    </table>

    <!-- Checklist table -->
    <div style="margin:12px 0 6px 0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#f97316;">
      Checklist
    </div>
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr>
          <th style="padding:6px 10px;text-align:left;font-size:11px;font-weight:600;color:#a1a1aa;border-bottom:1px solid #3a3a4a;">Item</th>
          <th style="padding:6px 10px;text-align:left;font-size:11px;font-weight:600;color:#a1a1aa;border-bottom:1px solid #3a3a4a;">Status</th>
          <th style="padding:6px 10px;text-align:left;font-size:11px;font-weight:600;color:#a1a1aa;border-bottom:1px solid #3a3a4a;">Count</th>
          <th style="padding:6px 10px;text-align:left;font-size:11px;font-weight:600;color:#a1a1aa;border-bottom:1px solid #3a3a4a;">Notes</th>
        </tr>
      </thead>
      <tbody>
        ${checklistRows}
      </tbody>
    </table>

    ${actionItemsHtml}

    <!-- Footer -->
    <div style="margin-top:24px;padding-top:12px;border-top:1px solid #2a2a3a;font-size:11px;color:#71717a;">
      Triggered by design status → Initial Review · PB Tech Ops Suite
    </div>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Plaintext Builder
// ---------------------------------------------------------------------------

export function buildReadinessEmailText(report: SurveyReadinessReport): string {
  const readyLabel = report.readyForIDR ? "YES" : "NO";
  const lines: string[] = [
    `SITE SURVEY READINESS — ${report.dealName}`,
    "",
    `Ready for IDR: ${readyLabel}`,
    "",
    `Project Type: ${report.projectType}`,
    `Survey Status: ${report.surveyStatus ?? "Not set"}`,
    `Survey Date: ${report.surveyDate ?? "Not set"}`,
    `Total Files: ${report.totalFiles}`,
    "",
    "CHECKLIST",
    "─".repeat(60),
  ];

  for (const c of report.checklist) {
    const emoji = STATUS_EMOJI[c.status] ?? "—";
    const label = STATUS_LABEL[c.status] ?? c.status.toUpperCase();
    lines.push(`${emoji} ${c.item}: ${label} (${c.count}) — ${c.note}`);
  }

  if (report.actionItems.length > 0) {
    lines.push("", "ACTION ITEMS", "─".repeat(60));
    for (const item of report.actionItems) {
      lines.push(`• ${item}`);
    }
  }

  lines.push("", "---", "Triggered by design status → Initial Review · PB Tech Ops Suite");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// FDR (Final Design Review) Email Builders
// ---------------------------------------------------------------------------

import type { Finding } from "./types";

export function buildFdrEmailHtml(
  dealId: string,
  dealName: string,
  passed: boolean,
  findings: Finding[],
): string {
  const dealUrl = getHubSpotDealUrl(dealId);
  const readyColor = passed ? "#22c55e" : "#ef4444";

  const findingsRows = findings
    .map((f) => {
      const color =
        f.severity === "error" ? "#ef4444" : f.severity === "warning" ? "#f59e0b" : "#a1a1aa";
      const emoji = f.severity === "error" ? "❌" : f.severity === "warning" ? "⚠️" : "ℹ️";
      return `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #2a2a3a;font-size:13px;">
          ${emoji} ${esc(f.check)}
        </td>
        <td style="padding:6px 10px;border-bottom:1px solid #2a2a3a;font-size:13px;color:${color};font-weight:600;">
          ${f.severity.toUpperCase()}
        </td>
        <td style="padding:6px 10px;border-bottom:1px solid #2a2a3a;font-size:12px;color:#a1a1aa;">
          ${esc(f.message)}
        </td>
      </tr>`;
    })
    .join("\n");

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px;">
    <!-- Header -->
    <div style="margin-bottom:20px;">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#f97316;">
        Final Design Review Check
      </div>
      <div style="font-size:18px;font-weight:700;color:#fafafa;margin-top:4px;">
        <a href="${dealUrl}" style="color:#3b82f6;text-decoration:none;">${esc(dealName)}</a>
      </div>
    </div>

    <!-- Result badge -->
    <div style="background-color:${readyColor}20;border:1px solid ${readyColor}40;border-radius:8px;padding:12px 16px;margin-bottom:16px;">
      <span style="font-size:14px;font-weight:700;color:${readyColor};">
        ${passed ? "All checks passed" : "Issues found"}
      </span>
      <span style="font-size:12px;color:#a1a1aa;margin-left:8px;">
        — ${findings.filter((f) => f.severity === "error").length} errors, ${findings.filter((f) => f.severity === "warning").length} warnings
      </span>
    </div>

    ${
      findings.length > 0
        ? `
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr>
          <th style="padding:6px 10px;text-align:left;font-size:11px;font-weight:600;color:#a1a1aa;border-bottom:1px solid #3a3a4a;">Check</th>
          <th style="padding:6px 10px;text-align:left;font-size:11px;font-weight:600;color:#a1a1aa;border-bottom:1px solid #3a3a4a;">Severity</th>
          <th style="padding:6px 10px;text-align:left;font-size:11px;font-weight:600;color:#a1a1aa;border-bottom:1px solid #3a3a4a;">Message</th>
        </tr>
      </thead>
      <tbody>
        ${findingsRows}
      </tbody>
    </table>`
        : '<p style="color:#22c55e;font-size:13px;">All design review checks passed — project is ready to proceed.</p>'
    }

    <!-- Footer -->
    <div style="margin-top:24px;padding-top:12px;border-top:1px solid #2a2a3a;font-size:11px;color:#71717a;">
      Triggered by design status → DA Approved · PB Tech Ops Suite
    </div>
  </div>
</body>
</html>`;
}

export function buildFdrEmailText(
  dealName: string,
  passed: boolean,
  findings: Finding[],
): string {
  const lines: string[] = [
    `FINAL DESIGN REVIEW — ${dealName}`,
    "",
    passed ? "All checks passed" : "Issues found",
    `${findings.filter((f) => f.severity === "error").length} errors, ${findings.filter((f) => f.severity === "warning").length} warnings`,
    "",
  ];

  if (findings.length > 0) {
    lines.push("FINDINGS", "─".repeat(60));
    for (const f of findings) {
      const emoji = f.severity === "error" ? "❌" : f.severity === "warning" ? "⚠️" : "ℹ️";
      lines.push(`${emoji} [${f.severity.toUpperCase()}] ${f.check}: ${f.message}`);
    }
  } else {
    lines.push("All design review checks passed — project is ready to proceed.");
  }

  lines.push("", "---", "Triggered by design status → DA Approved · PB Tech Ops Suite");
  return lines.join("\n");
}
