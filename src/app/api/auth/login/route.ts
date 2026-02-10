import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";

const AUTH_SALT = process.env.AUTH_SALT || "pb-ops-default-salt";

/** Generate a SHA-256 token from the password + salt */
function hashToken(password: string): string {
  return createHash("sha256")
    .update(password + AUTH_SALT)
    .digest("hex");
}

export async function POST(request: NextRequest) {
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
    }

    const { password } = body;
    const sitePassword = process.env.SITE_PASSWORD;

    if (!sitePassword) {
      // No password required
      return NextResponse.json({ success: true });
    }

    if (password === sitePassword) {
      const response = NextResponse.json({ success: true });

      // Set auth cookie with hashed token (not raw password)
      const token = hashToken(sitePassword);
      response.cookies.set("pb-auth", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 7, // 7 days
        path: "/",
      });

      return response;
    }

    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
