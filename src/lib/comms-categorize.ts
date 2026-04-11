/**
 * Message categorization for the Comms dashboard.
 *
 * HubSpot messages are Gmail emails from HubSpot notification addresses,
 * categorized by sender domain and subject/snippet pattern matching.
 */

import type { CommsMessage } from "./comms-gmail";

export type CommsCategory =
  | "stage_change"
  | "mention"
  | "task"
  | "comment"
  | "general";

export interface CategorizedMessage extends CommsMessage {
  category: CommsCategory;
}

const HUBSPOT_DOMAINS = [
  "hubspot.com",
  "hs-inbox.com",
  "hubspot.net",
  "inbound.hubspot.com",
];

function isHubSpotEmail(fromEmail: string): boolean {
  const domain = fromEmail.split("@")[1]?.toLowerCase() || "";
  return HUBSPOT_DOMAINS.some(
    (d) => domain === d || domain.endsWith(`.${d}`)
  );
}

function detectCategory(subject: string, snippet: string): CommsCategory {
  const text = `${subject} ${snippet}`.toLowerCase();
  if (/deal (moved|stage|changed|updated)/i.test(text)) return "stage_change";
  if (/@\w/.test(snippet)) return "mention";
  if (/task (assigned|created|due|completed)/i.test(text)) return "task";
  if (/comment|replied|noted/i.test(text)) return "comment";
  return "general";
}

function extractDealId(
  snippet: string,
  portalId: string
): string | undefined {
  // Match HubSpot deal URLs: app.hubspot.com/contacts/{portalId}/deal/{dealId}
  const pattern = new RegExp(
    `app\\.hubspot\\.com/contacts/${portalId}/deal/(\\d+)`
  );
  const match = snippet.match(pattern);
  return match?.[1];
}

export function categorizeMessage(
  msg: CommsMessage,
  hubspotPortalId: string
): CategorizedMessage {
  if (!isHubSpotEmail(msg.fromEmail)) {
    return { ...msg, category: "general" };
  }

  const category = detectCategory(msg.subject, msg.snippet);
  const dealId = extractDealId(msg.snippet, hubspotPortalId);

  return {
    ...msg,
    source: "hubspot",
    category,
    ...(dealId
      ? {
          hubspotDealId: dealId,
          hubspotDealUrl: `https://app.hubspot.com/contacts/${hubspotPortalId}/deal/${dealId}`,
        }
      : {}),
  };
}

/** Categorize a batch of messages. */
export function categorizeMessages(
  messages: CommsMessage[],
  hubspotPortalId: string
): CategorizedMessage[] {
  return messages.map((m) => categorizeMessage(m, hubspotPortalId));
}
