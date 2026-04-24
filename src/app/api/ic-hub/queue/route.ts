import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import {
  fetchIcQueue,
  isIcHubAllowedRole,
  isIcHubEnabled,
} from "@/lib/ic-hub";

export async function GET() {
  if (!isIcHubEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!auth.roles.some((r) => isIcHubAllowedRole(r))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const queue = await fetchIcQueue();
  return NextResponse.json({ queue, lastUpdated: new Date().toISOString() });
}
