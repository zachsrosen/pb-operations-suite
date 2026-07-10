import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { submitSolution } from "@/lib/production-check";
import { DESIGNER_ROLES, forbidden, hasAnyRole, mapProductionCheckError } from "../../lib";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { email, roles } = authResult;

  if (!hasAnyRole(roles, DESIGNER_ROLES)) return forbidden();

  try {
    const { id } = await params;
    const body = await req.json();
    const result = await submitSolution({
      id,
      proposedSolution: String(body.proposedSolution ?? ""),
      designerEmail: email,
    });
    return NextResponse.json(result);
  } catch (err) {
    return mapProductionCheckError(err);
  }
}
