import crypto from "crypto";
import { render } from "@react-email/render";
import { Resend } from "resend";
import type { UpdateEntry } from "@/lib/product-updates";
import { VerificationCode } from "@/emails/VerificationCode";
import { SchedulingNotification } from "@/emails/SchedulingNotification";
import { AvailabilityConflict } from "@/emails/AvailabilityConflict";
import { ProductUpdate } from "@/emails/ProductUpdate";
import { BugReport } from "@/emails/BugReport";
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
  return input
    .split(/[,\n;]+/)
    .map((value) => parseEmailAddress(value))
    .filter((value): value is string => !!value);
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
    .map((value) => value.replace(/[\r\n]+/g, " ").trim())
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
  to: string;
  bcc?: string[];
  subject: string;
  html: string;
  text: string;
  debugFallbackTitle: string;
  debugFallbackBody: string;
}): Promise<SendResult> {
  const senderEmail = getGoogleWorkspaceSenderEmail();
  const defaultFrom = senderEmail
    ? `PB Operations <${senderEmail}>`
    : "PB Operations <noreply@photonbrothers.com>";
  const from = process.env.EMAIL_FROM || defaultFrom;

  const googleResult = await trySendWithGoogleWorkspace({
    to: params.to,
    bcc: params.bcc,
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
        to: [params.to],
        ...(params.bcc && params.bcc.length > 0 ? { bcc: params.bcc } : {}),
        subject: params.subject,
        html: params.html,
        text: params.text,
      });

      if (error) {
        return { success: false, error: error.message };
      }

      console.log(`[email] Sent via Resend to ${params.to}`);
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
  dealOwnerName?: string | null;
  appointmentType: "survey" | "installation" | "inspection";
  customerName: string;
  customerAddress: string;
  scheduledDate: string; // YYYY-MM-DD
  scheduledStart?: string; // HH:mm
  scheduledEnd?: string; // HH:mm
  projectId: string;
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
  const defaultBcc = parseEmailList(process.env.SCHEDULING_NOTIFICATION_BCC);
  const explicitBcc =
    typeof params.bcc === "string"
      ? parseEmailList(params.bcc)
      : Array.isArray(params.bcc)
        ? params.bcc.map((value) => parseEmailAddress(value)).filter((value): value is string => !!value)
        : [];
  const bccRecipients = dedupeEmails([...defaultBcc, ...explicitBcc], params.to);
  const installDetails = params.appointmentType === "installation" ? params.installDetails : undefined;
  const cleanedNotes = sanitizeScheduleEmailNotes(params.notes);
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

  const installDetailsHtml = installDetailLines.length > 0
    ? `
                  <tr>
                    <td colspan="2" style="padding-top: 16px;">
                      <div style="background-color: #1e1e2e; border-radius: 6px; padding: 12px;">
                        <p style="color: #71717a; font-size: 12px; margin: 0 0 6px 0;">🔧 Install Details</p>
                        <p style="color: #ffffff; font-size: 13px; margin: 0; white-space: pre-line;">${installDetailLines.join("\n")}</p>
                      </div>
                    </td>
                  </tr>
                `
    : "";

  const html = await render(
    React.createElement(SchedulingNotification, {
      crewMemberName: params.crewMemberName,
      scheduledByName: params.scheduledByName,
      scheduledByEmail: params.scheduledByEmail,
      dealOwnerName: params.dealOwnerName,
      appointmentTypeLabel,
      customerName: params.customerName,
      customerAddress: params.customerAddress,
      formattedDate,
      timeSlot,
      notes: cleanedNotes,
      installDetailLines: installDetailLines.length > 0 ? installDetailLines : undefined,
    })
  );

  return sendEmailMessage({
    to: params.to,
    ...(bccRecipients.length > 0 ? { bcc: bccRecipients } : {}),
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
${params.dealOwnerName ? `Deal owner: ${params.dealOwnerName}\n` : ""}
${installDetailLines.length > 0 ? `\nInstall Details:\n${installDetailLines.join("\n")}` : ""}
${cleanedNotes ? `\nNotes: ${cleanedNotes}` : ""}

Please check your Zuper app for complete details.

- PB Operations`,
    debugFallbackTitle: `SCHEDULING NOTIFICATION for ${params.to}`,
    debugFallbackBody: [
      `Crew Member: ${params.crewMemberName}`,
      `Scheduled By: ${params.scheduledByName} (${params.scheduledByEmail})`,
      `Deal Owner: ${params.dealOwnerName || "N/A"}`,
      `BCC: ${bccRecipients.length > 0 ? bccRecipients.join(", ") : "None"}`,
      `Type: ${appointmentTypeLabel}`,
      `Customer: ${params.customerName}`,
      `Address: ${params.customerAddress}`,
      `Date: ${formattedDate}`,
      `Time: ${timeSlot}`,
      `Install Details: ${installDetailLines.length > 0 ? installDetailLines.join(" | ") : "None"}`,
      `Notes: ${cleanedNotes || "None"}`,
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
