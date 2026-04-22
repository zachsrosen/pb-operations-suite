// src/lib/eod-summary/html.ts
//
// Builds the EOD summary email — organized BY PERSON.
// Each person gets their milestones, status changes, and tasks grouped together.

import { getHubSpotDealUrl } from "@/lib/external-links";
import { getStatusDisplayName, trimDealName } from "@/lib/daily-focus/format";
import {
  PIPELINE_SUFFIXES,
  STATUS_TO_ROLE_PROPERTY,
  FIELD_TO_HS_PROPERTY,
} from "./config";
import type { StatusChange, SnapshotDeal } from "./snapshot";
import type { MilestoneHit, ChangeAttribution } from "./milestones";
import type { CompletedTask } from "./tasks";

// ── Public interface ───────────────────────────────────────────────────

export interface EodEmailData {
  changes: StatusChange[];
  changeAttributions: ChangeAttribution[];
  milestones: MilestoneHit[];
  tasks: CompletedTask[];
  newDeals: SnapshotDeal[];
  resolvedDeals: SnapshotDeal[];
  stageMap: Record<string, string>;
  morningDealCount: number;
  stillInScopeCount: number;
  errors: string[];
  dryRun: boolean;
  dealPropertyOwners: Map<string, Map<string, string>>;
  ownerNameMap: Map<string, string>;
  /** Morning snapshot: dealId → Set of ownerIds (for per-person resolution tracking) */
  morningDealOwnerMap: Map<string, Set<string>>;
  /** Evening deal IDs (for computing which morning deals are still in scope) */
  eveningDealIds: Set<string>;
}

// ── Helpers ────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function dealLink(dealId: string, rawDealName: string): string {
  const url = getHubSpotDealUrl(dealId);
  const trimmed = trimDealName(rawDealName);
  return `<a href="${url}" style="color:#3b82f6;text-decoration:none;">${esc(trimmed)}</a>`;
}

function resolveStage(stageId: string, pipelineId: string, stageMap: Record<string, string>): string {
  const name = stageMap[stageId];
  if (name) return name;
  const suffix = PIPELINE_SUFFIXES[pipelineId] ?? "";
  return stageId + suffix;
}

const M = "color:#a1a1aa;font-size:11px;";
const PERSON_HEADER =
  "margin:20px 0 6px 0;padding:8px 12px;border-radius:6px;background:#1a1a2e;" +
  "border-left:3px solid #f97316;";
const SUB_HEADER =
  "font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;" +
  "color:#71717a;margin:10px 0 4px 0;";
const SECTION_DIVIDER =
  "margin:20px 0 8px 0;padding:5px 0;font-size:11px;font-weight:700;" +
  "text-transform:uppercase;letter-spacing:0.5px;color:#f97316;" +
  "border-bottom:1px solid #2a2a3a;";

// ── Noise filter ──────────────────────────────────────────────────────

function isNoiseChange(change: StatusChange): boolean {
  // Stage-only pipeline moves
  if (change.field === "dealStage") return true;
  // First-set changes ("\u2014 \u2192 status") are low-signal — property was null, now set
  if (!change.from && change.to) return true;
  return false;
}

// ── Resolve which person owns a status change ─────────────────────────

function resolveOwnerId(
  change: StatusChange,
  dealPropertyOwners: Map<string, Map<string, string>>,
): string {
  const hsProperty = FIELD_TO_HS_PROPERTY[change.field];
  if (!hsProperty) return "unknown";
  const roleProperty = STATUS_TO_ROLE_PROPERTY[hsProperty];
  if (!roleProperty) return "unknown";
  return dealPropertyOwners.get(change.dealId)?.get(roleProperty) ?? "unknown";
}

// ── Per-person data aggregation ───────────────────────────────────────

interface PersonData {
  name: string;
  milestones: MilestoneHit[];
  changes: StatusChange[];
  tasks: CompletedTask[];
  /** How many morning focus deals this person had */
  morningDealCount: number;
  /** How many of those are still in scope at EOD */
  morningStillInScope: number;
}

