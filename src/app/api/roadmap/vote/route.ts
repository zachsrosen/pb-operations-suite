import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
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

export async function POST(request: Request) {
  try {
    const { itemId } = await request.json();

    if (!itemId) {
      return NextResponse.json({ error: "Item ID required" }, { status: 400 });
    }

    const items = await loadItems();
    const item = items.find(i => i.id === itemId);

    if (!item) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    // Increment vote count
    item.votes += 1;
    await saveItems(items);

    return NextResponse.json({
      success: true,
      item: {
        id: item.id,
        votes: item.votes
      }
    });
  } catch (error) {
    console.error("Failed to vote:", error);
    return NextResponse.json({ error: "Failed to vote" }, { status: 500 });
  }
}
