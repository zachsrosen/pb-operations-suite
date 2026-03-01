/**
 * Audit alert emails -- immediate alerts for HIGH/CRITICAL sessions
 * and daily digest summaries.
 *
 * Uses the same lazy-init Resend pattern as src/lib/email.ts.
 * No Prisma imports -- prisma is passed as `any` parameter.
 */

import { Resend } from "resend";
import { maskIP } from "./detect";

// ---------------------------------------------------------------------------
// Local type aliases (no Prisma imports)
// ---------------------------------------------------------------------------
export interface AlertableSession {
  id: string;
  userEmail: string | null;
  clientType: string;
  environment: string;
  ipAddress: string;
  riskScore: number;
  anomalyReasons: string[];
  startedAt: Date;
  immediateAlertSentAt: Date | null;
  criticalAlertSentAt: Date | null;
}

// ---------------------------------------------------------------------------
// Resend lazy init (matches src/lib/email.ts pattern)
// ---------------------------------------------------------------------------
let resendClient: Resend | null = null;

function getResendClient(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!resendClient) {
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const ALERT_FROM =
  process.env.ALERT_FROM_EMAIL || "alerts@photonbrothers.com";
const ADMIN_EMAILS = (process.env.AUDIT_ALERT_EMAILS || "")
  .split(",")
  .filter(Boolean);

const DASHBOARD_URL =
  process.env.NEXTAUTH_URL
    ? `${process.env.NEXTAUTH_URL}/dashboards/audit`
    : "https://ops.photonbrothers.com/dashboards/audit";

// ---------------------------------------------------------------------------
// Immediate alert (Two-Gate Dedup -- Amendment A5)
// ---------------------------------------------------------------------------

/**
 * Send an immediate email alert for HIGH or CRITICAL risk sessions.
 *
 * Two-gate dedup:
 *  - Gate 1: Fire at HIGH (riskScore >= 3) if immediateAlertSentAt IS NULL
 *  - Gate 2: Fire at CRITICAL (riskScore >= 4) if criticalAlertSentAt IS NULL
 *  - Max 2 emails per session lifetime.
 */
export async function sendImmediateAlert(
  session: AlertableSession,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any
): Promise<void> {
  if (ADMIN_EMAILS.length === 0) return;

  const resend = getResendClient();
  if (!resend) return;

  // Determine which gate to fire
  let alertLevel: "HIGH" | "CRITICAL" | null = null;
  let timestampField: "immediateAlertSentAt" | "criticalAlertSentAt" | null =
    null;

  if (session.riskScore >= 4 && !session.criticalAlertSentAt) {
    alertLevel = "CRITICAL";
    timestampField = "criticalAlertSentAt";
  } else if (session.riskScore >= 3 && !session.immediateAlertSentAt) {
    alertLevel = "HIGH";
    timestampField = "immediateAlertSentAt";
  }

  if (!alertLevel || !timestampField) return;

  // Mark sent BEFORE sending (prevent double-fire on concurrent requests)
  await prisma.auditSession.update({
    where: { id: session.id },
    data: { [timestampField]: new Date() },
  });

  const subject = `[${alertLevel}] Audit Alert: ${session.userEmail || "Unknown User"} — ${session.environment}`;

  const html = buildImmediateAlertHtml(session, alertLevel);

  await resend.emails.send({
    from: ALERT_FROM,
    to: ADMIN_EMAILS,
    subject,
    html,
  });
}

function buildImmediateAlertHtml(
  session: AlertableSession,
  alertLevel: "HIGH" | "CRITICAL"
): string {
  const borderColor = alertLevel === "CRITICAL" ? "#dc2626" : "#f59e0b";
  const labelColor = alertLevel === "CRITICAL" ? "#dc2626" : "#d97706";

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="border-left: 4px solid ${borderColor}; padding: 16px; margin-bottom: 16px;">
        <h2 style="margin: 0 0 4px 0; color: ${labelColor};">${alertLevel} Risk Session Detected</h2>
        <p style="margin: 0; color: #6b7280; font-size: 14px;">PB Operations Suite Audit System</p>
      </div>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <tr style="border-bottom: 1px solid #e5e7eb;">
          <td style="padding: 8px 12px; font-weight: 600; color: #374151; width: 160px;">User</td>
          <td style="padding: 8px 12px; color: #111827;">${session.userEmail || "Unknown"}</td>
        </tr>
        <tr style="border-bottom: 1px solid #e5e7eb;">
          <td style="padding: 8px 12px; font-weight: 600; color: #374151;">Client Type</td>
          <td style="padding: 8px 12px; color: #111827;">${session.clientType}</td>
        </tr>
        <tr style="border-bottom: 1px solid #e5e7eb;">
          <td style="padding: 8px 12px; font-weight: 600; color: #374151;">Environment</td>
          <td style="padding: 8px 12px; color: #111827;">${session.environment}</td>
        </tr>
        <tr style="border-bottom: 1px solid #e5e7eb;">
          <td style="padding: 8px 12px; font-weight: 600; color: #374151;">IP Address</td>
          <td style="padding: 8px 12px; color: #111827;">${maskIP(session.ipAddress)}</td>
        </tr>
        <tr style="border-bottom: 1px solid #e5e7eb;">
          <td style="padding: 8px 12px; font-weight: 600; color: #374151;">Anomaly Reasons</td>
          <td style="padding: 8px 12px; color: #111827;">${session.anomalyReasons.join(", ") || "None"}</td>
        </tr>
        <tr style="border-bottom: 1px solid #e5e7eb;">
          <td style="padding: 8px 12px; font-weight: 600; color: #374151;">Session Started</td>
          <td style="padding: 8px 12px; color: #111827;">${session.startedAt.toISOString()}</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; font-weight: 600; color: #374151;">Risk Score</td>
          <td style="padding: 8px 12px; color: ${labelColor}; font-weight: 700;">${session.riskScore} / 4</td>
        </tr>
      </table>
      <div style="margin-top: 20px;">
        <a href="${DASHBOARD_URL}" style="display: inline-block; padding: 10px 20px; background: ${borderColor}; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 600;">View Audit Dashboard</a>
      </div>
      <p style="margin-top: 16px; color: #9ca3af; font-size: 12px;">Session ID: ${session.id}</p>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Daily Digest (Amendment A7 -- Atomic Idempotency)
// ---------------------------------------------------------------------------

interface DigestResult {
  sent: boolean;
  reason?: string;
}

/**
 * Send a daily digest email summarizing the last 24 hours of audit activity.
 *
 * Uses atomic SQL UPDATE for idempotency -- only one instance can send
 * per 20-hour window.
 */
export async function sendDailyDigest(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma?: any
): Promise<DigestResult> {
  // Allow prisma to be passed or fall back to dynamic import
  if (!prisma) {
    const { default: db } = await import("@/lib/prisma");
    prisma = db;
  }

  if (ADMIN_EMAILS.length === 0) {
    return { sent: false, reason: "no admin emails configured" };
  }

  const resend = getResendClient();
  if (!resend) {
    return { sent: false, reason: "resend not configured" };
  }

  // Ensure row exists (first-ever run)
  await prisma.systemConfig.upsert({
    where: { key: "lastDigestSentAt" },
    update: {},
    create: { key: "lastDigestSentAt", value: new Date(0).toISOString() },
  });

  // Atomic lock -- only one instance can send per 20-hour window
  const twentyHoursAgo = new Date(Date.now() - 20 * 60 * 60 * 1000);
  const lockAcquired = await prisma.$executeRaw`
    UPDATE "SystemConfig"
    SET value = ${new Date().toISOString()}, "updatedAt" = NOW()
    WHERE key = 'lastDigestSentAt'
      AND (value::timestamptz < ${twentyHoursAgo} OR value IS NULL)
  `;

  if (lockAcquired === 0) {
    return { sent: false, reason: "digest recently sent" };
  }

  // Query stats for last 24 hours
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const totalSessions: number = await prisma.auditSession.count({
    where: { startedAt: { gte: since } },
  });

  const anomalySessions: number = await prisma.auditSession.count({
    where: { startedAt: { gte: since }, riskScore: { gte: 2 } },
  });

  const envBreakdown: Array<{ environment: string; _count: { id: number } }> =
    await prisma.auditSession.groupBy({
      by: ["environment"],
      where: { startedAt: { gte: since } },
      _count: { id: true },
    });

  const subject = `Audit Digest: ${totalSessions} sessions, ${anomalySessions} anomalies (last 24h)`;
  const html = buildDigestHtml(totalSessions, anomalySessions, envBreakdown);

  await resend.emails.send({
    from: ALERT_FROM,
    to: ADMIN_EMAILS,
    subject,
    html,
  });

  return { sent: true };
}

function buildDigestHtml(
  totalSessions: number,
  anomalySessions: number,
  envBreakdown: Array<{ environment: string; _count: { id: number } }>
): string {
  const envRows = envBreakdown
    .map(
      (e) => `
      <tr style="border-bottom: 1px solid #e5e7eb;">
        <td style="padding: 8px 12px; color: #111827;">${e.environment}</td>
        <td style="padding: 8px 12px; color: #111827; text-align: right;">${e._count.id}</td>
      </tr>`
    )
    .join("");

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="border-left: 4px solid #3b82f6; padding: 16px; margin-bottom: 16px;">
        <h2 style="margin: 0 0 4px 0; color: #1d4ed8;">Daily Audit Digest</h2>
        <p style="margin: 0; color: #6b7280; font-size: 14px;">PB Operations Suite — Last 24 Hours</p>
      </div>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 16px;">
        <tr style="border-bottom: 1px solid #e5e7eb;">
          <td style="padding: 8px 12px; font-weight: 600; color: #374151; width: 200px;">Total Sessions</td>
          <td style="padding: 8px 12px; color: #111827; text-align: right;">${totalSessions}</td>
        </tr>
        <tr style="border-bottom: 1px solid #e5e7eb;">
          <td style="padding: 8px 12px; font-weight: 600; color: #374151;">Anomaly Sessions (risk >= 2)</td>
          <td style="padding: 8px 12px; color: ${anomalySessions > 0 ? "#dc2626" : "#111827"}; font-weight: ${anomalySessions > 0 ? "700" : "400"}; text-align: right;">${anomalySessions}</td>
        </tr>
      </table>
      ${
        envBreakdown.length > 0
          ? `
        <h3 style="margin: 16px 0 8px 0; color: #374151; font-size: 14px;">Sessions by Environment</h3>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr style="border-bottom: 2px solid #d1d5db;">
            <th style="padding: 8px 12px; text-align: left; color: #6b7280; font-weight: 600;">Environment</th>
            <th style="padding: 8px 12px; text-align: right; color: #6b7280; font-weight: 600;">Sessions</th>
          </tr>
          ${envRows}
        </table>`
          : ""
      }
      <div style="margin-top: 20px;">
        <a href="${DASHBOARD_URL}" style="display: inline-block; padding: 10px 20px; background: #3b82f6; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 600;">View Audit Dashboard</a>
      </div>
      <p style="margin-top: 16px; color: #9ca3af; font-size: 12px;">This is an automated daily digest from the PB Operations Suite audit system.</p>
    </div>
  `;
}
