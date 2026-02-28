import crypto from "crypto";
import { render } from "@react-email/render";
import { Resend } from "resend";
import type { UpdateEntry } from "@/lib/product-updates";
import { VerificationCode } from "@/emails/VerificationCode";
import { SchedulingNotification } from "@/emails/SchedulingNotification";
import { AvailabilityConflict } from "@/emails/AvailabilityConflict";
import { ProductUpdate } from "@/emails/ProductUpdate";
import { BugReport } from "@/emails/BugReport";
import { ExecutiveLevelNotification } from "@/emails/ExecutiveLevelNotification";
import { WeeklyChangelogSimple } from "@/emails/WeeklyChangelogSimple";
import { OperationsOnlyUpdate } from "@/emails/OperationsOnlyUpdate";
import { BacklogForecastingUpdate } from "@/emails/BacklogForecastingUpdate";
import { getHubSpotDealUrl, getZuperJobUrl, getZohoSalesOrderUrl } from "@/lib/external-links";
import type { ComplianceDigest } from "@/lib/compliance-digest";
import * as React from "react";

type SendResult = { success: boolean; error?: string };
type SendAttemptResult = SendResult & { attempted: boolean };
type ServiceAccountTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

// Lazy initialization to avoid build-time errors when API key isn't set
let resendClient: Resend | null = null;

