import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  if (!code) {
    return NextResponse.json({ error: "Missing authorization code" }, { status: 400 });
  }

  const clientId = process.env.ENPHASE_CLIENT_ID;
  const clientSecret = process.env.ENPHASE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "Missing ENPHASE_CLIENT_ID or ENPHASE_CLIENT_SECRET" },
      { status: 500 }
    );
  }

  const redirectUri = `${process.env.AUTH_URL || "https://pbtechops.com"}/api/admin/enphase/oauth/callback`;
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  try {
    const res = await fetch("https://api.enphaseenergy.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth}`,
      },
      body: `grant_type=authorization_code&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(redirectUri)}`,
    });

    if (!res.ok) {
      const body = await res.text();
      return NextResponse.json({ error: "Token exchange failed", detail: body }, { status: 502 });
    }

    const data = await res.json();
    const refreshToken: string = data.refresh_token;

    // Persist refresh token to DB for runtime use
    await prisma.systemConfig.upsert({
      where: { key: "enphase_refresh_token" },
      create: { key: "enphase_refresh_token", value: refreshToken },
      update: { value: refreshToken },
    });

    // Return a simple HTML page confirming success (no tokens displayed)
    const html = `
      <!DOCTYPE html>
      <html><head><title>Enphase OAuth Complete</title></head>
      <body style="font-family:system-ui;padding:2rem;">
        <h1>Enphase OAuth Setup Complete</h1>
        <p>Refresh token has been saved to the database.</p>
        <p>Access token expires in ${data.expires_in}s and is ready for API calls.</p>
        <p><a href="/dashboards/admin">← Back to Admin</a></p>
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
    return NextResponse.json({ error: "OAuth callback failed", detail: message }, { status: 500 });
  }
}
