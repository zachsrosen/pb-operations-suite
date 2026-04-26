// src/lib/catalog-notify.ts
// Shared admin email notification for new PendingCatalogPush records.
// Uses the central sendEmailMessage (Google Workspace → Resend fallback).
import { sendEmailMessage } from "@/lib/email";

const ADMIN_EMAILS = (process.env.AUDIT_ALERT_EMAILS || "")
  .split(",")
  .filter(Boolean);

export interface CatalogPushNotification {
  id: string;
  brand: string;
  model: string;
  category: string;
  requestedBy: string | null;
  systems: string[];
  dealId?: string | null;
}

export interface CatalogApprovalWarning {
  id: string;
  brand: string;
  model: string;
  category: string;
  /** Per-system warnings keyed by system name, e.g. { HUBSPOT: ["manufacturer skipped..."] } */
  systemWarnings: Record<string, string[]>;
}

/**
 * Fire-and-forget email to admins when an approval succeeded with warnings
 * (e.g. some fields were skipped due to validation errors).
 */
export function notifyAdminsOfApprovalWarnings(data: CatalogApprovalWarning): void {
  if (ADMIN_EMAILS.length === 0) return;

  const dashboardUrl = process.env.NEXTAUTH_URL
    ? `${process.env.NEXTAUTH_URL}/dashboards/catalog?tab=pending`
    : "https://pbtechops.com/dashboards/catalog?tab=pending";

  const warningRows = Object.entries(data.systemWarnings)
    .flatMap(([system, warnings]) =>
      warnings.map(
        (w) =>
          `<tr><td style="padding: 6px 12px; font-weight: 600; color: #d97706;">${system}</td><td style="padding: 6px 12px;">${w}</td></tr>`
      )
    )
    .join("");

  const subject = `Catalog Approval Warning: ${data.brand} ${data.model}`;
  const html = `
    <div style="font-family: sans-serif; max-width: 600px;">
      <h2 style="margin-bottom: 4px; color: #d97706;">Product Approved with Warnings</h2>
      <p>The product <strong>${data.brand} ${data.model}</strong> (${data.category}) was approved, but some fields were skipped during sync.</p>
      <table style="border-collapse: collapse; width: 100%; margin: 16px 0; border: 1px solid #fbbf24;">
        <tr style="background: #fef3c7;"><th style="padding: 8px 12px; text-align: left;">System</th><th style="padding: 8px 12px; text-align: left;">Warning</th></tr>
        ${warningRows}
      </table>
      <p style="color: #78716c; font-size: 14px;">These fields may need to be added manually in the target system, or the system's allowed values may need updating.</p>
      <a href="${dashboardUrl}" style="display: inline-block; padding: 10px 20px; background: #f97316; color: white; text-decoration: none; border-radius: 6px;">
        Review in Dashboard
      </a>
    </div>
  `;

  sendEmailMessage({
    to: ADMIN_EMAILS,
    subject,
    html,
    text: `Catalog Approval Warning: ${data.brand} ${data.model}. Some fields were skipped during sync.`,
    debugFallbackTitle: "Catalog Approval Warning",
    debugFallbackBody: `${data.brand} ${data.model} approved with warnings`,
  })
    .then((result) => {
      if (result.success) {
        console.log(`[catalog] Warning notification sent for ${data.brand} ${data.model}`);
      } else {
        console.error(`[catalog] Failed to send warning notification: ${result.error}`);
      }
    })
    .catch((err) => {
      console.error(`[catalog] Failed to send warning notification: ${err instanceof Error ? err.message : String(err)}`);
    });
}

/**
 * Fire-and-forget email to admins when a new PendingCatalogPush is created.
 * Safe to call without awaiting — logs errors internally.
 */
export function notifyAdminsOfNewCatalogRequest(push: CatalogPushNotification): void {
  if (ADMIN_EMAILS.length === 0) {
    console.warn("[catalog] AUDIT_ALERT_EMAILS not configured — skipping notification");
    return;
  }

  const dashboardUrl = process.env.NEXTAUTH_URL
    ? `${process.env.NEXTAUTH_URL}/dashboards/catalog?tab=pending`
    : "https://pbtechops.com/dashboards/catalog?tab=pending";

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

  sendEmailMessage({
    to: ADMIN_EMAILS,
    subject,
    html,
    text: `New Catalog Request: ${push.brand} ${push.model} (${push.category}) — ${systemsList}. Requested by ${push.requestedBy ?? "Unknown"}.`,
    debugFallbackTitle: "New Catalog Request",
    debugFallbackBody: `${push.brand} ${push.model} (${push.category})`,
  })
    .then((result) => {
      if (result.success) {
        console.log(`[catalog] Admin notification sent for ${push.brand} ${push.model} to ${ADMIN_EMAILS.join(", ")}`);
      } else {
        console.error(`[catalog] Failed to send admin notification: ${result.error}`);
      }
    })
    .catch((err) => {
      console.error(`[catalog] Failed to send admin notification: ${err instanceof Error ? err.message : String(err)}`);
    });
}