function getResendClient(): Resend | null {
  if (!process.env.RESEND_API_KEY) {
    return null;
  }
  if (!resendClient) {
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
}

function isTruthy(value?: string): boolean {
  const raw = (value || "").toLowerCase().trim();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
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

function getGoogleWorkspaceCredentials():
  | { serviceAccountEmail: string; privateKey: string }
  | null {
  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!serviceAccountEmail || !serviceAccountKey) return null;

  const privateKey = parseServiceAccountPrivateKey(serviceAccountKey);
  if (!privateKey) return null;
  return { serviceAccountEmail, privateKey };
}

function parseEmailAddress(input?: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  const bracketMatch = trimmed.match(/<([^>]+)>/);
  const candidate = (bracketMatch?.[1] || trimmed).trim();
  const basicEmailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return basicEmailRegex.test(candidate) ? candidate : null;
}

function parseEmailList(input?: string): string[] {
  if (!input) return [];
  const parsed = input
    .split(/[,\n;]+/)
    .map((value) => parseEmailAddress(value))
    .filter((value): value is string => !!value);
  return [...new Set(parsed)];
}

function getSchedulingNotificationBccRecipients(): string[] {
  const configured = parseEmailList(process.env.SCHEDULING_NOTIFICATION_BCC);
  if (configured.length > 0) return configured;

  // Safety fallback for ops visibility when explicit BCC config is missing.
  const adminFallback = parseEmailAddress(process.env.GOOGLE_ADMIN_EMAIL || "");
  return adminFallback ? [adminFallback] : [];
}

function dedupeEmails(emails: string[], exclude?: string): string[] {
  const seen = new Set<string>();
  const excluded = (exclude || "").trim().toLowerCase();
  const result: string[] = [];
  for (const email of emails) {
    const normalized = email.trim().toLowerCase();
    if (!normalized || normalized === excluded || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(email.trim());
  }
  return result;
}

function getGoogleWorkspaceSenderEmail(): string | null {
  return (
    parseEmailAddress(process.env.GOOGLE_EMAIL_SENDER) ||
    parseEmailAddress(process.env.EMAIL_FROM) ||
    parseEmailAddress(process.env.GOOGLE_ADMIN_EMAIL)
  );
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
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

  const sign = crypto.createSign("RSA-SHA256");
  sign.update(signatureInput);
  sign.end();
  const signature = sign
    .sign(privateKey, "base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

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

function buildRawMimeMessage(params: {
  from: string;
  to: string;
  bcc?: string[];
  subject: string;
  text: string;
  html: string;
}): string {
  const safeFrom = params.from.replace(/[\r\n]+/g, " ").trim();
  const safeTo = params.to.replace(/[\r\n]+/g, " ").trim();
  const safeBcc = (params.bcc || [])
    .map((email) => email.replace(/[\r\n]+/g, " ").trim())
    .filter(Boolean);
  const safeSubject = params.subject.replace(/[\r\n]+/g, " ").trim();
  const boundary = `pb_ops_${crypto.randomUUID().replace(/-/g, "")}`;

  const mime = [
    `From: ${safeFrom}`,
    `To: ${safeTo}`,
    ...(safeBcc.length > 0 ? [`Bcc: ${safeBcc.join(", ")}`] : []),
    `Subject: ${safeSubject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    params.text,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    params.html,
    "",
    `--${boundary}--`,
    "",
  ].join("\r\n");

  return base64UrlEncode(mime);
}

async function trySendWithGoogleWorkspace(params: {
  to: string;
  bcc?: string[];
  subject: string;
  html: string;
  text: string;
  from: string;
}): Promise<SendAttemptResult> {
  if (!isTruthy(process.env.GOOGLE_WORKSPACE_EMAIL_ENABLED)) {
    return { attempted: false, success: false };
  }

  const creds = getGoogleWorkspaceCredentials();
  const senderEmail = getGoogleWorkspaceSenderEmail();
  if (!creds) {
    return {
      attempted: true,
      success: false,
      error: "Google Workspace email sender not configured (missing or invalid service account credentials)",
    };
  }
  if (!senderEmail) {
    return {
      attempted: true,
      success: false,
      error: "Google Workspace email sender not configured (set GOOGLE_EMAIL_SENDER or GOOGLE_ADMIN_EMAIL)",
    };
  }

  try {
    const token = await getServiceAccountToken(
      creds.serviceAccountEmail,
      creds.privateKey,
      senderEmail,
      ["https://www.googleapis.com/auth/gmail.send"]
    );

    if (!token.access_token) {
      return {
        attempted: true,
        success: false,
        error: token.error_description || token.error || "Failed to get Gmail access token",
      };
    }

    const raw = buildRawMimeMessage(params);
    const sendResponse = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(senderEmail)}/messages/send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw }),
      }
    );

    if (!sendResponse.ok) {
      const errorText = await sendResponse.text().catch(() => "");
      return {
        attempted: true,
        success: false,
        error: `Gmail API send failed: ${sendResponse.status} ${errorText}`.trim(),
      };
    }

    console.log(`[email] Sent via Google Workspace to ${params.to}`);
    return { attempted: true, success: true };
  } catch (error) {
    return {
      attempted: true,
      success: false,
      error: error instanceof Error ? error.message : "Google Workspace send failed",
    };
  }
}

function logLocalFallback(title: string, content: string) {
  console.log(`
    ==========================================
    ${title}
    ${content}
    ==========================================
    `);
}

async function sendEmailMessage(params: {
  to?: string;
  bcc?: string[];
  subject: string;
  html: string;
  text: string;
  debugFallbackTitle: string;
  debugFallbackBody: string;
}): Promise<SendResult> {
  const normalizedTo = parseEmailAddress(params.to);
  const requestedBcc = (params.bcc || [])
    .map((email) => parseEmailAddress(email))
    .filter((email): email is string => !!email);
  const configuredBcc = parseEmailList(process.env.SCHEDULING_NOTIFICATION_BCC);
  let mergedBcc = dedupeEmails([...configuredBcc, ...requestedBcc]);

  let primaryTo = normalizedTo || "";
  if (!primaryTo && mergedBcc.length > 0) {
    primaryTo = mergedBcc[0];
    mergedBcc = mergedBcc.slice(1);
  }
  if (!primaryTo) {
    return { success: false, error: "No valid recipient (to/bcc) for email send" };
  }

  // Remove duplicates and never BCC the primary recipient.
  const finalBcc = dedupeEmails(mergedBcc, primaryTo);

  const senderEmail = getGoogleWorkspaceSenderEmail();
  const defaultFrom = senderEmail
    ? `PB Operations <${senderEmail}>`
    : "PB Operations <noreply@photonbrothers.com>";
  const from = process.env.EMAIL_FROM || defaultFrom;

  const googleResult = await trySendWithGoogleWorkspace({
    to: primaryTo,
    bcc: finalBcc,
    subject: params.subject,
    html: params.html,
    text: params.text,
    from,
  });

  if (googleResult.success) {
    return { success: true };
  }
  if (googleResult.attempted && googleResult.error) {
    console.warn(`[email] Google Workspace send failed, falling back to Resend: ${googleResult.error}`);
  }

  const resend = getResendClient();
  if (resend) {
    // Resend requires a verified domain. If no custom domain is verified,
    // fall back to Resend's built-in test sender so emails still go out.
    const resendFrom = process.env.RESEND_FROM_EMAIL
      ? `PB Operations <${process.env.RESEND_FROM_EMAIL}>`
      : from;

    try {
      const { error } = await resend.emails.send({
        from: resendFrom,
        to: [primaryTo],
        ...(finalBcc.length > 0 ? { bcc: finalBcc } : {}),
        subject: params.subject,
        html: params.html,
        text: params.text,
      });

      if (error) {
        return { success: false, error: error.message };
      }

      console.log(`[email] Sent via Resend to ${primaryTo}${finalBcc.length > 0 ? ` (bcc: ${finalBcc.join(",")})` : ""}`);
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Failed to send email via Resend",
      };
    }
  }

  if (process.env.NODE_ENV !== "production") {
    logLocalFallback(params.debugFallbackTitle, `${params.debugFallbackBody}\n(No email provider configured)`);
    return { success: true };
  }

  return {
    success: false,
    error: "No email provider configured (enable Google Workspace email or set RESEND_API_KEY)",
  };
}

// Appointment type display names
const APPOINTMENT_TYPE_LABELS: Record<string, string> = {
  survey: "Site Survey",
  installation: "Installation",
  inspection: "Inspection",
};

// Format time for display (e.g., "08:00" -> "8:00 AM")
function formatTime(time: string): string {
  if (!time) return "";
  const [hours, minutes] = time.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${String(minutes).padStart(2, "0")} ${period}`;
}

// Format date for display (e.g., "2024-02-15" -> "Friday, February 15, 2024")
function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T12:00:00"); // Use noon to avoid timezone issues
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeScheduleEmailNotes(notes?: string | null): string | undefined {
  if (!notes) return undefined;
  const cleaned = notes
    .replace(/\[(?:TENTATIVE|CONFIRMED)\]\s*/gi, "")
    .replace(/\s*\[TZ:[^\]]+\]/gi, "")
    .replace(/\bTentatively scheduled\b/gi, "Scheduled")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned || undefined;
}

interface SendVerificationEmailParams {
  to: string;
  code: string;
}

export async function sendVerificationEmail({
  to,
  code,
}: SendVerificationEmailParams): Promise<{ success: boolean; error?: string }> {
  const html = await render(React.createElement(VerificationCode, { code }));
  return sendEmailMessage({
    to,
    subject: "Your PB Operations Login Code",
    html,
    text: `Your PB Operations verification code is: ${code}\n\nThis code expires in 10 minutes.\n\nIf you didn't request this code, you can safely ignore this email.`,
    debugFallbackTitle: `VERIFICATION CODE for ${to}`,
    debugFallbackBody: `Code: ${code}`,
  });
}

/**
 * Send scheduling notification to assigned crew member
 */
interface SendSchedulingNotificationParams {
  to: string; // Crew member email
  bcc?: string | string[];
  crewMemberName: string;
  scheduledByName: string;
  scheduledByEmail: string;
  dealOwnerName?: string;
  projectManagerName?: string;
  appointmentType: "survey" | "installation" | "inspection";
  customerName: string;
  customerAddress: string;
  scheduledDate: string; // YYYY-MM-DD
  scheduledStart?: string; // HH:mm
  scheduledEnd?: string; // HH:mm
  projectId: string;
  zuperJobUid?: string;
  googleCalendarEventUrl?: string;
  notes?: string;
  installDetails?: {
    forecastedInstallDays?: number;
    installerDays?: number;
    electricianDays?: number;
    installersCount?: number;
    electriciansCount?: number;
    installNotes?: string;
    equipmentSummary?: string;
  };
}

export async function sendSchedulingNotification(
  params: SendSchedulingNotificationParams
): Promise<{ success: boolean; error?: string }> {
  const appointmentTypeLabel = APPOINTMENT_TYPE_LABELS[params.appointmentType] || params.appointmentType;
  const formattedDate = formatDate(params.scheduledDate);
  const timeSlot = params.scheduledStart && params.scheduledEnd
    ? `${formatTime(params.scheduledStart)} - ${formatTime(params.scheduledEnd)}`
    : "Full day";
  const defaultBcc = getSchedulingNotificationBccRecipients();
  const explicitBcc =
    typeof params.bcc === "string"
      ? parseEmailList(params.bcc)
      : Array.isArray(params.bcc)
        ? params.bcc.map((value) => parseEmailAddress(value)).filter((value): value is string => !!value)
        : [];
  const bccRecipients = dedupeEmails([...defaultBcc, ...explicitBcc], params.to);
  const installDetails = params.appointmentType === "installation" ? params.installDetails : undefined;
  const cleanedNotes = sanitizeScheduleEmailNotes(params.notes);
  const hubSpotDealUrl = getHubSpotDealUrl(params.projectId);
  const zuperJobUrl = getZuperJobUrl(params.zuperJobUid);
  const stakeholderTextLine = params.appointmentType === "survey" && params.dealOwnerName
    ? `Deal owner: ${params.dealOwnerName}\n`
    : (params.appointmentType === "installation" || params.appointmentType === "inspection") && params.projectManagerName
      ? `Project manager: ${params.projectManagerName}\n`
      : "";
  const installDetailLines: string[] = [];
  if (installDetails?.forecastedInstallDays != null) {
    installDetailLines.push(`Forecasted Install Days: ${installDetails.forecastedInstallDays}`);
  }
  if (installDetails?.installerDays != null) {
    installDetailLines.push(`Installer Days: ${installDetails.installerDays}`);
  }
  if (installDetails?.electricianDays != null) {
    installDetailLines.push(`Electrician Days: ${installDetails.electricianDays}`);
  }
  if (installDetails?.installersCount != null) {
    installDetailLines.push(`Installers: ${installDetails.installersCount}`);
  }
  if (installDetails?.electriciansCount != null) {
    installDetailLines.push(`Electricians: ${installDetails.electriciansCount}`);
  }
  if (installDetails?.equipmentSummary) {
    installDetailLines.push(`Equipment:\n${installDetails.equipmentSummary}`);
  }
  if (installDetails?.installNotes) {
    installDetailLines.push(`Install Notes: ${installDetails.installNotes}`);
  }

  const html = await render(
    React.createElement(SchedulingNotification, {
      crewMemberName: params.crewMemberName,
      scheduledByName: params.scheduledByName,
      scheduledByEmail: params.scheduledByEmail,
      dealOwnerName: params.dealOwnerName,
      projectManagerName: params.projectManagerName,
      appointmentType: params.appointmentType,
      appointmentTypeLabel,
      customerName: params.customerName,
      customerAddress: params.customerAddress,
      formattedDate,
      timeSlot,
      notes: cleanedNotes,
      installDetailLines: installDetailLines.length > 0 ? installDetailLines : undefined,
      hubSpotDealUrl,
      zuperJobUrl: zuperJobUrl || undefined,
      googleCalendarEventUrl: params.googleCalendarEventUrl || undefined,
    })
  );

  return sendEmailMessage({
    to: params.to,
    bcc: bccRecipients,
    subject: `New ${appointmentTypeLabel} Scheduled - ${params.customerName}`,
    html,
    text: `New ${appointmentTypeLabel} Scheduled

Hi ${params.crewMemberName},

You have been scheduled for a new ${appointmentTypeLabel.toLowerCase()} appointment.

Customer: ${params.customerName}
Address: ${params.customerAddress}
Date: ${formattedDate}
Time: ${timeSlot}
Scheduled by: ${params.scheduledByName}
${stakeholderTextLine}
${installDetailLines.length > 0 ? `\nInstall Details:\n${installDetailLines.join("\n")}` : ""}
${cleanedNotes ? `\nNotes: ${cleanedNotes}` : ""}
HubSpot Deal: ${hubSpotDealUrl}
${zuperJobUrl ? `Zuper Job: ${zuperJobUrl}` : ""}
${params.googleCalendarEventUrl ? `Google Calendar Event: ${params.googleCalendarEventUrl}` : ""}

Please check your Zuper app for complete details.

- PB Operations`,
    debugFallbackTitle: `SCHEDULING NOTIFICATION for ${params.to}`,
    debugFallbackBody: [
      `Crew Member: ${params.crewMemberName}`,
      `Scheduled By: ${params.scheduledByName} (${params.scheduledByEmail})`,
      `Deal Owner: ${params.dealOwnerName || "N/A"}`,
      `Project Manager: ${params.projectManagerName || "N/A"}`,
      `Type: ${appointmentTypeLabel}`,
      `Customer: ${params.customerName}`,
      `Address: ${params.customerAddress}`,
      `Date: ${formattedDate}`,
      `Time: ${timeSlot}`,
      `Install Details: ${installDetailLines.length > 0 ? installDetailLines.join(" | ") : "None"}`,
      `Notes: ${cleanedNotes || "None"}`,
      `HubSpot Deal: ${hubSpotDealUrl}`,
      `Zuper Job: ${zuperJobUrl || "None"}`,
      `Google Calendar Event: ${params.googleCalendarEventUrl || "None"}`,
      `BCC: ${bccRecipients.join(", ") || "None"}`,
    ].join("\n"),
  });
}

interface SendCancellationNotificationParams {
  to: string;
  crewMemberName: string;
  cancelledByName: string;
  cancelledByEmail: string;
  scheduledByName?: string;
  dealOwnerName?: string;
  appointmentType: "survey" | "installation" | "inspection";
  customerName: string;
  customerAddress: string;
  scheduledDate?: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  projectId: string;
  cancelReason?: string;
}

export async function sendCancellationNotification(
  params: SendCancellationNotificationParams
): Promise<{ success: boolean; error?: string }> {
  const appointmentTypeLabel = APPOINTMENT_TYPE_LABELS[params.appointmentType] || params.appointmentType;
  const bccRecipients = getSchedulingNotificationBccRecipients();
  const formattedDate = params.scheduledDate ? formatDate(params.scheduledDate) : "Not provided";
  const timeSlot = params.scheduledStart && params.scheduledEnd
    ? `${formatTime(params.scheduledStart)} - ${formatTime(params.scheduledEnd)}`
    : "Not provided";
  const reasonText = params.cancelReason?.trim() || "No reason provided";

  return sendEmailMessage({
    to: params.to,
    bcc: bccRecipients,
    subject: `${appointmentTypeLabel} Cancelled - ${params.customerName}`,
    html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0a0a0f; color: #ffffff; padding: 40px 20px; margin: 0;">
            <div style="max-width: 500px; margin: 0 auto; background-color: #12121a; border: 1px solid #1e1e2e; border-radius: 12px; padding: 32px;">
              <h1 style="font-size: 24px; font-weight: bold; background: linear-gradient(to right, #f97316, #fb923c); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin: 0 0 8px 0; text-align: center;">
                PB Operations Suite
              </h1>
              <p style="color: #71717a; font-size: 14px; text-align: center; margin: 0 0 32px 0;">
                Appointment Cancelled
              </p>

              <div style="background-color: #0a0a0f; border: 1px solid #1e1e2e; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
                <div style="display: flex; align-items: center; margin-bottom: 16px;">
                  <span style="background: #dc2626; color: white; padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: 600; text-transform: uppercase;">
                    ${appointmentTypeLabel} Cancelled
                  </span>
                </div>

                <h2 style="font-size: 20px; color: #ffffff; margin: 0 0 16px 0;">
                  ${params.customerName}
                </h2>

                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="color: #71717a; font-size: 13px; padding: 8px 0; border-bottom: 1px solid #1e1e2e;">📍 Address</td>
                    <td style="color: #ffffff; font-size: 13px; padding: 8px 0; border-bottom: 1px solid #1e1e2e; text-align: right;">${params.customerAddress}</td>
                  </tr>
                  <tr>
                    <td style="color: #71717a; font-size: 13px; padding: 8px 0; border-bottom: 1px solid #1e1e2e;">📅 Date</td>
                    <td style="color: #ffffff; font-size: 13px; padding: 8px 0; border-bottom: 1px solid #1e1e2e; text-align: right;">${formattedDate}</td>
                  </tr>
                  <tr>
                    <td style="color: #71717a; font-size: 13px; padding: 8px 0; border-bottom: 1px solid #1e1e2e;">⏰ Time</td>
                    <td style="color: #ffffff; font-size: 13px; padding: 8px 0; border-bottom: 1px solid #1e1e2e; text-align: right;">${timeSlot}</td>
                  </tr>
                  ${params.scheduledByName ? `
                  <tr>
                    <td style="color: #71717a; font-size: 13px; padding: 8px 0; border-bottom: 1px solid #1e1e2e;">👤 Originally scheduled by</td>
                    <td style="color: #ffffff; font-size: 13px; padding: 8px 0; border-bottom: 1px solid #1e1e2e; text-align: right;">${params.scheduledByName}</td>
                  </tr>
                  ` : ""}
                  ${params.dealOwnerName ? `
                  <tr>
                    <td style="color: #71717a; font-size: 13px; padding: 8px 0; border-bottom: 1px solid #1e1e2e;">🧑‍💼 Deal owner</td>
                    <td style="color: #ffffff; font-size: 13px; padding: 8px 0; border-bottom: 1px solid #1e1e2e; text-align: right;">${params.dealOwnerName}</td>
                  </tr>
                  ` : ""}
                  <tr>
                    <td style="color: #71717a; font-size: 13px; padding: 8px 0; border-bottom: 1px solid #1e1e2e;">🛑 Cancelled by</td>
                    <td style="color: #ffffff; font-size: 13px; padding: 8px 0; border-bottom: 1px solid #1e1e2e; text-align: right;">${params.cancelledByName}</td>
                  </tr>
                  <tr>
                    <td colspan="2" style="padding-top: 16px;">
                      <div style="background-color: #1e1e2e; border-radius: 6px; padding: 12px;">
                        <p style="color: #71717a; font-size: 12px; margin: 0 0 4px 0;">📝 Cancellation reason</p>
                        <p style="color: #ffffff; font-size: 13px; margin: 0;">${reasonText}</p>
                      </div>
                    </td>
                  </tr>
                </table>
              </div>

              <p style="color: #71717a; font-size: 12px; text-align: center; margin: 0;">
                Please check your Zuper app for complete details.
              </p>
            </div>

            <p style="color: #3f3f46; font-size: 11px; text-align: center; margin-top: 24px;">
              Photon Brothers Operations Suite
            </p>
          </body>
        </html>
      `,
    text: `${appointmentTypeLabel} Cancelled

Hi ${params.crewMemberName},

Your assigned ${appointmentTypeLabel.toLowerCase()} appointment has been cancelled.

Customer: ${params.customerName}
Address: ${params.customerAddress}
Date: ${formattedDate}
Time: ${timeSlot}
${params.scheduledByName ? `Originally scheduled by: ${params.scheduledByName}\n` : ""}${params.dealOwnerName ? `Deal owner: ${params.dealOwnerName}\n` : ""}Cancelled by: ${params.cancelledByName}
Reason: ${reasonText}

Please check your Zuper app for complete details.

- PB Operations`,
    debugFallbackTitle: `CANCELLATION NOTIFICATION for ${params.to}`,
    debugFallbackBody: [
      `Crew Member: ${params.crewMemberName}`,
      `Cancelled By: ${params.cancelledByName} (${params.cancelledByEmail})`,
      `Originally Scheduled By: ${params.scheduledByName || "N/A"}`,
      `Deal Owner: ${params.dealOwnerName || "N/A"}`,
      `Type: ${appointmentTypeLabel}`,
      `Customer: ${params.customerName}`,
      `Address: ${params.customerAddress}`,
      `Date: ${formattedDate}`,
      `Time: ${timeSlot}`,
      `Reason: ${reasonText}`,
      `BCC: ${bccRecipients.join(", ") || "None"}`,
    ].join("\n"),
  });
}

interface AvailabilityConflictItem {
  projectId: string;
  customerName: string;
  customerAddress: string;
  scheduledDate: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  dealOwnerName?: string | null;
}

interface SendAvailabilityConflictNotificationParams {
  to: string;
  bcc?: string | string[];
  recipientName?: string;
  blockedByName: string;
  blockedByEmail?: string;
  surveyorName: string;
  overrideType: "blocked" | "custom";
  overrideDate: string;
  overrideStart?: string;
  overrideEnd?: string;
  overrideReason?: string;
  conflicts: AvailabilityConflictItem[];
}

export async function sendAvailabilityConflictNotification(
  params: SendAvailabilityConflictNotificationParams
): Promise<{ success: boolean; error?: string }> {
  if (!params.conflicts.length) {
    return { success: true };
  }

  const defaultBcc = parseEmailList(process.env.SCHEDULING_NOTIFICATION_BCC);
  const explicitBcc =
    typeof params.bcc === "string"
      ? parseEmailList(params.bcc)
      : Array.isArray(params.bcc)
        ? params.bcc.map((value) => parseEmailAddress(value)).filter((value): value is string => !!value)
        : [];
  const bccRecipients = dedupeEmails([...defaultBcc, ...explicitBcc], params.to);
  const recipientName = params.recipientName || "Team Member";
  const overrideDate = formatDate(params.overrideDate);
  const overrideWindow = params.overrideType === "custom" && params.overrideStart && params.overrideEnd
    ? `${formatTime(params.overrideStart)} - ${formatTime(params.overrideEnd)}`
    : "Full day";
  const subject = `Action Needed: ${params.conflicts.length} scheduled survey conflict${params.conflicts.length === 1 ? "" : "s"} for ${params.surveyorName}`;

  const conflictRowsHtml = params.conflicts
    .map((conflict) => {
      const time = conflict.scheduledStart && conflict.scheduledEnd
        ? `${formatTime(conflict.scheduledStart)} - ${formatTime(conflict.scheduledEnd)}`
        : "Time not set";
      return `
        <tr>
          <td style="color: #ffffff; font-size: 13px; padding: 8px 0; border-bottom: 1px solid #1e1e2e;">${conflict.customerName}</td>
          <td style="color: #a1a1aa; font-size: 12px; padding: 8px 0; border-bottom: 1px solid #1e1e2e;">${conflict.customerAddress}</td>
          <td style="color: #a1a1aa; font-size: 12px; padding: 8px 0; border-bottom: 1px solid #1e1e2e;">${formatDate(conflict.scheduledDate)}</td>
          <td style="color: #a1a1aa; font-size: 12px; padding: 8px 0; border-bottom: 1px solid #1e1e2e;">${time}</td>
          <td style="color: #a1a1aa; font-size: 12px; padding: 8px 0; border-bottom: 1px solid #1e1e2e;">${conflict.projectId}</td>
        </tr>
      `;
    })
    .join("");

  const conflictRowsText = params.conflicts
    .map((conflict) => {
      const time = conflict.scheduledStart && conflict.scheduledEnd
        ? `${formatTime(conflict.scheduledStart)}-${formatTime(conflict.scheduledEnd)}`
        : "Time not set";
      return `- ${conflict.customerName} | ${conflict.customerAddress} | ${formatDate(conflict.scheduledDate)} ${time} | Project ${conflict.projectId}`;
    })
    .join("\n");

  const conflictItems = params.conflicts.map((conflict) => ({
    projectId: conflict.projectId,
    customerName: conflict.customerName,
    customerAddress: conflict.customerAddress,
    formattedDate: formatDate(conflict.scheduledDate),
    timeSlot:
      conflict.scheduledStart && conflict.scheduledEnd
        ? `${formatTime(conflict.scheduledStart)} - ${formatTime(conflict.scheduledEnd)}`
        : "Time not set",
  }));

  const html = await render(
    React.createElement(AvailabilityConflict, {
      recipientName,
      surveyorName: params.surveyorName,
      blockedByName: params.blockedByName,
      blockedByEmail: params.blockedByEmail,
      overrideTypeLabel: params.overrideType === "custom" ? "Time Range" : "Full Day",
      overrideDate,
      overrideWindow,
      overrideReason: params.overrideReason,
      conflicts: conflictItems,
    })
  );

  return sendEmailMessage({
    to: params.to,
    ...(bccRecipients.length > 0 ? { bcc: bccRecipients } : {}),
    subject,
    html,
    text: `Availability Conflict Alert

${recipientName},

${params.surveyorName} added an availability block that overlaps scheduled site surveys.

Blocked By: ${params.blockedByName}${params.blockedByEmail ? ` (${params.blockedByEmail})` : ""}
Surveyor: ${params.surveyorName}
Override: ${params.overrideType === "custom" ? "Time Range" : "Full Day"} on ${overrideDate} (${overrideWindow})
${params.overrideReason ? `Reason: ${params.overrideReason}` : ""}

Impacted Surveys:
${conflictRowsText}

Please review and reschedule/cancel impacted surveys as needed.`,
    debugFallbackTitle: `AVAILABILITY CONFLICT ALERT for ${params.to}`,
    debugFallbackBody: [
      `Blocked By: ${params.blockedByName}${params.blockedByEmail ? ` (${params.blockedByEmail})` : ""}`,
      `Surveyor: ${params.surveyorName}`,
      `Override: ${params.overrideType} ${params.overrideDate} ${overrideWindow}`,
      `Reason: ${params.overrideReason || "None"}`,
      `Conflicts: ${params.conflicts.length}`,
      `BCC: ${bccRecipients.length > 0 ? bccRecipients.join(", ") : "None"}`,
      ...params.conflicts.map(
        (item) =>
          ` - ${item.customerName} | ${item.customerAddress} | ${item.scheduledDate} ${item.scheduledStart || ""}-${item.scheduledEnd || ""} | ${item.projectId}`
      ),
    ].join("\n"),
  });
}

interface SendProductUpdateEmailParams {
  to: string;
  update: UpdateEntry;
  updatesUrl?: string;
}

function resolveUpdatesUrl(): string {
  const baseUrl =
    (process.env.NEXT_PUBLIC_APP_URL || "").trim() ||
    (process.env.APP_URL || "").trim() ||
    "https://www.pbtechops.com";
  return `${baseUrl.replace(/\/$/, "")}/updates`;
}

export async function sendProductUpdateEmail(
  params: SendProductUpdateEmailParams
): Promise<{ success: boolean; error?: string }> {
  const updatesUrl = (params.updatesUrl || "").trim() || resolveUpdatesUrl();
  const formattedDate = formatDate(params.update.date);
  const changesHtml = params.update.changes
    .map((change) => `<li style="margin: 0 0 8px 0;"><strong>${change.type.toUpperCase()}:</strong> ${change.text}</li>`)
    .join("");
  const changesText = params.update.changes
    .map((change) => `- [${change.type.toUpperCase()}] ${change.text}`)
    .join("\n");

  const html = await render(
    React.createElement(ProductUpdate, {
      version: params.update.version,
      title: params.update.title,
      formattedDate,
      description: params.update.description,
      changes: params.update.changes,
      updatesUrl,
    })
  );

  return sendEmailMessage({
    to: params.to,
    subject: `PB Operations Update ${params.update.version} - ${params.update.title}`,
    html,
    text: `PB Operations Update v${params.update.version}

${params.update.title}
Date: ${formattedDate}

${params.update.description}

Changes:
${changesText}

Full changelog: ${updatesUrl}`,
    debugFallbackTitle: `PRODUCT UPDATE EMAIL for ${params.to}`,
    debugFallbackBody: [
      `Version: ${params.update.version}`,
      `Date: ${formattedDate}`,
      `Title: ${params.update.title}`,
      `Description: ${params.update.description}`,
      "Changes:",
      changesText,
      `URL: ${updatesUrl}`,
    ].join("\n"),
  });
}

interface SendExecutiveLevelNotificationEmailParams {
  to: string;
  title: string;
  reportWindow: string;
  summary: string;
  highlights: string[];
  risks?: string[];
  decisionsNeeded?: string[];
}

export async function sendExecutiveLevelNotificationEmail(
  params: SendExecutiveLevelNotificationEmailParams
): Promise<{ success: boolean; error?: string }> {
  const risks = params.risks || [];
  const decisions = params.decisionsNeeded || [];

  const html = await render(
    React.createElement(ExecutiveLevelNotification, {
      title: params.title,
      reportWindow: params.reportWindow,
      summary: params.summary,
      highlights: params.highlights,
      risks,
      decisionsNeeded: decisions,
    })
  );

  const bulletLines = (items: string[]) => items.map((item) => `- ${item}`).join("\n");

  return sendEmailMessage({
    to: params.to,
    subject: `Executive Alert - ${params.title}`,
    html,
    text: `Executive-Level Notification

${params.title}
Window: ${params.reportWindow}

Summary:
${params.summary}

Top Highlights:
${bulletLines(params.highlights)}
${risks.length > 0 ? `\n\nRisks To Watch:\n${bulletLines(risks)}` : ""}
${decisions.length > 0 ? `\n\nDecisions Needed:\n${bulletLines(decisions)}` : ""}
`,
    debugFallbackTitle: `EXECUTIVE NOTIFICATION for ${params.to}`,
    debugFallbackBody: [
      `Title: ${params.title}`,
      `Window: ${params.reportWindow}`,
      `Summary: ${params.summary}`,
      "Highlights:",
      bulletLines(params.highlights),
      ...(risks.length > 0 ? ["Risks:", bulletLines(risks)] : []),
      ...(decisions.length > 0 ? ["Decisions Needed:", bulletLines(decisions)] : []),
    ].join("\n"),
  });
}

interface SendWeeklyChangelogSimpleEmailParams {
  to: string;
  weekLabel: string;
  plainLanguageSummary: string;
  whatChanged: string[];
  whyItMatters: string[];
  actionItems?: string[];
  updatesUrl?: string;
}

export async function sendWeeklyChangelogSimpleEmail(
  params: SendWeeklyChangelogSimpleEmailParams
): Promise<{ success: boolean; error?: string }> {
  const updatesUrl = (params.updatesUrl || "").trim() || resolveUpdatesUrl();
  const actionItems = params.actionItems || [];
  const bulletLines = (items: string[]) => items.map((item) => `- ${item}`).join("\n");

  const html = await render(
    React.createElement(WeeklyChangelogSimple, {
      weekLabel: params.weekLabel,
      plainLanguageSummary: params.plainLanguageSummary,
      whatChanged: params.whatChanged,
      whyItMatters: params.whyItMatters,
      actionItems,
      updatesUrl,
    })
  );

  return sendEmailMessage({
    to: params.to,
    subject: `PB Ops Weekly Update (Simple) - ${params.weekLabel}`,
    html,
    text: `Weekly Changelog (Plain Language)

${params.weekLabel}

Summary:
${params.plainLanguageSummary}

What Changed:
${bulletLines(params.whatChanged)}

Why It Matters:
${bulletLines(params.whyItMatters)}
${actionItems.length > 0 ? `\n\nWhat You Need To Do:\n${bulletLines(actionItems)}` : ""}

Full changelog: ${updatesUrl}
`,
    debugFallbackTitle: `WEEKLY CHANGELOG SIMPLE for ${params.to}`,
    debugFallbackBody: [
      `Week: ${params.weekLabel}`,
      `Summary: ${params.plainLanguageSummary}`,
      "What Changed:",
      bulletLines(params.whatChanged),
      "Why It Matters:",
      bulletLines(params.whyItMatters),
      ...(actionItems.length > 0 ? ["What You Need To Do:", bulletLines(actionItems)] : []),
      `URL: ${updatesUrl}`,
    ].join("\n"),
  });
}

interface SendOperationsOnlyUpdateEmailParams {
  to: string;
  title: string;
  dateLabel: string;
  focus: string;
  completed: string[];
  nextUp: string[];
  blockers?: string[];
  owner?: string;
}

export async function sendOperationsOnlyUpdateEmail(
  params: SendOperationsOnlyUpdateEmailParams
): Promise<{ success: boolean; error?: string }> {
  const blockers = params.blockers || [];
  const bulletLines = (items: string[]) => items.map((item) => `- ${item}`).join("\n");

  const html = await render(
    React.createElement(OperationsOnlyUpdate, {
      title: params.title,
      dateLabel: params.dateLabel,
      focus: params.focus,
      completed: params.completed,
      nextUp: params.nextUp,
      blockers,
      owner: params.owner,
    })
  );

  return sendEmailMessage({
    to: params.to,
    subject: `[Operations Only] ${params.title}`,
    html,
    text: `Operations-Only Update

${params.title}
Date: ${params.dateLabel}
${params.owner ? `Owner: ${params.owner}\n` : ""}Focus: ${params.focus}

Completed:
${bulletLines(params.completed)}

Next Up:
${bulletLines(params.nextUp)}
${blockers.length > 0 ? `\n\nBlockers / Risks:\n${bulletLines(blockers)}` : ""}
`,
    debugFallbackTitle: `OPERATIONS ONLY UPDATE for ${params.to}`,
    debugFallbackBody: [
      `Title: ${params.title}`,
      `Date: ${params.dateLabel}`,
      `Owner: ${params.owner || "N/A"}`,
      `Focus: ${params.focus}`,
      "Completed:",
      bulletLines(params.completed),
      "Next Up:",
      bulletLines(params.nextUp),
      ...(blockers.length > 0 ? ["Blockers:", bulletLines(blockers)] : []),
    ].join("\n"),
  });
}

interface SendBacklogForecastingUpdateEmailParams {
  to: string;
  title: string;
  dateLabel: string;
  backlogSummary: string;
  backlogMetrics: string[];
  forecastWindow: string;
  forecastSummary: string;
  forecastPoints: string[];
  risks?: string[];
  actions?: string[];
}

export async function sendBacklogForecastingUpdateEmail(
  params: SendBacklogForecastingUpdateEmailParams
): Promise<{ success: boolean; error?: string }> {
  const risks = params.risks || [];
  const actions = params.actions || [];
  const bulletLines = (items: string[]) => items.map((item) => `- ${item}`).join("\n");

  const html = await render(
    React.createElement(BacklogForecastingUpdate, {
      title: params.title,
      dateLabel: params.dateLabel,
      backlogSummary: params.backlogSummary,
      backlogMetrics: params.backlogMetrics,
      forecastWindow: params.forecastWindow,
      forecastSummary: params.forecastSummary,
      forecastPoints: params.forecastPoints,
      risks,
      actions,
    })
  );

  return sendEmailMessage({
    to: params.to,
    subject: `Backlog + Forecasting - ${params.title}`,
    html,
    text: `Backlog & Forecasting Update

${params.title}
Date: ${params.dateLabel}

Backlog Snapshot:
${params.backlogSummary}
${bulletLines(params.backlogMetrics)}

Forecast Outlook (${params.forecastWindow}):
${params.forecastSummary}
${bulletLines(params.forecastPoints)}
${risks.length > 0 ? `\n\nRisks / Watchouts:\n${bulletLines(risks)}` : ""}
${actions.length > 0 ? `\n\nRecommended Actions:\n${bulletLines(actions)}` : ""}
`,
    debugFallbackTitle: `BACKLOG FORECASTING UPDATE for ${params.to}`,
    debugFallbackBody: [
      `Title: ${params.title}`,
      `Date: ${params.dateLabel}`,
      `Backlog Summary: ${params.backlogSummary}`,
      "Backlog Metrics:",
      bulletLines(params.backlogMetrics),
      `Forecast Window: ${params.forecastWindow}`,
      `Forecast Summary: ${params.forecastSummary}`,
      "Forecast Points:",
      bulletLines(params.forecastPoints),
      ...(risks.length > 0 ? ["Risks:", bulletLines(risks)] : []),
      ...(actions.length > 0 ? ["Actions:", bulletLines(actions)] : []),
    ].join("\n"),
  });
}

interface SendWeeklyComplianceEmailParams {
  to: string;
  bcc?: string[];
  digest: ComplianceDigest;
  dashboardUrl?: string;
}

function formatCompliancePercent(value: number): string {
  return `${Math.round(value * 10) / 10}%`;
}

function getTrend(current: number, prior: number, higherIsBetter: boolean): {
  arrow: string;
  color: string;
  deltaLabel: string;
} {
  const delta = Math.round((current - prior) * 10) / 10;
  const improved = higherIsBetter ? delta >= 0 : delta <= 0;
  const arrow = delta === 0 ? "→" : improved ? "▲" : "▼";
  const color = delta === 0 ? "#a1a1aa" : improved ? "#22c55e" : "#ef4444";
  const deltaLabel = `${delta > 0 ? "+" : ""}${delta}`;
  return { arrow, color, deltaLabel };
}

function gradeRank(grade: string): number {
  const key = grade.trim().toUpperCase();
  if (key === "A") return 5;
  if (key === "B") return 4;
  if (key === "C") return 3;
  if (key === "D") return 2;
  if (key === "F") return 1;
  return 0;
}

function buildWeeklyComplianceEmailHtml(digest: ComplianceDigest, dashboardUrl: string): string {
  const periodLabel = `${digest.period.from} - ${digest.period.to}`;

  const onTimeTrend = getTrend(digest.summary.onTimePercent, digest.priorPeriod.onTimePercent, true);
  const oowTrend = getTrend(
    digest.summary.oowUsagePercent,
    digest.priorPeriod.oowUsagePercent,
    true
  );
  const stuckTrend = getTrend(digest.summary.stuckJobs, digest.priorPeriod.stuckJobs, false);
  const completedTrend = getTrend(digest.summary.completedJobs, digest.priorPeriod.completedJobs, true);

  const onTimeBaseline = getTrend(digest.summary.onTimePercent, digest.baseline30Day.onTimePercent, true);
  const oowBaseline = getTrend(digest.summary.oowUsagePercent, digest.baseline30Day.oowUsagePercent, true);
  const stuckBaseline = getTrend(digest.summary.stuckJobs, digest.baseline30Day.stuckJobs, false);
  const completedBaseline = getTrend(digest.summary.completedJobs, digest.baseline30Day.completedJobs, true);

  const teamRows = digest.teams.slice(0, 10);
  const bestTeamName =
    teamRows.length > 0
      ? teamRows
          .slice()
          .sort(
            (a, b) =>
              gradeRank(b.grade) - gradeRank(a.grade) || b.onTimePercent - a.onTimePercent
          )[0]?.name
      : null;
  const worstTeamName =
    teamRows.length > 0
      ? teamRows
          .slice()
          .sort(
            (a, b) =>
              gradeRank(a.grade) - gradeRank(b.grade) || a.onTimePercent - b.onTimePercent
          )[0]?.name
      : null;

  const categoryRows = digest.categories.slice(0, 10);
  const lowOowUsers = digest.notificationReliability.lowOowUsers.slice(0, 8);
  const stuckCallouts = digest.callouts.stuckOver3Days.slice(0, 8);
  const failingUsers = digest.callouts.failingUsers.slice(0, 8);
  const unknownCompletion = digest.callouts.unknownCompletionJobs.slice(0, 8);

  const metricCard = (
    label: string,
    value: string,
    trend: { arrow: string; color: string; deltaLabel: string },
    baseline: { arrow: string; color: string; deltaLabel: string }
  ) => `
    <td style="width: 25%; padding: 10px;">
      <div style="background:#12121a; border:1px solid #1e1e2e; border-radius:10px; padding:12px;">
        <div style="color:#a1a1aa; font-size:12px; margin-bottom:6px;">${label}</div>
        <div style="color:#ffffff; font-size:24px; font-weight:700; margin-bottom:4px;">${value}</div>
        <div style="font-size:12px; color:${trend.color};">${trend.arrow} ${trend.deltaLabel} vs prior week</div>
        <div style="font-size:11px; color:${baseline.color}; margin-top:2px;">${baseline.arrow} ${baseline.deltaLabel} vs 30-day avg</div>
      </div>
    </td>
  `;

  const teamTableRows =
    teamRows.length === 0
      ? `<tr><td colspan="6" style="padding:10px; color:#a1a1aa;">No team data available.</td></tr>`
      : teamRows
          .map((team) => {
            const rowColor =
              team.name === bestTeamName
                ? "rgba(34,197,94,0.08)"
                : team.name === worstTeamName
                  ? "rgba(239,68,68,0.08)"
                  : "transparent";
            return `
              <tr style="background:${rowColor};">
                <td style="padding:8px; border-top:1px solid #1e1e2e;">${escapeHtml(team.name)}</td>
                <td style="padding:8px; border-top:1px solid #1e1e2e;">${team.grade}</td>
                <td style="padding:8px; border-top:1px solid #1e1e2e;">${team.completedJobs}</td>
                <td style="padding:8px; border-top:1px solid #1e1e2e;">${formatCompliancePercent(team.onTimePercent)}</td>
                <td style="padding:8px; border-top:1px solid #1e1e2e;">${team.avgDaysLate}</td>
                <td style="padding:8px; border-top:1px solid #1e1e2e;">${team.stuckJobs}</td>
              </tr>
            `;
          })
          .join("");

  const categoryTableRows =
    categoryRows.length === 0
      ? `<tr><td colspan="6" style="padding:10px; color:#a1a1aa;">No category data available.</td></tr>`
      : categoryRows
          .map(
            (category) => `
              <tr>
                <td style="padding:8px; border-top:1px solid #1e1e2e;">${escapeHtml(category.name)}</td>
                <td style="padding:8px; border-top:1px solid #1e1e2e;">${category.grade}</td>
                <td style="padding:8px; border-top:1px solid #1e1e2e;">${category.completedJobs}</td>
                <td style="padding:8px; border-top:1px solid #1e1e2e;">${formatCompliancePercent(category.onTimePercent)}</td>
                <td style="padding:8px; border-top:1px solid #1e1e2e;">${category.avgDaysLate}</td>
                <td style="padding:8px; border-top:1px solid #1e1e2e;">${category.stuckJobs}</td>
              </tr>
            `
          )
          .join("");

  const lowOowHtml =
    lowOowUsers.length === 0
      ? `<li style="margin-bottom:6px; color:#a1a1aa;">No low-OOW users in this period.</li>`
      : lowOowUsers
          .map(
            (item) =>
              `<li style="margin-bottom:6px;">${escapeHtml(item.name)} (${escapeHtml(item.team)}): ${formatCompliancePercent(item.oowPercent)}</li>`
          )
          .join("");

  const stuckHtml =
    stuckCallouts.length === 0
      ? `<li style="margin-bottom:6px; color:#a1a1aa;">No stuck jobs over 3 days.</li>`
      : stuckCallouts
          .map(
            (job) =>
              `<li style="margin-bottom:6px;"><strong>${escapeHtml(job.title || job.jobUid)}</strong> (${escapeHtml(job.team)}) - ${job.daysPastEnd} days past end</li>`
          )
          .join("");

  const failingUsersHtml =
    failingUsers.length === 0
      ? `<li style="margin-bottom:6px; color:#a1a1aa;">No failing users in this period.</li>`
      : failingUsers
          .map(
            (user) =>
              `<li style="margin-bottom:6px;">${escapeHtml(user.name)} (${escapeHtml(user.team)}) - ${user.grade} (${user.score})</li>`
          )
          .join("");

  const unknownCompletionHtml =
    unknownCompletion.length === 0
      ? `<li style="margin-bottom:6px; color:#a1a1aa;">No unknown completion timestamps.</li>`
      : unknownCompletion
          .map(
            (job) =>
              `<li style="margin-bottom:6px;"><strong>${escapeHtml(job.title || job.jobUid)}</strong> (${escapeHtml(job.category)})</li>`
          )
          .join("");

  const growthTableRow = (entry: ComplianceDigest["userGrowth"]["improvers"][0], isImprover: boolean) => {
    const deltaColor = isImprover ? "#22c55e" : "#ef4444";
    const deltaSign = entry.scoreDelta > 0 ? "+" : "";
    return `
      <tr>
        <td style="padding:8px; border-top:1px solid #1e1e2e;">${escapeHtml(entry.name)}</td>
        <td style="padding:8px; border-top:1px solid #1e1e2e;">${escapeHtml(entry.team)}</td>
        <td style="padding:8px; border-top:1px solid #1e1e2e;">${entry.priorGrade} &rarr; ${entry.currentGrade}</td>
        <td style="padding:8px; border-top:1px solid #1e1e2e;">${formatCompliancePercent(entry.priorOnTimePercent)} &rarr; ${formatCompliancePercent(entry.currentOnTimePercent)}</td>
        <td style="padding:8px; border-top:1px solid #1e1e2e; color:${deltaColor}; font-weight:700;">${deltaSign}${entry.scoreDelta}</td>
      </tr>
    `;
  };

  const growthTableHeaders = `
    <thead style="background:#12121a; color:#a1a1aa;">
      <tr>
        <th align="left" style="padding:8px;">Name</th>
        <th align="left" style="padding:8px;">Team</th>
        <th align="left" style="padding:8px;">Grade</th>
        <th align="left" style="padding:8px;">On-Time %</th>
        <th align="left" style="padding:8px;">Score &Delta;</th>
      </tr>
    </thead>
  `;

  const improversHtml = digest.userGrowth.improvers.length === 0
    ? `<p style="color:#a1a1aa; font-size:13px;">No significant improvements this period.</p>`
    : `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border:1px solid #1e1e2e; border-radius:8px; overflow:hidden; font-size:13px;">
        ${growthTableHeaders}
        <tbody>${digest.userGrowth.improvers.map((e) => growthTableRow(e, true)).join("")}</tbody>
      </table>`;

  const declinersHtml = digest.userGrowth.decliners.length === 0
    ? `<p style="color:#a1a1aa; font-size:13px;">No significant declines this period.</p>`
    : `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border:1px solid #1e1e2e; border-radius:8px; overflow:hidden; font-size:13px;">
        ${growthTableHeaders}
        <tbody>${digest.userGrowth.decliners.map((e) => growthTableRow(e, false)).join("")}</tbody>
      </table>`;

  const userGrowthSection = `
    <h2 style="font-size:16px; margin:18px 0 8px;">User Growth (&ge;${digest.userGrowth.threshold}pt change)</h2>
    <p style="margin:0 0 6px 0; color:#22c55e; font-size:13px;">Most Improved</p>
    ${improversHtml}
    <p style="margin:14px 0 6px 0; color:#ef4444; font-size:13px;">Biggest Declines</p>
    ${declinersHtml}
  `;

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </head>
      <body style="margin:0; padding:24px; background:#0a0a0f; color:#ffffff; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
        <div style="max-width:920px; margin:0 auto; background:#0f1118; border:1px solid #1e1e2e; border-radius:14px; overflow:hidden;">
          <div style="padding:20px 24px; border-bottom:1px solid #1e1e2e; background:linear-gradient(180deg,#151823,#0f1118);">
            <h1 style="margin:0 0 4px 0; font-size:24px; color:#f97316;">Weekly Operations Report</h1>
            <p style="margin:0; color:#a1a1aa; font-size:13px;">${periodLabel}</p>
          </div>

          <div style="padding:14px 24px 8px 24px;">
            <details style="margin:0 0 6px 0;">
              <summary style="cursor:pointer; color:#a1a1aa; font-size:12px; list-style:none;">
                <span style="text-decoration:underline;">What do these metrics mean?</span>
              </summary>
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:8px; border:1px solid #1e1e2e; border-radius:8px; overflow:hidden; font-size:12px; color:#d4d4d8;">
                <tr><td style="padding:6px 10px; border-bottom:1px solid #1e1e2e; color:#a1a1aa; width:140px;"><strong>On-Time %</strong></td><td style="padding:6px 10px; border-bottom:1px solid #1e1e2e;">Jobs completed within 1 day of their scheduled end date</td></tr>
                <tr><td style="padding:6px 10px; border-bottom:1px solid #1e1e2e; color:#a1a1aa;"><strong>OOW Usage</strong></td><td style="padding:6px 10px; border-bottom:1px solid #1e1e2e;">&ldquo;On Our Way&rdquo; status used before arriving at completed jobs</td></tr>
                <tr><td style="padding:6px 10px; border-bottom:1px solid #1e1e2e; color:#a1a1aa;"><strong>Stuck Jobs</strong></td><td style="padding:6px 10px; border-bottom:1px solid #1e1e2e;">In-progress jobs past their scheduled end (OOW / Started / In Progress)</td></tr>
                <tr><td style="padding:6px 10px; border-bottom:1px solid #1e1e2e; color:#a1a1aa;"><strong>Compliance Score</strong></td><td style="padding:6px 10px; border-bottom:1px solid #1e1e2e;">50% on-time rate + 30% not-stuck rate + 20% not-never-started rate</td></tr>
                <tr><td style="padding:6px 10px; border-bottom:1px solid #1e1e2e; color:#a1a1aa;"><strong>Grade</strong></td><td style="padding:6px 10px; border-bottom:1px solid #1e1e2e;">A &ge;90 &middot; B &ge;75 &middot; C &ge;60 &middot; D &ge;45 &middot; F &lt;45</td></tr>
                <tr><td style="padding:6px 10px; border-bottom:1px solid #1e1e2e; color:#a1a1aa;"><strong>Avg Days Late</strong></td><td style="padding:6px 10px; border-bottom:1px solid #1e1e2e;">Average days past scheduled end for late completions</td></tr>
                <tr><td style="padding:6px 10px; color:#a1a1aa;"><strong>OOW Before Start</strong></td><td style="padding:6px 10px;">Crew sent &ldquo;On Our Way&rdquo; before the scheduled start time</td></tr>
              </table>
            </details>
          </div>

          <div style="padding:0 14px 4px 14px;">
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
              <tr>
                ${metricCard("On-Time Completion", formatCompliancePercent(digest.summary.onTimePercent), onTimeTrend, onTimeBaseline)}
                ${metricCard("OOW Usage", formatCompliancePercent(digest.summary.oowUsagePercent), oowTrend, oowBaseline)}
                ${metricCard("Stuck Jobs", `${digest.summary.stuckJobs}`, stuckTrend, stuckBaseline)}
                ${metricCard("Completed Jobs", `${digest.summary.completedJobs}`, completedTrend, completedBaseline)}
              </tr>
            </table>
          </div>

          <div style="padding:0 24px 20px 24px;">
            <h2 style="font-size:16px; margin:10px 0;">Team Performance</h2>
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border:1px solid #1e1e2e; border-radius:8px; overflow:hidden; font-size:13px;">
              <thead style="background:#12121a; color:#a1a1aa;">
                <tr>
                  <th align="left" style="padding:8px;">Team</th>
                  <th align="left" style="padding:8px;">Grade</th>
                  <th align="left" style="padding:8px;">Completed</th>
                  <th align="left" style="padding:8px;">On-Time</th>
                  <th align="left" style="padding:8px;">Avg Days Late</th>
                  <th align="left" style="padding:8px;">Stuck</th>
                </tr>
              </thead>
              <tbody>${teamTableRows}</tbody>
            </table>

            <h2 style="font-size:16px; margin:18px 0 8px;">Category Performance</h2>
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border:1px solid #1e1e2e; border-radius:8px; overflow:hidden; font-size:13px;">
              <thead style="background:#12121a; color:#a1a1aa;">
                <tr>
                  <th align="left" style="padding:8px;">Category</th>
                  <th align="left" style="padding:8px;">Grade</th>
                  <th align="left" style="padding:8px;">Completed</th>
                  <th align="left" style="padding:8px;">On-Time</th>
                  <th align="left" style="padding:8px;">Avg Days Late</th>
                  <th align="left" style="padding:8px;">Stuck</th>
                </tr>
              </thead>
              <tbody>${categoryTableRows}</tbody>
            </table>

            <h2 style="font-size:16px; margin:18px 0 8px;">Notification Reliability</h2>
            <p style="margin:0 0 8px 0; font-size:13px;">
              OOW before start: <strong>${formatCompliancePercent(digest.notificationReliability.oowBeforeStartPercent)}</strong><br/>
              Started on time: <strong>${formatCompliancePercent(digest.notificationReliability.startedOnTimePercent)}</strong>
            </p>
            <ul style="padding-left:20px; margin:8px 0 0 0; font-size:13px; color:#d4d4d8;">
              ${lowOowHtml}
            </ul>

            <h2 style="font-size:16px; margin:18px 0 8px;">Callouts</h2>
            <p style="margin:0 0 6px 0; color:#f97316; font-size:13px;">Stuck jobs (&gt;3 days overdue)</p>
            <ul style="padding-left:20px; margin:0 0 10px 0; font-size:13px; color:#d4d4d8;">${stuckHtml}</ul>

            <p style="margin:0 0 6px 0; color:#f97316; font-size:13px;">Lowest-performing users</p>
            <ul style="padding-left:20px; margin:0 0 10px 0; font-size:13px; color:#d4d4d8;">${failingUsersHtml}</ul>

            <p style="margin:0 0 6px 0; color:#f97316; font-size:13px;">Unknown completion timestamps</p>
            <ul style="padding-left:20px; margin:0 0 14px 0; font-size:13px; color:#d4d4d8;">${unknownCompletionHtml}</ul>

            ${userGrowthSection}

            <a href="${escapeHtml(dashboardUrl)}" style="display:inline-block; background:#f97316; color:#111827; text-decoration:none; font-weight:700; border-radius:8px; padding:10px 14px; font-size:13px;">
              Open Full Compliance Dashboard
            </a>
          </div>
        </div>
      </body>
    </html>
  `;
}

function buildWeeklyComplianceEmailText(digest: ComplianceDigest, dashboardUrl: string): string {
  const lines: string[] = [];
  lines.push(`Weekly Operations Report (${digest.period.from} - ${digest.period.to})`);
  lines.push("");
  lines.push("Metric Definitions:");
  lines.push("  On-Time %        - Jobs completed within 1 day of scheduled end");
  lines.push("  OOW Usage        - \"On Our Way\" status used before arriving at completed jobs");
  lines.push("  Stuck Jobs       - In-progress jobs past their scheduled end");
  lines.push("  Compliance Score - 50% on-time + 30% not-stuck + 20% not-never-started");
  lines.push("  Grade            - A>=90, B>=75, C>=60, D>=45, F<45");
  lines.push("  Avg Days Late    - Average days past scheduled end for late completions");
  lines.push("  OOW Before Start - Crew sent \"On Our Way\" before scheduled start time");
  lines.push("");
  lines.push(`Total Jobs: ${digest.summary.totalJobs}`);
  lines.push(`Completed Jobs: ${digest.summary.completedJobs}`);
  lines.push(`On-Time Completion: ${formatCompliancePercent(digest.summary.onTimePercent)}`);
  lines.push(`OOW Usage: ${formatCompliancePercent(digest.summary.oowUsagePercent)}`);
  lines.push(`Stuck Jobs: ${digest.summary.stuckJobs}`);
  lines.push(`Unknown Completion Timestamps: ${digest.summary.unknownCompletionJobs}`);
  lines.push("");
  lines.push("30-Day Baseline Comparison:");
  lines.push(`  On-Time: ${formatCompliancePercent(digest.summary.onTimePercent)} (current) vs ${formatCompliancePercent(digest.baseline30Day.onTimePercent)} (30-day avg)`);
  lines.push(`  OOW Usage: ${formatCompliancePercent(digest.summary.oowUsagePercent)} vs ${formatCompliancePercent(digest.baseline30Day.oowUsagePercent)}`);
  lines.push(`  Stuck Jobs: ${digest.summary.stuckJobs} vs ${digest.baseline30Day.stuckJobs}`);
  lines.push(`  Completed: ${digest.summary.completedJobs} vs ${digest.baseline30Day.completedJobs}`);
  lines.push("");
  lines.push("Top Teams:");
  for (const team of digest.teams.slice(0, 8)) {
    lines.push(
      `- ${team.name}: grade ${team.grade}, on-time ${formatCompliancePercent(team.onTimePercent)}, completed ${team.completedJobs}, stuck ${team.stuckJobs}`
    );
  }
  lines.push("");
  lines.push("Top Categories:");
  for (const category of digest.categories.slice(0, 8)) {
    lines.push(
      `- ${category.name}: grade ${category.grade}, on-time ${formatCompliancePercent(category.onTimePercent)}, completed ${category.completedJobs}, stuck ${category.stuckJobs}`
    );
  }
  lines.push("");
  lines.push(
    `Notification Reliability: OOW before start ${formatCompliancePercent(digest.notificationReliability.oowBeforeStartPercent)}, Started on time ${formatCompliancePercent(digest.notificationReliability.startedOnTimePercent)}`
  );
  if (digest.notificationReliability.lowOowUsers.length > 0) {
    lines.push("Low OOW Users:");
    for (const user of digest.notificationReliability.lowOowUsers.slice(0, 8)) {
      lines.push(`- ${user.name} (${user.team}): ${formatCompliancePercent(user.oowPercent)}`);
    }
  }
  if (digest.callouts.stuckOver3Days.length > 0) {
    lines.push("");
    lines.push("Stuck Jobs > 3 days:");
    for (const job of digest.callouts.stuckOver3Days.slice(0, 8)) {
      lines.push(`- ${job.title || job.jobUid} (${job.team}): ${job.daysPastEnd} days past end`);
    }
  }
  if (digest.callouts.failingUsers.length > 0) {
    lines.push("");
    lines.push("Lowest-performing users:");
    for (const user of digest.callouts.failingUsers.slice(0, 8)) {
      lines.push(`- ${user.name} (${user.team}): ${user.grade} (${user.score})`);
    }
  }
  if (digest.callouts.unknownCompletionJobs.length > 0) {
    lines.push("");
    lines.push("Unknown completion timestamps:");
    for (const job of digest.callouts.unknownCompletionJobs.slice(0, 8)) {
      lines.push(`- ${job.title || job.jobUid} (${job.category})`);
    }
  }
  if (digest.userGrowth.improvers.length > 0 || digest.userGrowth.decliners.length > 0) {
    lines.push("");
    lines.push(`User Growth (>=${digest.userGrowth.threshold}pt change):`);
    if (digest.userGrowth.improvers.length > 0) {
      lines.push("  Most Improved:");
      for (const u of digest.userGrowth.improvers) {
        lines.push(`  - ${u.name} (${u.team}): ${u.priorGrade} -> ${u.currentGrade}, score +${u.scoreDelta}`);
      }
    }
    if (digest.userGrowth.decliners.length > 0) {
      lines.push("  Biggest Declines:");
      for (const u of digest.userGrowth.decliners) {
        lines.push(`  - ${u.name} (${u.team}): ${u.priorGrade} -> ${u.currentGrade}, score ${u.scoreDelta}`);
      }
    }
  }
  lines.push("");
  lines.push(`Full dashboard: ${dashboardUrl}`);
  return lines.join("\n");
}

export async function sendWeeklyComplianceEmail(
  params: SendWeeklyComplianceEmailParams
): Promise<{ success: boolean; error?: string }> {
  const appBase =
    (process.env.NEXT_PUBLIC_APP_URL || "").trim() ||
    (process.env.APP_URL || "").trim() ||
    "https://www.pbtechops.com";
  const defaultDashboardUrl = `${appBase.replace(/\/$/, "")}/dashboards/zuper-compliance`;
  const dashboardUrl = params.dashboardUrl?.trim() || defaultDashboardUrl;
  const weekLabel = `${params.digest.period.from} - ${params.digest.period.to}`;

  const html = buildWeeklyComplianceEmailHtml(params.digest, dashboardUrl);
  const text = buildWeeklyComplianceEmailText(params.digest, dashboardUrl);

  return sendEmailMessage({
    to: params.to,
    bcc: params.bcc,
    subject: `Weekly Ops Report - ${weekLabel}`,
    html,
    text,
    debugFallbackTitle: `WEEKLY COMPLIANCE REPORT for ${params.to}`,
    debugFallbackBody: text,
  });
}

/**
 * Send bug report notification email to techops
 */
interface SendBugReportEmailParams {
  reportId: string;
  title: string;
  description: string;
  pageUrl?: string;
  reporterName?: string;
  reporterEmail: string;
}

export async function sendBugReportEmail(
  params: SendBugReportEmailParams
): Promise<{ success: boolean; error?: string }> {
  const recipient = "techops@photonbrothers.com";

  const timestamp = new Date().toLocaleString("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });

  const html = await render(
    React.createElement(BugReport, {
      reportId: params.reportId,
      title: params.title,
      description: params.description,
      pageUrl: params.pageUrl,
      reporterName: params.reporterName,
      reporterEmail: params.reporterEmail,
      timestamp,
    })
  );

  return sendEmailMessage({
    to: recipient,
    subject: `Bug Report: ${params.title}`,
    html,
    text: `Bug Report: ${params.title}

${params.description}

Page: ${params.pageUrl || "N/A"}
Reported by: ${params.reporterName || "Unknown"} (${params.reporterEmail})
Time: ${timestamp}
Ticket ID: ${params.reportId}

- PB Operations`,
    debugFallbackTitle: `BUG REPORT NOTIFICATION for ${recipient}`,
    debugFallbackBody: [
      `Title: ${params.title}`,
      `Description: ${params.description}`,
      `Page: ${params.pageUrl || "N/A"}`,
      `Reporter: ${params.reporterName || "Unknown"} (${params.reporterEmail})`,
      `Time: ${timestamp}`,
    ].join("\n"),
  });
}

// ==========================================================================
// BOM Pipeline Notification
// ==========================================================================

export async function sendPipelineNotification(params: {
  dealId: string;
  dealName: string;
  status: "succeeded" | "failed" | "partial";
  soNumber?: string;
  soId?: string;
  failedStep?: string;
  errorMessage?: string;
  unmatchedCount?: number;
  unmatchedItems?: string[];
  customerMatchMethod?: string;
  designFolderUrl?: string;
  plansetFileName?: string;
  durationMs?: number;
}): Promise<SendResult> {
  const recipients = process.env.DESIGN_COMPLETE_NOTIFY_EMAILS;
  if (!recipients) {
    console.warn("[email] No DESIGN_COMPLETE_NOTIFY_EMAILS configured — skipping pipeline notification");
    return { success: true };
  }

  const toList = recipients.split(",").map((e) => e.trim()).filter(Boolean);
  if (toList.length === 0) {
    return { success: true };
  }

  const isSuccess = params.status === "succeeded";
  const isPartial = params.status === "partial";
  const isFailed = params.status === "failed";

  // ASCII-safe status indicators for subject line (avoids garbled emoji encoding)
  const subjectTag = isSuccess ? "[OK]" : isPartial ? "[WARN]" : "[FAIL]";
  const statusLabel = isSuccess ? "Succeeded" : isPartial ? "Partial" : "Failed";
  const statusColor = isSuccess ? "#16a34a" : isPartial ? "#d97706" : "#dc2626";
  const durationSec = params.durationMs ? `${(params.durationMs / 1000).toFixed(1)}s` : "N/A";

  const subject = `${subjectTag} BOM Pipeline ${statusLabel}: ${params.dealName || params.dealId}`;

  // ── Build links ──
  const hubspotDealUrl = getHubSpotDealUrl(params.dealId);
  const zohoSoUrl = params.soId ? getZohoSalesOrderUrl(params.soId) : null;

  // ── HTML email ──
  const htmlParts: string[] = [
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto">`,
    `<h2 style="color:${statusColor};margin-bottom:4px">BOM Pipeline ${statusLabel}</h2>`,
    `<p style="margin:2px 0"><strong>Deal:</strong> ${escapeHtml(params.dealName || params.dealId)}</p>`,
  ];

  // Links section
  const linkItems: string[] = [];
  linkItems.push(`<a href="${hubspotDealUrl}" style="color:#2563eb">HubSpot Deal</a>`);
  if (zohoSoUrl && params.soNumber) {
    linkItems.push(`<a href="${zohoSoUrl}" style="color:#2563eb">Zoho SO (${escapeHtml(params.soNumber)})</a>`);
  }
  if (params.designFolderUrl) {
    linkItems.push(`<a href="${escapeHtml(params.designFolderUrl)}" style="color:#2563eb">Design Folder</a>`);
  }
  htmlParts.push(`<p style="margin:8px 0">${linkItems.join(" &nbsp;|&nbsp; ")}</p>`);

  // SO + match info
  if ((isSuccess || isPartial) && params.soNumber) {
    htmlParts.push(`<p style="margin:2px 0"><strong>Sales Order:</strong> ${escapeHtml(params.soNumber)}</p>`);
  }
  if (params.customerMatchMethod) {
    htmlParts.push(`<p style="margin:2px 0"><strong>Customer Matched Via:</strong> ${escapeHtml(params.customerMatchMethod)}</p>`);
  }
  if (params.plansetFileName) {
    htmlParts.push(`<p style="margin:2px 0"><strong>Planset:</strong> ${escapeHtml(params.plansetFileName)}</p>`);
  }

  // Unmatched items
  if (params.unmatchedCount && params.unmatchedCount > 0) {
    htmlParts.push(`<p style="margin:8px 0 2px"><strong>Unmatched Items (${params.unmatchedCount}):</strong></p>`);
    if (params.unmatchedItems && params.unmatchedItems.length > 0) {
      htmlParts.push(`<ul style="margin:2px 0;padding-left:20px">`);
      for (const item of params.unmatchedItems) {
        htmlParts.push(`<li style="color:#b91c1c">${escapeHtml(item)}</li>`);
      }
      htmlParts.push(`</ul>`);
    }
  }

  // Failure details
  if (isFailed || isPartial) {
    if (params.failedStep) htmlParts.push(`<p style="margin:2px 0"><strong>Failed Step:</strong> ${escapeHtml(params.failedStep)}</p>`);
    if (params.errorMessage) htmlParts.push(`<p style="margin:2px 0;color:#dc2626"><strong>Error:</strong> ${escapeHtml(params.errorMessage)}</p>`);
  }

  htmlParts.push(`<p style="margin:8px 0 2px"><strong>Duration:</strong> ${durationSec}</p>`);
  htmlParts.push(`<hr style="border:none;border-top:1px solid #e5e7eb;margin:12px 0"/>`);
  htmlParts.push(`<p style="color:#9ca3af;font-size:12px;margin:0">Automated BOM Pipeline &mdash; PB Operations Suite</p>`);
  htmlParts.push(`</div>`);

  const html = htmlParts.join("\n");

  // ── Plain text fallback ──
  const textLines: (string | null)[] = [
    `BOM Pipeline ${statusLabel}: ${params.dealName || params.dealId}`,
    ``,
    `HubSpot Deal: ${hubspotDealUrl}`,
    zohoSoUrl && params.soNumber ? `Zoho SO: ${params.soNumber} — ${zohoSoUrl}` : null,
    params.designFolderUrl ? `Design Folder: ${params.designFolderUrl}` : null,
    ``,
    params.soNumber ? `Sales Order: ${params.soNumber}` : null,
    params.customerMatchMethod ? `Customer Matched Via: ${params.customerMatchMethod}` : null,
    params.plansetFileName ? `Planset: ${params.plansetFileName}` : null,
    params.unmatchedCount ? `Unmatched Items (${params.unmatchedCount}): ${(params.unmatchedItems ?? []).join(", ")}` : null,
    params.failedStep ? `Failed Step: ${params.failedStep}` : null,
    params.errorMessage ? `Error: ${params.errorMessage}` : null,
    `Duration: ${durationSec}`,
  ];

  const text = textLines.filter((l) => l !== null).join("\n");

  return sendEmailMessage({
    to: toList[0],
    bcc: toList.slice(1),
    subject,
    html,
    text,
    debugFallbackTitle: `PIPELINE ${statusLabel.toUpperCase()} for ${params.dealName}`,
    debugFallbackBody: text,
  });
}

/** HTML-escape user-provided values to prevent XSS in email content. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
