const DEFAULT_HUBSPOT_PORTAL_ID = "21710069";
const DEFAULT_ZUPER_BASE_URL = "https://us-west-1c.zuperpro.com";
const GOOGLE_CALENDAR_EVENT_BASE_URL = "https://calendar.google.com/calendar/event";

export function getHubSpotDealUrl(dealId: string): string {
  const portalId = (process.env.HUBSPOT_PORTAL_ID || DEFAULT_HUBSPOT_PORTAL_ID).trim();
  return `https://app.hubspot.com/contacts/${portalId}/record/0-3/${dealId}`;
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

  const apiBase = (process.env.ZUPER_API_URL || "").trim();
  if (apiBase) {
    return normalizeWebBaseUrl(apiBase);
  }

  return DEFAULT_ZUPER_BASE_URL;
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
