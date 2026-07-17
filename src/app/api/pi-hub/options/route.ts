import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { getActiveEnumOptions } from "@/lib/hubspot-enum-labels";
import {
  allowedTeamsForRoles,
  isPiHubAllowedRole,
  isPiHubEnabled,
  parseTeam,
} from "@/lib/pi-hub/access";
import { TEAM_CONFIGS } from "@/lib/pi-hub/config";

export async function GET(req: NextRequest) {
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

  const config = TEAM_CONFIGS[team];
  // ACTIVE options only — this list feeds the status-change dropdown, and
  // offering archived values reintroduces the #1481 bug class. Terminal
  // statuses ride along so the UI can confirm before a terminal write.
  const options = await getActiveEnumOptions(config.statusProperty);
  return NextResponse.json({
    options,
    terminalStatuses: config.terminalStatuses,
  });
}
