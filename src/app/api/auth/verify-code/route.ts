import { NextRequest, NextResponse } from "next/server";
import { verifyCodeWithToken, generateSessionToken, isAllowedEmail } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
    }

    const { email, code, token } = body;

    if (!email || typeof email !== "string") {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      );
    }

    if (!code || typeof code !== "string") {
      return NextResponse.json(
        { error: "Verification code is required" },
        { status: 400 }
      );
    }

    if (!token || typeof token !== "string") {
      return NextResponse.json(
        { error: "Verification token is required. Please request a new code." },
        { status: 400 }
      );
    }

    const normalizedEmail = email.toLowerCase().trim();
    const normalizedCode = code.trim();

    // Double check email is allowed
    if (!isAllowedEmail(normalizedEmail)) {
      return NextResponse.json(
        { error: "Please use your Photon Brothers email address" },
        { status: 403 }
      );
    }

    // Verify the code with the token
    const result = verifyCodeWithToken(token, normalizedEmail, normalizedCode);

    if (!result.valid) {
      return NextResponse.json(
        {
          error: result.error,
          // Return new token with incremented attempts if available
          token: result.newToken,
        },
        { status: 401 }
      );
    }

    // Generate session token
    const sessionToken = generateSessionToken();

    // Create response with session cookie
    const response = NextResponse.json({
      success: true,
      email: normalizedEmail,
    });

    // Set auth cookie with session token
    const cookieValue = JSON.stringify({
      token: sessionToken,
      email: normalizedEmail,
      createdAt: Date.now(),
    });

    response.cookies.set("pb-auth", cookieValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("Error verifying code:", error);
    return NextResponse.json(
      { error: "An error occurred" },
      { status: 500 }
    );
  }
}
