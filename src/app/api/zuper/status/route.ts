import { NextResponse } from "next/server";
import { zuper } from "@/lib/zuper";

export async function GET() {
  const configured = zuper.isConfigured();

  return NextResponse.json({
    configured,
    message: configured
      ? "Zuper integration is active"
      : "Zuper API key not configured. Add ZUPER_API_KEY to environment variables.",
  });
}
