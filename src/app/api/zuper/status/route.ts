import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { zuper } from "@/lib/zuper";

export async function GET() {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const configured = zuper.isConfigured();

  // Get the web URL base for constructing job links
  // Web app is at web.zuperpro.com with format: /jobs/{uid}/details
  const webBaseUrl = process.env.ZUPER_WEB_URL || "https://web.zuperpro.com";

  return NextResponse.json({
    configured,
    webBaseUrl,
    message: configured
      ? "Zuper integration is active"
      : "Zuper API key not configured. Add ZUPER_API_KEY to environment variables.",
  });
}
