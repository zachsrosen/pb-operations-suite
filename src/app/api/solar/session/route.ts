/**
 * GET /api/solar/session
 *
 * Returns current user info or 401.
 * Includes pending recovery states for the user.
 * Sets csrf_token cookie for double-submit CSRF protection.
 */

import { NextResponse } from "next/server";
import { requireSolarAuth } from "@/lib/solar-auth";
import { prisma } from "@/lib/db";
import { randomBytes } from "crypto";

export async function GET(req: Request) {
  const [user, authError] = await requireSolarAuth();
  if (authError) return authError;

  // Fetch pending states for this user
  let pendingStates: Array<{
    id: string;
    projectId: string;
    projectName: string;
    version: number;
    createdAt: Date;
  }> = [];

  if (prisma) {
    const pending = await prisma.solarPendingState.findMany({
      where: { userId: user.id },
      include: {
        project: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    pendingStates = pending.map((p) => ({
      id: p.id,
      projectId: p.projectId,
      projectName: p.project.name,
      version: p.version,
      createdAt: p.createdAt,
    }));
  }

  // Generate CSRF token for double-submit cookie pattern.
  // Token is set as a cookie (readable by JS) and returned in the response
  // so the client can include it in X-CSRF-Token headers on mutations.
  const csrfToken = randomBytes(32).toString("hex");
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const isHttps = forwardedProto === "https" || process.env.NODE_ENV === "production";

  const response = NextResponse.json({
    data: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      csrfToken,
      pendingStates,
    },
  });

  // Set csrf_token cookie — NOT httpOnly so client JS can read it
  const cookieParts = [
    `csrf_token=${csrfToken}`,
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${7 * 24 * 60 * 60}`,
  ];
  if (isHttps) {
    cookieParts.push("Secure");
  }
  response.headers.append("Set-Cookie", cookieParts.join("; "));

  return response;
}
