// src/lib/task-digest/send.ts
//
// Daily digest of open HubSpot tasks + Freshservice tickets assigned to
// Zach. Surfaces overdue + urgent items first so nothing slips.

import * as Sentry from "@sentry/nextjs";
import { sendEmailMessage } from "@/lib/email";
import {
  FRESHSERVICE_PRIORITY_LABELS,
  FRESHSERVICE_STATUS_LABELS,
} from "@/lib/freshservice";
import { fetchOpenHsTasksForOwner, type OpenHsTask } from "./fetch-hs-tasks";
import { fetchOpenFsTicketsForAgent, type OpenFsTicket } from "./fetch-fs-tickets";

const RECIPIENT_EMAIL = "zach@photonbrothers.com";
const HUBSPOT_OWNER_ID = "2068088473"; // Zach Rosen — see daily-focus/config.ts
const HUBSPOT_PORTAL_ID = process.env.HUBSPOT_PORTAL_ID ?? "";
const FRESHSERVICE_DOMAIN = process.env.FRESHSERVICE_DOMAIN || "photonbrothers";

export interface TaskDigestResult {
  sent: boolean;
  dryRun: boolean;
  hsTaskCount: number;
  hsOverdueCount: number;
  fsTicketCount: number;
  fsOverdueCount: number;
  fsUrgentCount: number;
  errors: string[];
}

