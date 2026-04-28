/**
 * /api/pm-flags
 *
 * GET  — list flags. Default scope: flags assigned to the calling user.
 *        ?scope=all (admins, OWNER, OPERATIONS_MANAGER) lists everything.
 *        ?scope=unassigned lists null-assignee flags.
 *        Filters: status, severity, type, hubspotDealId.
 *
 * POST — create a flag. Two auth paths:
 *        1. Logged-in user (manual flag from in-app UI)
 *        2. API_SECRET_TOKEN bearer (HubSpot workflow callout)
 *        Idempotent on (source, externalRef) — see lib/pm-flags.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireApiAuth } from "@/lib/api-auth";
import { createFlag, listFlags } from "@/lib/pm-flags";
import {
  PmFlagType,
  PmFlagSeverity,
  PmFlagSource,
  PmFlagStatus,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";

const ADMIN_LIKE_ROLES = new Set(["ADMIN", "OWNER", "EXECUTIVE", "OPERATIONS_MANAGER"]);

function isAdminLike(roles: string[]): boolean {
  return roles.some(r => ADMIN_LIKE_ROLES.has(r));
}

// =============================================================================
// GET
// =============================================================================

export async function GET(req: NextRequest) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") ?? "mine";
  const statusParam = url.searchParams.getAll("status") as PmFlagStatus[];
  const severityParam = url.searchParams.getAll("severity") as PmFlagSeverity[];
  const typeParam = url.searchParams.getAll("type") as PmFlagType[];
  const dealIdParam = url.searchParams.get("hubspotDealId") ?? undefined;

  const status =
    statusParam.length > 0 ? statusParam : (["OPEN", "ACKNOWLEDGED"] as PmFlagStatus[]);

  // Resolve calling user → DB id (machine tokens have synthetic email "api@system",
  // which won't have a User row; admin scope is implicit for them).
  const me = auth.email === "api@system"
    ? null
    : await prisma.user.findUnique({ where: { email: auth.email }, select: { id: true } });

  const filter = {
    status,
    severity: severityParam.length > 0 ? severityParam : undefined,
    type: typeParam.length > 0 ? typeParam : undefined,
    hubspotDealId: dealIdParam,
  };

  if (scope === "all") {
    if (!isAdminLike(auth.roles)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ flags: await listFlags(filter) });
  }
  if (scope === "unassigned") {
    if (!isAdminLike(auth.roles)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ flags: await listFlags({ ...filter, assignedToUserId: null }) });
  }

  // Default: mine
  if (!me) {
    return NextResponse.json({ flags: [] });
  }
  return NextResponse.json({
    flags: await listFlags({ ...filter, assignedToUserId: me.id }),
  });
}

// =============================================================================
// POST
// =============================================================================

const createSchema = z.object({
  hubspotDealId: z.string().min(1),
  dealName: z.string().optional().nullable(),
  type: z.nativeEnum(PmFlagType),
  severity: z.nativeEnum(PmFlagSeverity),
  reason: z.string().min(1).max(5000),
  source: z.nativeEnum(PmFlagSource).optional(),
  externalRef: z.string().optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
});

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const isMachineToken = auth.email === "api@system";

  // Source defaults: machine token → HUBSPOT_WORKFLOW (override allowed for ADMIN_WORKFLOW),
  // logged-in user → MANUAL.
  const source: PmFlagSource =
    parsed.data.source
      ?? (isMachineToken ? PmFlagSource.HUBSPOT_WORKFLOW : PmFlagSource.MANUAL);

  // Resolve raisedByUserId for in-app flags.
  let raisedByUserId: string | null = null;
  if (!isMachineToken) {
    const user = await prisma.user.findUnique({
      where: { email: auth.email },
      select: { id: true },
    });
    raisedByUserId = user?.id ?? null;
  }

  const result = await createFlag({
    hubspotDealId: parsed.data.hubspotDealId,
    dealName: parsed.data.dealName ?? null,
    type: parsed.data.type,
    severity: parsed.data.severity,
    reason: parsed.data.reason,
    source,
    externalRef: parsed.data.externalRef ?? null,
    metadata: parsed.data.metadata ?? null,
    raisedByUserId,
    raisedByEmail: isMachineToken ? null : auth.email,
  });

  // Fire-and-forget assignment email (don't block the response on SMTP).
  if (!result.alreadyExisted && result.flag.assignedToUser) {
    void import("@/lib/pm-flag-email").then(m =>
      m.sendFlagAssignedEmail(result.flag).catch(err => {
        console.error("PM flag email send failed", err);
      })
    );
  }

  return NextResponse.json(
    { flag: result.flag, alreadyExisted: result.alreadyExisted },
    { status: result.alreadyExisted ? 200 : 201 }
  );
}
