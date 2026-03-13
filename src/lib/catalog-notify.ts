// src/lib/catalog-notify.ts
// Shared admin email notification for new PendingCatalogPush records.
import { Resend } from "resend";

const ADMIN_EMAILS = (process.env.AUDIT_ALERT_EMAILS || "")
  .split(",")
  .filter(Boolean);

let _resend: Resend | null = null;
function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

export interface CatalogPushNotification {
  id: string;
  brand: string;
  model: string;
  category: string;
  requestedBy: string | null;
  systems: string[];
  dealId?: string | null;
}

/**
 * Fire-and-forget email to admins when a new PendingCatalogPush is created.
 * Safe to call without awaiting — logs errors internally.
 */
export function notifyAdminsOfNewCatalogRequest(push: CatalogPushNotification): void {
  if (ADMIN_EMAILS.length === 0) return;
  const resend = getResend();
  if (!resend) return;

  const dashboardUrl = process.env.NEXTAUTH_URL
    ? `${process.env.NEXTAUTH_URL}/dashboards/catalog`
    : "https://ops.photonbrothers.com/dashboards/catalog";

  const systemsList = push.systems.join(", ");
  const subject = `New Catalog Request: ${push.brand} ${push.model}`;
  const html = `
    <div style="font-family: sans-serif; max-width: 600px;">
      <h2 style="margin-bottom: 4px;">New Product Catalog Request</h2>
      <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
        <tr><td style="padding: 6px 12px; font-weight: 600;">Brand</td><td style="padding: 6px 12px;">${push.brand}</td></tr>
        <tr><td style="padding: 6px 12px; font-weight: 600;">Model</td><td style="padding: 6px 12px;">${push.model}</td></tr>
        <tr><td style="padding: 6px 12px; font-weight: 600;">Category</td><td style="padding: 6px 12px;">${push.category}</td></tr>
        <tr><td style="padding: 6px 12px; font-weight: 600;">Target Systems</td><td style="padding: 6px 12px;">${systemsList}</td></tr>
        <tr><td style="padding: 6px 12px; font-weight: 600;">Requested By</td><td style="padding: 6px 12px;">${push.requestedBy ?? "Unknown"}</td></tr>
        ${push.dealId ? `<tr><td style="padding: 6px 12px; font-weight: 600;">Deal ID</td><td style="padding: 6px 12px;">${push.dealId}</td></tr>` : ""}
      </table>
      <a href="${dashboardUrl}" style="display: inline-block; padding: 10px 20px; background: #f97316; color: white; text-decoration: none; border-radius: 6px;">
        Review in Dashboard
      </a>
    </div>
  `;

  resend.emails
    .send({
      from: process.env.RESEND_FROM || "PB Ops <ops@photonbrothers.com>",
      to: ADMIN_EMAILS,
      subject,
      html,
    })
    .catch(() => {
      console.error("[catalog] Failed to send admin notification email");
    });
}
