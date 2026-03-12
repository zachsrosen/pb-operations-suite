// src/app/api/catalog/push-requests/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { prisma } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";
import { FORM_CATEGORIES } from "@/lib/catalog-fields";

// ---------------------------------------------------------------------------
// Admin notification for new catalog requests
// ---------------------------------------------------------------------------
const ADMIN_EMAILS = (process.env.AUDIT_ALERT_EMAILS || "")
  .split(",")
  .filter(Boolean);

let _resend: Resend | null = null;
function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

async function notifyAdminsOfNewRequest(push: {
  id: string;
  brand: string;
  model: string;
  category: string;
  requestedBy: string | null;
  systems: string[];
  dealId: string | null;
}) {
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

  try {
    await resend.emails.send({
      from: process.env.RESEND_FROM || "PB Ops <ops@photonbrothers.com>",
      to: ADMIN_EMAILS,
      subject,
      html,
    });
  } catch {
    console.error("[catalog] Failed to send admin notification email");
  }
}

const VALID_SYSTEMS = ["INTERNAL", "ZOHO", "HUBSPOT", "ZUPER"] as const;
const VALID_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
const VALID_CATEGORIES = new Set<string>(FORM_CATEGORIES as readonly string[]);
type PushStatus = typeof VALID_STATUSES[number];

function parseNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function POST(request: NextRequest) {
  if (!prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    brand, model, description, category, unitSpec, unitLabel,
    sku, vendorName, vendorPartNumber, unitCost, sellPrice,
    hardToProcure, length, width, weight, metadata,
    systems, dealId,
  } = body as Record<string, unknown>;

  if (!brand || !model || !description || !category) {
    return NextResponse.json({ error: "brand, model, description, category are required" }, { status: 400 });
  }
  const normalizedCategory = String(category).trim();
  if (!VALID_CATEGORIES.has(normalizedCategory)) {
    return NextResponse.json({ error: `Invalid category: ${normalizedCategory}` }, { status: 400 });
  }
  if (!Array.isArray(systems) || systems.length === 0) {
    return NextResponse.json({ error: "systems must be a non-empty array" }, { status: 400 });
  }
  if (!systems.every((s): s is string => typeof s === "string")) {
    return NextResponse.json({ error: "systems must be an array of strings" }, { status: 400 });
  }
  const invalidSystems = systems.filter((s) => !(VALID_SYSTEMS as readonly string[]).includes(s));
  if (invalidSystems.length > 0) {
    return NextResponse.json({ error: `Invalid systems: ${invalidSystems.join(", ")}` }, { status: 400 });
  }

  const push = await prisma.pendingCatalogPush.create({
    data: {
      brand: String(brand).trim(),
      model: String(model).trim(),
      description: String(description).trim(),
      category: normalizedCategory,
      unitSpec: unitSpec ? String(unitSpec).trim() : null,
      unitLabel: unitLabel ? String(unitLabel).trim() : null,
      sku: sku ? String(sku).trim() : null,
      vendorName: vendorName ? String(vendorName).trim() : null,
      vendorPartNumber: vendorPartNumber ? String(vendorPartNumber).trim() : null,
      unitCost: parseNullableNumber(unitCost),
      sellPrice: parseNullableNumber(sellPrice),
      hardToProcure: hardToProcure === true,
      length: parseNullableNumber(length),
      width: parseNullableNumber(width),
      weight: parseNullableNumber(weight),
      metadata: metadata || undefined,
      systems: systems,
      requestedBy: authResult.email,
      dealId: dealId ? String(dealId) : null,
    },
  });

  // Fire-and-forget admin notification
  notifyAdminsOfNewRequest({
    id: push.id,
    brand: push.brand,
    model: push.model,
    category: push.category,
    requestedBy: push.requestedBy,
    systems: push.systems,
    dealId: push.dealId,
  });

  return NextResponse.json({ push }, { status: 201 });
}

export async function GET(request: NextRequest) {
  if (!prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const rawStatus = request.nextUrl.searchParams.get("status") ?? "PENDING";
  if (!(VALID_STATUSES as readonly string[]).includes(rawStatus)) {
    return NextResponse.json({ error: "Invalid status value" }, { status: 400 });
  }
  const status = rawStatus as PushStatus;

  const pushes = await prisma.pendingCatalogPush.findMany({
    where: { status },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ pushes, count: pushes.length });
}
