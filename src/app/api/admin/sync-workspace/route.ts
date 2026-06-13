import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/auth";
import { prisma, getOrCreateUser, getUserByEmail } from "@/lib/db";
import { logAdminActivity, extractRequestContext } from "@/lib/audit/admin-activity";
import { fetchAllOwnersMinimal } from "@/lib/hubspot";
import { zuper, type ZuperUser } from "@/lib/zuper";
import {
  planLinkFills,
  nameMatchCandidates,
  type CrewCandidate,
} from "@/lib/directory-links";

interface LinkPhaseResult {
  linked: number;
  alreadyLinked: number;
  unmatched: number;
  skipped?: string;
}

interface SyncLinksResult {
  hubspot: LinkPhaseResult;
  zuper: LinkPhaseResult;
  crew: LinkPhaseResult & { candidates: CrewCandidate[] };
}

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
  if (!currentUser || !currentUser.roles?.includes("ADMIN")) {
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

    // ----------------------------------------------------------------------
    // Link phases (2–4): fill null identity links, never overwrite existing.
    // Each phase is independently try/caught — a failure reports the phase
    // as skipped (with reason) and the rest continue.
    // ----------------------------------------------------------------------
    const links: SyncLinksResult = {
      hubspot: { linked: 0, alreadyLinked: 0, unmatched: 0 },
      zuper: { linked: 0, alreadyLinked: 0, unmatched: 0 },
      crew: { linked: 0, alreadyLinked: 0, unmatched: 0, candidates: [] },
    };

    // Shared app-user list — fetched once after phase 1 so phases 2–4 see
    // the freshly synced directory.
    const appUsers = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        hubspotOwnerId: true,
        zuperUserUid: true,
      },
    });

    // Phase 2: HubSpot owners → User.hubspotOwnerId
    try {
      const owners = await fetchAllOwnersMinimal();
      if (owners.length === 0) {
        links.hubspot.skipped =
          "No HubSpot owners returned (owners API may be in 403 backoff window)";
      } else {
        const hsPlan = planLinkFills(
          appUsers.map((u) => ({
            id: u.id,
            email: u.email,
            existingLink: u.hubspotOwnerId,
            name: u.name,
          })),
          owners.map((o) => ({
            id: o.id,
            email: o.email,
            label: `${o.firstName ?? ""} ${o.lastName ?? ""}`.trim(),
          })),
        );
        for (const fill of hsPlan.fills) {
          await prisma.user.update({
            where: { id: fill.userId },
            data: { hubspotOwnerId: fill.externalId },
          });
        }
        links.hubspot = {
          linked: hsPlan.fills.length,
          alreadyLinked: hsPlan.alreadyLinked,
          unmatched: hsPlan.unmatched.length,
        };
      }
    } catch (err) {
      links.hubspot.skipped = err instanceof Error ? err.message : String(err);
    }

    // Phase 3: Zuper users → User.zuperUserUid
    try {
      const zuperRes = await zuper.getUsers("sync-workspace:links");
      if (zuperRes.type !== "success" || !zuperRes.data) {
        links.zuper.skipped =
          zuperRes.error || zuperRes.message || "Zuper users fetch failed";
      } else {
        // is_active exists on the wire even though the minimal ZuperUser
        // interface omits it (see sync-zuper/route.ts precedent).
        const activeZuperUsers = zuperRes.data.filter(
          (u) => (u as ZuperUser & { is_active?: boolean }).is_active !== false,
        );
        const zpPlan = planLinkFills(
          appUsers.map((u) => ({
            id: u.id,
            email: u.email,
            existingLink: u.zuperUserUid,
            name: u.name,
          })),
          activeZuperUsers.map((u) => ({
            id: u.user_uid,
            email: u.email ?? null,
            label: `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim(),
          })),
        );
        for (const fill of zpPlan.fills) {
          await prisma.user.update({
            where: { id: fill.userId },
            data: { zuperUserUid: fill.externalId },
          });
        }
        links.zuper = {
          linked: zpPlan.fills.length,
          alreadyLinked: zpPlan.alreadyLinked,
          unmatched: zpPlan.unmatched.length,
        };
      }
    } catch (err) {
      links.zuper.skipped = err instanceof Error ? err.message : String(err);
    }

    // Phase 4: active CrewMembers → CrewMember.userId (email match);
    // crew without email get name-match candidates, returned but NEVER written.
    try {
      const crew = await prisma.crewMember.findMany({
        where: { isActive: true },
        select: { id: true, name: true, email: true, userId: true },
      });

      // CrewMember.userId is @unique across ALL crew (incl. inactive), so the
      // claim guard must look at every existing link, not just active crew.
      const claimedRows = await prisma.crewMember.findMany({
        where: { userId: { not: null } },
        select: { userId: true },
      });
      const claimedUserIds = new Set(
        claimedRows.map((c) => c.userId).filter((id): id is string => id != null),
      );

      // Inverted planLinkFills: each unlinked crew-with-email is the link
      // target ("user" side); app users are the externals matched by email.
      const crewWithEmail = crew.filter(
        (c) => c.email != null && c.email.trim() !== "",
      );
      const crewPlan = planLinkFills(
        crewWithEmail.map((c) => ({
          id: c.id,
          email: c.email as string,
          existingLink: c.userId,
          name: c.name,
        })),
        appUsers.map((u) => ({
          id: u.id,
          email: u.email,
          label: u.name ?? u.email,
        })),
      );

      let crewLinked = 0;
      let crewUnmatched = crewPlan.unmatched.length;
      for (const fill of crewPlan.fills) {
        // Guard the @unique constraint: skip if this User is already claimed
        // by another CrewMember (report as unmatched instead of violating).
        if (claimedUserIds.has(fill.externalId)) {
          crewUnmatched++;
          continue;
        }
        await prisma.crewMember.update({
          where: { id: fill.userId },
          data: { userId: fill.externalId },
        });
        claimedUserIds.add(fill.externalId);
        crewLinked++;
      }

      // Crew without email → name-match candidates for manual review only.
      const candidates = nameMatchCandidates(
        crew,
        appUsers.map((u) => ({ id: u.id, name: u.name, email: u.email })),
      );

      links.crew = {
        linked: crewLinked,
        alreadyLinked: crewPlan.alreadyLinked,
        unmatched: crewUnmatched,
        candidates,
      };
    } catch (err) {
      links.crew.skipped = err instanceof Error ? err.message : String(err);
    }

    // Log the sync activity through audit pipeline
    const headersList = await headers();
    const reqCtx = extractRequestContext(headersList);
    await logAdminActivity({
      type: "USER_CREATED",
      description: `Google Workspace sync: ${results.created} created, ${results.updated} updated, ${results.skipped} skipped`,
      userId: currentUser.id,
      userEmail: currentUser.email,
      userName: currentUser.name || undefined,
      entityType: "workspace_sync",
      metadata: {
        domain: workspaceDomain,
        totalUsers: results.total,
        created: results.created,
        updated: results.updated,
        skipped: results.skipped,
        errors: results.errors.length,
        links: {
          hubspot: {
            linked: links.hubspot.linked,
            alreadyLinked: links.hubspot.alreadyLinked,
            unmatched: links.hubspot.unmatched,
            ...(links.hubspot.skipped ? { skipped: links.hubspot.skipped } : {}),
          },
          zuper: {
            linked: links.zuper.linked,
            alreadyLinked: links.zuper.alreadyLinked,
            unmatched: links.zuper.unmatched,
            ...(links.zuper.skipped ? { skipped: links.zuper.skipped } : {}),
          },
          crew: {
            linked: links.crew.linked,
            alreadyLinked: links.crew.alreadyLinked,
            unmatched: links.crew.unmatched,
            candidates: links.crew.candidates.length,
            ...(links.crew.skipped ? { skipped: links.crew.skipped } : {}),
          },
        },
      },
      requestPath: "/api/admin/sync-workspace",
      requestMethod: "POST",
      ...reqCtx,
    });

    return NextResponse.json({
      success: true,
      results,
      links,
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
  if (!currentUser || !currentUser.roles?.includes("ADMIN")) {
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
