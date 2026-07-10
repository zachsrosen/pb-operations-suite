import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { decide } from "@/lib/production-check";
import { canDecide, forbidden, mapProductionCheckError } from "../../lib";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { email, roles } = authResult;

  if (!(await canDecide(email, roles))) return forbidden();

  try {
    const { id } = await params;
    const body = await req.json();
    const decision = body.decision;
    if (decision !== "yes" && decision !== "no") {
      return NextResponse.json({ error: 'decision must be "yes" or "no"' }, { status: 400 });
    }
    const result = await decide({
      id,
      decision,
      reason: body.reason ? String(body.reason) : undefined,
      decidedByEmail: email,
    });
    return NextResponse.json(result);
  } catch (err) {
    return mapProductionCheckError(err);
  }
}
