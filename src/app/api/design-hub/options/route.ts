import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { getActiveEnumOptions } from "@/lib/hubspot-enum-labels";
import {
  isDesignHubAllowedRole,
  isDesignHubEnabled,
} from "@/lib/design-hub/access";
import { parseTab } from "@/lib/design-hub/types";
import { TAB_CONFIGS } from "@/lib/design-hub/config";

export async function GET(req: NextRequest) {
  if (!isDesignHubEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isDesignHubAllowedRole(auth.roles)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const tab = parseTab(req.nextUrl.searchParams.get("tab"));
  if (!tab) {
    return NextResponse.json({ error: "Invalid tab" }, { status: 400 });
  }

  const config = TAB_CONFIGS[tab];
  // ACTIVE options only — this list feeds the status-change dropdown, and
  // offering archived values would let a user set a dead status. Terminal
  // statuses ride along so the UI can confirm before a terminal write.
  const options = await getActiveEnumOptions(config.statusProperty);
  return NextResponse.json({
    options,
    terminalStatuses: config.terminalStatuses,
  });
}
