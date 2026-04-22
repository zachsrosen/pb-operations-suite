/**
 * POST /api/adders/sync
 *
 * Manual trigger for the adder catalog → OpenSolar sync orchestrator.
 * Gated to ADMIN/OWNER roles; prefix-covered by `/api/adders` in
 * `src/lib/roles.ts` but the handler still checks roles explicitly so
 * non-manage roles get 403 instead of running a sync.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { syncAll } from "@/lib/adders/sync";

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const roles = session.user.roles ?? [];
  const canManage = roles.includes("ADMIN") || roles.includes("OWNER");
  if (!canManage) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const result = await syncAll({ trigger: "MANUAL" });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
