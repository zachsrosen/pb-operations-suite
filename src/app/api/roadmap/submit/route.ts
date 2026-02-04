import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { auth } from "@/auth";
import type { RoadmapItem } from "../route";

const DATA_FILE = path.join(process.cwd(), "data", "roadmap.json");

async function loadItems(): Promise<RoadmapItem[]> {
  try {
    const data = await fs.readFile(DATA_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    // Import defaults from main route
    const { GET } = await import("../route");
    const response = await GET();
    const data = await response.json();
    return data.items;
  }
}

async function saveItems(items: RoadmapItem[]) {
  const dataDir = path.join(process.cwd(), "data");
  try {
    await fs.access(dataDir);
  } catch {
    await fs.mkdir(dataDir, { recursive: true });
  }
  await fs.writeFile(DATA_FILE, JSON.stringify(items, null, 2));
}

function generateId(): string {
  return `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

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

    // Create new item
    const newItem: RoadmapItem = {
      id: generateId(),
      title: title.trim(),
      description: description.trim(),
      category,
      status: "under-review",
      votes: 1, // Auto-upvote by submitter
      isOfficial: false,
      submittedBy: userEmail ? userEmail.split("@")[0] : "Anonymous",
      createdAt: new Date().toISOString(),
    };

    // Load existing items and add new one
    const items = await loadItems();
    items.unshift(newItem); // Add to beginning
    await saveItems(items);

    return NextResponse.json({
      success: true,
      item: newItem,
    });
  } catch (error) {
    console.error("Failed to submit idea:", error);
    return NextResponse.json(
      { error: "Failed to submit idea" },
      { status: 500 }
    );
  }
}
