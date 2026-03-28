// src/lib/eod-summary/html.ts
//
// Builds the HTML email for the EOD summary.

import { getHubSpotDealUrl } from "@/lib/external-links";
import { getStatusDisplayName } from "@/lib/daily-focus/format";
import {
  PIPELINE_SUFFIXES,
  PROPERTY_TO_DEPARTMENT,
  STATUS_TO_ROLE_PROPERTY,
  FIELD_TO_HS_PROPERTY,
} from "./config";
import type { StatusChange, SnapshotDeal } from "./snapshot";
import type { MilestoneHit } from "./milestones";
import type { CompletedTask } from "./tasks";

// ── Public interface ───────────────────────────────────────────────────

export interface EodEmailData {
  changes: StatusChange[];
  milestones: MilestoneHit[];
  tasks: CompletedTask[];
  newDeals: SnapshotDeal[];
  resolvedDeals: SnapshotDeal[];
  stageMap: Record<string, string>;
  morningDealCount: number;
  stillInScopeCount: number;
  errors: string[];
  dryRun: boolean;
  dealPropertyOwners: Map<string, Map<string, string>>; // dealId → roleProperty → ownerId
  ownerNameMap: Map<string, string>; // ownerId → name
}

// ── Helpers ────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pipelineSuffix(pipelineId: string): string {
  return PIPELINE_SUFFIXES[pipelineId] ?? "";
}

function dealLink(dealId: string, dealName: string): string {
  const url = getHubSpotDealUrl(dealId);
  return `<a href="${url}" style="color:#3b82f6;text-decoration:none;">${esc(dealName)}</a>`;
}

const SECTION_HEADER_STYLE =
  "margin:20px 0 8px 0;padding:5px 0 5px 0;font-size:11px;font-weight:700;" +
  "text-transform:uppercase;letter-spacing:0.5px;color:#f97316;" +
  "border-bottom:1px solid #2a2a3a;";

const MUTED_STYLE = "color:#a1a1aa;font-size:11px;";

// ── Resolve lead name for a status change ─────────────────────────────

function resolveLeadName(
  change: StatusChange,
  dealPropertyOwners: Map<string, Map<string, string>>,
  ownerNameMap: Map<string, string>
): string {
  const hsProperty = FIELD_TO_HS_PROPERTY[change.field];
  if (!hsProperty) return "Unknown";

  const roleProperty = STATUS_TO_ROLE_PROPERTY[hsProperty];
  if (!roleProperty) return "Unknown";

  const ownerId = dealPropertyOwners.get(change.dealId)?.get(roleProperty);
  if (!ownerId) return "Unknown";

  return ownerNameMap.get(ownerId) ?? ownerId;
}

// ── Section builders ───────────────────────────────────────────────────

function buildDryRunBanner(): string {
  return `<div style="background:#451a03;border:1px solid #f97316;border-radius:6px;padding:10px 14px;margin-bottom:16px;font-size:12px;color:#fdba74;">
  <strong>\u26a0 DRY RUN MODE</strong> \u2014 This is a preview only. No email was sent to recipients.
</div>`;
}

function buildHeadlineStats(data: EodEmailData): string {
  const { changes, milestones, tasks } = data;
  const total = changes.length + milestones.length + tasks.length;

  let text: string;
  if (total === 0) {
    text = "All quiet \u2014 no status changes, milestones, or task completions today.";
  } else {
    const parts: string[] = [];
    if (changes.length > 0)
      parts.push(`${changes.length} status change${changes.length === 1 ? "" : "s"}`);
    if (milestones.length > 0)
      parts.push(`${milestones.length} milestone${milestones.length === 1 ? "" : "s"}`);
    if (tasks.length > 0)
      parts.push(`${tasks.length} task${tasks.length === 1 ? "" : "s"} completed`);
    text = parts.join(" \u00b7 ");
  }

  return `<div style="font-size:14px;font-weight:600;color:#e4e4e7;margin-bottom:16px;">${esc(text)}</div>`;
}

