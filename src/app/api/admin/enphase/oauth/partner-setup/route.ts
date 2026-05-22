/**
 * Enphase Partner OAuth Setup
 *
 * Partner applications use grant_type=password (installer credentials)
 * instead of the authorization_code flow used by developer apps.
 *
 * GET  → renders an HTML form for the admin to enter Enlighten credentials
 * POST → exchanges credentials for access + refresh tokens, persists refresh token
 *
 * Credentials are transient — never stored. Only the refresh token is persisted
 * to SystemConfig for runtime use by the API client.
 *
 * This route is behind session auth (admin-only via /api/admin/* middleware check).
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const html = `
    <!DOCTYPE html>
    <html><head><title>Enphase Partner Setup</title></head>
    <body style="font-family:system-ui;padding:2rem;max-width:500px;margin:0 auto;">
      <h1>Enphase Partner Setup</h1>
      <p>Enter your Enlighten installer credentials to authenticate the Partner API.
         Credentials are used once to obtain tokens and are <strong>not stored</strong>.</p>
      <form method="POST" style="display:flex;flex-direction:column;gap:1rem;">
        <label>
          Enlighten Email
          <input type="email" name="username" required
                 style="display:block;width:100%;padding:0.5rem;margin-top:0.25rem;border:1px solid #ccc;border-radius:4px;" />
        </label>
        <label>
          Enlighten Password
          <input type="password" name="password" required
                 style="display:block;width:100%;padding:0.5rem;margin-top:0.25rem;border:1px solid #ccc;border-radius:4px;" />
        </label>
        <button type="submit"
                style="padding:0.75rem;background:#f26522;color:white;border:none;border-radius:4px;cursor:pointer;font-size:1rem;">
          Authenticate
        </button>
      </form>
      <p style="margin-top:1rem;"><a href="/dashboards/admin">&larr; Back to Admin</a></p>
    </body></html>
  `;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html",
      "Cache-Control": "no-store, no-cache",
      "Pragma": "no-cache",
    },
  });
}

export async function POST(request: Request) {
  const clientId = process.env.ENPHASE_CLIENT_ID;
  const clientSecret = process.env.ENPHASE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "Missing ENPHASE_CLIENT_ID or ENPHASE_CLIENT_SECRET" },
      { status: 500 }
    );
  }

  const formData = await request.formData();
  const username = formData.get("username") as string | null;
  const password = formData.get("password") as string | null;

  if (!username || !password) {
    return new NextResponse(errorHtml("Email and password are required."), {
      status: 400,
      headers: { "Content-Type": "text/html", "Cache-Control": "no-store, no-cache" },
    });
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  try {
    const res = await fetch("https://api.enphaseenergy.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth}`,
      },
      body: `grant_type=password&username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`,
    });

    if (!res.ok) {
      const body = await res.text();
      const msg = res.status === 401
        ? "Invalid Enlighten credentials. Please check your email and password."
        : `Token exchange failed (${res.status}): ${body}`;
      return new NextResponse(errorHtml(msg), {
        status: res.status === 401 ? 401 : 502,
        headers: { "Content-Type": "text/html", "Cache-Control": "no-store, no-cache" },
      });
    }

    const data = await res.json();
    const refreshToken: string = data.refresh_token;

    // Persist refresh token to DB for runtime use
    await prisma.systemConfig.upsert({
      where: { key: "enphase_refresh_token" },
      create: { key: "enphase_refresh_token", value: refreshToken },
      update: { value: refreshToken },
    });

    const html = `
      <!DOCTYPE html>
      <html><head><title>Enphase Partner Setup Complete</title></head>
      <body style="font-family:system-ui;padding:2rem;max-width:500px;margin:0 auto;">
        <h1 style="color:#22c55e;">&#10003; Partner Setup Complete</h1>
        <p>Refresh token has been saved to the database.</p>
        <p>Access token expires in ${data.expires_in}s. The API client will auto-refresh using the stored token.</p>
        <p>App type: <code>${data.app_type || "partner"}</code></p>
        <p><strong>Next steps:</strong></p>
        <ol>
          <li>Set <code>ENPHASE_ENABLED=true</code> in Vercel to activate crons</li>
          <li>Set <code>ENPHASE_CROSSLINK_ENABLED=true</code> to link sites to HubSpot Properties</li>
        </ol>
        <p><a href="/dashboards/admin">&larr; Back to Admin</a></p>
      </body></html>
    `;

    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html",
        "Cache-Control": "no-store, no-cache",
        "Pragma": "no-cache",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new NextResponse(errorHtml(`Partner auth failed: ${message}`), {
      status: 500,
      headers: { "Content-Type": "text/html", "Cache-Control": "no-store, no-cache" },
    });
  }
}

function errorHtml(message: string): string {
  return `
    <!DOCTYPE html>
    <html><head><title>Enphase Partner Setup - Error</title></head>
    <body style="font-family:system-ui;padding:2rem;max-width:500px;margin:0 auto;">
      <h1 style="color:#ef4444;">Error</h1>
      <p>${message}</p>
      <p><a href="/api/admin/enphase/oauth/partner-setup">&larr; Try again</a></p>
    </body></html>
  `;
}
