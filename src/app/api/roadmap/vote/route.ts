import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const { itemId } = await request.json();

    if (!itemId) {
      return NextResponse.json({ error: "Item ID required" }, { status: 400 });
    }

    if (!prisma) {
      // No database - return success anyway (vote tracked in localStorage)
      return NextResponse.json({
        success: true,
        item: { id: itemId, votes: 1 },
        note: "Vote tracked locally only",
      });
    }

    // Increment vote count in database
    const updated = await prisma.roadmapItem.update({
      where: { id: itemId },
      data: { votes: { increment: 1 } },
    });

    return NextResponse.json({
      success: true,
      item: {
        id: updated.id,
        votes: updated.votes,
      },
    });
  } catch (error) {
    console.error("Failed to vote:", error);
    return NextResponse.json({ error: "Failed to vote" }, { status: 500 });
  }
}