function aggregateByPerson(data: EodEmailData): PersonData[] {
  const people = new Map<string, PersonData>();
  const trackedOwnerIds = new Set(data.ownerNameMap.keys());

  // Precompute per-owner morning resolution stats
  const ownerMorningCounts = new Map<string, { total: number; stillInScope: number }>();
  for (const [dealId, owners] of data.morningDealOwnerMap) {
    for (const ownerId of owners) {
      if (!ownerMorningCounts.has(ownerId)) ownerMorningCounts.set(ownerId, { total: 0, stillInScope: 0 });
      const stats = ownerMorningCounts.get(ownerId)!;
      stats.total++;
      if (data.eveningDealIds.has(dealId)) stats.stillInScope++;
    }
  }

  function getOrCreate(ownerId: string): PersonData {
    if (!people.has(ownerId)) {
      const morningStats = ownerMorningCounts.get(ownerId);
      people.set(ownerId, {
        name: data.ownerNameMap.get(ownerId) ?? ownerId,
        milestones: [],
        changes: [],
        tasks: [],
        morningDealCount: morningStats?.total ?? 0,
        morningStillInScope: morningStats?.stillInScope ?? 0,
      });
    }
    return people.get(ownerId)!;
  }

  // Resolve the best owner: if property history attributed it to a tracked
  // team member, use that. Otherwise fall back to the deal's role-property
  // owner. Handles automation IDs (PandaDoc, workflows) by crediting the
  // design/permit lead instead.
  function resolveChangeOwner(
    attrOwnerId: string | null,
    change: StatusChange,
  ): string {
    if (attrOwnerId && trackedOwnerIds.has(attrOwnerId)) return attrOwnerId;
    return resolveOwnerId(change, data.dealPropertyOwners);
  }

  // Build a set of dealId:field keys that are milestones, so we can
  // exclude them from the status changes list (avoid duplication).
  const milestoneKeys = new Set<string>();
  for (const hit of data.milestones) {
    milestoneKeys.add(`${hit.change.dealId}:${hit.change.field}`);
  }

  // Milestones \u2192 person
  const milestoneAttrLookup = new Map<string, ChangeAttribution>();
  for (const attr of data.changeAttributions) {
    milestoneAttrLookup.set(`${attr.change.dealId}:${attr.change.field}`, attr);
  }

  for (const hit of data.milestones) {
    const attrKey = `${hit.change.dealId}:${hit.change.field}`;
    const attr = milestoneAttrLookup.get(attrKey);
    const ownerId = resolveChangeOwner(attr?.changedByOwnerId ?? null, hit.change);
    getOrCreate(ownerId).milestones.push(hit);
  }

  // Status changes \u2192 person (skip noise + skip milestones already shown)
  for (const attr of data.changeAttributions) {
    if (isNoiseChange(attr.change)) continue;
    const key = `${attr.change.dealId}:${attr.change.field}`;
    if (milestoneKeys.has(key)) continue; // already shown as milestone
    const ownerId = resolveChangeOwner(attr.changedByOwnerId, attr.change);
    getOrCreate(ownerId).changes.push(attr.change);
  }

  // Tasks \u2192 person via ownerId
  for (const task of data.tasks) {
    getOrCreate(task.ownerId).tasks.push(task);
  }

  // Sort by total activity descending
  return [...people.values()]
    .filter((p) => p.milestones.length + p.changes.length + p.tasks.length > 0)
    .sort((a, b) => {
      const aTotal = a.milestones.length + a.changes.length + a.tasks.length;
      const bTotal = b.milestones.length + b.changes.length + b.tasks.length;
      return bTotal - aTotal;
    });
}

// ── Build HTML for one person ─────────────────────────────────────────

