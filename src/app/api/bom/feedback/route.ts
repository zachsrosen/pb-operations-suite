import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

/* ---- POST /api/bom/feedback — submit extraction feedback ---- */
export async function POST(req: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  if (!prisma) return NextResponse.json({ error: "DB unavailable" }, { status: 503 });

  const body = await req.json() as {
    notes?: string;
    dealId?: string;
    dealName?: string;
  };

  const notes = (body.notes || "").trim();
  if (!notes) {
    return NextResponse.json({ error: "notes is required" }, { status: 400 });
  }

  const entry = await prisma.bomToolFeedback.create({
    data: {
      notes,
      dealId: body.dealId || null,
      dealName: body.dealName || null,
      submittedBy: authResult.email ?? "unknown",
    },
  });

  return NextResponse.json({ id: entry.id });
}

/* ---- GET /api/bom/feedback — return feedback as markdown for Claude ---- */
export async function GET(_req: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  if (!prisma) return NextResponse.json({ error: "DB unavailable" }, { status: 503 });

  const entries = await prisma.bomToolFeedback.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  if (entries.length === 0) {
    return new NextResponse("# BOM Tool Feedback\n\nNo feedback submitted yet.", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const lines: string[] = [
    "# BOM Tool Feedback",
    `_${entries.length} entr${entries.length === 1 ? "y" : "ies"}, most recent first_`,
    "",
  ];

  for (const entry of entries) {
    const date = entry.createdAt.toISOString().slice(0, 10);
    const deal = entry.dealName ? ` — ${entry.dealName}` : "";
    lines.push(`## ${date}${deal}`);
    if (entry.dealId) lines.push(`Deal ID: ${entry.dealId}`);
    lines.push(`Submitted by: ${entry.submittedBy}`);
    lines.push("");
    lines.push(entry.notes);
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return new NextResponse(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
