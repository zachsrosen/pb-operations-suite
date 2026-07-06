import { render } from "@react-email/render";
import * as React from "react";
import { prisma } from "@/lib/db";
import { sendEmailMessage } from "@/lib/email";
import { expandSwapDates, isShortNotice, todayInTz } from "@/lib/on-call-swap";
import OnCallSwapNotification, { type OnCallSwapEvent } from "@/emails/OnCallSwapNotification";

// Email notifications for the on-call swap lifecycle. Callers wrap in
// try/catch — a failed email must never fail the underlying swap action.

function baseUrl(): string {
  return (
    (process.env.NEXT_PUBLIC_APP_URL || "").trim() ||
    (process.env.APP_URL || "").trim() ||
    "https://www.pbtechops.com"
  );
}

function formatDayLong(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** "Mon, Aug 10 – Sun, Aug 16" for weekly pools; a single day for daily. */
function formatShiftRange(rotationUnit: string, date: string): string {
  const dates = expandSwapDates(rotationUnit, date);
  const start = dates[0];
  const end = dates[dates.length - 1];
  return start === end ? formatDayLong(start) : `${formatDayLong(start)} – ${formatDayLong(end)}`;
}

/**
 * Who gets the "needs approval" email. ON_CALL_APPROVER_EMAILS (comma-sep)
 * wins when set; otherwise every user whose roles allow on-call approval
 * (mirrors APPROVER_ROLES in on-call-auth.ts).
 */
async function approverEmails(): Promise<string[]> {
  const fromEnv = (process.env.ON_CALL_APPROVER_EMAILS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromEnv.length > 0) return fromEnv;
  const users = await prisma.user.findMany({
    where: { roles: { hasSome: ["ADMIN", "EXECUTIVE", "OPERATIONS_MANAGER"] } },
    select: { email: true },
  });
  return users.map((u) => u.email).filter(Boolean);
}

export async function sendOnCallSwapNotification(swapId: string, event: OnCallSwapEvent): Promise<void> {
  const swap = await prisma.onCallSwapRequest.findUnique({
    where: { id: swapId },
    include: { requesterCrewMember: true, counterpartyCrewMember: true, pool: true },
  });
  if (!swap) return;

  const requesterName = swap.requesterCrewMember.name;
  const counterpartyName = swap.counterpartyCrewMember.name;
  const requesterRange = formatShiftRange(swap.pool.rotationUnit, swap.requesterDate);
  const counterpartyRange = formatShiftRange(swap.pool.rotationUnit, swap.counterpartyDate);
  const today = todayInTz(swap.pool.timezone);
  const shortNotice = isShortNotice(swap.requesterDate, today) || isShortNotice(swap.counterpartyDate, today);

  const mePage = `${baseUrl()}/dashboards/on-call/me`;
  const activityPage = `${baseUrl()}/dashboards/on-call/activity`;

  let to: string[];
  let subject: string;
  let actionUrl: string;
  let actionLabel: string;

  switch (event) {
    case "requested": {
      to = swap.counterpartyCrewMember.email ? [swap.counterpartyCrewMember.email] : [];
      subject = `On-call swap request from ${requesterName} — ${swap.pool.name}`;
      actionUrl = mePage;
      actionLabel = "Accept or decline on your on-call page";
      break;
    }
    case "accepted": {
      to = await approverEmails();
      subject = `${shortNotice ? "[Short notice] " : ""}On-call swap needs approval — ${requesterName} ↔ ${counterpartyName} (${swap.pool.name})`;
      actionUrl = activityPage;
      actionLabel = "Approve or deny on the Activity page";
      break;
    }
    case "approved": {
      to = [swap.requesterCrewMember.email, swap.counterpartyCrewMember.email].filter(
        (e): e is string => !!e,
      );
      subject = `On-call swap confirmed — ${requesterName} ↔ ${counterpartyName} (${swap.pool.name})`;
      actionUrl = mePage;
      actionLabel = "View your updated schedule";
      break;
    }
    case "denied": {
      to = [swap.requesterCrewMember.email, swap.counterpartyCrewMember.email].filter(
        (e): e is string => !!e,
      );
      subject = `On-call swap denied — ${requesterName} ↔ ${counterpartyName} (${swap.pool.name})`;
      actionUrl = mePage;
      actionLabel = "View your on-call page";
      break;
    }
  }

  if (to.length === 0) {
    console.warn(`[on-call] swap ${event} notification skipped — no recipient emails`, { swapId });
    return;
  }

  const props = {
    event,
    requesterName,
    counterpartyName,
    requesterRange,
    counterpartyRange,
    poolName: swap.pool.name,
    reason: swap.reason,
    denialReason: swap.denialReason,
    shortNotice,
    actionUrl,
    actionLabel,
  };

  const html = await render(React.createElement(OnCallSwapNotification, props));
  const text = [
    subject,
    "",
    `${requesterName}'s shift: ${requesterRange}`,
    `${counterpartyName}'s shift: ${counterpartyRange}`,
    `Pool: ${swap.pool.name}`,
    ...(swap.reason ? [`Reason: ${swap.reason}`] : []),
    ...(event === "denied" && swap.denialReason ? [`Denial reason: ${swap.denialReason}`] : []),
    ...(shortNotice && event !== "denied" ? ["Short notice: one of these shifts starts within 2 weeks."] : []),
    "",
    `${actionLabel}: ${actionUrl}`,
  ].join("\n");

  const result = await sendEmailMessage({
    to,
    subject,
    html,
    text,
    debugFallbackTitle: `On-call swap ${event}`,
    debugFallbackBody: text,
  });
  if (!result.success) {
    console.warn(`[on-call] swap ${event} notification send failed`, { swapId, error: result.error });
  }
}