function buildPersonHtml(person: PersonData, stageMap: Record<string, string>): string {
  const parts: string[] = [];

  // Summary badges
  const badges: string[] = [];
  if (person.milestones.length > 0)
    badges.push(`<span style="display:inline-block;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600;background:#052e16;color:#4ade80;margin-right:4px;">${person.milestones.length} \u2605</span>`);
  if (person.changes.length > 0)
    badges.push(`<span style="display:inline-block;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600;background:#172554;color:#60a5fa;margin-right:4px;">${person.changes.length} \u2194</span>`);
  if (person.tasks.length > 0)
    badges.push(`<span style="display:inline-block;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600;background:#1c1917;color:#a1a1aa;margin-right:4px;">${person.tasks.length} \u2713</span>`);

  // Morning resolution line
  const resolved = person.morningDealCount - person.morningStillInScope;
  const resolutionLine = person.morningDealCount > 0
    ? `<div style="font-size:10px;color:#52525b;margin-top:3px;">${resolved} of ${person.morningDealCount} morning items resolved</div>`
    : "";

  // Person header
  parts.push(`<div style="${PERSON_HEADER}">
  <span style="font-size:14px;font-weight:700;color:#e4e4e7;">${esc(person.name)}</span>
  <span style="margin-left:8px;">${badges.join("")}</span>
  ${resolutionLine}
</div>`);

  // Milestones
  if (person.milestones.length > 0) {
    parts.push(`<div style="${SUB_HEADER}">Milestones</div>`);
    for (const hit of person.milestones) {
      const { change } = hit;
      const fromDisplay = change.from
        ? getStatusDisplayName(change.from, FIELD_TO_HS_PROPERTY[change.field] ?? change.field)
        : null;
      const wasPart = fromDisplay ? ` <span style="${M}">(was: ${esc(fromDisplay)})</span>` : "";
      const timePart = hit.changedAt ? ` <span style="${M}">\u00b7 ${esc(hit.changedAt)}</span>` : "";

      parts.push(`<div style="border-left:3px solid #22c55e;padding:4px 10px;margin-bottom:4px;background:#0f1a0f;border-radius:0 4px 4px 0;">
  <span style="color:#4ade80;margin-right:4px;">\u2605</span>
  <span style="font-size:12px;color:#86efac;font-weight:600;">${esc(hit.displayLabel)}</span>${wasPart}${timePart}
  <br>${dealLink(change.dealId, change.dealName)}
</div>`);
    }
  }

  // Status changes
  if (person.changes.length > 0) {
    parts.push(`<div style="${SUB_HEADER}">Status Changes</div>`);
    const sorted = [...person.changes].sort((a, b) => a.dealName.localeCompare(b.dealName));
    for (const change of sorted) {
      const hsProperty = FIELD_TO_HS_PROPERTY[change.field] ?? change.field;
      const fromDisplay = change.from ? getStatusDisplayName(change.from, hsProperty) : "\u2014";
      const toDisplay = change.to ? getStatusDisplayName(change.to, hsProperty) : "cleared";

      parts.push(`<div style="padding:3px 0 3px 8px;border-left:2px solid #2a2a3a;margin-bottom:3px;">
  ${dealLink(change.dealId, change.dealName)}
  <br><span style="${M}">${esc(fromDisplay)} \u2192 </span><span style="color:#d4d4d8;font-weight:600;font-size:12px;">${esc(toDisplay)}</span>
</div>`);
    }
  }

  // Tasks
  if (person.tasks.length > 0) {
    parts.push(`<div style="${SUB_HEADER}">Tasks Completed</div>`);
    for (const task of person.tasks) {
      const dealPart = task.associatedDealId && task.associatedDealName
        ? ` <span style="${M}">(${dealLink(task.associatedDealId, task.associatedDealName)})</span>`
        : "";
      parts.push(`<div style="padding:2px 0 2px 8px;">
  <span style="color:#4ade80;">\u2713</span> <span style="font-size:12px;">${esc(task.subject)}</span>${dealPart}
</div>`);
    }
  }

  return parts.join("\n");
}

// ── Top-level sections ────────────────────────────────────────────────

