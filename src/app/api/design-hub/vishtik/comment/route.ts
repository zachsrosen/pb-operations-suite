import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { requireApiAuth } from "@/lib/api-auth";
import {
  isDesignHubAllowedRole,
  isDesignHubEnabled,
} from "@/lib/design-hub/access";
import {
  isVishtikWriteEnabled,
  sendProjectComment,
} from "@/lib/vishtik-write";
import { batchReadDealsWithRetry } from "@/lib/hubspot";
import { prisma } from "@/lib/db";

const Schema = z.object({
  dealId: z.string().min(1),
  message: z.string().min(1).max(5000),
});

/**
 * POST /api/design-hub/vishtik/comment — post a message to a deal's Vishtik
 * project chat ("Send to Vishtik"). Double-gated: the design-hub role AND
 * VISHTIK_WRITE_ENABLED. The Vishtik project id is resolved server-side from
 * the deal — never taken from the client — so a caller can't target an
 * arbitrary Vishtik project.
 */
export async function POST(req: NextRequest) {
  if (!isDesignHubEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!isVishtikWriteEnabled()) {
    // Capability off ⇒ 404, not 403: don't advertise a disabled write path.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isDesignHubAllowedRole(auth.roles)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { dealId, message } = parsed.data;

  // Resolve the Vishtik project id from the deal (authoritative, server-side).
  const resp = await batchReadDealsWithRetry([dealId], ["vishtik_project_id", "dealname"]);
  const props = (resp?.results?.[0]?.properties ?? {}) as Record<string, string | null>;
  const vishtikProjectId = (props.vishtik_project_id ?? "").trim();
  if (!vishtikProjectId) {
    return NextResponse.json(
      { error: "This deal has no linked Vishtik project." },
      { status: 409 },
    );
  }

  try {
    const result = await sendProjectComment({ vishtikProjectId, message });

    // Audit every send attempt (dry-run included) — this writes to an external
    // system the team relies on, so the trail matters.
    try {
      await prisma.activityLog.create({
        data: {
          type: "HUBSPOT_DEAL_UPDATED",
          description: result.dryRun
            ? `Vishtik send (DRY-RUN) → ${props.dealname ?? dealId}`
            : `Sent to Vishtik → ${props.dealname ?? dealId}`,
          userEmail: auth.email,
          userName: auth.name,
          entityType: "deal",
          entityId: dealId,
          metadata: {
            vishtikProjectId,
            dryRun: result.dryRun,
            revisionRequested: result.revisionRequested,
            warnings: result.warnings,
            messagePreview: message.slice(0, 200),
          } as never,
        },
      });
    } catch {
      // Audit failure must not fail the send that already happened.
    }

    return NextResponse.json({
      ok: true,
      dryRun: result.dryRun,
      httpStatus: result.httpStatus,
      revisionRequested: result.revisionRequested,
      warnings: result.warnings,
    });
  } catch (err) {
    Sentry.captureException(err);
    const messageText = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: messageText }, { status: 502 });
  }
}
