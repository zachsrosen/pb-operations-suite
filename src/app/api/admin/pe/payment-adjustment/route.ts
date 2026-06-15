import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";
import { getPaymentAdjustments, setPaymentAdjustment } from "@/lib/pe-payment-adjustments";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.email) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const user = await getUserByEmail(session.user.email);
  const ok = !!user?.roles?.some((r) => r === "ADMIN" || r === "OWNER");
  if (!ok) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { email: session.user.email };
}

// GET — list current payment adjustments
export async function GET() {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  return NextResponse.json({ adjustments: await getPaymentAdjustments() });
}

// POST — record a short-pay. Body { dealId, m1Short, m2Short, note }. Both 0 clears it.
export async function POST(req: NextRequest) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  let body: { dealId?: unknown; m1Short?: unknown; m2Short?: unknown; note?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const dealId = typeof body.dealId === "string" ? body.dealId.trim() : "";
  if (!dealId) return NextResponse.json({ error: "dealId is required" }, { status: 400 });
  const m1Short = Number(body.m1Short) || 0;
  const m2Short = Number(body.m2Short) || 0;
  const note = typeof body.note === "string" ? body.note.slice(0, 300) : "";

  await setPaymentAdjustment({ dealId, m1Short, m2Short, note, setBy: gate.email! });
  return NextResponse.json({ ok: true, cleared: m1Short <= 0 && m2Short <= 0 });
}
