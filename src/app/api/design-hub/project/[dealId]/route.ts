import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { requireApiAuth } from "@/lib/api-auth";
import {
  isDesignHubAllowedRole,
  isDesignHubEnabled,
} from "@/lib/design-hub/access";
import { parseTab } from "@/lib/design-hub/types";
import { fetchProjectDetail } from "@/lib/design-hub/detail";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
) {
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

  const { dealId } = await params;
  try {
    const detail = await fetchProjectDetail(tab, dealId);
    if (!detail) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }
    return NextResponse.json(detail);
  } catch (err) {
    Sentry.captureException(err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