function buildMilestonesSection(milestones: MilestoneHit[]): string {
  if (milestones.length === 0) return "";

  const sorted = [...milestones].sort((a, b) => {
    if (!a.changedAtIso && !b.changedAtIso) return 0;
    if (!a.changedAtIso) return 1;
    if (!b.changedAtIso) return -1;
    return b.changedAtIso.localeCompare(a.changedAtIso);
  });

  const rows = sorted.map((hit) => {
    const { change } = hit;
    const location = change.pbLocation ? ` \u00b7 ${esc(change.pbLocation)}` : "";
    const suffix = pipelineSuffix(change.pipeline);
    const suffixHtml = suffix ? ` <span style="${MUTED_STYLE}">${esc(suffix.trim())}</span>` : "";
    const fromDisplay = change.from
      ? getStatusDisplayName(change.from, FIELD_TO_HS_PROPERTY[change.field] ?? change.field)
      : null;
    const wasPart = fromDisplay ? ` <span style="${MUTED_STYLE}">(was: ${esc(fromDisplay)})</span>` : "";
    const whoPart =
      hit.changedBy || hit.changedAt
        ? ` <span style="${MUTED_STYLE}">\u2014 ${hit.changedBy ? esc(hit.changedBy) : ""}${hit.changedAt ? `, ${esc(hit.changedAt)}` : ""}</span>`
        : "";

    return `<div style="border-left:3px solid #22c55e;padding:6px 10px;margin-bottom:6px;background:#0f1a0f;border-radius:0 4px 4px 0;">
  <span style="color:#4ade80;font-size:13px;margin-right:4px;">\u2605</span>
  ${dealLink(change.dealId, change.dealName)}${suffixHtml}<span style="${MUTED_STYLE}">${location}</span>
  <br><span style="font-size:12px;color:#86efac;font-weight:600;">${esc(hit.displayLabel)}</span>${wasPart}${whoPart}
</div>`;
  });

  return `<div style="${SECTION_HEADER_STYLE}">Milestones (${milestones.length})</div>
${rows.join("\n")}`;
}

function buildStatusChangesSection(
  changes: StatusChange[],
  stageMap: Record<string, string>,
  dealPropertyOwners: Map<string, Map<string, string>>,
  ownerNameMap: Map<string, string>
): string {
  if (changes.length === 0) return "";

  // Group by department → lead name → changes
  const deptMap = new Map<string, Map<string, StatusChange[]>>();

  for (const change of changes) {
    const hsProperty = FIELD_TO_HS_PROPERTY[change.field] ?? "";
    const dept = PROPERTY_TO_DEPARTMENT[hsProperty] ?? "Other";
    const leadName = resolveLeadName(change, dealPropertyOwners, ownerNameMap);

    if (!deptMap.has(dept)) deptMap.set(dept, new Map());
    const leadMap = deptMap.get(dept)!;
    if (!leadMap.has(leadName)) leadMap.set(leadName, []);
    leadMap.get(leadName)!.push(change);
  }

  const deptOrder = ["Design", "Permitting", "Interconnection", "PTO", "Other"];
  const sortedDepts = [...deptMap.keys()].sort(
    (a, b) => deptOrder.indexOf(a) - deptOrder.indexOf(b)
  );

  const parts: string[] = [
    `<div style="${SECTION_HEADER_STYLE}">Status Changes by Department (${changes.length})</div>`,
  ];

  for (const dept of sortedDepts) {
    const leadMap = deptMap.get(dept)!;
    const sortedLeads = [...leadMap.keys()].sort((a, b) => a.localeCompare(b));

    parts.push(
      `<div style="font-size:11px;font-weight:700;color:#71717a;text-transform:uppercase;letter-spacing:0.4px;margin:10px 0 4px 0;">${esc(dept)}</div>`
    );

    for (const leadName of sortedLeads) {
      const leadChanges = leadMap.get(leadName)!;
      const sortedChanges = [...leadChanges].sort((a, b) =>
        a.dealName.localeCompare(b.dealName)
      );

      parts.push(
        `<div style="font-size:12px;font-weight:600;color:#d4d4d8;margin:6px 0 3px 0;">${esc(leadName)}</div>`
      );

      for (const change of sortedChanges) {
        const hsProperty = FIELD_TO_HS_PROPERTY[change.field] ?? change.field;
        const fromDisplay = change.from ? getStatusDisplayName(change.from, hsProperty) : null;
        const toDisplay = change.to ? getStatusDisplayName(change.to, hsProperty) : null;
        const stageName = stageMap[change.dealStage] ?? change.dealStage;
        const location = change.pbLocation ? ` \u00b7 ${esc(change.pbLocation)}` : "";
        const suffix = pipelineSuffix(change.pipeline);
        const suffixHtml = suffix
          ? ` <span style="${MUTED_STYLE}">${esc(suffix.trim())}</span>`
          : "";

        const fromHtml = fromDisplay
          ? `<span style="color:#a1a1aa;">${esc(fromDisplay)}</span> \u2192 `
          : "";
        const toHtml = toDisplay
          ? `<span style="color:#d4d4d8;font-weight:600;">${esc(toDisplay)}</span>`
          : "<span style=\"color:#a1a1aa;\">cleared</span>";

        parts.push(
          `<div style="padding:4px 0 4px 8px;border-left:2px solid #2a2a3a;margin-bottom:4px;">
  ${dealLink(change.dealId, change.dealName)}${suffixHtml}<span style="${MUTED_STYLE}">${location}</span>
  <br><span style="${MUTED_STYLE}">${esc(stageName)} \u00b7 </span>${fromHtml}${toHtml}
</div>`
        );
      }
    }
  }

  return parts.join("\n");
}

