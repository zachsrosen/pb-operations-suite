/**
 * POST /api/admin/inngest-resync
 *
 * Manual trigger for Inngest sync. ADMIN only. Useful when the deployment
 * webhook didn't fire (e.g. not configured) or when you want to re-sync
 * without deploying. Automation is also wired via /api/deployment on
 * deployment.succeeded events.
 */

import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";
import { triggerInngestSync } from "@/lib/inngest-sync";

export async function POST() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const user = await getUserByEmail(session.user.email);
  if (!user?.roles.includes("ADMIN")) {
    return NextResponse.json({ error: "Admin required" }, { status: 403 });
  }

  const result = await triggerInngestSync();
  const status = result.ok ? 200 : 502;
  return NextResponse.json(result, { status });
}
