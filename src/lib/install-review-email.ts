/**
 * Install Photo Review — Email Builder
 *
 * Builds HTML + plaintext email for install photo review results,
 * comparing field install photos against the permitted planset.
 */

import { getHubSpotDealUrl } from "@/lib/external-links";

// ---------------------------------------------------------------------------
// Types (mirrored from install-review route)
// ---------------------------------------------------------------------------

export interface InstallFinding {
  category: string;
  status: "pass" | "fail" | "unable_to_verify";
  planset_spec: string;
  observed: string;
  notes: string;
}

export interface InstallReviewReport {
  dealId: string;
  dealName: string;
  findings: InstallFinding[];
  overall_pass: boolean;
  summary: string;
  photo_count: number;
  planset_filename: string;
  duration_ms: number;
}

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
  pass: "\u2705",
  fail: "\u274C",
  unable_to_verify: "\u2753",
};

const STATUS_COLOR: Record<string, string> = {
  pass: "#22c55e",
  fail: "#ef4444",
  unable_to_verify: "#f59e0b",
};

const CATEGORY_LABEL: Record<string, string> = {
  modules: "Solar Modules",
  inverter: "Inverter",
  battery: "Battery / ESS",
  racking: "Racking / Mounting",
  electrical: "Electrical BOS",
  labels: "Labels & Signage",
};

// ---------------------------------------------------------------------------
// HTML Builder
// ---------------------------------------------------------------------------