function buildNewDealsSection(
  newDeals: SnapshotDeal[],
  stageMap: Record<string, string>
): string {
  if (newDeals.length === 0) return "";

  const rows = newDeals.map((deal) => {
    const stageName = stageMap[deal.dealStage] ?? deal.dealStage;
    const location = deal.pbLocation ? ` \u00b7 ${esc(deal.pbLocation)}` : "";
    const suffix = pipelineSuffix(deal.pipeline);
    const suffixHtml = suffix ? ` <span style="${MUTED_STYLE}">${esc(suffix.trim())}</span>` : "";
    return `<div style="padding:3px 0;">
  <span style="color:#4ade80;font-weight:700;">+</span> ${dealLink(deal.dealId, deal.dealName)}${suffixHtml}<span style="${MUTED_STYLE}">${location} \u00b7 ${esc(stageName)}</span>
</div>`;
  });

  return `<div style="${SECTION_HEADER_STYLE}">New Deals In Scope (${newDeals.length})</div>
${rows.join("\n")}`;
}

function buildResolvedDealsSection(resolvedDeals: SnapshotDeal[]): string {
  if (resolvedDeals.length === 0) return "";

  const rows = resolvedDeals.map((deal) => {
    const location = deal.pbLocation ? ` \u00b7 ${esc(deal.pbLocation)}` : "";
    const suffix = pipelineSuffix(deal.pipeline);
    const suffixHtml = suffix ? ` <span style="${MUTED_STYLE}">${esc(suffix.trim())}</span>` : "";
    return `<div style="padding:3px 0;">
  <span style="color:#a1a1aa;">\u2713</span> ${dealLink(deal.dealId, deal.dealName)}${suffixHtml}<span style="${MUTED_STYLE}">${location}</span>
</div>`;
  });

  return `<div style="${SECTION_HEADER_STYLE}">Deals Resolved (${resolvedDeals.length})</div>
${rows.join("\n")}`;
}