function buildNewDealsSection(newDeals: SnapshotDeal[], stageMap: Record<string, string>): string {
  if (newDeals.length === 0) return "";
  const rows = newDeals.map((deal) => {
    const stageName = resolveStage(deal.dealStage, deal.pipeline, stageMap);
    return `<div style="padding:3px 0;">
  <span style="color:#4ade80;font-weight:700;">+</span> ${dealLink(deal.dealId, deal.dealName)} <span style="${M}">\u00b7 ${esc(stageName)}</span>
</div>`;
  });
  return `<div style="${SECTION_DIVIDER}">New Deals In Scope (${newDeals.length})</div>\n${rows.join("\n")}`;
}

function buildResolvedDealsSection(resolvedDeals: SnapshotDeal[]): string {
  if (resolvedDeals.length === 0) return "";
  const rows = resolvedDeals.map((deal) => {
    return `<div style="padding:3px 0;">
  <span style="color:#a1a1aa;">\u2713</span> ${dealLink(deal.dealId, deal.dealName)}
</div>`;
  });
  return `<div style="${SECTION_DIVIDER}">Deals Resolved (${resolvedDeals.length})</div>\n${rows.join("\n")}`;
}

function buildErrorsSection(errors: string[]): string {
  if (errors.length === 0) return "";
  const rows = errors.map((e) => `<div style="padding:2px 0;font-size:11px;">\u2022 ${esc(e)}</div>`);
  return `<div style="margin-top:16px;border:1px solid #dc2626;border-radius:6px;padding:10px 14px;background:#1a0808;">
  <div style="font-size:12px;font-weight:700;color:#f87171;margin-bottom:6px;">\u26a0 Errors:</div>
  ${rows.join("\n")}
</div>`;
}

// ── Plain-text ────────────────────────────────────────────────────────

function buildPlainText(data: EodEmailData): string {
  const lines: string[] = ["PB Operations \u2014 EOD Summary", ""];
  const people = aggregateByPerson(data);

  if (people.length === 0) {
    lines.push("All quiet \u2014 no activity today.");
    return lines.join("\n");
  }

  const nonNoiseChanges = data.changeAttributions.filter((a) => !isNoiseChange(a.change));
  const stats: string[] = [];
  if (nonNoiseChanges.length > 0) stats.push(`${nonNoiseChanges.length} status changes`);
  if (data.milestones.length > 0) stats.push(`${data.milestones.length} milestones`);
  if (data.tasks.length > 0) stats.push(`${data.tasks.length} tasks completed`);
  lines.push(stats.join(" \u00b7 "), "");

  for (const person of people) {
    const summary: string[] = [];
    if (person.milestones.length > 0) summary.push(`${person.milestones.length}\u2605`);
    if (person.changes.length > 0) summary.push(`${person.changes.length}\u2194`);
    if (person.tasks.length > 0) summary.push(`${person.tasks.length}\u2713`);
    lines.push(`${person.name} \u2014 ${summary.join("  ")}`);

    for (const hit of person.milestones) {
      lines.push(`  \u2605 ${hit.displayLabel} \u2014 ${trimDealName(hit.change.dealName)}`);
    }
    for (const change of person.changes) {
      const hsProperty = FIELD_TO_HS_PROPERTY[change.field] ?? change.field;
      const from = change.from ? getStatusDisplayName(change.from, hsProperty) : "\u2014";
      const to = change.to ? getStatusDisplayName(change.to, hsProperty) : "cleared";
      lines.push(`  ${trimDealName(change.dealName)}: ${from} \u2192 ${to}`);
    }
    for (const task of person.tasks) {
      const dealSuffix = task.associatedDealName ? ` (${trimDealName(task.associatedDealName)})` : "";
      lines.push(`  \u2713 ${task.subject}${dealSuffix}`);
    }
    lines.push("");
  }

  if (data.newDeals.length > 0) {
    lines.push("NEW DEALS IN SCOPE");
    for (const deal of data.newDeals) lines.push(`  + ${trimDealName(deal.dealName)}`);
    lines.push("");
  }

  if (data.resolvedDeals.length > 0) {
    lines.push("DEALS RESOLVED");
    for (const deal of data.resolvedDeals) lines.push(`  \u2713 ${trimDealName(deal.dealName)}`);
    lines.push("");
  }

  lines.push(`Morning focus had ${data.morningDealCount} deals \u00b7 ${data.stillInScopeCount} still in scope`);

  if (data.errors.length > 0) {
    lines.push("", "ERRORS");
    for (const e of data.errors) lines.push(`  \u2022 ${e}`);
  }

  return lines.join("\n");
}

