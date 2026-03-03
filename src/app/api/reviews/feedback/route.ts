import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

/* ---- POST /api/reviews/feedback — submit design review feedback ---- */
export async function POST(req: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  if (!prisma) return NextResponse.json({ error: "DB unavailable" }, { status: 503 });

  const body = (await req.json()) as {
    reviewId?: string;
    rating?: string;
    notes?: string;
    dealId?: string;
    dealName?: string;
  };

  const rating = body.rating;
  if (rating !== "positive" && rating !== "negative") {
    return NextResponse.json({ error: "rating must be 'positive' or 'negative'" }, { status: 400 });
  }

  const entry = await prisma.designReviewFeedback.create({
    data: {
      reviewId: body.reviewId || null,
      rating,
      notes: (body.notes || "").trim() || null,
      dealId: body.dealId || null,
      dealName: body.dealName || null,
      submittedBy: authResult.email ?? "unknown",
    },
  });

  return NextResponse.json({ id: entry.id });
}

/* ---- GET /api/reviews/feedback — return feedback as markdown for Claude ---- */
export async function GET(_req: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  if (!prisma) return NextResponse.json({ error: "DB unavailable" }, { status: 503 });

  const entries = await prisma.designReviewFeedback.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  if (entries.length === 0) {
    return new NextResponse("# Design Review Feedback\n\nNo feedback submitted yet.", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const lines: string[] = [
    "# Design Review Feedback",
    `_${entries.length} entr${entries.length === 1 ? "y" : "ies"}, most recent first_`,
    "",
  ];

  for (const entry of entries) {
    const date = entry.createdAt.toISOString().slice(0, 10);
    const deal = entry.dealName ? ` — ${entry.dealName}` : "";
    const emoji = entry.rating === "positive" ? "👍" : "👎";
    lines.push(`## ${emoji} ${date}${deal}`);
    if (entry.dealId) lines.push(`Deal ID: ${entry.dealId}`);
    if (entry.reviewId) lines.push(`Review ID: ${entry.reviewId}`);
    lines.push(`Submitted by: ${entry.submittedBy}`);
    lines.push("");
    if (entry.notes) {
      lines.push(entry.notes);
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  }

  return new NextResponse(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
