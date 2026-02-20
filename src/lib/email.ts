import crypto from "crypto";
import { Resend } from "resend";
import type { UpdateEntry } from "@/lib/product-updates";

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
  return sendEmailMessage({
    to,
    subject: "Your PB Operations Login Code",
    html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0a0a0f; color: #ffffff; padding: 40px 20px; margin: 0;">
            <div style="max-width: 400px; margin: 0 auto; background-color: #12121a; border: 1px solid #1e1e2e; border-radius: 12px; padding: 32px;">
              <h1 style="font-size: 24px; font-weight: bold; background: linear-gradient(to right, #f97316, #fb923c); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin: 0 0 8px 0; text-align: center;">
                PB Operations Suite
              </h1>
              <p style="color: #71717a; font-size: 14px; text-align: center; margin: 0 0 32px 0;">
                Your login verification code
              </p>

              <div style="background-color: #0a0a0f; border: 1px solid #1e1e2e; border-radius: 8px; padding: 24px; text-align: center; margin-bottom: 24px;">
                <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #ffffff; font-family: monospace;">
                  ${code}
                </span>
              </div>

              <p style="color: #71717a; font-size: 13px; text-align: center; margin: 0 0 8px 0;">
                This code expires in 10 minutes.
              </p>
              <p style="color: #52525b; font-size: 12px; text-align: center; margin: 0;">
                If you didn't request this code, you can safely ignore this email.
              </p>
            </div>

            <p style="color: #3f3f46; font-size: 11px; text-align: center; margin-top: 24px;">
              Photon Brothers Operations Suite
            </p>
          </body>
        </html>
      `,
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

  return sendEmailMessage({
    to: params.to,
    bcc: bccRecipients,
    subject: `New ${appointmentTypeLabel} Scheduled - ${params.customerName}`,
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
                New Appointment Scheduled
              </p>

              <div style="background-color: #0a0a0f; border: 1px solid #1e1e2e; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
                <div style="display: flex; align-items: center; margin-bottom: 16px;">
                  <span style="background: linear-gradient(to right, #f97316, #fb923c); color: white; padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: 600; text-transform: uppercase;">
                    ${appointmentTypeLabel}
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
                  <tr>
                    <td style="color: #71717a; font-size: 13px; padding: 8px 0;">👤 Scheduled by</td>
                    <td style="color: #ffffff; font-size: 13px; padding: 8px 0; text-align: right;">${params.scheduledByName}</td>
                  </tr>
                  ${params.dealOwnerName ? `
                  <tr>
                    <td style="color: #71717a; font-size: 13px; padding: 8px 0;">🧑‍💼 Deal owner</td>
                    <td style="color: #ffffff; font-size: 13px; padding: 8px 0; text-align: right;">${params.dealOwnerName}</td>
                  </tr>
                  ` : ""}
                  ${installDetailsHtml}
                  ${cleanedNotes ? `
                  <tr>
                    <td colspan="2" style="padding-top: 16px;">
                      <div style="background-color: #1e1e2e; border-radius: 6px; padding: 12px;">
                        <p style="color: #71717a; font-size: 12px; margin: 0 0 4px 0;">📝 Notes</p>
                        <p style="color: #ffffff; font-size: 13px; margin: 0;">${cleanedNotes}</p>
                      </div>
                    </td>
                  </tr>
                  ` : ""}
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
      `Type: ${appointmentTypeLabel}`,
      `Customer: ${params.customerName}`,
      `Address: ${params.customerAddress}`,
      `Date: ${formattedDate}`,
      `Time: ${timeSlot}`,
      `Install Details: ${installDetailLines.length > 0 ? installDetailLines.join(" | ") : "None"}`,
      `Notes: ${cleanedNotes || "None"}`,
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

  return sendEmailMessage({
    to: params.to,
    ...(bccRecipients.length > 0 ? { bcc: bccRecipients } : {}),
    subject,
    html: `
      <!DOCTYPE html>
      <html>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0a0a0f; color: #ffffff; padding: 24px; margin: 0;">
          <div style="max-width: 760px; margin: 0 auto; background-color: #12121a; border: 1px solid #1e1e2e; border-radius: 12px; padding: 24px;">
            <h2 style="margin: 0 0 8px 0; font-size: 22px;">Availability Conflict Alert</h2>
            <p style="color: #a1a1aa; font-size: 13px; margin: 0 0 20px 0;">
              ${recipientName}, ${params.surveyorName} added an availability block that overlaps existing scheduled site surveys.
            </p>

            <div style="background-color: #1e1e2e; border-radius: 8px; padding: 12px; margin-bottom: 16px;">
              <p style="margin: 0 0 6px 0; font-size: 13px; color: #e4e4e7;"><strong>Blocked By:</strong> ${params.blockedByName}${params.blockedByEmail ? ` (${params.blockedByEmail})` : ""}</p>
              <p style="margin: 0 0 6px 0; font-size: 13px; color: #e4e4e7;"><strong>Surveyor:</strong> ${params.surveyorName}</p>
              <p style="margin: 0 0 6px 0; font-size: 13px; color: #e4e4e7;"><strong>Override:</strong> ${params.overrideType === "custom" ? "Time Range" : "Full Day"} on ${overrideDate} (${overrideWindow})</p>
              ${params.overrideReason ? `<p style="margin: 0; font-size: 13px; color: #e4e4e7;"><strong>Reason:</strong> ${params.overrideReason}</p>` : ""}
            </div>

            <table style="width: 100%; border-collapse: collapse;">
              <thead>
                <tr>
                  <th style="text-align: left; color: #71717a; font-size: 11px; padding-bottom: 6px;">Customer</th>
                  <th style="text-align: left; color: #71717a; font-size: 11px; padding-bottom: 6px;">Address</th>
                  <th style="text-align: left; color: #71717a; font-size: 11px; padding-bottom: 6px;">Date</th>
                  <th style="text-align: left; color: #71717a; font-size: 11px; padding-bottom: 6px;">Time</th>
                  <th style="text-align: left; color: #71717a; font-size: 11px; padding-bottom: 6px;">Project</th>
                </tr>
              </thead>
              <tbody>
                ${conflictRowsHtml}
              </tbody>
            </table>

            <p style="margin-top: 18px; color: #a1a1aa; font-size: 12px;">
              Please review and reschedule/cancel impacted surveys as needed.
            </p>
          </div>
        </body>
      </html>
    `,
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

  return sendEmailMessage({
    to: params.to,
    subject: `PB Operations Update ${params.update.version} - ${params.update.title}`,
    html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0a0a0f; color: #ffffff; padding: 40px 20px; margin: 0;">
            <div style="max-width: 620px; margin: 0 auto; background-color: #12121a; border: 1px solid #1e1e2e; border-radius: 12px; padding: 32px;">
              <h1 style="font-size: 24px; font-weight: bold; background: linear-gradient(to right, #f97316, #fb923c); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin: 0 0 8px 0; text-align: center;">
                PB Operations Suite
              </h1>
              <p style="color: #71717a; font-size: 14px; text-align: center; margin: 0 0 24px 0;">
                Product Update Published
              </p>

              <div style="background-color: #0a0a0f; border: 1px solid #1e1e2e; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
                <p style="margin: 0 0 8px 0; color: #fb923c; font-weight: 700;">v${params.update.version}</p>
                <h2 style="margin: 0 0 8px 0; font-size: 20px; color: #ffffff;">${params.update.title}</h2>
                <p style="margin: 0 0 16px 0; color: #a1a1aa; font-size: 13px;">${formattedDate}</p>
                <p style="margin: 0 0 16px 0; color: #e4e4e7; font-size: 14px; line-height: 1.5;">${params.update.description}</p>
                <ul style="margin: 0; padding-left: 20px; color: #e4e4e7; font-size: 13px; line-height: 1.5;">
                  ${changesHtml}
                </ul>
              </div>

              <p style="margin: 0; text-align: center;">
                <a href="${updatesUrl}" style="display: inline-block; background: linear-gradient(to right, #f97316, #fb923c); color: #ffffff; text-decoration: none; font-weight: 600; padding: 10px 16px; border-radius: 8px;">
                  View Full Changelog
                </a>
              </p>
            </div>

            <p style="color: #3f3f46; font-size: 11px; text-align: center; margin-top: 24px;">
              Photon Brothers Operations Suite
            </p>
          </body>
        </html>
      `,
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

  return sendEmailMessage({
    to: recipient,
    subject: `Bug Report: ${params.title}`,
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
                New Bug Report Submitted
              </p>

              <div style="background-color: #0a0a0f; border: 1px solid #1e1e2e; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
                <div style="margin-bottom: 16px;">
                  <span style="background: #dc2626; color: white; padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: 600; text-transform: uppercase;">
                    Bug Report
                  </span>
                </div>

                <h2 style="font-size: 18px; color: #ffffff; margin: 0 0 16px 0;">
                  ${params.title}
                </h2>

                <div style="background-color: #1e1e2e; border-radius: 6px; padding: 12px; margin-bottom: 16px;">
                  <p style="color: #ffffff; font-size: 13px; margin: 0; white-space: pre-wrap;">${params.description}</p>
                </div>

                <table style="width: 100%; border-collapse: collapse;">
                  ${params.pageUrl ? `
                  <tr>
                    <td style="color: #71717a; font-size: 13px; padding: 8px 0; border-bottom: 1px solid #1e1e2e;">Page</td>
                    <td style="color: #60a5fa; font-size: 13px; padding: 8px 0; border-bottom: 1px solid #1e1e2e; text-align: right; word-break: break-all;">${params.pageUrl}</td>
                  </tr>
                  ` : ""}
                  <tr>
                    <td style="color: #71717a; font-size: 13px; padding: 8px 0; border-bottom: 1px solid #1e1e2e;">Reported by</td>
                    <td style="color: #ffffff; font-size: 13px; padding: 8px 0; border-bottom: 1px solid #1e1e2e; text-align: right;">${params.reporterName || params.reporterEmail}</td>
                  </tr>
                  <tr>
                    <td style="color: #71717a; font-size: 13px; padding: 8px 0; border-bottom: 1px solid #1e1e2e;">Email</td>
                    <td style="color: #ffffff; font-size: 13px; padding: 8px 0; border-bottom: 1px solid #1e1e2e; text-align: right;">${params.reporterEmail}</td>
                  </tr>
                  <tr>
                    <td style="color: #71717a; font-size: 13px; padding: 8px 0;">Time</td>
                    <td style="color: #ffffff; font-size: 13px; padding: 8px 0; text-align: right;">${timestamp}</td>
                  </tr>
                </table>
              </div>

              <p style="color: #71717a; font-size: 12px; text-align: center; margin: 0;">
                Ticket ID: ${params.reportId}
              </p>
            </div>

            <p style="color: #3f3f46; font-size: 11px; text-align: center; margin-top: 24px;">
              Photon Brothers Operations Suite
            </p>
          </body>
        </html>
      `,
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
