import { NextResponse } from "next/server";
import { assertOnCallEnabled } from "@/lib/on-call-guard";
import { canAdminOnCall } from "@/lib/on-call-auth";
import { getCurrentUser } from "@/lib/auth-utils";
import { resolveElectricianByEmail } from "@/lib/on-call-db";
import { prisma, logActivity } from "@/lib/db";
import { safeWaitUntil } from "@/lib/safe-wait-until";
import { appendCallLogToSheet } from "@/lib/on-call-sheet";
import { createServiceTicket, findOrCreateContact } from "@/lib/hubspot-tickets";
import {
  ISSUE_TYPES,
  ISSUE_TYPE_VALUES,
  computeHoursWorked,
  type CallLogPayload,
} from "@/lib/on-call-call-log";

export const dynamic = "force-dynamic";

/**
 * GET /api/on-call/call-logs
 *   ?poolId=...           filter to one pool (otherwise all visible)
 *   ?from=YYYY-MM-DD       inclusive lower bound on callReceivedAt
 *   ?to=YYYY-MM-DD         inclusive upper bound on callReceivedAt
 *   ?reporterCrewMemberId  only this electrician's logs
 *
 * Visibility: any authenticated user with /api/on-call access can read.
 * The whole pool sees each other's logs so the next on-call shift has
 * context on what's already happened.
 */
export async function GET(req: Request) {
  const gate = assertOnCallEnabled();
  if (gate) return gate;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const poolId = url.searchParams.get("poolId") ?? undefined;
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const reporterCrewMemberId = url.searchParams.get("reporterCrewMemberId") ?? undefined;

  const dateFilter: { gte?: Date; lte?: Date } = {};
  if (from) {
    const [y, m, d] = from.split("-").map(Number);
    dateFilter.gte = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  }
  if (to) {
    const [y, m, d] = to.split("-").map(Number);
    // Inclusive end-of-day in UTC.
    dateFilter.lte = new Date(Date.UTC(y, m - 1, d, 23, 59, 59));
  }

  const logs = await prisma.onCallCallLog.findMany({
    where: {
      ...(poolId ? { poolId } : {}),
      ...(reporterCrewMemberId ? { reporterCrewMemberId } : {}),
      ...(Object.keys(dateFilter).length > 0 ? { callReceivedAt: dateFilter } : {}),
    },
    include: {
      reporterCrewMember: {
        select: { id: true, name: true, email: true },
      },
      pool: { select: { id: true, name: true, region: true, timezone: true } },
    },
    orderBy: { callReceivedAt: "desc" },
    take: 200,
  });

  return NextResponse.json({ logs });
}

/**
 * POST /api/on-call/call-logs
 *
 * Creates a call-log row. Caller must be an admin OR the reporter
 * themselves (verified via CrewMember.email match against session email).
 * Field validation: issueType must be in the whitelist; if dispatched,
 * arrivalAt is required and hoursWorked is auto-derived from arrival/completion.
 */
