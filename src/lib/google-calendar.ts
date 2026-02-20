import crypto from "crypto";

type ServiceAccountTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

type GoogleCalendarEvent = {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: {
    dateTime?: string;
    date?: string;
  };
  end?: {
    dateTime?: string;
    date?: string;
  };
};

type GoogleCalendarListResponse = {
  items?: GoogleCalendarEvent[];
  nextPageToken?: string;
  error?: {
    message?: string;
  };
};

type LocationBucket = "dtc" | "westy" | "cosp";

function isEnabled(): boolean {
  const raw = (process.env.GOOGLE_CALENDAR_SYNC_ENABLED || "false").toLowerCase().trim();
  return raw === "1" || raw === "true" || raw === "yes";
}

function getDefaultSurveyCalendarId(): string {
  const configured = (process.env.GOOGLE_SITE_SURVEY_CALENDAR_ID || "").trim();
  return configured || "primary";
}

function parseServiceAccountPrivateKey(serviceAccountKey: string): string | null {
  const normalizedRaw = serviceAccountKey.replace(/\\n/g, "\n").trim();
  if (normalizedRaw.includes("-----BEGIN")) {
    return normalizedRaw;
  }

  const decoded = Buffer.from(serviceAccountKey, "base64").toString("utf-8");
  const normalizedDecoded = decoded.replace(/\\n/g, "\n").trim();
  if (normalizedDecoded.includes("-----BEGIN")) {
    return normalizedDecoded;
  }

  return null;
}

function parseEmailAddress(input?: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  const bracketMatch = trimmed.match(/<([^>]+)>/);
  const candidate = (bracketMatch?.[1] || trimmed).trim();
  const basicEmailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return basicEmailRegex.test(candidate) ? candidate : null;
}

function getFallbackImpersonationEmail(): string | null {
  return parseEmailAddress(process.env.GOOGLE_EMAIL_SENDER) || parseEmailAddress(process.env.GOOGLE_ADMIN_EMAIL);
}

export function getSharedCalendarImpersonationEmail(): string | null {
  return (
    parseEmailAddress(process.env.GOOGLE_CALENDAR_IMPERSONATION_EMAIL) ||
    getFallbackImpersonationEmail()
  );
}

export function normalizeLocationForInstallCalendars(location?: string | null): LocationBucket | null {
  const normalized = (location || "").trim().toLowerCase();
  if (!normalized) return null;

  if (
    normalized === "dtc" ||
    normalized === "centennial" ||
    normalized.includes("denver tech")
  ) {
    return "dtc";
  }
  if (normalized === "westminster" || normalized === "westy") {
    return "westy";
  }
  if (
    normalized === "colorado springs" ||
    normalized === "cosp" ||
    normalized === "pueblo"
  ) {
    return "cosp";
  }

  return null;
}

export function getDenverSiteSurveyCalendarId(): string | null {
  return (
    (process.env.GOOGLE_DENVER_SITE_SURVEY_CALENDAR_ID || "").trim() ||
    (process.env.GOOGLE_SITE_SURVEY_SHARED_CALENDAR_ID || "").trim() ||
    null
  );
}

export function getInstallCalendarIdForLocation(location?: string | null): string | null {
  const bucket = normalizeLocationForInstallCalendars(location);
  if (bucket === "dtc") {
    return (process.env.GOOGLE_INSTALL_CALENDAR_DTC_ID || "").trim() || null;
  }
  if (bucket === "westy") {
    return (process.env.GOOGLE_INSTALL_CALENDAR_WESTY_ID || "").trim() || null;
  }
  if (bucket === "cosp") {
    return (
      (process.env.GOOGLE_INSTALL_CALENDAR_COSP_ID || "").trim() ||
      (process.env.GOOGLE_INSTALL_CALENDAR_PUEBLO_ID || "").trim() ||
      null
    );
  }
  return null;
}

function getCredentials() {
  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!serviceAccountEmail || !serviceAccountKey) return null;

  const privateKey = parseServiceAccountPrivateKey(serviceAccountKey);
  if (!privateKey) return null;
  return { serviceAccountEmail, privateKey };
}

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

