import { NextResponse } from "next/server";
import { zuper } from "@/lib/zuper";

export async function GET() {
  const configured = zuper.isConfigured();

  // Get the web URL base for constructing job links
  const webBaseUrl = process.env.ZUPER_WEB_URL ||
    (process.env.ZUPER_API_URL?.replace("/api", "") || "https://us-west-1c.zuperpro.com");

  return NextResponse.json({
    configured,
    webBaseUrl,
    message: configured
      ? "Zuper integration is active"
      : "Zuper API key not configured. Add ZUPER_API_KEY to environment variables.",
  });
}
