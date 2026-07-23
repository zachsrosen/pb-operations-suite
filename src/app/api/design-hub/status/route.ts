import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuth } from "@/lib/api-auth";
import { resolveUserIdByEmail } from "@/lib/permit-hub";
import {
  isDesignHubAllowedRole,
  isDesignHubEnabled,
} from "@/lib/design-hub/access";
import { setStatus } from "@/lib/design-hub/status";

const Schema = z.object({
  tab: z.enum(["design", "da"]),
  dealId: z.string().min(1),
  status: z.string().min(1),
});

export async function POST(req: NextRequest) {
  if (!isDesignHubEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isDesignHubAllowedRole(auth.roles)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Tolerate a malformed / missing body: parse defensively so bad JSON is a
  // 400 (validation failure) rather than a 500 (unhandled parse throw).
  const body = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { tab, dealId, status } = parsed.data;

  const userId = await resolveUserIdByEmail(auth.email);
  try {
    const result = await setStatus({
      tab,
      dealId,
      newValue: status,
      userEmail: auth.email,
      userName: auth.name,
      userId,
    });
    return NextResponse.json({ ok: true, warnings: result.warnings });
  } catch (err) {
    // setStatus throws only when the write did NOT land (validation, options
    // load, or the PATCH itself) — surface as an upstream failure.
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