// ── Main export ────────────────────────────────────────────────────────

export function buildEodEmail(data: EodEmailData): { html: string; text: string } {
  const parts: string[] = [];

  if (data.dryRun) {
    parts.push(`<div style="background:#451a03;border:1px solid #f97316;border-radius:6px;padding:10px 14px;margin-bottom:16px;font-size:12px;color:#fdba74;">
  <strong>\u26a0 DRY RUN</strong> \u2014 Preview only
</div>`);
  }

  const people = aggregateByPerson(data);

  // Headline stats (exclude noise from count)
  const nonNoiseChanges = data.changeAttributions.filter((a) => !isNoiseChange(a.change));
  // Also exclude milestones from change count since they're shown separately
  const milestoneKeys = new Set(data.milestones.map((h) => `${h.change.dealId}:${h.change.field}`));
  const uniqueChanges = nonNoiseChanges.filter((a) => !milestoneKeys.has(`${a.change.dealId}:${a.change.field}`));

  if (people.length === 0) {
    parts.push(`<div style="font-size:14px;color:#a1a1aa;">All quiet \u2014 no activity today.</div>`);
  } else {
    const stats: string[] = [];
    if (data.milestones.length > 0) stats.push(`${data.milestones.length} milestones`);
    if (uniqueChanges.length > 0) stats.push(`${uniqueChanges.length} status changes`);
    if (data.tasks.length > 0) stats.push(`${data.tasks.length} tasks completed`);
    parts.push(`<div style="font-size:14px;font-weight:600;color:#e4e4e7;margin-bottom:4px;">${stats.join(" \u00b7 ")}</div>`);

    // Team summary bar with micro-icons
    const teamSummary = people
      .map((p) => {
        const badges: string[] = [];
        if (p.milestones.length > 0) badges.push(`${p.milestones.length}\u2605`);
        if (p.changes.length > 0) badges.push(`${p.changes.length}\u2194`);
        if (p.tasks.length > 0) badges.push(`${p.tasks.length}\u2713`);
        return `<span style="display:inline-block;padding:2px 8px;margin:2px 4px 2px 0;background:#1a1a2e;border-radius:4px;font-size:11px;"><strong style="color:#e4e4e7;">${esc(p.name.split(" ")[0])}</strong> <span style="${M}">${badges.join(" ")}</span></span>`;
      })
      .join("");
    parts.push(`<div style="margin:8px 0 16px 0;">${teamSummary}</div>`);
  }

  // Per-person sections
  for (const person of people) {
    parts.push(buildPersonHtml(person, data.stageMap));
  }

  // New deals + resolved
  const newDealsHtml = buildNewDealsSection(data.newDeals, data.stageMap);
  if (newDealsHtml) parts.push(newDealsHtml);

  const resolvedHtml = buildResolvedDealsSection(data.resolvedDeals);
  if (resolvedHtml) parts.push(resolvedHtml);

  // Still pending
  parts.push(`<div style="margin-top:20px;padding:10px 12px;background:#17171f;border-radius:6px;font-size:12px;color:#71717a;">
  Morning focus had <strong style="color:#a1a1aa;">${data.morningDealCount}</strong> deals \u00b7
  <strong style="color:#a1a1aa;">${data.stillInScopeCount}</strong> still in scope
</div>`);

  // Errors
  const errorsHtml = buildErrorsSection(data.errors);
  if (errorsHtml) parts.push(errorsHtml);

  // Timestamp
  const timeStr = new Date().toLocaleString("en-US", {
    timeZone: "America/Denver",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  });
  parts.push(`<div style="margin-top:20px;text-align:center;font-size:10px;color:#52525b;">Generated at ${esc(timeStr)} \u00b7 Powered by PB Tech Ops Suite</div>`);

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

  return { html, text: buildPlainText(data) };
}
