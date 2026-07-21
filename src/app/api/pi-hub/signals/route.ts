import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuth } from "@/lib/api-auth";
import {
  allowedTeamsForRoles,
  isPiHubAllowedRole,
  isPiHubEnabled,
} from "@/lib/pi-hub/access";
import {
  dismissSignal,
  isApprovalSignalsEnabled,
} from "@/lib/pi-hub/signals";

const Schema = z.object({
  team: z.enum(["permit", "ic", "pto"]),
  dealId: z.string().min(1),
  signalType: z.string().min(1),
  action: z.literal("dismiss"),
});

/**
 * POST /api/pi-hub/signals — dismiss an approval signal. Strikes the current
 * evidence messageId; the 3rd distinct dismissed message mutes the deal+team
 * (admin escape hatch un-mutes). There is deliberately no "resolve" action:
 * resolution only happens through a real status write (/api/pi-hub/status).
 * Gating mirrors the sibling pi-hub routes, plus the signals UI flag.
 */
export async function POST(req: NextRequest) {
  if (!isPiHubEnabled() || !isApprovalSignalsEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isPiHubAllowedRole(auth.roles)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { team, dealId, signalType } = parsed.data;
  if (!allowedTeamsForRoles(auth.roles).includes(team)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const status = await dismissSignal({ dealId, team, signalType });
    if (status === null) {
      return NextResponse.json({ error: "Signal not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, status });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
