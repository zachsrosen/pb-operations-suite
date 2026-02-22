// src/app/api/bom/notify/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { getServiceAccountToken } from "@/lib/google-auth";

export const runtime = "nodejs";
export const maxDuration = 15;

// Encode a header value that may contain non-ASCII chars (e.g. em dash in deal names)
function encodeHeader(value: string): string {
  // If all ASCII, no encoding needed
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  // RFC 2047 encoded-word: =?utf-8?B?<base64>?=
  return `=?utf-8?B?${Buffer.from(value).toString("base64")}?=`;
}

function makeRfc2822(opts: {
  from: string; to: string; bcc?: string; subject: string; html: string;
}): string {
  const boundary = `boundary_${Date.now()}`;
  const lines = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    ...(opts.bcc ? [`Bcc: ${opts.bcc}`] : []),
    `Subject: ${encodeHeader(opts.subject)}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=utf-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    Buffer.from(opts.html, "utf-8").toString("base64"),
    ``,
    `--${boundary}--`,
  ];
  return lines.join("\r\n");
}

function base64url(str: string): string {
  return Buffer.from(str).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function escHtml(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export async function POST(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const senderEmail = process.env.GMAIL_SENDER_EMAIL;
  if (!senderEmail) {
    // Silently skip if not configured — don't fail the BOM save
    return NextResponse.json({ skipped: true, reason: "GMAIL_SENDER_EMAIL not configured" });
  }

  const bccEmail = process.env.BOM_NOTIFY_BCC ?? "zach@photonbrothers.com";

  let body: {
    userEmail: string;
    dealName: string;
    dealId: string;
    version: number;
    sourceFile?: string | null;
    itemCount: number;
    projectInfo?: {
      customer?: string;
      address?: string;
      systemSizeKwdc?: number | string;
      moduleCount?: number | string;
    };
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { userEmail, dealName, dealId, version, sourceFile, itemCount, projectInfo } = body;

  // Validate required fields
  if (!userEmail || !dealName || !dealId || typeof version !== "number" || typeof itemCount !== "number") {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Prevent sending to arbitrary addresses — only send to the authenticated user's email
  if (userEmail !== authResult.email) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const bomUrl = `https://pbtechops.com/dashboards/bom?deal=${encodeURIComponent(dealId)}&load=latest`;

  // Format customer name to title case: "SILFVEN, ERIK" → "Erik Silfven"
  function formatCustomer(raw: string | undefined): string {
    if (!raw) return "";
    const parts = raw.split(/[,\s]+/).filter(Boolean);
    // "LAST, FIRST" format
    if (raw.includes(",")) {
      const [last, ...first] = raw.split(",").map(s => s.trim());
      const toTitle = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
      return `${first.join(" ").split(" ").map(toTitle).join(" ")} ${toTitle(last)}`.trim();
    }
    return parts.map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(" ");
  }

  const customerDisplay = formatCustomer(projectInfo?.customer);
  const systemSpec = [
    projectInfo?.moduleCount ? `${projectInfo.moduleCount} modules` : null,
    projectInfo?.systemSizeKwdc ? `${projectInfo.systemSizeKwdc} kWdc` : null,
  ].filter(Boolean).join(" · ");

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:560px;margin:32px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08),0 1px 2px rgba(0,0,0,0.04)">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#0e7490 0%,#0891b2 100%);padding:28px 32px 24px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
        <div style="background:rgba(255,255,255,0.15);border-radius:8px;width:36px;height:36px;display:flex;align-items:center;justify-content:center">
          <span style="color:white;font-size:18px">☀</span>
        </div>
        <span style="color:rgba(255,255,255,0.85);font-size:13px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase">Photon Brothers · PB Ops</span>
      </div>
      <h1 style="color:white;margin:0 0 4px;font-size:22px;font-weight:700;letter-spacing:-0.01em">BOM v${version} Extracted</h1>
      <p style="color:rgba(207,250,254,0.9);margin:0;font-size:14px">${escHtml(dealName)}</p>
    </div>

    <!-- Project card -->
    <div style="padding:24px 32px;border-bottom:1px solid #f0f0f0">
      ${customerDisplay ? `<p style="margin:0 0 2px;font-size:18px;font-weight:700;color:#111">${escHtml(customerDisplay)}</p>` : ""}
      ${projectInfo?.address ? `<p style="margin:0 0 12px;font-size:13px;color:#6b7280">${escHtml(projectInfo.address)}</p>` : ""}
      ${systemSpec ? `<div style="display:inline-block;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:20px;padding:4px 12px;font-size:12px;font-weight:600;color:#15803d">${escHtml(systemSpec)}</div>` : ""}
    </div>

    <!-- Stats row -->
    <div style="padding:20px 32px;display:flex;gap:0;border-bottom:1px solid #f0f0f0">
      <div style="flex:1;text-align:center;padding:0 16px 0 0;border-right:1px solid #f0f0f0">
        <div style="font-size:28px;font-weight:800;color:#0891b2;letter-spacing:-0.02em">v${version}</div>
        <div style="font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.06em;margin-top:2px">Version</div>
      </div>
      <div style="flex:1;text-align:center;padding:0 16px">
        <div style="font-size:28px;font-weight:800;color:#111;letter-spacing:-0.02em">${itemCount}</div>
        <div style="font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.06em;margin-top:2px">Line Items</div>
      </div>
      ${projectInfo?.moduleCount ? `
      <div style="flex:1;text-align:center;padding:0 0 0 16px;border-left:1px solid #f0f0f0">
        <div style="font-size:28px;font-weight:800;color:#111;letter-spacing:-0.02em">${projectInfo.moduleCount}</div>
        <div style="font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.06em;margin-top:2px">Modules</div>
      </div>` : ""}
    </div>

    ${sourceFile ? `
    <!-- Source file -->
    <div style="padding:12px 32px;background:#fafafa;border-bottom:1px solid #f0f0f0">
      <span style="font-size:12px;color:#9ca3af">Source: </span>
      <span style="font-size:12px;color:#374151;font-weight:500">${escHtml(sourceFile)}</span>
    </div>` : ""}

    <!-- CTA -->
    <div style="padding:24px 32px">
      <a href="${bomUrl}" style="display:inline-block;background:#0891b2;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;letter-spacing:0.01em">View BOM &rarr;</a>
    </div>

    <!-- Footer -->
    <div style="padding:16px 32px;background:#fafafa;border-top:1px solid #f0f0f0">
      <p style="margin:0;font-size:11px;color:#9ca3af">PB Ops &middot; Photon Brothers &middot; <a href="https://pbtechops.com" style="color:#9ca3af;text-decoration:none">pbtechops.com</a></p>
    </div>

  </div>
</body>
</html>`;

  try {
    const token = await getServiceAccountToken(
      ["https://www.googleapis.com/auth/gmail.send"],
      senderEmail
    );

    const raw = base64url(makeRfc2822({
      from: `PB Ops <${senderEmail}>`,
      to: userEmail,
      bcc: bccEmail !== userEmail ? bccEmail : undefined,
      subject: `BOM v${version} extracted - ${dealName}`,
      html,
    }));

    const gmailRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(senderEmail)}/messages/send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw }),
      }
    );

    if (!gmailRes.ok) {
      const err = await gmailRes.json().catch(() => ({})) as { error?: { message?: string } };
      console.error("[bom/notify] Gmail send failed:", err);
      return NextResponse.json({ error: err.error?.message ?? "Gmail error" }, { status: 500 });
    }

    return NextResponse.json({ sent: true });
  } catch (e) {
    console.error("[bom/notify]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Send failed" }, { status: 500 });
  }
}