export async function runTaskDigest(options: {
  dryRun: boolean;
}): Promise<TaskDigestResult> {
  const { dryRun } = options;
  const errors: string[] = [];

  const [{ tasks, error: hsErr }, { tickets, error: fsErr }] = await Promise.all([
    fetchOpenHsTasksForOwner(HUBSPOT_OWNER_ID),
    fetchOpenFsTicketsForAgent(RECIPIENT_EMAIL),
  ]);

  if (hsErr) errors.push(`HubSpot: ${hsErr}`);
  if (fsErr) errors.push(`Freshservice: ${fsErr}`);

  const now = Date.now();
  const hsOverdue = tasks.filter((t) => t.dueAtMs !== null && t.dueAtMs < now);
  const fsOverdue = tickets.filter((t) => t.isOverdue);
  const fsUrgent = tickets.filter((t) => t.priority >= 3 && !t.isOverdue);

  const todayStr = new Date().toLocaleDateString("en-US", {
    timeZone: "America/Denver",
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  const subject = `${dryRun ? "[DRY RUN] " : ""}Daily Task Digest — ${tasks.length} task${tasks.length === 1 ? "" : "s"}, ${tickets.length} ticket${tickets.length === 1 ? "" : "s"}`;

  const { html, text } = buildEmail({
    todayStr,
    tasks,
    tickets,
    hsOverdue,
    fsOverdue,
    fsUrgent,
    errors,
    dryRun,
  });

  if (dryRun) {
    console.log("[task-digest] DRY RUN — would send to", RECIPIENT_EMAIL);
    console.log(text);
    return {
      sent: false,
      dryRun,
      hsTaskCount: tasks.length,
      hsOverdueCount: hsOverdue.length,
      fsTicketCount: tickets.length,
      fsOverdueCount: fsOverdue.length,
      fsUrgentCount: fsUrgent.length,
      errors,
    };
  }

  try {
    await sendEmailMessage({
      to: RECIPIENT_EMAIL,
      subject,
      html,
      text,
      debugFallbackTitle: subject,
      debugFallbackBody: text,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    Sentry.captureException(err, { tags: { module: "task-digest" } });
    errors.push(`Email send failed: ${msg}`);
    return {
      sent: false,
      dryRun,
      hsTaskCount: tasks.length,
      hsOverdueCount: hsOverdue.length,
      fsTicketCount: tickets.length,
      fsOverdueCount: fsOverdue.length,
      fsUrgentCount: fsUrgent.length,
      errors,
    };
  }

  return {
    sent: true,
    dryRun,
    hsTaskCount: tasks.length,
    hsOverdueCount: hsOverdue.length,
    fsTicketCount: tickets.length,
    fsOverdueCount: fsOverdue.length,
    fsUrgentCount: fsUrgent.length,
    errors,
  };
}

// ── Email rendering ────────────────────────────────────────────────────

function buildEmail(input: {
  todayStr: string;
  tasks: OpenHsTask[];
  tickets: OpenFsTicket[];
  hsOverdue: OpenHsTask[];
  fsOverdue: OpenFsTicket[];
  fsUrgent: OpenFsTicket[];
  errors: string[];
  dryRun: boolean;
}): { html: string; text: string } {
  const { todayStr, tasks, tickets, hsOverdue, fsOverdue, fsUrgent, errors, dryRun } = input;

  const hsUpcoming = tasks.filter((t) => !hsOverdue.includes(t));
  const fsRest = tickets.filter((t) => !fsOverdue.includes(t) && !fsUrgent.includes(t));

  const html = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f6f7f9;margin:0;padding:24px;color:#111;">
  <div style="max-width:680px;margin:0 auto;background:#fff;border-radius:8px;padding:24px;">
    <h1 style="margin:0 0 4px;font-size:20px;">${escapeHtml(dryRun ? "[DRY RUN] " : "")}Your Daily Task Digest</h1>
    <p style="margin:0 0 20px;color:#666;font-size:14px;">${escapeHtml(todayStr)}</p>

    <div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap;">
      ${summaryChip("Open Tasks", tasks.length, hsOverdue.length > 0 ? "#dc2626" : "#111")}
      ${summaryChip("Open Tickets", tickets.length, fsOverdue.length + fsUrgent.length > 0 ? "#dc2626" : "#111")}
      ${hsOverdue.length > 0 ? summaryChip("Overdue Tasks", hsOverdue.length, "#dc2626") : ""}
      ${fsOverdue.length > 0 ? summaryChip("Overdue Tickets", fsOverdue.length, "#dc2626") : ""}
      ${fsUrgent.length > 0 ? summaryChip("High/Urgent", fsUrgent.length, "#ea580c") : ""}
    </div>

    ${renderHsSection("⚠️ Overdue HubSpot Tasks", hsOverdue, "#dc2626", "#fef2f2")}
    ${renderHsSection("HubSpot Tasks (Upcoming / No Due Date)", hsUpcoming, "#2563eb", "#eff6ff")}

    ${renderFsSection("⚠️ Overdue Freshservice Tickets", fsOverdue, "#dc2626", "#fef2f2")}
    ${renderFsSection("🔥 High & Urgent Freshservice Tickets", fsUrgent, "#ea580c", "#fff7ed")}
    ${renderFsSection("Other Open Freshservice Tickets", fsRest, "#2563eb", "#eff6ff")}

    ${tasks.length === 0 && tickets.length === 0
      ? `<div style="padding:24px;text-align:center;color:#16a34a;background:#f0fdf4;border-radius:6px;">✅ All caught up — no open tasks or tickets.</div>`
      : ""}

    ${errors.length > 0
      ? `<div style="margin-top:20px;padding:12px;background:#fef2f2;border-left:3px solid #dc2626;border-radius:4px;font-size:13px;color:#991b1b;">
          <strong>Errors during fetch:</strong><ul style="margin:6px 0 0 18px;padding:0;">${errors.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul>
        </div>`
      : ""}

    <p style="margin-top:24px;color:#999;font-size:12px;">
      Sent by PB Ops Suite • <a href="https://app.hubspot.com/contacts/${escapeHtml(HUBSPOT_PORTAL_ID)}/tasks/all/list/view/all/" style="color:#999;">HubSpot tasks</a> • <a href="https://${escapeHtml(FRESHSERVICE_DOMAIN)}.freshservice.com/a/tickets/filters/agent" style="color:#999;">Freshservice tickets</a>
    </p>
  </div>
</body></html>`.trim();

  const text = buildText({ todayStr, tasks, tickets, hsOverdue, fsOverdue, fsUrgent, errors, dryRun });

  return { html, text };
}

function summaryChip(label: string, count: number, color: string): string {
  return `<div style="background:#f3f4f6;border-radius:6px;padding:10px 14px;min-width:90px;">
    <div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(label)}</div>
    <div style="font-size:22px;font-weight:600;color:${color};">${count}</div>
  </div>`;
}

function renderHsSection(
  title: string,
  tasks: OpenHsTask[],
  borderColor: string,
  bgColor: string
): string {
  if (tasks.length === 0) return "";
  const rows = tasks
    .map((t) => {
      const due = t.dueAtMs ? formatRelative(t.dueAtMs) : "<span style='color:#999;'>no due date</span>";
      const dealLink = t.associatedDealId
        ? ` · <a href="https://app.hubspot.com/contacts/${escapeHtml(HUBSPOT_PORTAL_ID)}/deal/${escapeHtml(t.associatedDealId)}" style="color:#2563eb;">${escapeHtml(t.associatedDealName ?? `Deal ${t.associatedDealId}`)}</a>`
        : "";
      const priority = t.priority && t.priority !== "NONE"
        ? ` · <span style="color:${t.priority === "HIGH" ? "#dc2626" : "#666"};">${escapeHtml(t.priority)}</span>`
        : "";
      return `<tr><td style="padding:8px 0;border-bottom:1px solid #eee;">
        <a href="https://app.hubspot.com/contacts/${escapeHtml(HUBSPOT_PORTAL_ID)}/record/0-27/${escapeHtml(t.taskId)}" style="color:#111;text-decoration:none;font-weight:500;">${escapeHtml(t.subject)}</a>
        <div style="font-size:12px;color:#666;margin-top:2px;">${due}${priority}${dealLink}</div>
      </td></tr>`;
    })
    .join("");
  return `<div style="margin-bottom:20px;">
    <h2 style="margin:0 0 8px;font-size:15px;color:${borderColor};border-left:3px solid ${borderColor};background:${bgColor};padding:6px 10px;">${escapeHtml(title)} (${tasks.length})</h2>
    <table style="width:100%;border-collapse:collapse;">${rows}</table>
  </div>`;
}

function renderFsSection(
  title: string,
  tickets: OpenFsTicket[],
  borderColor: string,
  bgColor: string
): string {
  if (tickets.length === 0) return "";
  const rows = tickets
    .map((t) => {
      const url = `https://${FRESHSERVICE_DOMAIN}.freshservice.com/a/tickets/${t.id}`;
      const status = FRESHSERVICE_STATUS_LABELS[t.status] ?? `Status ${t.status}`;
      const priority = FRESHSERVICE_PRIORITY_LABELS[t.priority] ?? `P${t.priority}`;
      const dueText = t.due_by
        ? `Due ${formatRelative(new Date(t.due_by).getTime())}`
        : "<span style='color:#999;'>no due date</span>";
      return `<tr><td style="padding:8px 0;border-bottom:1px solid #eee;">
        <a href="${url}" style="color:#111;text-decoration:none;font-weight:500;">#${t.id} · ${escapeHtml(t.subject)}</a>
        <div style="font-size:12px;color:#666;margin-top:2px;">${escapeHtml(status)} · <span style="color:${t.priority >= 3 ? "#dc2626" : "#666"};">${escapeHtml(priority)}</span> · ${dueText}</div>
      </td></tr>`;
    })
    .join("");
  return `<div style="margin-bottom:20px;">
    <h2 style="margin:0 0 8px;font-size:15px;color:${borderColor};border-left:3px solid ${borderColor};background:${bgColor};padding:6px 10px;">${escapeHtml(title)} (${tickets.length})</h2>
    <table style="width:100%;border-collapse:collapse;">${rows}</table>
  </div>`;
}

function buildText(input: {
  todayStr: string;
  tasks: OpenHsTask[];
  tickets: OpenFsTicket[];
  hsOverdue: OpenHsTask[];
  fsOverdue: OpenFsTicket[];
  fsUrgent: OpenFsTicket[];
  errors: string[];
  dryRun: boolean;
}): string {
  const { todayStr, tasks, tickets, hsOverdue, fsOverdue, fsUrgent } = input;
  const lines: string[] = [];
  lines.push(`Daily Task Digest — ${todayStr}`);
  lines.push("");
  lines.push(`Open HubSpot tasks: ${tasks.length} (${hsOverdue.length} overdue)`);
  lines.push(`Open Freshservice tickets: ${tickets.length} (${fsOverdue.length} overdue, ${fsUrgent.length} high/urgent)`);
  lines.push("");
  if (hsOverdue.length > 0) {
    lines.push("OVERDUE HUBSPOT TASKS:");
    for (const t of hsOverdue) {
      lines.push(`  • ${t.subject}${t.dueAtMs ? ` (${formatRelativeText(t.dueAtMs)})` : ""}${t.associatedDealName ? ` — ${t.associatedDealName}` : ""}`);
    }
    lines.push("");
  }
  if (fsOverdue.length > 0 || fsUrgent.length > 0) {
    lines.push("URGENT FRESHSERVICE TICKETS:");
    for (const t of [...fsOverdue, ...fsUrgent]) {
      lines.push(`  • #${t.id} ${t.subject} — ${FRESHSERVICE_PRIORITY_LABELS[t.priority] ?? "?"}`);
    }
  }
  return lines.join("\n");
}

function formatRelativeText(ms: number): string {
  const now = Date.now();
  const diffMs = ms - now;
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < -1) return `${Math.abs(diffDays)} days overdue`;
  if (diffDays === -1) return `1 day overdue`;
  if (diffDays === 0) return `due today`;
  if (diffDays === 1) return `due tomorrow`;
  return `due in ${diffDays} days`;
}

function formatRelative(ms: number): string {
  const text = formatRelativeText(ms);
  const now = Date.now();
  const diffMs = ms - now;
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return `<span style="color:#dc2626;">${text}</span>`;
  if (diffDays === 0) return `<span style="color:#ea580c;">${text}</span>`;
  return text;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
