import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { endSession } from "@/lib/shit-show/hubspot-note";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;

  const result = await endSession(id);
  return NextResponse.json(result);
}
