/**
 * POST /api/portal/survey/invite
 *
 * Internal endpoint (requires auth + canScheduleSurveys).
 * Creates a survey invite for a customer and sends the scheduling email.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma, logActivity } from "@/lib/db";
import { getUserPermissions } from "@/lib/db";
import { generateToken, hasActiveInvite } from "@/lib/portal-token";
import { render } from "@react-email/render";
import { SurveyInviteEmail } from "@/emails/SurveyInviteEmail";
import { sendPortalEmail } from "@/lib/email";

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

  // Auth check
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Permission check
  const permissions = await getUserPermissions(session.user.email);
  if (!permissions?.canScheduleSurveys) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  // Parse body
  let body: z.infer<typeof InviteSchema>;
  try {
    body = InviteSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Check for existing active invite (app-level fast-path)
  if (await hasActiveInvite(body.dealId)) {
    return NextResponse.json(
      { error: "An active survey invite already exists for this deal" },
      { status: 409 },
    );
  }

  // Generate token
  const { raw, hash } = generateToken();

  // Build portal URL — prefer custom domain for customer-facing links
  const baseUrl = process.env.PORTAL_BASE_URL
    || process.env.NEXTAUTH_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  const portalUrl = `${baseUrl}/portal/survey/${raw}`;

  // Create invite
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days

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
        sentBy: session.user.email,
        sentAt: new Date(),
      },
    });

    // Send invite email via Google Workspace (falls back to Resend)
    let emailSent = false;
    try {
      const html = await render(
        SurveyInviteEmail({
          customerName: body.customerName,
          propertyAddress: body.propertyAddress,
          portalUrl,
        }),
      );

      const result = await sendPortalEmail({
        to: body.customerEmail,
        subject: "Schedule Your Site Survey - Photon Brothers",
        html,
        senderEmail: session.user.email!,
        senderName: session.user.name || undefined,
      });

      emailSent = result.success;
      if (!result.success) {
        console.error("[portal/invite] Failed to send email:", result.error);
      }
    } catch (emailError) {
      console.error("[portal/invite] Failed to send email:", emailError);
      // Don't fail the invite creation — email can be resent
    }

    // Log activity
    await logActivity({
      type: "PORTAL_INVITE_CREATED",
      description: `Survey invite created for ${body.customerName} (${body.dealId})`,
      userEmail: session.user.email,
      userName: session.user.name || undefined,
      entityType: "survey_invite",
      entityId: invite.id,
      entityName: body.customerName,
      pbLocation: body.pbLocation,
      metadata: {
        dealId: body.dealId,
        customerEmail: body.customerEmail,
        emailSent,
        source: "internal",
      },
    });

    return NextResponse.json({
      id: invite.id,
      portalUrl,
      emailSent,
      expiresAt: expiresAt.toISOString(),
    }, { status: 201 });
  } catch (error) {
    // Partial unique index violation (concurrent invite creation)
    if (isPrismaUniqueViolation(error)) {
      return NextResponse.json(
        { error: "An active survey invite already exists for this deal" },
        { status: 409 },
      );
    }

    console.error("[portal/invite] Unexpected error:", error);
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