export function buildInstallReviewEmailHtml(report: InstallReviewReport): string {
  const dealUrl = getHubSpotDealUrl(report.dealId);
  const passColor = report.overall_pass ? "#22c55e" : "#ef4444";
  const failCount = report.findings.filter((f) => f.status === "fail").length;
  const passCount = report.findings.filter((f) => f.status === "pass").length;
  const unverifiedCount = report.findings.filter((f) => f.status === "unable_to_verify").length;

  const findingsRows = report.findings
    .map((f) => {
      const emoji = STATUS_EMOJI[f.status] ?? "\u2014";
      const color = STATUS_COLOR[f.status] ?? "#a1a1aa";
      const label = CATEGORY_LABEL[f.category] ?? f.category;
      return `
      <tr>
        <td style="padding:8px 10px;border-bottom:1px solid #2a2a3a;font-size:13px;color:#e4e4e7;">
          ${emoji} ${esc(label)}
        </td>
        <td style="padding:8px 10px;border-bottom:1px solid #2a2a3a;font-size:13px;color:${color};font-weight:600;">
          ${f.status === "pass" ? "PASS" : f.status === "fail" ? "FAIL" : "UNVERIFIED"}
        </td>
        <td style="padding:8px 10px;border-bottom:1px solid #2a2a3a;font-size:12px;color:#a1a1aa;">
          ${esc(f.planset_spec)}
        </td>
        <td style="padding:8px 10px;border-bottom:1px solid #2a2a3a;font-size:12px;color:#a1a1aa;">
          ${esc(f.observed)}
        </td>
      </tr>
      ${f.notes ? `<tr><td colspan="4" style="padding:2px 10px 8px 34px;border-bottom:1px solid #1a1a2a;font-size:11px;color:#71717a;font-style:italic;">${esc(f.notes)}</td></tr>` : ""}`;
    })
    .join("\n");

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:680px;margin:0 auto;padding:24px 16px;">
    <!-- Header -->
    <div style="margin-bottom:20px;">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#f97316;">
        Install Photo Review
      </div>
      <div style="font-size:18px;font-weight:700;color:#fafafa;margin-top:4px;">
        <a href="${dealUrl}" style="color:#3b82f6;text-decoration:none;">${esc(report.dealName)}</a>
      </div>
    </div>

    <!-- Result badge -->
    <div style="background-color:${passColor}20;border:1px solid ${passColor}40;border-radius:8px;padding:12px 16px;margin-bottom:16px;">
      <span style="font-size:14px;font-weight:700;color:${passColor};">
        ${report.overall_pass ? "All equipment matches planset" : "Mismatches found"}
      </span>
      <span style="font-size:12px;color:#a1a1aa;margin-left:8px;">
        \u2014 ${passCount} pass, ${failCount} fail, ${unverifiedCount} unverified
      </span>
    </div>

    <!-- Summary -->
    <div style="margin-bottom:16px;padding:10px 14px;background-color:#1a1a2a;border-radius:6px;font-size:13px;color:#d4d4d8;line-height:1.5;">
      ${esc(report.summary)}
    </div>

    <!-- Info row -->
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
      <tr>
        <td style="padding:3px 0;font-size:12px;color:#a1a1aa;width:120px;">Photos Analyzed</td>
        <td style="padding:3px 0;font-size:12px;color:#e4e4e7;">${report.photo_count}</td>
      </tr>
      <tr>
        <td style="padding:3px 0;font-size:12px;color:#a1a1aa;">Planset</td>
        <td style="padding:3px 0;font-size:12px;color:#e4e4e7;">${esc(report.planset_filename)}</td>
      </tr>
      <tr>
        <td style="padding:3px 0;font-size:12px;color:#a1a1aa;">Duration</td>
        <td style="padding:3px 0;font-size:12px;color:#e4e4e7;">${Math.round(report.duration_ms / 1000)}s</td>
      </tr>
    </table>

    <!-- Findings table -->
    ${
      report.findings.length > 0
        ? `
    <div style="margin:12px 0 6px 0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#f97316;">
      Equipment Review
    </div>
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr>
          <th style="padding:6px 10px;text-align:left;font-size:11px;font-weight:600;color:#a1a1aa;border-bottom:1px solid #3a3a4a;">Category</th>
          <th style="padding:6px 10px;text-align:left;font-size:11px;font-weight:600;color:#a1a1aa;border-bottom:1px solid #3a3a4a;">Status</th>
          <th style="padding:6px 10px;text-align:left;font-size:11px;font-weight:600;color:#a1a1aa;border-bottom:1px solid #3a3a4a;">Planset Spec</th>
          <th style="padding:6px 10px;text-align:left;font-size:11px;font-weight:600;color:#a1a1aa;border-bottom:1px solid #3a3a4a;">Observed</th>
        </tr>
      </thead>
      <tbody>
        ${findingsRows}
      </tbody>
    </table>`
        : '<p style="color:#22c55e;font-size:13px;">No findings recorded.</p>'
    }

    <!-- Footer -->
    <div style="margin-top:24px;padding-top:12px;border-top:1px solid #2a2a3a;font-size:11px;color:#71717a;">
      Triggered at Inspection stage \u00b7 PB Operations Suite
    </div>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Plaintext Builder
// ---------------------------------------------------------------------------

export function buildInstallReviewEmailText(report: InstallReviewReport): string {
  const failCount = report.findings.filter((f) => f.status === "fail").length;
  const passCount = report.findings.filter((f) => f.status === "pass").length;
  const unverifiedCount = report.findings.filter((f) => f.status === "unable_to_verify").length;

  const lines: string[] = [
    `INSTALL PHOTO REVIEW \u2014 ${report.dealName}`,
    "",
    report.overall_pass ? "All equipment matches planset" : "MISMATCHES FOUND",
    `${passCount} pass, ${failCount} fail, ${unverifiedCount} unverified`,
    "",
    report.summary,
    "",
    `Photos: ${report.photo_count} | Planset: ${report.planset_filename} | Duration: ${Math.round(report.duration_ms / 1000)}s`,
    "",
  ];

  if (report.findings.length > 0) {
    lines.push("EQUIPMENT REVIEW", "\u2500".repeat(60));
    for (const f of report.findings) {
      const emoji = STATUS_EMOJI[f.status] ?? "\u2014";
      const label = CATEGORY_LABEL[f.category] ?? f.category;
      lines.push(`${emoji} ${label}: ${f.status.toUpperCase()}`);
      if (f.planset_spec) lines.push(`   Planset: ${f.planset_spec}`);
      if (f.observed) lines.push(`   Observed: ${f.observed}`);
      if (f.notes) lines.push(`   Notes: ${f.notes}`);
      lines.push("");
    }
  }

  lines.push("---", "Triggered at Inspection stage \u00b7 PB Operations Suite");
  return lines.join("\n");
}
