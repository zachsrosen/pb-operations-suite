/**
 * API Route Authentication Helper
 *
 * Provides a consistent auth check for API routes.
 * Import and call at the top of any API handler.
 */

import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { headers } from "next/headers";

export interface AuthenticatedUser {
  email: string;
  name?: string;
  role: string;
  ip: string;
  userAgent: string;
}

/**
 * Require authentication for an API route.
 * Returns the authenticated user or a 401 NextResponse.
 *
 * Usage:
 * ```ts
 * const authResult = await requireApiAuth();
 * if (authResult instanceof NextResponse) return authResult;
 * const { email, role } = authResult;
 * ```
 */
export async function requireApiAuth(): Promise<AuthenticatedUser | NextResponse> {
  const session = await auth();

  if (!session?.user?.email) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 }
    );
  }

  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() || hdrs.get("x-real-ip") || "unknown";
  const userAgent = hdrs.get("user-agent") || "unknown";

  return {
    email: session.user.email,
    name: session.user.name || undefined,
    role: session.user.role || "TECH_OPS",
    ip,
    userAgent,
  };
}
