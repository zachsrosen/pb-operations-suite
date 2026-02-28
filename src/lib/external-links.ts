const DEFAULT_HUBSPOT_PORTAL_ID = "21710069";
const DEFAULT_ZUPER_BASE_URL = "https://web.zuperpro.com";
const GOOGLE_CALENDAR_EVENT_BASE_URL = "https://calendar.google.com/calendar/event";
const DEFAULT_ZOHO_ITEM_BASE_URL = "https://inventory.zoho.com/app#/items";
const DEFAULT_OPENSOLAR_BASE_URL = "https://app.opensolar.com";
const DEFAULT_QUICKBOOKS_BASE_URL = "https://app.qbo.intuit.com";

export function getHubSpotDealUrl(dealId: string): string {
  const portalId = (process.env.HUBSPOT_PORTAL_ID || DEFAULT_HUBSPOT_PORTAL_ID).trim();
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

export function getHubSpotProductUrl(productId: string): string {
  const portalId = (process.env.HUBSPOT_PORTAL_ID || DEFAULT_HUBSPOT_PORTAL_ID).trim();
  return `https://app.hubspot.com/contacts/${portalId}/record/0-7/${encodeURIComponent(productId)}`;
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
  const explicitWebBase = (process.env.ZUPER_WEB_URL || "").trim();
  if (explicitWebBase) {
    return normalizeWebBaseUrl(explicitWebBase);
  }

  return DEFAULT_ZUPER_BASE_URL;
}

export function getZuperProductUrl(productId: string): string {
  const template = (process.env.ZUPER_PRODUCT_URL_TEMPLATE || "").trim();
  if (template) {
    return applyUrlTemplate(template, { id: productId });
  }
  return `${getZuperWebBaseUrl()}/app/product/${encodeURIComponent(productId)}`;
}

export function getZohoItemUrl(itemId: string): string {
  const template = (process.env.ZOHO_INVENTORY_ITEM_URL_TEMPLATE || "").trim();
  if (template) {
    return applyUrlTemplate(template, { id: itemId });
  }
  const baseUrl = process.env.ZOHO_INVENTORY_WEB_URL || DEFAULT_ZOHO_ITEM_BASE_URL;
  return `${baseUrl.replace(/\/$/, "")}/${encodeURIComponent(itemId)}`;
}

export function getOpenSolarProductUrl(productId: string): string {
  const template = (process.env.OPENSOLAR_PRODUCT_URL_TEMPLATE || "").trim();
  if (template) {
    return applyUrlTemplate(template, { id: productId });
  }
  const baseUrl = process.env.OPENSOLAR_WEB_URL || DEFAULT_OPENSOLAR_BASE_URL;
  return `${baseUrl.replace(/\/$/, "")}/app/products/${encodeURIComponent(productId)}`;
}

export function getQuickBooksItemUrl(itemId: string): string | null {
  const companyId = String(process.env.QUICKBOOKS_COMPANY_ID || "").trim();
  if (!companyId) return null;

  const template = (process.env.QUICKBOOKS_ITEM_URL_TEMPLATE || "").trim();
  if (template) {
    return applyUrlTemplate(template, { id: itemId, companyId });
  }

  const baseUrl = process.env.QUICKBOOKS_WEB_URL || DEFAULT_QUICKBOOKS_BASE_URL;
  return `${baseUrl.replace(/\/$/, "")}/app/items?itemId=${encodeURIComponent(itemId)}&companyId=${encodeURIComponent(companyId)}`;
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
