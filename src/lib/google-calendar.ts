import crypto from "crypto";

type ServiceAccountTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

function isEnabled(): boolean {
  const raw = (process.env.GOOGLE_CALENDAR_SYNC_ENABLED || "false").toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function getTargetCalendarId(): string {
  const configured = (process.env.GOOGLE_SITE_SURVEY_CALENDAR_ID || "").trim();
  return configured || "primary";
}

function getCredentials() {
  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!serviceAccountEmail || !serviceAccountKey) return null;

  let privateKey: string;
  try {
    privateKey = Buffer.from(serviceAccountKey, "base64").toString("utf-8");
  } catch {
    privateKey = serviceAccountKey.replace(/\\n/g, "\n");
  }
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
}): Promise<{ success: boolean; error?: string }> {
  if (!isEnabled()) return { success: true };

  const creds = getCredentials();
  if (!creds) {
    return { success: false, error: "Google Calendar not configured" };
  }

  const token = await getServiceAccountToken(
    creds.serviceAccountEmail,
    creds.privateKey,
    params.surveyorEmail,
    ["https://www.googleapis.com/auth/calendar.events"]
  );

  if (!token.access_token) {
    return { success: false, error: token.error_description || token.error || "Failed to get Google token" };
  }

  const timezone = params.timezone || "America/Denver";
  const startTime = params.startTime || "08:00";
  const endTime = params.endTime || "09:00";
  const eventId = getSurveyCalendarEventId(params.projectId);
  const calendarId = getTargetCalendarId();

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

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
    {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    return { success: false, error: `Google Calendar upsert failed: ${response.status} ${errorText}` };
  }

  return { success: true };
}