function buildTasksSection(tasks: CompletedTask[]): string {
  if (tasks.length === 0) return "";

  // Group by owner name
  const ownerMap = new Map<string, CompletedTask[]>();
  for (const task of tasks) {
    const name = task.ownerName || task.ownerId;
    if (!ownerMap.has(name)) ownerMap.set(name, []);
    ownerMap.get(name)!.push(task);
  }

  const sortedOwners = [...ownerMap.keys()].sort((a, b) => a.localeCompare(b));

  const parts: string[] = [
    `<div style="${SECTION_HEADER_STYLE}">Tasks Completed (${tasks.length})</div>`,
  ];

  for (const ownerName of sortedOwners) {
    const ownerTasks = ownerMap.get(ownerName)!;
    const count = ownerTasks.length;
    parts.push(
      `<div style="font-size:12px;font-weight:600;color:#d4d4d8;margin:8px 0 3px 0;">${esc(ownerName)} <span style="${MUTED_STYLE}">\u2014 ${count} task${count === 1 ? "" : "s"}</span></div>`
    );
    for (const task of ownerTasks) {
      const dealPart =
        task.associatedDealId && task.associatedDealName
          ? ` <span style="${MUTED_STYLE}">(${dealLink(task.associatedDealId, task.associatedDealName)})</span>`
          : task.associatedDealId
            ? ` <span style="${MUTED_STYLE}">(deal ${esc(task.associatedDealId)})</span>`
            : "";
      parts.push(
        `<div style="padding:2px 0 2px 8px;">
  <span style="color:#4ade80;">\u2713</span> <span style="font-size:12px;">${esc(task.subject)}</span>${dealPart}
</div>`
      );
    }
  }

  return parts.join("\n");
}

function buildStillPendingSection(
  morningDealCount: number,
  stillInScopeCount: number
): string {
  return `<div style="margin-top:20px;padding:10px 12px;background:#17171f;border-radius:6px;font-size:12px;color:#71717a;">
  Morning focus had <strong style="color:#a1a1aa;">${morningDealCount}</strong> deal${morningDealCount === 1 ? "" : "s"} across the team \u00b7
  <strong style="color:#a1a1aa;">${stillInScopeCount}</strong> still in scope
</div>`;
}

function buildErrorsSection(errors: string[]): string {
  if (errors.length === 0) return "";

  const rows = errors.map(
    (e) =>
      `<div style="padding:2px 0;font-size:11px;">\u2022 ${esc(e)}</div>`
  );

  return `<div style="margin-top:16px;border:1px solid #dc2626;border-radius:6px;padding:10px 14px;background:#1a0808;">
  <div style="font-size:12px;font-weight:700;color:#f87171;margin-bottom:6px;">\u26a0 Errors encountered during generation:</div>
  ${rows.join("\n")}
</div>`;
}

function buildTimestampFooter(): string {
  const now = new Date();
  const formatted = now.toLocaleString("en-US", {
    timeZone: "America/Denver",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  });

  return `<div style="margin-top:20px;text-align:center;font-size:10px;color:#52525b;">
  Generated at ${esc(formatted)} \u00b7 Powered by PB Operations Suite
</div>`;
}

// ── Plain-text summary ─────────────────────────────────────────────────

