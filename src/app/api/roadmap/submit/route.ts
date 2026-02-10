import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

// Inline validation for roadmap submission
interface RoadmapSubmissionRequest {
  title?: unknown;
  description?: unknown;
  category?: unknown;
}

const VALID_CATEGORIES = ["performance", "features", "integrations", "ux", "analytics"];
const MAX_TITLE_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 500;

function validateRoadmapSubmission(data: unknown): data is { title: string; description: string; category: string } {
  if (!data || typeof data !== "object") return false;
  const req = data as RoadmapSubmissionRequest;

  return (
    typeof req.title === "string" &&
    req.title.length > 0 &&
    req.title.length <= MAX_TITLE_LENGTH &&
    typeof req.description === "string" &&
    req.description.length > 0 &&
    req.description.length <= MAX_DESCRIPTION_LENGTH &&
    typeof req.category === "string" &&
    VALID_CATEGORIES.includes(req.category)
  );
}

export async function POST(request: Request) {
  try {
    // Get the current user session
    const session = await auth();
    const userEmail = session?.user?.email;

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
    }

    // Validate request body
    if (!validateRoadmapSubmission(body)) {
      return NextResponse.json(
        {
          error: `Invalid request: title (1-${MAX_TITLE_LENGTH} chars), description (1-${MAX_DESCRIPTION_LENGTH} chars), and category (${VALID_CATEGORIES.join("|")}) are required`,
        },
        { status: 400 }
      );
    }

    const { title, description, category } = body;

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
