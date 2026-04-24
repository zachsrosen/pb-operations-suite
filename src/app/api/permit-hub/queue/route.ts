import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import {
  fetchPermitQueue,
  isPermitHubAllowedRole,
  isPermitHubEnabled,
} from "@/lib/permit-hub";

export async function GET() {
  if (!isPermitHubEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!auth.roles.some((r) => isPermitHubAllowedRole(r))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const queue = await fetchPermitQueue();
  return NextResponse.json({ queue, lastUpdated: new Date().toISOString() });
}
