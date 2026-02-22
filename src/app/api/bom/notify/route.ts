// src/app/api/bom/notify/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { getServiceAccountToken } from "@/lib/google-auth";

export const runtime = "nodejs";
export const maxDuration = 15;

function makeRfc2822(opts: {
  from: string; to: string; bcc?: string; subject: string; html: string;
}): string {
  const boundary = `boundary_${Date.now()}`;
  const lines = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    ...(opts.bcc ? [`Bcc: ${opts.bcc}`] : []),
    `Subject: ${opts.subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=utf-8`,
    ``,
    opts.html,
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

  const bomUrl = `https://pbtechops.com/dashboards/bom?deal=${encodeURIComponent(dealId)}`;

  const html = `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a">
  <div style="background:#0891b2;padding:20px 24px;border-radius:8px 8px 0 0">
    <h1 style="color:white;margin:0;font-size:20px">BOM v${version} Extracted</h1>
    <p style="color:#cffafe;margin:4px 0 0">${escHtml(dealName)}</p>
  </div>
  <div style="background:#f9fafb;padding:24px;border:1px solid #e5e7eb;border-top:none">
    ${projectInfo?.customer ? `<p style="margin:0 0 4px"><strong>${escHtml(projectInfo.customer)}</strong></p>` : ""}
    ${projectInfo?.address ? `<p style="margin:0 0 12px;color:#555">${escHtml(projectInfo.address)}</p>` : ""}
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:16px">
      <tr><td style="padding:4px 0;color:#555">Version</td><td style="padding:4px 0"><strong>v${version}</strong></td></tr>
      <tr><td style="padding:4px 0;color:#555">Items</td><td style="padding:4px 0"><strong>${itemCount}</strong></td></tr>
      ${projectInfo?.systemSizeKwdc ? `<tr><td style="padding:4px 0;color:#555">System size</td><td style="padding:4px 0"><strong>${projectInfo.systemSizeKwdc} kWdc</strong></td></tr>` : ""}
      ${projectInfo?.moduleCount ? `<tr><td style="padding:4px 0;color:#555">Modules</td><td style="padding:4px 0"><strong>${projectInfo.moduleCount}</strong></td></tr>` : ""}
      ${sourceFile ? `<tr><td style="padding:4px 0;color:#555">Source</td><td style="padding:4px 0">${escHtml(sourceFile)}</td></tr>` : ""}
    </table>
    <a href="${bomUrl}" style="display:inline-block;background:#0891b2;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">View BOM →</a>
  </div>
  <p style="color:#aaa;font-size:12px;text-align:center;margin-top:12px">PB Ops · Photon Brothers</p>
</div>`;

  try {
    const token = await getServiceAccountToken(
      ["https://www.googleapis.com/auth/gmail.send"],
      senderEmail
    );

    const raw = base64url(makeRfc2822({
      from: `PB Ops <${senderEmail}>`,
      to: userEmail,
      bcc: bccEmail !== userEmail ? bccEmail : undefined,
      subject: `BOM v${version} extracted — ${dealName}`,
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
