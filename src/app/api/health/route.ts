import { NextResponse } from "next/server";
import { appCache } from "@/lib/cache";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    uptime: process.uptime(),
    cache: appCache.stats(),
    timestamp: new Date().toISOString(),
  });
}
