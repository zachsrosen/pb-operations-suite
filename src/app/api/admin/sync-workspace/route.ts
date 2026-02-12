import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma, getOrCreateUser, getUserByEmail, logActivity } from "@/lib/db";

/**
 * POST /api/admin/sync-workspace
 * Sync users from Google Workspace Directory API
 *
 * Requires:
 * - GOOGLE_SERVICE_ACCOUNT_EMAIL: Service account email
 * - GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: Service account private key (base64 encoded)
 * - GOOGLE_WORKSPACE_DOMAIN: Your Google Workspace domain
 * - GOOGLE_ADMIN_EMAIL: An admin email to impersonate for API calls
 */
export async function POST() {
  const session = await auth();

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  // Check if user is admin - fetch from DB since JWT may be stale
  const currentUser = await getUserByEmail(session.user.email);
  if (!currentUser || currentUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  // Check for required environment variables
  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  const workspaceDomain = process.env.GOOGLE_WORKSPACE_DOMAIN || "photonbrothers.com";
  const adminEmail = process.env.GOOGLE_ADMIN_EMAIL;

  if (!serviceAccountEmail || !serviceAccountKey || !adminEmail) {
    return NextResponse.json({
      error: "Google Workspace sync not configured. Required: GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY, GOOGLE_ADMIN_EMAIL",
      configured: false
    }, { status: 400 });
  }

  try {
    // Decode the private key (stored as base64 to handle newlines)
    let privateKey: string;
    try {
      privateKey = Buffer.from(serviceAccountKey, 'base64').toString('utf-8');
    } catch {
      // If not base64, assume it's already the raw key
      privateKey = serviceAccountKey.replace(/\\n/g, '\n');
    }

    // Get an access token using the service account
    const tokenResponse = await getServiceAccountToken(
      serviceAccountEmail,
      privateKey,
      adminEmail,
      ['https://www.googleapis.com/auth/admin.directory.user.readonly']
    );

    if (!tokenResponse.access_token) {
      console.error("Failed to get access token:", tokenResponse);
      return NextResponse.json({
        error: "Failed to authenticate with Google Workspace",
        details: tokenResponse.error_description || "Unknown error"
      }, { status: 500 });
    }

    // Fetch users from Google Workspace Directory API
    const usersResponse = await fetch(
      `https://admin.googleapis.com/admin/directory/v1/users?domain=${workspaceDomain}&maxResults=500`,
      {
        headers: {
          Authorization: `Bearer ${tokenResponse.access_token}`,
        },
      }
    );

    if (!usersResponse.ok) {
      const errorText = await usersResponse.text();
      console.error("Google Directory API error:", errorText);
      return NextResponse.json({
        error: "Failed to fetch users from Google Workspace",
        details: errorText
      }, { status: 500 });
    }

    const usersData = await usersResponse.json();
    const workspaceUsers = usersData.users || [];

    // Sync each user to our database
    const results = {
      total: workspaceUsers.length,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [] as string[],
    };

    for (const wsUser of workspaceUsers) {
      try {
        // Skip suspended users
        if (wsUser.suspended) {
          results.skipped++;
          continue;
        }

        const email = wsUser.primaryEmail;
        const name = wsUser.name?.fullName || `${wsUser.name?.givenName || ''} ${wsUser.name?.familyName || ''}`.trim();
        const image = wsUser.thumbnailPhotoUrl || null;

        // Check if user exists
        const existingUser = await prisma.user.findUnique({
          where: { email },
        });

        if (existingUser) {
          // Update name and image if changed
          if (existingUser.name !== name || existingUser.image !== image) {
            await prisma.user.update({
              where: { email },
              data: { name, image },
            });
            results.updated++;
          } else {
            results.skipped++;
          }
        } else {
          // Create new user with VIEWER role by default
          await getOrCreateUser(
            { email, name, image: image || undefined },
            { touchLastLogin: false }
          );
          results.created++;
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        results.errors.push(`${wsUser.primaryEmail}: ${errorMsg}`);
      }
    }

    // Log the sync activity
    await logActivity({
      type: "USER_CREATED",
      description: `Google Workspace sync: ${results.created} created, ${results.updated} updated, ${results.skipped} skipped`,
      userId: currentUser.id,
      userEmail: currentUser.email,
      entityType: "workspace_sync",
      metadata: {
        domain: workspaceDomain,
        totalUsers: results.total,
        created: results.created,
        updated: results.updated,
        skipped: results.skipped,
        errors: results.errors.length,
      },
    });

    return NextResponse.json({
      success: true,
      results,
      message: `Synced ${results.created} new users, updated ${results.updated}, skipped ${results.skipped}`,
    });
  } catch (error) {
    console.error("Workspace sync error:", error);
    return NextResponse.json({
      error: "Failed to sync workspace users",
      details: error instanceof Error ? error.message : "Unknown error"
    }, { status: 500 });
  }
}

/**
 * Get an access token using a service account with domain-wide delegation
 */
async function getServiceAccountToken(
  serviceAccountEmail: string,
  privateKey: string,
  impersonateEmail: string,
  scopes: string[]
): Promise<{ access_token?: string; error?: string; error_description?: string }> {
  const now = Math.floor(Date.now() / 1000);
  const expiry = now + 3600; // 1 hour

  // Create JWT header
  const header = {
    alg: "RS256",
    typ: "JWT",
  };

  // Create JWT claims
  const claims = {
    iss: serviceAccountEmail,
    sub: impersonateEmail, // Impersonate an admin user
    scope: scopes.join(" "),
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: expiry,
  };

  // Encode header and claims
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedClaims = base64UrlEncode(JSON.stringify(claims));
  const signatureInput = `${encodedHeader}.${encodedClaims}`;

  // Sign with private key
  const signature = await signRS256(signatureInput, privateKey);
  const jwt = `${signatureInput}.${signature}`;

  // Exchange JWT for access token
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  return tokenResponse.json();
}

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

async function signRS256(data: string, privateKey: string): Promise<string> {
  const crypto = await import("crypto");
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(data);
  sign.end();
  const signature = sign.sign(privateKey, "base64");
  return signature.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * GET /api/admin/sync-workspace
 * Check if Google Workspace sync is configured
 */
export async function GET() {
  const session = await auth();

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Check if user is admin - fetch from DB since JWT may be stale
  const currentUser = await getUserByEmail(session.user.email);
  if (!currentUser || currentUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const configured = !!(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY &&
    process.env.GOOGLE_ADMIN_EMAIL
  );

  return NextResponse.json({
    configured,
    domain: process.env.GOOGLE_WORKSPACE_DOMAIN || "photonbrothers.com",
  });
}
