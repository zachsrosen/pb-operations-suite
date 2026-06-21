import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";
import { updateDealProperty } from "@/lib/hubspot";

// Allowlist of deal properties this endpoint may write. Scoped to the free-text
// "reason / notes" fields the funnel surfaces as missing, so an admin can fill
// them in-bulk without granting blanket write access to every deal property.
const EDITABLE_PROPERTIES = new Set<string>([
  "rtb_blocked_reason",
  "sales_change_order_notes",
  "on_hold_reason",
  "on_hold_selection",
  "cancellation_notes",
  "cancelled_reason",
]);

const MAX_DEALS = 50;
const MAX_VALUE_LEN = 1000;

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.email) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const user = await getUserByEmail(session.user.email);
  const ok = !!user?.roles?.some((r) => r === "ADMIN" || r === "OWNER");
  if (!ok) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { email: session.user.email };
}

// GET — list the properties this endpoint is allowed to write.
export async function GET() {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  return NextResponse.json({ editableProperties: [...EDITABLE_PROPERTIES] });
}

// POST — set one allowlisted property to the same value across a batch of deals.
// Body: { dealIds: string[], property: string, value: string }
export async function POST(req: NextRequest) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  let body: { dealIds?: unknown; property?: unknown; value?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const property = typeof body.property === "string" ? body.property.trim() : "";
  if (!EDITABLE_PROPERTIES.has(property)) {
    return NextResponse.json(
      { error: `property must be one of: ${[...EDITABLE_PROPERTIES].join(", ")}` },
      { status: 400 }
    );
  }

  const value = typeof body.value === "string" ? body.value.slice(0, MAX_VALUE_LEN) : "";
  if (!value) return NextResponse.json({ error: "value is required" }, { status: 400 });

  const dealIds = Array.isArray(body.dealIds)
    ? [...new Set(body.dealIds.map((d) => String(d).trim()).filter(Boolean))]
    : [];
  if (dealIds.length === 0) return NextResponse.json({ error: "dealIds is required" }, { status: 400 });
  if (dealIds.length > MAX_DEALS) {
    return NextResponse.json({ error: `dealIds capped at ${MAX_DEALS} per request` }, { status: 400 });
  }

  const results: { dealId: string; ok: boolean }[] = [];
  for (const dealId of dealIds) {
    const ok = await updateDealProperty(dealId, { [property]: value });
    results.push({ dealId, ok });
    if (!ok) console.warn(`[admin/set-property] ${gate.email} failed to set ${property} on deal ${dealId}`);
  }

  const updated = results.filter((r) => r.ok).length;
  return NextResponse.json({ ok: updated === results.length, updated, total: results.length, results });
}
