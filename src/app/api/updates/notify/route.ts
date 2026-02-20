import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendProductUpdateEmail } from "@/lib/email";
import { UPDATES } from "@/lib/product-updates";

const LAST_SENT_SETTING_KEY = "product_updates_last_emailed_version";

function parseEmails(raw?: string | null): string[] {
  if (!raw) return [];
  const parts = raw
    .split(/[,\n;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const basicEmailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const unique = new Set<string>();
  for (const part of parts) {
    const normalized = part.toLowerCase();
    if (basicEmailRegex.test(normalized)) {
      unique.add(normalized);
    }
  }
  return [...unique];
}

function getRecipients(): string[] {
  const fromEnv = parseEmails(
    process.env.PRODUCT_UPDATE_EMAIL_RECIPIENTS ||
      process.env.CHANGELOG_UPDATE_EMAIL_RECIPIENTS ||
      process.env.UPDATES_EMAIL_RECIPIENTS ||
      ""
  );

  if (fromEnv.length > 0) return fromEnv;
  return parseEmails(process.env.GOOGLE_ADMIN_EMAIL || "");
}

function extractLastSentVersion(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (value && typeof value === "object" && "version" in value) {
    const candidate = (value as { version?: unknown }).version;
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

function isAuthorizedRequest(request: NextRequest): boolean {
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  if (!cronSecret) {
    return process.env.NODE_ENV !== "production";
  }

  const authHeader = request.headers.get("authorization") || "";
  return authHeader === `Bearer ${cronSecret}`;
}

async function handleNotify(request: NextRequest) {
  if (!isAuthorizedRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const latest = UPDATES[0];
  if (!latest) {
    return NextResponse.json({ success: true, skipped: true, reason: "No updates available" });
  }

  const recipients = getRecipients();
  if (recipients.length === 0) {
    return NextResponse.json({
      success: false,
      skipped: true,
      reason: "No product update recipients configured",
      env: "Set PRODUCT_UPDATE_EMAIL_RECIPIENTS (or CHANGELOG_UPDATE_EMAIL_RECIPIENTS / UPDATES_EMAIL_RECIPIENTS)",
    }, { status: 503 });
  }

  const existing = await prisma.appSetting.findUnique({
    where: { key: LAST_SENT_SETTING_KEY },
  });
  const lastSentVersion = extractLastSentVersion(existing?.value);
  if (lastSentVersion === latest.version) {
    return NextResponse.json({
      success: true,
      skipped: true,
      reason: "Latest version already emailed",
      version: latest.version,
      recipients: recipients.length,
    });
  }

  const sent: string[] = [];
  const failed: Array<{ email: string; error: string }> = [];
  for (const email of recipients) {
    const result = await sendProductUpdateEmail({
      to: email,
      update: latest,
    });
    if (result.success) {
      sent.push(email);
    } else {
      failed.push({ email, error: result.error || "Unknown error" });
    }
  }

  if (sent.length > 0) {
    await prisma.appSetting.upsert({
      where: { key: LAST_SENT_SETTING_KEY },
      update: {
        value: {
          version: latest.version,
          date: latest.date,
          sentAt: new Date().toISOString(),
          sent,
          failed,
        },
      },
      create: {
        key: LAST_SENT_SETTING_KEY,
        value: {
          version: latest.version,
          date: latest.date,
          sentAt: new Date().toISOString(),
          sent,
          failed,
        },
      },
    });
  }

  const statusCode = sent.length > 0 ? (failed.length > 0 ? 207 : 200) : 502;
  return NextResponse.json({
    success: sent.length > 0,
    version: latest.version,
    sent,
    failed,
  }, { status: statusCode });
}

export async function GET(request: NextRequest) {
  return handleNotify(request);
}

export async function POST(request: NextRequest) {
  return handleNotify(request);
}
