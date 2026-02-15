import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { logActivity } from "@/lib/db";
import { headers } from "next/headers";

export async function POST() {
  // Log the logout event
  const session = await auth();
  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const userAgent = hdrs.get("user-agent") || "unknown";
  if (session?.user?.email) {
    await logActivity({
      type: "LOGOUT",
      description: `${session.user.name || session.user.email} logged out`,
      userEmail: session.user.email,
      userName: session.user.name || undefined,
      ipAddress: ip,
      userAgent,
    });
  }

  return NextResponse.json({ success: true });
}

// Also support GET for simple logout links
export async function GET() {
  // Log the logout event
  const session = await auth();
  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const userAgent = hdrs.get("user-agent") || "unknown";
  if (session?.user?.email) {
    await logActivity({
      type: "LOGOUT",
      description: `${session.user.name || session.user.email} logged out`,
      userEmail: session.user.email,
      userName: session.user.name || undefined,
      ipAddress: ip,
      userAgent,
    });
  }

  return NextResponse.redirect(new URL("/login", process.env.NEXT_PUBLIC_URL || "http://localhost:3000"));
}
