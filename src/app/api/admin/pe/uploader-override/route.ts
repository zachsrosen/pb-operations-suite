import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";
import { getUploaderOverridesRaw, setUploaderOverride } from "@/lib/pe-uploader-overrides";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.email) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const user = await getUserByEmail(session.user.email);
  const ok = !!user?.roles?.some((r) => r === "ADMIN" || r === "OWNER");
  if (!ok) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { email: session.user.email };
}

// GET — list current uploader overrides
export async function GET() {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  return NextResponse.json({ overrides: await getUploaderOverridesRaw() });
}

// POST — set or clear an override.
// Body: { dealId, docName, uploader: string | null, reason?: string }
//   uploader = email to credit, "" to credit Unknown, null to clear the override.
export async function POST(req: NextRequest) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  let body: { dealId?: unknown; docName?: unknown; uploader?: unknown; reason?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const dealId = typeof body.dealId === "string" ? body.dealId.trim() : "";
  const docName = typeof body.docName === "string" ? body.docName.trim() : "";
  if (!dealId || !docName) {
    return NextResponse.json({ error: "dealId and docName are required" }, { status: 400 });
  }
  const uploader =
    body.uploader === null ? null : typeof body.uploader === "string" ? body.uploader.trim() : undefined;
  if (uploader === undefined) {
    return NextResponse.json({ error: "uploader must be a string or null" }, { status: 400 });
  }
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 300) : "";

  await setUploaderOverride({ dealId, docName, uploader, setBy: gate.email!, reason });
  return NextResponse.json({ ok: true, cleared: uploader === null });
}