// ── TechOps notification: brand auto-added to HubSpot manufacturer enum ────

const TECH_OPS_EMAILS = (process.env.TECH_OPS_REQUESTS_EMAIL || "techops@photonbrothers.com")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export interface AutoAddedBrandNotification {
  brand: string;
  productName: string | null;
  productSku: string | null;
  productCategory: string | null;
  triggeredAt: string;  // ISO timestamp
}

/**
 * Fire-and-forget email to TechOps when a new brand is auto-added to HubSpot's
 * manufacturer enum (Phase D behavior). Lets ops review additions periodically
 * to catch typos before they pollute the enum.
 *
 * Recipients: TECH_OPS_REQUESTS_EMAIL env var (comma-separated), defaulting
 * to techops@photonbrothers.com.
 */
export function notifyTechOpsOfAutoAddedBrand(data: AutoAddedBrandNotification): void {
  if (TECH_OPS_EMAILS.length === 0) return;

  const hubspotPropertyUrl = process.env.HUBSPOT_PORTAL_ID
    ? `https://app.hubspot.com/property-settings/${process.env.HUBSPOT_PORTAL_ID}/properties?type=0-7&action=edit&property=manufacturer`
    : "https://app.hubspot.com/property-settings";

  const subject = `HubSpot brand auto-added: "${data.brand}"`;
  const html = `
    <div style="font-family: sans-serif; max-width: 600px;">
      <h2 style="margin-bottom: 4px; color: #2563eb;">New brand auto-added to HubSpot manufacturer enum</h2>
      <p>The brand <strong>${data.brand}</strong> was just added to HubSpot's Products → Manufacturer enum because a product was submitted with it and the value wasn't recognized.</p>
      <p><strong>Please review</strong> to confirm this isn't a typo. If it is, edit the product to use the correct brand and remove the new enum value via HubSpot Settings.</p>
      <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
        <tr><td style="padding: 6px 12px; font-weight: 600;">Brand added</td><td style="padding: 6px 12px;"><code>${data.brand}</code></td></tr>
        <tr><td style="padding: 6px 12px; font-weight: 600;">Triggered by product</td><td style="padding: 6px 12px;">${data.productName || "(no name)"}</td></tr>
        ${data.productSku ? `<tr><td style="padding: 6px 12px; font-weight: 600;">Product SKU</td><td style="padding: 6px 12px;">${data.productSku}</td></tr>` : ""}
        ${data.productCategory ? `<tr><td style="padding: 6px 12px; font-weight: 600;">Product Category</td><td style="padding: 6px 12px;">${data.productCategory}</td></tr>` : ""}
        <tr><td style="padding: 6px 12px; font-weight: 600;">When</td><td style="padding: 6px 12px;">${data.triggeredAt}</td></tr>
      </table>
      <a href="${hubspotPropertyUrl}" style="display: inline-block; padding: 10px 20px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px;">
        Review in HubSpot Property Settings
      </a>
      <p style="color: #78716c; font-size: 12px; margin-top: 24px;">Sent automatically by the catalog sync — no action needed unless this looks like a typo.</p>
    </div>
  `;

  sendEmailMessage({
    to: TECH_OPS_EMAILS,
    subject,
    html,
    text: `HubSpot brand auto-added: "${data.brand}". Triggered by product "${data.productName || ""}" (${data.productCategory || "?"}). Please review to confirm it's not a typo.`,
    debugFallbackTitle: "HubSpot brand auto-added",
    debugFallbackBody: `${data.brand} added to HubSpot manufacturer enum`,
  })
    .then((result) => {
      if (result.success) {
        console.log(`[catalog] TechOps notified of auto-added brand "${data.brand}" → ${TECH_OPS_EMAILS.join(", ")}`);
      } else {
        console.error(`[catalog] Failed to send TechOps brand-add notification: ${result.error}`);
      }
    })
    .catch((err) => {
      console.error(`[catalog] Failed to send TechOps brand-add notification: ${err instanceof Error ? err.message : String(err)}`);
    });
}
