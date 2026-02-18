import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";
import crypto from "crypto";

/**
 * GET /api/debug/notifications
 *
 * Diagnostic endpoint to verify email (Google Workspace + Resend) and
 * Google Calendar integrations.  Admin-only, production-gated.
 *
 * Returns step-by-step checks so you can see exactly which piece is failing.
 */
export async function GET() {
  if (process.env.NODE_ENV === "production" && process.env.DEBUG_API_ENABLED !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const user = await getUserByEmail(session.user.email);
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const results: Record<string, unknown> = {};

  // ─── 1. Env var checks ───────────────────────────────────────────────
  const envChecks: Record<string, string> = {};
  const checkEnv = (name: string) => {
    const val = process.env[name];
    if (!val) return "❌ NOT SET";
    if (val.length > 50) return `✅ set (${val.length} chars)`;
    // Mask sensitive values
    if (name.includes("KEY") || name.includes("SECRET") || name.includes("PRIVATE")) {
      return `✅ set (${val.length} chars, starts with "${val.slice(0, 6)}…")`;
    }
    return `✅ ${val}`;
  };

  envChecks["GOOGLE_WORKSPACE_EMAIL_ENABLED"] = checkEnv("GOOGLE_WORKSPACE_EMAIL_ENABLED");
  envChecks["GOOGLE_CALENDAR_SYNC_ENABLED"] = checkEnv("GOOGLE_CALENDAR_SYNC_ENABLED");
  envChecks["GOOGLE_SERVICE_ACCOUNT_EMAIL"] = checkEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  envChecks["GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"] = checkEnv("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY");
  envChecks["GOOGLE_ADMIN_EMAIL"] = checkEnv("GOOGLE_ADMIN_EMAIL");
  envChecks["GOOGLE_EMAIL_SENDER"] = checkEnv("GOOGLE_EMAIL_SENDER");
  envChecks["EMAIL_FROM"] = checkEnv("EMAIL_FROM");
  envChecks["GOOGLE_SITE_SURVEY_CALENDAR_ID"] = checkEnv("GOOGLE_SITE_SURVEY_CALENDAR_ID");
  envChecks["RESEND_API_KEY"] = checkEnv("RESEND_API_KEY");
  results.envVars = envChecks;

  // ─── 2. Sender email resolution ─────────────────────────────────────
  const parseEmail = (input?: string): string | null => {
    if (!input) return null;
    const trimmed = input.trim();
    const bracketMatch = trimmed.match(/<([^>]+)>/);
    const candidate = (bracketMatch?.[1] || trimmed).trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
  };

  const senderEmail =
    parseEmail(process.env.GOOGLE_EMAIL_SENDER) ||
    parseEmail(process.env.EMAIL_FROM) ||
    parseEmail(process.env.GOOGLE_ADMIN_EMAIL);

  results.resolvedSenderEmail = senderEmail || "❌ Could not resolve any sender email";

  // ─── 3. Private key parsing ──────────────────────────────────────────
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  let privateKey: string | null = null;
  let keyParseError: string | null = null;

  if (rawKey) {
    try {
      const decoded = Buffer.from(rawKey, "base64").toString("utf-8");
      if (decoded.includes("-----BEGIN")) {
        privateKey = decoded;
      } else {
        // Not base64 — try raw with newline replacement
        const raw = rawKey.replace(/\\n/g, "\n");
        if (raw.includes("-----BEGIN")) {
          privateKey = raw;
        } else {
          keyParseError = "Key does not contain '-----BEGIN' marker after decoding";
        }
      }
    } catch {
      const raw = rawKey.replace(/\\n/g, "\n");
      if (raw.includes("-----BEGIN")) {
        privateKey = raw;
      } else {
        keyParseError = "Failed to decode key (not valid base64 and no PEM markers found)";
      }
    }
  }

  results.privateKeyParsed = privateKey
    ? `✅ parsed (starts: ${privateKey.slice(0, 30)}…)`
    : `❌ ${keyParseError || "No key provided"}`;

  // ─── 4. JWT signing test ─────────────────────────────────────────────
  if (privateKey) {
    try {
      const testData = "test-signing-data";
      const sign = crypto.createSign("RSA-SHA256");
      sign.update(testData);
      sign.end();
      const sig = sign.sign(privateKey, "base64");
      results.jwtSigning = `✅ RSA-SHA256 signing works (signature: ${sig.slice(0, 20)}…)`;
    } catch (err) {
      results.jwtSigning = `❌ RSA-SHA256 signing failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  } else {
    results.jwtSigning = "⏭️ skipped (no private key)";
  }

  // ─── 5. Google OAuth token exchange (Gmail scope) ────────────────────
  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;

  if (privateKey && serviceAccountEmail && senderEmail) {
    try {
      const now = Math.floor(Date.now() / 1000);
      const b64url = (s: string) =>
        Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

      const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
      const claims = b64url(
        JSON.stringify({
          iss: serviceAccountEmail,
          sub: senderEmail,
          scope: "https://www.googleapis.com/auth/gmail.send",
          aud: "https://oauth2.googleapis.com/token",
          iat: now,
          exp: now + 3600,
        })
      );

      const sign = crypto.createSign("RSA-SHA256");
      sign.update(`${header}.${claims}`);
      sign.end();
      const signature = sign
        .sign(privateKey, "base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");

      const jwt = `${header}.${claims}.${signature}`;

      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion: jwt,
        }),
      });

      const tokenData = await tokenRes.json();

      if (tokenData.access_token) {
        results.gmailTokenExchange = `✅ Got Gmail access token (expires in ${tokenData.expires_in}s)`;

        // Quick test: can we read the sender profile?
        const profileRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(senderEmail)}/profile`,
          { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
        );
        if (profileRes.ok) {
          const profile = await profileRes.json();
          results.gmailProfile = `✅ Sender verified: ${profile.emailAddress} (${profile.messagesTotal} messages)`;
        } else {
          const errText = await profileRes.text().catch(() => "");
          results.gmailProfile = `❌ Gmail profile check failed: ${profileRes.status} ${errText.slice(0, 200)}`;
        }
      } else {
        results.gmailTokenExchange = `❌ Token exchange failed: ${tokenData.error} — ${tokenData.error_description}`;
      }
    } catch (err) {
      results.gmailTokenExchange = `❌ Exception: ${err instanceof Error ? err.message : String(err)}`;
    }
  } else {
    results.gmailTokenExchange = `⏭️ skipped (missing: ${
      [!privateKey && "private key", !serviceAccountEmail && "service account email", !senderEmail && "sender email"]
        .filter(Boolean)
        .join(", ")
    })`;
  }

  // ─── 6. Google Calendar token exchange ───────────────────────────────
  if (privateKey && serviceAccountEmail && senderEmail) {
    try {
      const now = Math.floor(Date.now() / 1000);
      const b64url = (s: string) =>
        Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

      const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
      const claims = b64url(
        JSON.stringify({
          iss: serviceAccountEmail,
          sub: senderEmail,
          scope: "https://www.googleapis.com/auth/calendar.events",
          aud: "https://oauth2.googleapis.com/token",
          iat: now,
          exp: now + 3600,
        })
      );

      const sign = crypto.createSign("RSA-SHA256");
      sign.update(`${header}.${claims}`);
      sign.end();
      const signature = sign
        .sign(privateKey, "base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");

      const jwt = `${header}.${claims}.${signature}`;

      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion: jwt,
        }),
      });

      const tokenData = await tokenRes.json();

      if (tokenData.access_token) {
        results.calendarTokenExchange = `✅ Got Calendar access token (expires in ${tokenData.expires_in}s)`;

        // Quick test: list calendars
        const calId = (process.env.GOOGLE_SITE_SURVEY_CALENDAR_ID || "primary").trim();
        const calRes = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}`,
          { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
        );
        if (calRes.ok) {
          const cal = await calRes.json();
          results.calendarAccess = `✅ Calendar accessible: "${cal.summary}" (${cal.id})`;
        } else {
          const errText = await calRes.text().catch(() => "");
          results.calendarAccess = `❌ Calendar access failed (calId: "${calId}"): ${calRes.status} ${errText.slice(0, 200)}`;
        }
      } else {
        results.calendarTokenExchange = `❌ Token exchange failed: ${tokenData.error} — ${tokenData.error_description}`;
      }
    } catch (err) {
      results.calendarTokenExchange = `❌ Exception: ${err instanceof Error ? err.message : String(err)}`;
    }
  } else {
    results.calendarTokenExchange = `⏭️ skipped (same prereqs as Gmail)`;
  }

  // ─── 7. Resend check ────────────────────────────────────────────────
  if (process.env.RESEND_API_KEY) {
    try {
      const { Resend } = await import("resend");
      const resend = new Resend(process.env.RESEND_API_KEY);
      const domains = await resend.domains.list();
      results.resend = `✅ Resend connected (${(domains.data?.data || []).length} domains)`;
    } catch (err) {
      results.resend = `❌ Resend error: ${err instanceof Error ? err.message : String(err)}`;
    }
  } else {
    results.resend = "⏭️ RESEND_API_KEY not set";
  }

  // ─── 8. Summary ─────────────────────────────────────────────────────
  const issues: string[] = [];
  const checkStr = (val: unknown) => typeof val === "string" && val.startsWith("❌");

  if (checkStr(results.resolvedSenderEmail)) issues.push("No sender email resolved");
  if (checkStr(results.privateKeyParsed)) issues.push("Private key parse failure");
  if (checkStr(results.jwtSigning)) issues.push("RSA signing failure (bad key format?)");
  if (checkStr(results.gmailTokenExchange)) issues.push("Gmail token exchange failed (check domain-wide delegation for gmail.send scope)");
  if (checkStr(results.gmailProfile)) issues.push("Gmail profile check failed");
  if (checkStr(results.calendarTokenExchange)) issues.push("Calendar token exchange failed (check domain-wide delegation for calendar.events scope)");
  if (checkStr(results.calendarAccess)) issues.push("Calendar not accessible");

  results.summary = issues.length === 0
    ? "✅ All checks passed"
    : `⚠️ ${issues.length} issue(s): ${issues.join("; ")}`;

  return NextResponse.json(results, { status: 200 });
}