export async function POST(req: Request) {
  const gate = assertOnCallEnabled();
  if (gate) return gate;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json()) as CallLogPayload;
  if (!body.poolId || !body.reporterCrewMemberId || !body.callReceivedAt || !body.customerName || !body.issueType) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  if (!ISSUE_TYPE_VALUES.has(body.issueType)) {
    return NextResponse.json({ error: `Invalid issueType: ${body.issueType}` }, { status: 400 });
  }
  const issueTypeOther = typeof body.issueTypeOther === "string" ? body.issueTypeOther.trim() : "";
  if (body.issueType === "other" && !issueTypeOther) {
    return NextResponse.json(
      { error: "issueTypeOther is required when issueType is 'other'" },
      { status: 400 },
    );
  }

  // Reporter check: caller must be the reporter themselves OR an admin.
  const isAdmin = canAdminOnCall(user);
  if (!isAdmin) {
    const callerCrew = user.email ? await resolveElectricianByEmail(user.email) : null;
    if (!callerCrew || callerCrew.id !== body.reporterCrewMemberId) {
      return NextResponse.json(
        { error: "Forbidden: can only log calls as yourself" },
        { status: 403 },
      );
    }
  }

  const dispatched = Boolean(body.dispatched && !body.resolvedRemotely);
  const arrivalAt = dispatched && body.arrivalAt ? new Date(body.arrivalAt) : null;
  const completedAt = dispatched && body.completedAt ? new Date(body.completedAt) : null;
  // Server-derived hours so a tampered client can't post a bogus number.
  const hoursWorked = dispatched ? computeHoursWorked(arrivalAt, completedAt) : null;

  const log = await prisma.onCallCallLog.create({
    data: {
      poolId: body.poolId,
      reporterCrewMemberId: body.reporterCrewMemberId,
      callReceivedAt: new Date(body.callReceivedAt),
      customerName: body.customerName.trim(),
      customerPhone: typeof body.customerPhone === "string" ? body.customerPhone.trim() || null : null,
      customerAddress: typeof body.customerAddress === "string" ? body.customerAddress.trim() || null : null,
      issueType: body.issueType,
      issueTypeOther: body.issueType === "other" ? issueTypeOther : null,
      safetyRisk: Boolean(body.safetyRisk),
      homeHasPower: body.homeHasPower ?? null,
      troubleshootingAttempted: body.troubleshootingAttempted?.trim() || null,
      resolvedRemotely: Boolean(body.resolvedRemotely),
      dispatched,
      arrivalAt,
      completedAt,
      hoursWorked,
      escalatedTo: body.escalatedTo?.trim() || null,
      notes: body.notes?.trim() || null,
    },
    include: {
      reporterCrewMember: { select: { id: true, name: true, email: true } },
      pool: { select: { id: true, name: true, region: true, timezone: true } },
    },
  });

  await logActivity({
    type: "ON_CALL_CALL_LOGGED",
    description: `Call logged for ${log.customerName} (${log.issueType}) in ${log.pool.name}`,
    userId: user.id,
    userEmail: user.email,
    entityType: "OnCallCallLog",
    entityId: log.id,
  });

  if (process.env.ONCALL_HR_SHEET_ID) {
    safeWaitUntil(
      appendCallLogToSheet(log).catch((e) => {
        console.error("[on-call-sheet] append failed:", e);
      }),
    );
  }

  // Find or create HubSpot contact from phone (runs for every call, not just follow-ups).
  safeWaitUntil(
    (async () => {
      let contactId: string | null = null;
      if (log.customerPhone) {
        try {
          contactId = await findOrCreateContact({
            phone: log.customerPhone,
            name: log.customerName,
            address: log.customerAddress ?? undefined,
          });
          await prisma.onCallCallLog.update({
            where: { id: log.id },
            data: { hubspotContactId: contactId },
          });
        } catch (e) {
          console.error("[on-call/call-logs] HubSpot contact find/create failed:", e);
        }
      }

      const isFollowUp = !log.resolvedRemotely && !log.dispatched;
      if (isFollowUp) {
        const issueLabel = ISSUE_TYPES.find((t) => t.value === log.issueType)?.label ?? log.issueType;
        try {
          const ticketId = await createServiceTicket({
            subject: `On-Call Follow-Up: ${log.customerName} — ${issueLabel}`,
            content: [
              `Auto-created from on-call call log (${log.pool.name}).`,
              `Electrician: ${log.reporterCrewMember.name}`,
              `Date: ${log.callReceivedAt.toLocaleString("en-US", { timeZone: log.pool.timezone || "America/Denver" })}`,
              log.customerPhone ? `Phone: ${log.customerPhone}` : null,
              log.customerAddress ? `Address: ${log.customerAddress}` : null,
              log.troubleshootingAttempted ? `Troubleshooting: ${log.troubleshootingAttempted}` : null,
              log.escalatedTo ? `Escalated to: ${log.escalatedTo}` : null,
              log.notes ? `Notes: ${log.notes}` : null,
            ].filter(Boolean).join("\n"),
            priority: log.safetyRisk ? "HIGH" : "MEDIUM",
            contactId: contactId ?? undefined,
          });
          await prisma.onCallCallLog.update({
            where: { id: log.id },
            data: { hubspotTicketId: ticketId },
          });
        } catch (e) {
          console.error("[on-call/call-logs] HubSpot ticket creation failed:", e);
        }
      }
    })(),
  );

  return NextResponse.json({ log });
}
