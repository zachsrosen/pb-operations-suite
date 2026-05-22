/**
 * POST /api/portal/survey/invite/service
 *
 * Service-to-service endpoint for Olivia (project-manager bot).
 * Creates a survey invite and returns the portal URL — does NOT
 * send any customer email.  Olivia owns outbound messaging.
 *
 * Auth: Bearer API_SECRET_TOKEN (same as other machine-to-machine routes).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma, logActivity } from "@/lib/db";
import { generateToken, hasActiveInvite } from "@/lib/portal-token";

const InviteSchema = z.object({
  dealId: z.string().min(1),
  customerEmail: z.string().email(),
  customerName: z.string().min(1),
  propertyAddress: z.string().min(1),
  pbLocation: z.string().min(1),
  systemSize: z.number().positive().optional(),
  customerPhone: z.string().optional(),
});

export async function POST(request: NextRequest) {
  if (!prisma) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  // Service-to-service bearer token auth
  const authHeader = request.headers.get("authorization");
  const apiSecretToken = process.env.API_SECRET_TOKEN;
  if (!apiSecretToken || authHeader !== `Bearer ${apiSecretToken}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Parse body
  let body: z.infer<typeof InviteSchema>;
  try {
    body = InviteSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Dedup: reject if an active invite already exists for this deal
  if (await hasActiveInvite(body.dealId)) {
    return NextResponse.json(
      { error: "An active survey invite already exists for this deal" },
      { status: 409 },
    );
  }

  const { raw, hash } = generateToken();

  const baseUrl = process.env.PORTAL_BASE_URL
    || process.env.NEXTAUTH_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  const portalUrl = `${baseUrl}/portal/survey/${raw}`;

  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  try {
    const invite = await prisma.surveyInvite.create({
      data: {
        tokenHash: hash,
        dealId: body.dealId,
        customerEmail: body.customerEmail,
        customerName: body.customerName,
        customerPhone: body.customerPhone,
        propertyAddress: body.propertyAddress,
        pbLocation: body.pbLocation,
        systemSize: body.systemSize,
        expiresAt,
        sentBy: "olivia@service",
        sentAt: new Date(),
      },
    });

    await logActivity({
      type: "PORTAL_INVITE_CREATED",
      description: `Survey invite auto-created by Olivia for ${body.customerName} (${body.dealId})`,
      userEmail: "olivia@service",
      userName: "Olivia (service)",
      entityType: "survey_invite",
      entityId: invite.id,
      entityName: body.customerName,
      pbLocation: body.pbLocation,
      metadata: {
        dealId: body.dealId,
        customerEmail: body.customerEmail,
        source: "olivia",
      },
    });

    return NextResponse.json({
      id: invite.id,
      portalUrl,
      expiresAt: expiresAt.toISOString(),
    }, { status: 201 });
  } catch (error) {
    if (isPrismaUniqueViolation(error)) {
      return NextResponse.json(
        { error: "An active survey invite already exists for this deal" },
        { status: 409 },
      );
    }

    console.error("[portal/invite/service] Unexpected error:", error);
    return NextResponse.json({ error: "Failed to create invite" }, { status: 500 });
  }
}

function isPrismaUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "P2002"
  );
}
