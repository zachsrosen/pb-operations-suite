/**
 * GET /api/solar/session
 *
 * Returns current user info or 401.
 * Includes pending recovery states for the user.
 */

import { NextResponse } from "next/server";
import { requireSolarAuth } from "@/lib/solar-auth";
import { prisma } from "@/lib/db";

export async function GET() {
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

  return NextResponse.json({
    data: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      pendingStates,
    },
  });
}
