const DEFAULT_HUBSPOT_PORTAL_ID = "21710069";
const DEFAULT_ZUPER_BASE_URL = "https://web.zuperpro.com";
const GOOGLE_CALENDAR_EVENT_BASE_URL = "https://calendar.google.com/calendar/event";
const DEFAULT_ZOHO_DOMAIN = "https://inventory.zoho.com";

/**
 * Static map of client-visible env vars.
 *
 * Next.js only inlines NEXT_PUBLIC_* vars when the full literal string
 * (e.g. `process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID`) appears in source.
 * Computed access like `process.env[\`NEXT_PUBLIC_${name}\`]` compiles to
 * `undefined` in client bundles.  These explicit references ensure the
 * values are inlined at build time.
 */
const CLIENT_ENV: Record<string, string | undefined> = {
  HUBSPOT_PORTAL_ID: process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID,
  ZUPER_WEB_URL: process.env.NEXT_PUBLIC_ZUPER_WEB_URL,
  ZOHO_INVENTORY_ORG_ID: process.env.NEXT_PUBLIC_ZOHO_INVENTORY_ORG_ID,
};

/**
 * Read an env var that works in both client and server contexts.
 * Checks the static CLIENT_ENV map first (build-time inlined for client
 * bundles), then falls back to dynamic process.env lookups which only
 * resolve on the server.
 */
function env(name: string): string {
  return (
    CLIENT_ENV[name] ??
    process.env[`NEXT_PUBLIC_${name}`] ??
    process.env[name] ??
    ""
  ).trim();
}

export function getHubSpotDealUrl(dealId: string): string {
  const portalId = env("HUBSPOT_PORTAL_ID") || DEFAULT_HUBSPOT_PORTAL_ID;
  return `https://app.hubspot.com/contacts/${portalId}/record/0-3/${dealId}`;
}

function applyUrlTemplate(
  template: string,
  replacements: Record<string, string>
): string {
  let rendered = template;
  for (const [key, value] of Object.entries(replacements)) {
    rendered = rendered.replace(new RegExp(`\\{${key}\\}`, "g"), encodeURIComponent(value));
  }
  return rendered;
}

/**
 * HubSpot products no longer have standalone record pages (the old
 * `/record/0-7/{id}` URL now 404s). The product library list at
 * `/objects/0-7/views/all/list` is the only working route — clicking a
 * product name there opens a sidebar preview.
 */
export function getHubSpotProductUrl(productId: string): string {
  const portalId = env("HUBSPOT_PORTAL_ID") || DEFAULT_HUBSPOT_PORTAL_ID;
  return `https://app.hubspot.com/contacts/${portalId}/objects/0-7/views/all/list`;
}

function normalizeWebBaseUrl(baseUrl: string): string {
  const raw = baseUrl.trim();
  if (!raw) return DEFAULT_ZUPER_BASE_URL;

  try {
    const parsed = new URL(raw);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return raw
      .replace(/\/api(\/.*)?$/i, "")
      .replace(/\/+$/, "");
  }
}

export function getZuperWebBaseUrl(): string {
  const explicitWebBase = env("ZUPER_WEB_URL");
  if (explicitWebBase) {
    return normalizeWebBaseUrl(explicitWebBase);
  }

  return DEFAULT_ZUPER_BASE_URL;
}

export function getZuperProductUrl(productId: string): string {
  const template = env("ZUPER_PRODUCT_URL_TEMPLATE");
  if (template) {
    return applyUrlTemplate(template, { id: productId });
  }
  return `${getZuperWebBaseUrl()}/products/${encodeURIComponent(productId)}/details`;
}

/**
 * Build the Zoho Inventory web-app base (without hash module path):
 *   https://inventory.zoho.com/app/{orgId}
 *
 * Zoho Inventory hash routes vary by module:
 *   Items:           #/inventory/items/{id}
 *   Sales Orders:    #/salesorders/{id}
 *   Purchase Orders: #/purchaseorders/{id}
 */
function getZohoAppBase(): string {
  const orgId = env("ZOHO_INVENTORY_ORG_ID");
  const domain = DEFAULT_ZOHO_DOMAIN;
  return orgId ? `${domain}/app/${orgId}` : `${domain}/app`;
}

export function getZohoSalesOrderUrl(salesorderId: string): string {
  return `${getZohoAppBase()}#/salesorders/${encodeURIComponent(salesorderId)}`;
}

export function getZohoPurchaseOrderUrl(purchaseOrderId: string): string {
  return `${getZohoAppBase()}#/purchaseorders/${encodeURIComponent(purchaseOrderId)}`;
}

export function getZohoItemUrl(itemId: string): string {
  const template = env("ZOHO_INVENTORY_ITEM_URL_TEMPLATE");
  if (template) {
    return applyUrlTemplate(template, { id: itemId });
  }
  return `${getZohoAppBase()}#/inventory/items/${encodeURIComponent(itemId)}`;
}

export function getZuperJobUrl(jobUid?: string | null): string | null {
  const normalizedJobUid = (jobUid || "").trim();
  if (!normalizedJobUid) return null;

  return `${getZuperWebBaseUrl()}/jobs/${encodeURIComponent(normalizedJobUid)}/details`;
}

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function getGoogleCalendarEventUrl(eventId?: string | null, calendarId?: string | null): string | null {
  const normalizedEventId = (eventId || "").trim();
  const normalizedCalendarId = (calendarId || "").trim();
  if (!normalizedEventId || !normalizedCalendarId) return null;

  const eid = toBase64Url(`${normalizedEventId} ${normalizedCalendarId}`);
  return `${GOOGLE_CALENDAR_EVENT_BASE_URL}?eid=${encodeURIComponent(eid)}`;
}
