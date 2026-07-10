import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { createProductionCheck, listProductionChecks } from "@/lib/production-check";
import {
  CREATOR_ROLES,
  DESIGNER_ROLES,
  canDecide,
  forbidden,
  hasAnyRole,
  mapProductionCheckError,
} from "./lib";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { email, roles } = authResult;

  try {
    const requests = await listProductionChecks();
    return NextResponse.json({
      requests,
      viewer: {
        canCreate: hasAnyRole(roles, CREATOR_ROLES),
        canSubmitSolution: hasAnyRole(roles, DESIGNER_ROLES),
        canDecide: await canDecide(email, roles),
      },
      lastUpdated: new Date().toISOString(),
    });
  } catch (err) {
    return mapProductionCheckError(err);
  }
}

export async function POST(req: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { email, roles } = authResult;

  if (!hasAnyRole(roles, CREATOR_ROLES)) return forbidden();

  try {
    const body = await req.json();
    const result = await createProductionCheck({
      dealId: String(body.dealId ?? ""),
      issueSummary: String(body.issueSummary ?? ""),
      zuperJobUid: body.zuperJobUid ? String(body.zuperJobUid) : null,
      hubspotTicketId: body.hubspotTicketId ? String(body.hubspotTicketId) : null,
      createdByEmail: email,
    });
    return NextResponse.json(result);
  } catch (err) {
    return mapProductionCheckError(err);
  }
}
