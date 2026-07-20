import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import {
  allowedTeamsForRoles,
  isPiHubAllowedRole,
  isPiHubEnabled,
} from "@/lib/pi-hub/access";
import { parseTeam } from "@/lib/pi-hub/types";
import { fetchDetail } from "@/lib/pi-hub/detail";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
) {
  if (!isPiHubEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isPiHubAllowedRole(auth.roles)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const team = parseTeam(req.nextUrl.searchParams.get("team"));
  if (!team) {
    return NextResponse.json({ error: "Invalid team" }, { status: 400 });
  }
  if (!allowedTeamsForRoles(auth.roles).includes(team)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { dealId } = await params;
  const detail = await fetchDetail(team, dealId);
  if (!detail) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  return NextResponse.json(detail);
}
