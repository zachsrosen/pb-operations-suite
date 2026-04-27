import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

/**
 * Search past Shit Show session items by deal name, meeting notes, or
 * decision rationale.
 */
export async function GET(req: NextRequest) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";

  const items = await prisma.shitShowSessionItem.findMany({
    where: q
      ? {
          OR: [
            { dealName: { contains: q, mode: "insensitive" } },
            { meetingNotes: { contains: q, mode: "insensitive" } },
            { decisionRationale: { contains: q, mode: "insensitive" } },
          ],
        }
      : {},
    include: { session: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ items });
}