async function signRS256(data: string, privateKey: string): Promise<string> {
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(data);
  sign.end();
  const signature = sign.sign(privateKey, "base64");
  return signature.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function normalizeForMatch(value?: string | null): string {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isManagedEventId(eventId?: string | null): boolean {
  return (eventId || "").trim().toLowerCase().startsWith("pb");
}

function getAddressAnchor(address?: string | null): string {
  const firstSegment = (address || "").split(",")[0] || "";
  return normalizeForMatch(firstSegment);
}

function parseMinutes(value?: string | null): number | null {
  const raw = (value || "").trim();
  const match = raw.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function extractEventTime(value?: string | null): string | null {
  const raw = (value || "").trim();
  const match = raw.match(/T(\d{2}:\d{2})/);
  return match?.[1] || null;
}

function isTimeCompatibleWithTarget(
  event: GoogleCalendarEvent,
  targetStartTime?: string,
  targetEndTime?: string
): boolean {
  if (!targetStartTime && !targetEndTime) return true;

  const eventStartMinutes = parseMinutes(extractEventTime(event.start?.dateTime));
  const eventEndMinutes = parseMinutes(extractEventTime(event.end?.dateTime));
  const targetStartMinutes = parseMinutes(targetStartTime);
  const targetEndMinutes = parseMinutes(targetEndTime);

  // If event has no parseable times (all-day or malformed), keep the duplicate
  // check permissive instead of hard-failing.
  if (eventStartMinutes === null && eventEndMinutes === null) {
    return true;
  }

  const toleranceMinutes = 120;
  if (
    eventStartMinutes !== null &&
    targetStartMinutes !== null &&
    Math.abs(eventStartMinutes - targetStartMinutes) > toleranceMinutes
  ) {
    return false;
  }
  if (
    eventEndMinutes !== null &&
    targetEndMinutes !== null &&
    Math.abs(eventEndMinutes - targetEndMinutes) > toleranceMinutes
  ) {
    return false;
  }

  return true;
}

function isLikelyLegacyDuplicateEvent(
  event: GoogleCalendarEvent,
  params: {
    eventId: string;
    projectId: string;
    projectName: string;
    customerName: string;
    customerAddress: string;
    startTime?: string;
    endTime?: string;
  }
): boolean {
  if ((event.status || "").toLowerCase() === "cancelled") return false;
  if (isManagedEventId(event.id)) return false;
  if ((event.id || "").trim() === params.eventId) return false;

  const haystack = normalizeForMatch(
    `${event.summary || ""}\n${event.description || ""}\n${event.location || ""}`
  );
  if (!haystack) return false;

  const projectId = normalizeForMatch(params.projectId);
  const projectName = normalizeForMatch(params.projectName);
  const customerName = normalizeForMatch(params.customerName);
  const addressAnchor = getAddressAnchor(params.customerAddress);

  if (projectId.length >= 4 && haystack.includes(projectId)) {
    return isTimeCompatibleWithTarget(event, params.startTime, params.endTime);
  }

  const addressMatch = !addressAnchor || haystack.includes(addressAnchor);
  const customerMatch = customerName.length >= 6 && haystack.includes(customerName);
  const projectMatch = projectName.length >= 6 && haystack.includes(projectName);

  if ((customerMatch || projectMatch) && addressMatch) {
    return isTimeCompatibleWithTarget(event, params.startTime, params.endTime);
  }

  return false;
}

async function listCalendarEventsForDateWindow(params: {
  accessToken: string;
  calendarId: string;
  startDate: string;
  endDate: string;
}): Promise<{ events: GoogleCalendarEvent[]; error?: string }> {
  const events: GoogleCalendarEvent[] = [];
  const calendarEventsBase = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(params.calendarId)}/events`;

  let pageToken: string | null = null;
  for (let page = 0; page < 5; page++) {
    const url = new URL(calendarEventsBase);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("showDeleted", "false");
    url.searchParams.set("timeMin", `${params.startDate}T00:00:00Z`);
    url.searchParams.set("timeMax", `${params.endDate}T23:59:59Z`);
    url.searchParams.set("maxResults", "250");
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
      },
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      return {
        events,
        error: `Google Calendar list failed: ${response.status} ${errorText}`.trim(),
      };
    }

    const payload = (await response.json()) as GoogleCalendarListResponse;
    if (Array.isArray(payload.items)) {
      events.push(...payload.items);
    }
    pageToken = payload.nextPageToken || null;
    if (!pageToken) break;
  }

  return { events };
}

async function deleteCalendarEventIfPresent(params: {
  accessToken: string;
  calendarId: string;
  eventId: string;
}): Promise<{ deleted: boolean; error?: string }> {
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(params.calendarId)}/events/${params.eventId}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
      },
    }
  );

  if (response.status === 404) return { deleted: false };
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    return {
      deleted: false,
      error: `Google Calendar delete failed: ${response.status} ${errorText}`.trim(),
    };
  }
  return { deleted: true };
}

async function shouldSkipManagedUpsertForLegacyEvent(params: {
  accessToken: string;
  calendarId: string;
  eventId: string;
  projectId: string;
  projectName: string;
  customerName: string;
  customerAddress: string;
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
}): Promise<{ skip: boolean }> {
  const listResult = await listCalendarEventsForDateWindow({
    accessToken: params.accessToken,
    calendarId: params.calendarId,
    startDate: params.startDate,
    endDate: params.endDate,
  });

  if (listResult.error) {
    console.warn(
      `[Google Calendar] Legacy duplicate guard lookup failed for calendar ${params.calendarId}: ${listResult.error}`
    );
    return { skip: false };
  }

  const legacyEvent = listResult.events.find((event) =>
    isLikelyLegacyDuplicateEvent(event, {
      eventId: params.eventId,
      projectId: params.projectId,
      projectName: params.projectName,
      customerName: params.customerName,
      customerAddress: params.customerAddress,
      startTime: params.startTime,
      endTime: params.endTime,
    })
  );

  if (!legacyEvent) {
    return { skip: false };
  }

  const deleteResult = await deleteCalendarEventIfPresent({
    accessToken: params.accessToken,
    calendarId: params.calendarId,
    eventId: params.eventId,
  });
  if (deleteResult.error) {
    console.warn(
      `[Google Calendar] Failed to remove stale managed event ${params.eventId} while preserving legacy event ${legacyEvent.id || "unknown"}: ${deleteResult.error}`
    );
  }

  console.log(
    `[Google Calendar] Skipping managed upsert for project ${params.projectId}; legacy event ${legacyEvent.id || "unknown"} already exists in shared calendar`
  );
  return { skip: true };
}

async function getServiceAccountToken(
  serviceAccountEmail: string,
  privateKey: string,
  impersonateEmail: string,
  scopes: string[]
): Promise<ServiceAccountTokenResponse> {
  const now = Math.floor(Date.now() / 1000);
  const expiry = now + 3600;

  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: serviceAccountEmail,
    sub: impersonateEmail,
    scope: scopes.join(" "),
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: expiry,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedClaims = base64UrlEncode(JSON.stringify(claims));
  const signatureInput = `${encodedHeader}.${encodedClaims}`;
  const signature = await signRS256(signatureInput, privateKey);
  const jwt = `${signatureInput}.${signature}`;

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  return tokenResponse.json();
}

export function getSurveyCalendarEventId(projectId: string): string {
  // Google event id should be stable and lowercase.
  const hash = crypto.createHash("sha1").update(`survey:${projectId}`).digest("hex").slice(0, 30);
  return `pb${hash}`;
}

export async function upsertSiteSurveyCalendarEvent(params: {
  surveyorEmail: string;
  projectId: string;
  projectName: string;
  customerName: string;
  customerAddress: string;
  date: string;
  startTime?: string;
  endTime?: string;
  timezone?: string;
  notes?: string;
  calendarId?: string;
  impersonateEmail?: string;
}): Promise<{ success: boolean; error?: string }> {
  if (!isEnabled()) return { success: true };

  const creds = getCredentials();
  if (!creds) {
    return { success: false, error: "Google Calendar not configured (missing or invalid service account credentials)" };
  }

  const impersonateEmail =
    params.impersonateEmail || params.surveyorEmail || getFallbackImpersonationEmail();
  if (!impersonateEmail) {
    return { success: false, error: "Google Calendar sync failed: no impersonation email available" };
  }

  const token = await getServiceAccountToken(
    creds.serviceAccountEmail,
    creds.privateKey,
    impersonateEmail,
    ["https://www.googleapis.com/auth/calendar.events"]
  );

  if (!token.access_token) {
    return { success: false, error: token.error_description || token.error || "Failed to get Google token" };
  }

  const timezone = params.timezone || "America/Denver";
  const startTime = params.startTime || "08:00";
  const endTime = params.endTime || "09:00";
  const eventId = getSurveyCalendarEventId(params.projectId);
  const calendarId = (params.calendarId || "").trim() || getDefaultSurveyCalendarId();
  const isSharedMirrorWrite = (params.calendarId || "").trim().length > 0;

  if (isSharedMirrorWrite) {
    const legacyGuard = await shouldSkipManagedUpsertForLegacyEvent({
      accessToken: token.access_token,
      calendarId,
      eventId,
      projectId: params.projectId,
      projectName: params.projectName,
      customerName: params.customerName,
      customerAddress: params.customerAddress,
      startDate: params.date,
      endDate: params.date,
      startTime,
      endTime,
    });
    if (legacyGuard.skip) {
      return { success: true };
    }
  }

  const body = {
    summary: `Site Survey - ${params.customerName}`,
    location: params.customerAddress,
    description: [
      `Project: ${params.projectName}`,
      `Deal ID: ${params.projectId}`,
      params.notes ? `Notes: ${params.notes}` : "",
    ].filter(Boolean).join("\n"),
    start: {
      dateTime: `${params.date}T${startTime}:00`,
      timeZone: timezone,
    },
    end: {
      dateTime: `${params.date}T${endTime}:00`,
      timeZone: timezone,
    },
  };

  const calendarEventsBase = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;

  // Google Calendar PUT updates an existing event and returns 404 if it does not
  // exist. For true upsert behavior: create first, then update on duplicate.
  const insertResponse = await fetch(calendarEventsBase, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: eventId,
      ...body,
    }),
  });

  if (insertResponse.ok) {
    return { success: true };
  }

  if (insertResponse.status !== 409) {
    const errorText = await insertResponse.text().catch(() => "");
    return { success: false, error: `Google Calendar insert failed: ${insertResponse.status} ${errorText}` };
  }

  const updateResponse = await fetch(`${calendarEventsBase}/${eventId}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: eventId,
      ...body,
    }),
  });

  if (!updateResponse.ok) {
    const errorText = await updateResponse.text().catch(() => "");
    return { success: false, error: `Google Calendar update failed: ${updateResponse.status} ${errorText}` };
  }

  return { success: true };
}

