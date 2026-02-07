import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  try {
    // Get the current user session
    const session = await auth();
    const userEmail = session?.user?.email;

    const { title, description, category } = await request.json();

    // Validate input
    if (!title || !description) {
      return NextResponse.json(
        { error: "Title and description are required" },
        { status: 400 }
      );
    }

    if (title.length > 100) {
      return NextResponse.json(
        { error: "Title must be 100 characters or less" },
        { status: 400 }
      );
    }

    if (description.length > 500) {
      return NextResponse.json(
        { error: "Description must be 500 characters or less" },
        { status: 400 }
      );
    }

    const validCategories = ["performance", "features", "integrations", "ux", "analytics"];
    if (!validCategories.includes(category)) {
      return NextResponse.json(
        { error: "Invalid category" },
        { status: 400 }
      );
    }

    if (!prisma) {
      return NextResponse.json(
        { error: "Database not configured" },
        { status: 503 }
      );
    }

    // Create new item in database
    const newItem = await prisma.roadmapItem.create({
      data: {
        title: title.trim(),
        description: description.trim(),
        category,
        status: "under-review",
        votes: 1, // Auto-upvote by submitter
        isOfficial: false,
        submittedBy: userEmail ? userEmail.split("@")[0] : "Anonymous",
      },
    });

    return NextResponse.json({
      success: true,
      item: {
        id: newItem.id,
        title: newItem.title,
        description: newItem.description,
        category: newItem.category,
        status: newItem.status,
        votes: newItem.votes,
        isOfficial: newItem.isOfficial,
        submittedBy: newItem.submittedBy,
        createdAt: newItem.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("Failed to submit idea:", error);
    return NextResponse.json(
      { error: "Failed to submit idea" },
      { status: 500 }
    );
  }
}
