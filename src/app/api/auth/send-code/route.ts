import { NextRequest, NextResponse } from "next/server";
import {
  generateVerificationCode,
  createVerificationToken,
  isAllowedEmail,
  checkRateLimit,
} from "@/lib/auth";
import { sendVerificationEmail } from "@/lib/email";

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email || typeof email !== "string") {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      );
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 }
      );
    }

    // Check if email is from allowed domain
    if (!isAllowedEmail(normalizedEmail)) {
      return NextResponse.json(
        { error: "Please use your Photon Brothers email address" },
        { status: 403 }
      );
    }

    // Check rate limit
    const rateLimit = checkRateLimit(normalizedEmail);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: `Too many requests. Please try again in ${rateLimit.retryAfter} seconds.`,
        },
        { status: 429 }
      );
    }

    // Generate verification code and create signed token
    const code = generateVerificationCode();
    const verificationToken = createVerificationToken(normalizedEmail, code);

    // Send email
    const emailResult = await sendVerificationEmail({
      to: normalizedEmail,
      code,
    });

    if (!emailResult.success) {
      return NextResponse.json(
        { error: emailResult.error || "Failed to send verification email" },
        { status: 500 }
      );
    }

    // Return the token - client must send it back when verifying
    return NextResponse.json({
      success: true,
      message: "Verification code sent",
      token: verificationToken,
    });
  } catch (error) {
    console.error("Error sending verification code:", error);
    return NextResponse.json(
      { error: "An error occurred" },
      { status: 500 }
    );
  }
}