export async function deleteSiteSurveyCalendarEvent(params: {
  projectId: string;
  surveyorEmail?: string;
  calendarId?: string;
  impersonateEmail?: string;
}): Promise<{ success: boolean; error?: string }> {
  if (!isEnabled()) return { success: true };

  const creds = getCredentials();
  if (!creds) {
    return { success: false, error: "Google Calendar not configured (missing or invalid service account credentials)" };
  }

  const impersonateEmail =
    params.impersonateEmail ||
    params.surveyorEmail ||
    getFallbackImpersonationEmail();
  if (!impersonateEmail) {
    return { success: false, error: "Google Calendar delete failed: no impersonation email available" };
  }

  const token = await getServiceAccountToken(
    creds.serviceAccountEmail,
    creds.privateKey,
    impersonateEmail,
    ["https://www.googleapis.com/auth/calendar.events"]
  );

  if (!token.access_token) {
    return { success: false, error: token.error_description || token.error || "Failed to get Google token" };
  }

  const eventId = getSurveyCalendarEventId(params.projectId);
  const calendarId = (params.calendarId || "").trim() || getDefaultSurveyCalendarId();
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token.access_token}`,
      },
    }
  );

  if (response.status === 404) {
    return { success: true };
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    return { success: false, error: `Google Calendar delete failed: ${response.status} ${errorText}` };
  }

  return { success: true };
}

export function getInstallationCalendarEventId(projectId: string): string {
  const hash = crypto.createHash("sha1").update(`install:${projectId}`).digest("hex").slice(0, 30);
  return `pb${hash}`;
}

export async function upsertInstallationCalendarEvent(params: {
  projectId: string;
  projectName: string;
  customerName: string;
  customerAddress: string;
  startDate: string;
  startTime?: string;
  endDate: string;
  endTime?: string;
  timezone?: string;
  notes?: string;
  calendarId: string;
  impersonateEmail?: string;
}): Promise<{ success: boolean; error?: string }> {
  if (!isEnabled()) return { success: true };

  const creds = getCredentials();
  if (!creds) {
    return { success: false, error: "Google Calendar not configured (missing or invalid service account credentials)" };
  }

  const impersonateEmail = params.impersonateEmail || getSharedCalendarImpersonationEmail();
  if (!impersonateEmail) {
    return { success: false, error: "Google Calendar sync failed: no impersonation email available" };
  }

  const token = await getServiceAccountToken(
    creds.serviceAccountEmail,
    creds.privateKey,
    impersonateEmail,
    ["https://www.googleapis.com/auth/calendar.events"]
  );

  if (!token.access_token) {
    return { success: false, error: token.error_description || token.error || "Failed to get Google token" };
  }

  const timezone = params.timezone || "America/Denver";
  const startTime = params.startTime || "08:00";
  const endTime = params.endTime || "16:00";
  const eventId = getInstallationCalendarEventId(params.projectId);
  const calendarId = (params.calendarId || "").trim();
  if (!calendarId) {
    return { success: false, error: "Google Calendar sync failed: installation calendar ID is missing" };
  }

  const legacyGuard = await shouldSkipManagedUpsertForLegacyEvent({
    accessToken: token.access_token,
    calendarId,
    eventId,
    projectId: params.projectId,
    projectName: params.projectName,
    customerName: params.customerName,
    customerAddress: params.customerAddress,
    startDate: params.startDate,
    endDate: params.endDate,
    startTime,
    endTime,
  });
  if (legacyGuard.skip) {
    return { success: true };
  }

  const body = {
    summary: `Installation - ${params.customerName}`,
    location: params.customerAddress,
    description: [
      `Project: ${params.projectName}`,
      `Deal ID: ${params.projectId}`,
      params.notes ? `Notes: ${params.notes}` : "",
    ].filter(Boolean).join("\n"),
    start: {
      dateTime: `${params.startDate}T${startTime}:00`,
      timeZone: timezone,
    },
    end: {
      dateTime: `${params.endDate}T${endTime}:00`,
      timeZone: timezone,
    },
  };

  const calendarEventsBase = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const insertResponse = await fetch(calendarEventsBase, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: eventId,
      ...body,
    }),
  });

  if (insertResponse.ok) {
    return { success: true };
  }

  if (insertResponse.status !== 409) {
    const errorText = await insertResponse.text().catch(() => "");
    return { success: false, error: `Google Calendar insert failed: ${insertResponse.status} ${errorText}` };
  }

  const updateResponse = await fetch(`${calendarEventsBase}/${eventId}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: eventId,
      ...body,
    }),
  });

  if (!updateResponse.ok) {
    const errorText = await updateResponse.text().catch(() => "");
    return { success: false, error: `Google Calendar update failed: ${updateResponse.status} ${errorText}` };
  }

  return { success: true };
}

