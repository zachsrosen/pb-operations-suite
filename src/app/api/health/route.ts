import { NextResponse } from "next/server";
import { appCache } from "@/lib/cache";

/** Stable identifier for the current deployment — changes on every Vercel deploy */
const DEPLOY_ID =
  process.env.VERCEL_DEPLOYMENT_ID ||
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ||
  `local-${Math.floor(process.uptime())}`;

export async function GET() {
  return NextResponse.json({
    status: "ok",
    deployId: DEPLOY_ID,
    uptime: process.uptime(),
    cache: appCache.stats(),
    timestamp: new Date().toISOString(),
  });
}
