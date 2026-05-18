import { NextResponse } from "next/server";
import { getAvl } from "@/lib/pe-avl";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const avl = await getAvl();
    return NextResponse.json(avl);
  } catch (err) {
    console.error("[pe-avl] API error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch AVL" },
      { status: 500 },
    );
  }
}
