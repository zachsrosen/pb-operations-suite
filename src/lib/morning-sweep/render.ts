// src/lib/morning-sweep/render.ts
//
// Builds the HTML body for the morning sweep email. Reuses the shared
// daily-focus email wrapper so it matches the other morning emails' chrome.

import { renderEmailWrapper } from "@/lib/daily-focus/html";
import type { SweepData, SweepTaskItem } from "./types";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function fmtDate(iso: string | null): string {
  if (!iso) return "no due date";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

const PRIORITY_COLOR: Record<string, string> = {
  HIGH: "#dc2626",
  Urgent: "#dc2626",
  High: "#dc2626",
  MEDIUM: "#d97706",
  Medium: "#d97706",
  LOW: "#6b7280",
  Low: "#6b7280",
};

function pill(label: string): string {
  const color = PRIORITY_COLOR[label] || "#6b7280";
  return `<span style="display:inline-block;font-size:11px;font-weight:600;color:#fff;background:${color};border-radius:9999px;padding:1px 8px;vertical-align:middle">${esc(
    label
  )}</span>`;
}

function sectionHeader(title: string, accent: string): string {
  return `<h2 style="font-size:15px;font-weight:700;color:#111827;margin:26px 0 10px;padding-bottom:6px;border-bottom:2px solid ${accent}">${esc(
    title
  )}</h2>`;
}

function taskLine(t: SweepTaskItem): string {
  const pr = t.priority ? pill(t.priority) + " " : "";
  return `<li style="margin:6px 0;line-height:1.4">
    ${pr}<a href="${t.url}" style="color:#1d4ed8;text-decoration:none;font-weight:600">${esc(
    t.subject
  )}</a>
    <span style="color:#6b7280"> &middot; ${esc(fmtDate(t.dueAt))}</span>
  </li>`;
}

export function renderSweepEmail(data: SweepData): string {
  const parts: string[] = [];

  const prettyDate = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(data.date + "T12:00:00"));

  parts.push(
    `<p style="font-size:16px;color:#111827;margin:0 0 4px"><strong>Good morning, Zach.</strong></p>
     <p style="font-size:13px;color:#6b7280;margin:0 0 8px">Your proactive sweep for ${esc(
       prettyDate
     )}. Nothing below was sent or changed. Draft replies are ready for you to use.</p>`
  );

  // ── Top priorities (Claude) ──
  if (data.drafts && data.drafts.topPriorities.length > 0) {
    parts.push(sectionHeader("Do these first", "#dc2626"));
    parts.push(
      `<ol style="margin:0;padding-left:20px;font-size:14px;color:#111827">${data.drafts.topPriorities
        .map((p) => `<li style="margin:6px 0;line-height:1.45">${esc(p)}</li>`)
        .join("")}</ol>`
    );
  }

  // ── HubSpot tasks ──
  const { tasks } = data;
  parts.push(
    sectionHeader(`HubSpot tasks (${tasks.totalOpen} open)`, "#2563eb")
  );
  const taskBody: string[] = [];
  if (tasks.overdue.length) {
    taskBody.push(
      `<p style="font-size:13px;font-weight:700;color:#dc2626;margin:8px 0 2px">Overdue</p><ul style="margin:0;padding-left:18px;font-size:13px">${tasks.overdue
        .map(taskLine)
        .join("")}</ul>`
    );
  }
  if (tasks.today.length) {
    taskBody.push(
      `<p style="font-size:13px;font-weight:700;color:#d97706;margin:10px 0 2px">Due today</p><ul style="margin:0;padding-left:18px;font-size:13px">${tasks.today
        .map(taskLine)
        .join("")}</ul>`
    );
  }
  if (tasks.upcoming.length) {
    taskBody.push(
      `<p style="font-size:13px;font-weight:700;color:#374151;margin:10px 0 2px">Upcoming</p><ul style="margin:0;padding-left:18px;font-size:13px">${tasks.upcoming
        .map(taskLine)
        .join("")}</ul>`
    );
  }
  if (tasks.groups.length) {
    taskBody.push(
      `<p style="font-size:13px;font-weight:700;color:#374151;margin:10px 0 2px">Recurring &amp; batched queues (open to triage)</p><ul style="margin:0;padding-left:18px;font-size:13px">${tasks.groups
        .map(
          (g) =>
            `<li style="margin:6px 0">${g.priority ? pill(g.priority) + " " : ""}<a href="${
              g.sampleUrl
            }" style="color:#1d4ed8;text-decoration:none;font-weight:600">${esc(
              g.label
            )}</a> <span style="color:#6b7280">&times;${g.count} &middot; from ${esc(
              fmtDate(g.earliestDue)
            )}</span></li>`
        )
        .join("")}</ul>`
    );
  }
  if (taskBody.length === 0) taskBody.push(`<p style="font-size:13px;color:#6b7280">No open tasks.</p>`);
  parts.push(taskBody.join(""));

  // ── Freshservice ──
  const { freshservice } = data;
  parts.push(
    sectionHeader(`Freshservice (${freshservice.waitingOnMe.length} waiting on you)`, "#7c3aed")
  );
  if (freshservice.waitingOnMe.length === 0) {
    parts.push(`<p style="font-size:13px;color:#6b7280">Nobody is waiting on you. ${freshservice.selfRaisedCount} self-raised tickets in your backlog.</p>`);
  } else {
    for (const t of freshservice.waitingOnMe) {
      const draft = data.drafts?.ticketReplies[String(t.id)];
      parts.push(
        `<div style="margin:10px 0;padding:10px 12px;background:#faf5ff;border:1px solid #e9d5ff;border-radius:8px">
          <div style="font-size:13px">${pill(t.priority)} <a href="${t.url}" style="color:#6d28d9;text-decoration:none;font-weight:600">#${t.id} ${esc(
          t.subject
        )}</a> <span style="color:#9ca3af">&middot; ${t.status} &middot; ${t.ageDays}d</span></div>
          ${
            draft
              ? `<div style="margin-top:6px;font-size:13px;color:#374151;background:#fff;border:1px dashed #c4b5fd;border-radius:6px;padding:8px"><span style="font-size:11px;color:#7c3aed;font-weight:700">DRAFT REPLY</span><br>${esc(
                  draft
                )}</div>`
              : ""
          }
        </div>`
      );
    }
    parts.push(
      `<p style="font-size:12px;color:#9ca3af;margin:4px 0">Plus ${freshservice.selfRaisedCount} self-raised tickets in your own backlog.</p>`
    );
  }

  // ── PE ──
  const { pe } = data;
  parts.push(sectionHeader(`PE action-required (${pe.actionRequiredDealCount} deals)`, "#059669"));
  if (pe.actionRequiredDealCount === 0) {
    parts.push(`<p style="font-size:13px;color:#6b7280">No PE docs in action-required state.</p>`);
  } else {
    parts.push(
      `<ul style="margin:0;padding-left:18px;font-size:13px">${pe.topDeals
        .map(
          (d) =>
            `<li style="margin:5px 0"><strong>${esc(d.dealName)}</strong> <span style="color:#6b7280">&middot; ${d.issueCount} doc${
              d.issueCount === 1 ? "" : "s"
            }: ${esc(d.docs.join(", "))}</span></li>`
        )
        .join("")}</ul>
       <p style="font-size:12px;color:#9ca3af;margin:6px 0">Full per-doc detail is in the PE Doc Digest email.</p>`
    );
  }

  // ── Email / meeting follow-ups ──
  const { email } = data;
  parts.push(sectionHeader("Email & meeting follow-ups", "#ea580c"));
  if (!email.connected) {
    parts.push(
      `<p style="font-size:13px;color:#6b7280">${esc(email.unavailableReason || "Not available.")}</p>`
    );
  } else if (email.items.length === 0) {
    parts.push(`<p style="font-size:13px;color:#6b7280">Nothing needing a reply.</p>`);
  } else {
    parts.push(
      `<ul style="margin:0;padding-left:18px;font-size:13px">${email.items
        .map(
          (e) =>
            `<li style="margin:5px 0">${
              e.isMeetingNote
                ? '<span style="font-size:11px;color:#ea580c;font-weight:700">MEETING</span> '
                : ""
            }${esc(e.subject)} <span style="color:#9ca3af">&middot; ${esc(e.from)} &middot; ${e.ageDays}d</span></li>`
        )
        .join("")}</ul>`
    );
  }

  // ── Errors (transparency) ──
  if (data.errors.length) {
    parts.push(
      `<p style="font-size:12px;color:#b91c1c;margin-top:20px">Some sources had issues this run: ${esc(
        data.errors.join("; ")
      )}</p>`
    );
  }

  return renderEmailWrapper(parts.join("\n"));
}
