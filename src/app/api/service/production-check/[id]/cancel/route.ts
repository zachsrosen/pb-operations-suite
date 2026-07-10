import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { cancelProductionCheck } from "@/lib/production-check";
import { CREATOR_ROLES, forbidden, hasAnyRole, mapProductionCheckError } from "../../lib";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { email, roles } = authResult;

  if (!hasAnyRole(roles, CREATOR_ROLES)) return forbidden();

  try {
    const { id } = await params;
    const result = await cancelProductionCheck({ id, cancelledByEmail: email });
    return NextResponse.json(result);
  } catch (err) {
    return mapProductionCheckError(err);
  }
}
