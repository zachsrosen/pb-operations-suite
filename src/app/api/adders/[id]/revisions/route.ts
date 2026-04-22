import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { listRevisions } from "@/lib/adders/catalog";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const revisions = await listRevisions(id);
  return NextResponse.json({ revisions });
}
