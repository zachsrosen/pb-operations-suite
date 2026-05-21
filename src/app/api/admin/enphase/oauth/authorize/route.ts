import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const clientId = process.env.ENPHASE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "ENPHASE_CLIENT_ID not configured" }, { status: 500 });
  }

  const redirectUri = `${process.env.AUTH_URL || "https://pbtechops.com"}/api/admin/enphase/oauth/callback`;
  const authUrl = new URL("https://api.enphaseenergy.com/oauth/authorize");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);

  return NextResponse.redirect(authUrl.toString());
}