function buildPlainText(data: EodEmailData): string {
  const lines: string[] = ["PB Operations — EOD Summary", ""];

  const total = data.changes.length + data.milestones.length + data.tasks.length;
  if (total === 0) {
    lines.push("All quiet — no status changes, milestones, or task completions today.");
  } else {
    const parts: string[] = [];
    if (data.changes.length > 0)
      parts.push(`${data.changes.length} status change${data.changes.length === 1 ? "" : "s"}`);
    if (data.milestones.length > 0)
      parts.push(`${data.milestones.length} milestone${data.milestones.length === 1 ? "" : "s"}`);
    if (data.tasks.length > 0)
      parts.push(`${data.tasks.length} task${data.tasks.length === 1 ? "" : "s"} completed`);
    lines.push(parts.join(" · "));
  }

  if (data.milestones.length > 0) {
    lines.push("", "MILESTONES");
    for (const hit of data.milestones) {
      lines.push(`  ★ ${hit.displayLabel} — ${hit.change.dealName}${hit.changedBy ? ` (by ${hit.changedBy})` : ""}`);
    }
  }

  if (data.changes.length > 0) {
    lines.push("", "STATUS CHANGES");
    for (const change of data.changes) {
      const hsProperty = FIELD_TO_HS_PROPERTY[change.field] ?? change.field;
      const from = change.from ? getStatusDisplayName(change.from, hsProperty) : "—";
      const to = change.to ? getStatusDisplayName(change.to, hsProperty) : "cleared";
      lines.push(`  ${change.dealName}: ${from} → ${to}`);
    }
  }

  if (data.newDeals.length > 0) {
    lines.push("", "NEW DEALS IN SCOPE");
    for (const deal of data.newDeals) lines.push(`  + ${deal.dealName}`);
  }

  if (data.resolvedDeals.length > 0) {
    lines.push("", "DEALS RESOLVED");
    for (const deal of data.resolvedDeals) lines.push(`  ✓ ${deal.dealName}`);
  }

  if (data.tasks.length > 0) {
    lines.push("", "TASKS COMPLETED");
    const byOwner = new Map<string, CompletedTask[]>();
    for (const task of data.tasks) {
      const name = task.ownerName || task.ownerId;
      if (!byOwner.has(name)) byOwner.set(name, []);
      byOwner.get(name)!.push(task);
    }
    for (const [name, ownerTasks] of [...byOwner.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      lines.push(`  ${name} — ${ownerTasks.length} task${ownerTasks.length === 1 ? "" : "s"}`);
      for (const task of ownerTasks) {
        const dealSuffix = task.associatedDealName ? ` (${task.associatedDealName})` : "";
        lines.push(`    ✓ ${task.subject}${dealSuffix}`);
      }
    }
  }

  lines.push(
    "",
    `Morning focus had ${data.morningDealCount} deal${data.morningDealCount === 1 ? "" : "s"} across the team · ${data.stillInScopeCount} still in scope`
  );

  if (data.errors.length > 0) {
    lines.push("", "ERRORS");
    for (const e of data.errors) lines.push(`  • ${e}`);
  }

  return lines.join("\n");
}

// ── Main export ────────────────────────────────────────────────────────

export function buildEodEmail(data: EodEmailData): { html: string; text: string } {
  const parts: string[] = [];

  if (data.dryRun) {
    parts.push(buildDryRunBanner());
  }

  parts.push(buildHeadlineStats(data));

  const milestonesHtml = buildMilestonesSection(data.milestones);
  if (milestonesHtml) parts.push(milestonesHtml);

  const changesHtml = buildStatusChangesSection(
    data.changes,
    data.stageMap,
    data.dealPropertyOwners,
    data.ownerNameMap
  );
  if (changesHtml) parts.push(changesHtml);

  const newDealsHtml = buildNewDealsSection(data.newDeals, data.stageMap);
  if (newDealsHtml) parts.push(newDealsHtml);

  const resolvedHtml = buildResolvedDealsSection(data.resolvedDeals);
  if (resolvedHtml) parts.push(resolvedHtml);

  const tasksHtml = buildTasksSection(data.tasks);
  if (tasksHtml) parts.push(tasksHtml);

  parts.push(buildStillPendingSection(data.morningDealCount, data.stillInScopeCount));

  const errorsHtml = buildErrorsSection(data.errors);
  if (errorsHtml) parts.push(errorsHtml);

  parts.push(buildTimestampFooter());

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:640px;margin:0 auto;padding:24px 16px;">
  <div style="text-align:center;margin-bottom:20px;">
    <span style="font-size:18px;font-weight:700;background:linear-gradient(to right,#f97316,#fb923c);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">PB Operations</span>
    <span style="font-size:12px;color:#71717a;margin-left:8px;">EOD Summary</span>
  </div>
  <div style="background:#12121a;border-radius:8px;padding:20px;color:#e4e4e7;font-size:13px;line-height:1.5;">
    ${parts.join("\n")}
  </div>
</div>
</body>
</html>`;

  const text = buildPlainText(data);

  return { html, text };
}
