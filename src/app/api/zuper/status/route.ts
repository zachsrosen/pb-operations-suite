import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { zuper } from "@/lib/zuper";
import { getZuperWebBaseUrl } from "@/lib/external-links";

export async function GET() {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const configured = zuper.isConfigured();

  // Canonical web base used everywhere we generate job links.
  const webBaseUrl = getZuperWebBaseUrl();

  return NextResponse.json({
    configured,
    webBaseUrl,
    message: configured
      ? "Zuper integration is active"
      : "Zuper API key not configured. Add ZUPER_API_KEY to environment variables.",
  });
}
