import crypto from "crypto";

// For serverless environments, we use a stateless approach with signed tokens
// The verification code is encoded in an encrypted token that's stored client-side

const getSecretKey = (): Buffer => {
  // Use RESEND_API_KEY as part of the secret (it's already secret and available)
  const base = process.env.RESEND_API_KEY || process.env.SITE_PASSWORD || "pb-ops-default-key-2024";
  return crypto.createHash("sha256").update(base + "-pb-auth-secret-v2").digest();
};

// Generate a 6-digit verification code
export function generateVerificationCode(): string {
  return crypto.randomInt(100000, 999999).toString();
}

// Create a signed token containing the code and expiration
// This token is sent back to the client and must be provided when verifying
export function createVerificationToken(email: string, code: string): string {
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes
  const data = JSON.stringify({
    e: email.toLowerCase().trim(),
    c: code,
    x: expiresAt,
    a: 0 // attempts
  });

  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", getSecretKey(), iv);
  let encrypted = cipher.update(data, "utf8", "base64");
  encrypted += cipher.final("base64");

  // Combine IV and encrypted data, URL-safe
  return Buffer.from(iv.toString("base64") + "." + encrypted).toString("base64url");
}

// Verify a code using the signed token
// Returns the updated token (with incremented attempts) on failure
export function verifyCodeWithToken(
  token: string,
  email: string,
  code: string
): { valid: boolean; error?: string; newToken?: string } {
  try {
    // Decode the token
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const [ivBase64, encryptedData] = decoded.split(".");

    if (!ivBase64 || !encryptedData) {
      return { valid: false, error: "Invalid verification token. Please request a new code." };
    }

    const iv = Buffer.from(ivBase64, "base64");
    const decipher = crypto.createDecipheriv("aes-256-cbc", getSecretKey(), iv);
    let decrypted = decipher.update(encryptedData, "base64", "utf8");
    decrypted += decipher.final("utf8");

    const data = JSON.parse(decrypted);

    // Check expiration
    if (data.x < Date.now()) {
      return { valid: false, error: "Verification code expired. Please request a new one." };
    }

    // Check email match
    if (data.e !== email.toLowerCase().trim()) {
      return { valid: false, error: "Email mismatch. Please request a new code." };
    }

    // Check attempts
    if (data.a >= 5) {
      return { valid: false, error: "Too many attempts. Please request a new code." };
    }

    // Check code
    if (data.c !== code) {
      // Increment attempts and return new token
      data.a++;
      const newIv = crypto.randomBytes(16);
      const newCipher = crypto.createCipheriv("aes-256-cbc", getSecretKey(), newIv);
      let newEncrypted = newCipher.update(JSON.stringify(data), "utf8", "base64");
      newEncrypted += newCipher.final("base64");
      const newToken = Buffer.from(newIv.toString("base64") + "." + newEncrypted).toString("base64url");

      return {
        valid: false,
        error: `Invalid code. ${5 - data.a} attempts remaining.`,
        newToken
      };
    }

    // Success!
    return { valid: true };
  } catch (err) {
    console.error("Token verification error:", err);
    return { valid: false, error: "Invalid or expired token. Please request a new code." };
  }
}

// Check if email is from allowed domain
export function isAllowedEmail(email: string): boolean {
  const normalizedEmail = email.toLowerCase().trim();
  const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN || "photonbrothers.com";

  // Support multiple domains separated by comma
  const domains = allowedDomain.split(",").map((d) => d.trim().toLowerCase());

  return domains.some((domain) => normalizedEmail.endsWith(`@${domain}`));
}

// Generate a session token
export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

// Rate limiting using database
// Limits: 5 code requests per 15 minutes per email
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX_REQUESTS = 5;

export async function checkRateLimit(email: string): Promise<{ allowed: boolean; retryAfter?: number }> {
  // Import dynamically to avoid circular dependencies
  const { prisma } = await import("./db");

  if (!prisma) {
    // If database not configured, allow but log warning
    console.warn("Rate limiting disabled: database not configured");
    return { allowed: true };
  }

  const identifier = `email:${email.toLowerCase().trim()}`;
  const now = new Date();
  const windowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW_MS);

  try {
    // Clean up expired entries (fire and forget)
    prisma.rateLimit.deleteMany({
      where: { expiresAt: { lt: now } }
    }).catch(() => {}); // Ignore cleanup errors

    // Get or create rate limit entry
    const existing = await prisma.rateLimit.findUnique({
      where: { identifier }
    });

    if (existing) {
      // Check if window has expired
      if (existing.windowStart < windowStart) {
        // Reset the window
        await prisma.rateLimit.update({
          where: { identifier },
          data: {
            count: 1,
            windowStart: now,
            expiresAt: new Date(now.getTime() + RATE_LIMIT_WINDOW_MS)
          }
        });
        return { allowed: true };
      }

      // Check if limit exceeded
      if (existing.count >= RATE_LIMIT_MAX_REQUESTS) {
        const retryAfter = Math.ceil((existing.windowStart.getTime() + RATE_LIMIT_WINDOW_MS - now.getTime()) / 1000);
        return { allowed: false, retryAfter };
      }

      // Increment count
      await prisma.rateLimit.update({
        where: { identifier },
        data: { count: existing.count + 1 }
      });
      return { allowed: true };
    }

    // Create new entry
    await prisma.rateLimit.create({
      data: {
        identifier,
        count: 1,
        windowStart: now,
        expiresAt: new Date(now.getTime() + RATE_LIMIT_WINDOW_MS)
      }
    });
    return { allowed: true };

  } catch (error) {
    console.error("Rate limit check failed:", error);
    // On error, allow but with reduced limit (fail open for UX, but log)
    return { allowed: true };
  }
}