export async function deleteInstallationCalendarEvent(params: {
  projectId: string;
  calendarId: string;
  impersonateEmail?: string;
}): Promise<{ success: boolean; error?: string }> {
  if (!isEnabled()) return { success: true };

  const creds = getCredentials();
  if (!creds) {
    return { success: false, error: "Google Calendar not configured (missing or invalid service account credentials)" };
  }

  const impersonateEmail = params.impersonateEmail || getSharedCalendarImpersonationEmail();
  if (!impersonateEmail) {
    return { success: false, error: "Google Calendar delete failed: no impersonation email available" };
  }

  const token = await getServiceAccountToken(
    creds.serviceAccountEmail,
    creds.privateKey,
    impersonateEmail,
    ["https://www.googleapis.com/auth/calendar.events"]
  );

  if (!token.access_token) {
    return { success: false, error: token.error_description || token.error || "Failed to get Google token" };
  }

  const calendarId = (params.calendarId || "").trim();
  if (!calendarId) {
    return { success: false, error: "Google Calendar delete failed: installation calendar ID is missing" };
  }

  const eventId = getInstallationCalendarEventId(params.projectId);
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token.access_token}`,
      },
    }
  );

  if (response.status === 404) {
    return { success: true };
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    return { success: false, error: `Google Calendar delete failed: ${response.status} ${errorText}` };
  }

  return { success: true };
}
