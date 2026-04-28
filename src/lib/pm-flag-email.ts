/**
 * PM Flag email helper.
 *
 * Renders the PmFlagAssigned template and dispatches via sendEmailMessage,
 * which already handles Google Workspace primary + Resend fallback.
 *
 * Kept in its own module so route handlers can `void import()` it lazily —
 * email render + send is heavy and we don't want to block create-flag responses.
 */

import { render } from "@react-email/render";
import * as React from "react";

import { sendEmailMessage } from "@/lib/email";
import { PmFlagAssigned } from "@/emails/PmFlagAssigned";
import type { PmFlagWithEvents } from "@/lib/pm-flags";
import { getHubSpotDealUrl } from "@/lib/external-links";

export interface SendFlagAssignedOptions {
  /** Override the deep-link host. Defaults to `NEXT_PUBLIC_APP_URL` or pbtechops.com. */
  appUrl?: string;
}

export async function sendFlagAssignedEmail(
  flag: PmFlagWithEvents,
  options: SendFlagAssignedOptions = {}
): Promise<{ sent: boolean; reason?: string }> {
  const recipient = flag.assignedToUser?.email;
  if (!recipient) {
    return { sent: false, reason: "no assignee email" };
  }

  const baseUrl =
    options.appUrl
    ?? process.env.NEXT_PUBLIC_APP_URL
    ?? process.env.AUTH_URL
    ?? "https://pbtechops.com";

  const flagUrl = `${baseUrl.replace(/\/$/, "")}/dashboards/pm-action-queue?flag=${encodeURIComponent(flag.id)}`;
  const hubSpotDealUrl = getHubSpotDealUrl(flag.hubspotDealId) ?? undefined;

  const props = {
    assigneeName: flag.assignedToUser?.name ?? recipient,
    dealName: flag.dealName ?? `Deal ${flag.hubspotDealId}`,
    hubspotDealId: flag.hubspotDealId,
    type: flag.type,
    severity: flag.severity,
    reason: flag.reason,
    raisedByName: flag.raisedByUser?.name ?? null,
    flagUrl,
    hubSpotDealUrl,
  };

  const html = await render(React.createElement(PmFlagAssigned, props));
  const text = [
    `[${flag.severity}] PM flag on ${props.dealName}`,
    `Type: ${flag.type}`,
    "",
    flag.reason,
    "",
    `View: ${flagUrl}`,
    hubSpotDealUrl ? `HubSpot deal: ${hubSpotDealUrl}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const subject = `[${flag.severity}] PM flag on ${props.dealName}: ${humanizeType(flag.type)}`;

  const result = await sendEmailMessage({
    to: recipient,
    subject,
    html,
    text,
    debugFallbackTitle: `PM Flag Assigned: ${props.dealName}`,
    debugFallbackBody: text,
  });
  return { sent: result.success, reason: result.error };
}

function humanizeType(type: string): string {
  return type.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}
