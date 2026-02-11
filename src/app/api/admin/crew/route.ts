/**
 * Crew Member Management API
 *
 * GET /api/admin/crew - List all crew members
 * POST /api/admin/crew - Create/update crew member
 * POST /api/admin/crew?action=seed - Seed initial crew data from hardcoded values
 * POST /api/admin/crew?action=seed-teams - Seed DTC & Westminster teams with Zuper resolution
 *
 * Admin-only endpoint
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  prisma,
  getActiveCrewMembers,
  upsertCrewMember,
  getCrewMemberByName,
} from "@/lib/db";
import { zuper } from "@/lib/zuper";

// Zuper Team UIDs by location
const ZUPER_TEAM_UIDS: Record<string, string> = {
  Westminster: "1c23adb9-cefa-44c7-8506-804949afc56f",
  Centennial: "76b94bd3-e2fc-4cfe-8c2a-357b9a850b3c",
  DTC: "76b94bd3-e2fc-4cfe-8c2a-357b9a850b3c", // DTC uses Centennial team
  "Colorado Springs": "1a914a0e-b633-4f12-8ed6-3348285d6b93",
  "San Luis Obispo": "699cec60-f9f8-4e57-b41a-bb29b1f3649c",
  Camarillo: "0168d963-84af-4214-ad81-d6c43cee8e65",
};

// Generate email from name: "Drew Perry" → "drew@photonbrothers.com"
function generateCrewEmail(name: string): string {
  const firstName = name.split(" ")[0].toLowerCase();
  return `${firstName}@photonbrothers.com`;
}

// Initial seed data (migrate from hardcoded values)
const SEED_DATA = [
  {
    name: "Drew Perry",
    email: "drew@photonbrothers.com",
    zuperUserUid: "0ddc7e1d-62e1-49df-b89d-905a39c1e353",
    zuperTeamUid: ZUPER_TEAM_UIDS.Centennial,
    role: "surveyor",
    locations: ["DTC", "Centennial"],
  },
  {
    name: "Joe Lynch",
    email: "joe@photonbrothers.com",
    zuperUserUid: "f203f99b-4aaf-488e-8e6a-8ee5e94ec217",
    zuperTeamUid: ZUPER_TEAM_UIDS.Westminster,
    role: "surveyor",
    locations: ["Westminster"],
  },
  {
    name: "Derek Pomar",
    email: "derek@photonbrothers.com",
    zuperUserUid: "f3bb40c0-d548-4355-ab39-6c27532a6d36",
    zuperTeamUid: ZUPER_TEAM_UIDS.Centennial,
    role: "surveyor",
    locations: ["DTC", "Centennial"],
  },
  {
    name: "Ryszard Szymanski",
    email: "ryszard@photonbrothers.com",
    zuperUserUid: "e043bf1d-006b-4033-a46e-3b5d06ed3d00",
    zuperTeamUid: ZUPER_TEAM_UIDS.Westminster,
    role: "surveyor",
    locations: ["Westminster"],
  },
  {
    name: "Nick Scarpellino",
    email: "nick@photonbrothers.com",
    zuperUserUid: "8e67159c-48fe-4fb0-acc3-b1c905ff6e95",
    zuperTeamUid: ZUPER_TEAM_UIDS["San Luis Obispo"],
    role: "surveyor",
    locations: ["San Luis Obispo", "Camarillo"],
  },
  {
    name: "Rolando",
    email: "rolando@photonbrothers.com",
    zuperUserUid: "a89ed2f5-222b-4b09-8bb0-14dc45c2a51b",
    zuperTeamUid: ZUPER_TEAM_UIDS["Colorado Springs"],
    role: "technician",
    locations: ["Colorado Springs"],
  },
  {
    name: "Daniel Kelly",
    email: "dan@photonbrothers.com",
    zuperUserUid: "f0a5aca8-0137-478c-a910-1380b9a31a79",
    zuperTeamUid: ZUPER_TEAM_UIDS.DTC,
    role: "inspector",
    locations: ["DTC"],
    teamName: "Thunderbird",
    permissions: ["Site Survey", "Inspections", "Service", "Loose Ends"],
  },
];

// DTC & Westminster crew teams (Zuper UIDs resolved at seed time)
const TEAM_SEED_DATA: Array<{
  name: string;
  zuperSearchName: string; // Name to search in Zuper (first name or full name)
  location: "DTC" | "Westminster";
  role: string;
  teamName: string;
  permissions: string[];
}> = [
  // ===== DTC Electricians =====
  {
    name: "Jeremy",
    zuperSearchName: "Jeremy",
    location: "DTC",
    role: "electrician",
    teamName: "Godzilla",
    permissions: ["Inspections", "MPUs", "GW3s", "Split Service", "Site Survey", "Service", "EV", "Sub Panels", "Loose Ends"],
  },
  {
    name: "Olek",
    zuperSearchName: "Olek",
    location: "DTC",
    role: "electrician",
    teamName: "Mothman",
    permissions: ["MPUs", "GW3s", "Split Service", "EV", "Sub Panels", "Service", "Loose Ends"],
  },
  {
    name: "Paul",
    zuperSearchName: "Paul",
    location: "DTC",
    role: "electrician",
    teamName: "Nessie",
    permissions: ["TBUS", "PW3", "AC Coupled", "Inspections", "EV", "Sub Panels", "Roof Work", "Loose Ends"],
  },
  {
    name: "Gaige",
    zuperSearchName: "Gaige",
    location: "DTC",
    role: "electrician",
    teamName: "Sasquatch",
    permissions: ["TBUS", "PW3", "AC Coupled", "EV", "Sub Panels", "Roof Work", "Loose Ends"],
  },
  // ===== DTC Roof Teams =====
  {
    name: "Emerill",
    zuperSearchName: "Emerill",
    location: "DTC",
    role: "roofer",
    teamName: "Jackalope",
    permissions: ["All Roof Scope"],
  },
  {
    name: "Ian",
    zuperSearchName: "Ian",
    location: "DTC",
    role: "roofer",
    teamName: "Jackalope",
    permissions: ["All Roof Scope"],
  },
  {
    name: "Kaleb",
    zuperSearchName: "Kaleb",
    location: "DTC",
    role: "roofer",
    teamName: "Chupacabra",
    permissions: ["All Roof Scope"],
  },
  {
    name: "Kevin",
    zuperSearchName: "Kevin",
    location: "DTC",
    role: "roofer",
    teamName: "Chupacabra",
    permissions: ["All Roof Scope"],
  },
  // ===== Westminster Electricians =====
  {
    name: "Adolphe",
    zuperSearchName: "Adolphe",
    location: "Westminster",
    role: "electrician",
    teamName: "Summit",
    permissions: ["Inspections", "MPUs", "GW3s", "Split Service", "EV", "Sub Panels", "Loose Ends", "Service", "Live"],
  },
  {
    name: "Chris K",
    zuperSearchName: "Chris",
    location: "Westminster",
    role: "electrician",
    teamName: "Keystone",
    permissions: ["MPUs", "GW3s", "Split Service", "EV", "Sub Panels", "Service", "Inspections", "Loose Ends"],
  },
  {
    name: "Chad",
    zuperSearchName: "Chad",
    location: "Westminster",
    role: "electrician",
    teamName: "Denali",
    permissions: ["Inspections", "Service", "Loose Ends", "GW3s", "MPUs", "Sub Panels"],
  },
  // ===== Westminster Roof Teams =====
  {
    name: "Nathan",
    zuperSearchName: "Nathan",
    location: "Westminster",
    role: "roofer",
    teamName: "Kilimanjaro",
    permissions: ["All Roof Scope"],
  },
  {
    name: "Tyler",
    zuperSearchName: "Tyler",
    location: "Westminster",
    role: "roofer",
    teamName: "Kilimanjaro",
    permissions: ["All Roof Scope"],
  },
  {
    name: "Dalton",
    zuperSearchName: "Dalton",
    location: "Westminster",
    role: "roofer",
    teamName: "Kilimanjaro",
    permissions: ["All Roof Scope"],
  },
  {
    name: "Jose",
    zuperSearchName: "Jose",
    location: "Westminster",
    role: "roofer",
    teamName: "Everest",
    permissions: ["All Roof Scope"],
  },
  {
    name: "Tony",
    zuperSearchName: "Tony",
    location: "Westminster",
    role: "roofer",
    teamName: "Everest",
    permissions: ["All Roof Scope"],
  },
];

// Verify admin role
async function verifyAdmin(_request: NextRequest): Promise<{ authorized: boolean; error?: string }> {
  const session = await auth();

  if (!session?.user?.email) {
    return { authorized: false, error: "Not authenticated" };
  }

  if (!prisma) {
    return { authorized: false, error: "Database not configured" };
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { role: true },
  });

  if (user?.role !== "ADMIN") {
    return { authorized: false, error: "Admin access required" };
  }

  return { authorized: true };
}

/**
 * GET /api/admin/crew - List all crew members
 */
export async function GET(request: NextRequest) {
  const authResult = await verifyAdmin(request);
  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  try {
    const role = request.nextUrl.searchParams.get("role") || undefined;
    const crew = await getActiveCrewMembers(role);

    return NextResponse.json({
      success: true,
      crew,
      count: crew.length,
    });
  } catch (error) {
    console.error("Error fetching crew:", error);
    return NextResponse.json(
      { error: "Failed to fetch crew members" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/crew - Create/update crew member or seed data
 */
export async function POST(request: NextRequest) {
  const authResult = await verifyAdmin(request);
  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  const action = request.nextUrl.searchParams.get("action");

  // Seed initial data (existing crew with known Zuper UIDs)
  if (action === "seed") {
    try {
      const results = [];
      for (const data of SEED_DATA) {
        const existing = await getCrewMemberByName(data.name);
        if (!existing) {
          const created = await upsertCrewMember(data);
          results.push({ name: data.name, status: "created", data: created });
        } else {
          // Update existing crew member with any missing fields (email, locations, teamUid, etc.)
          const updated = await upsertCrewMember({
            ...data,
            email: data.email || existing.email || generateCrewEmail(data.name),
          });
          results.push({ name: data.name, status: "updated", data: updated });
        }
      }

      return NextResponse.json({
        success: true,
        message: "Crew data seeded",
        results,
      });
    } catch (error) {
      console.error("Error seeding crew data:", error);
      return NextResponse.json(
        { error: "Failed to seed crew data" },
        { status: 500 }
      );
    }
  }

  // Seed DTC & Westminster teams — resolve Zuper UIDs dynamically + create User records
  if (action === "seed-teams") {
    try {
      if (!prisma) {
        return NextResponse.json({ error: "Database not configured" }, { status: 503 });
      }

      // Step 1: Fetch all Zuper users for UID resolution
      const zuperUsers = zuper.isConfigured() ? await zuper.getCachedUsers() : new Map();
      console.log(`[seed-teams] Zuper user cache has ${zuperUsers.size} entries`);

      const results: Array<{
        name: string;
        teamName: string;
        location: string;
        status: string;
        zuperUserUid?: string;
        zuperResolved: boolean;
        userCreated: boolean;
      }> = [];

      // Step 2: First update Daniel Kelly with team info (already exists)
      const danielData = SEED_DATA.find(d => d.name === "Daniel Kelly");
      if (danielData) {
        await upsertCrewMember({
          ...danielData,
          teamName: "Thunderbird",
          permissions: ["Site Survey", "Inspections", "Service", "Loose Ends"],
        });
        results.push({
          name: "Daniel Kelly",
          teamName: "Thunderbird",
          location: "DTC",
          status: "updated",
          zuperUserUid: danielData.zuperUserUid,
          zuperResolved: true,
          userCreated: false,
        });
      }

      // Step 3: Process each new crew member
      for (const crew of TEAM_SEED_DATA) {
        // Skip Daniel Kelly — already handled above
        if (crew.name === "Daniel Kelly" || crew.name === "Dan") continue;

        // Resolve Zuper UID by searching first name
        const resolved = zuperUsers.size > 0
          ? await zuper.resolveUserUid(crew.zuperSearchName)
          : null;

        const zuperUserUid = resolved?.userUid || "pending-" + crew.name.toLowerCase().replace(/\s+/g, "-");
        const zuperTeamUid = resolved?.teamUid || ZUPER_TEAM_UIDS[crew.location];

        // Build full name for crew member record
        // For first-name-only entries, try to get full name from Zuper
        let fullName = crew.name;
        if (resolved) {
          // Check if Zuper gave us more info (full name in the cache key)
          for (const [key, val] of zuperUsers) {
            if (val.userUid === resolved.userUid && key.includes(" ")) {
              // Found full name — capitalize properly
              fullName = key.split(" ").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
              break;
            }
          }
        }

        // Upsert crew member
        const crewResult = await upsertCrewMember({
          name: fullName,
          email: generateCrewEmail(fullName),
          zuperUserUid,
          zuperTeamUid,
          role: crew.role,
          locations: [crew.location],
          teamName: crew.teamName,
          permissions: crew.permissions,
        });

        // Step 4: Create User record if not present
        let userCreated = false;
        const email = generateCrewEmail(fullName);
        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (!existingUser) {
          await prisma.user.create({
            data: {
              email,
              name: fullName,
              role: "TECH_OPS",
              // No googleId, no lastLoginAt — they haven't logged in
            },
          });
          userCreated = true;
        }

        results.push({
          name: fullName,
          teamName: crew.teamName,
          location: crew.location,
          status: crewResult ? "created" : "failed",
          zuperUserUid: resolved?.userUid,
          zuperResolved: !!resolved,
          userCreated,
        });
      }

      const resolved = results.filter(r => r.zuperResolved).length;
      const unresolved = results.filter(r => !r.zuperResolved).length;
      const usersCreated = results.filter(r => r.userCreated).length;

      return NextResponse.json({
        success: true,
        message: `Seeded ${results.length} crew members (${resolved} Zuper resolved, ${unresolved} pending). Created ${usersCreated} user accounts.`,
        results,
      });
    } catch (error) {
      console.error("Error seeding team data:", error);
      return NextResponse.json(
        { error: "Failed to seed team data", details: String(error) },
        { status: 500 }
      );
    }
  }

  // Create/update single crew member
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
    }

    // Validate required fields
    if (!body.name || !body.zuperUserUid) {
      return NextResponse.json(
        { error: "Name and zuperUserUid are required" },
        { status: 400 }
      );
    }

    // Validate zuperUserUid format (UUID)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(body.zuperUserUid)) {
      return NextResponse.json(
        { error: "Invalid zuperUserUid format (must be UUID)" },
        { status: 400 }
      );
    }

    if (body.zuperTeamUid && !uuidRegex.test(body.zuperTeamUid)) {
      return NextResponse.json(
        { error: "Invalid zuperTeamUid format (must be UUID)" },
        { status: 400 }
      );
    }

    const crew = await upsertCrewMember({
      name: body.name,
      email: body.email || generateCrewEmail(body.name),
      zuperUserUid: body.zuperUserUid,
      zuperTeamUid: body.zuperTeamUid,
      role: body.role,
      locations: body.locations,
      teamName: body.teamName,
      permissions: body.permissions,
      isActive: body.isActive,
      maxDailyJobs: body.maxDailyJobs,
    });

    return NextResponse.json({
      success: true,
      crew,
    });
  } catch (error) {
    console.error("Error creating crew member:", error);
    return NextResponse.json(
      { error: "Failed to create crew member" },
      { status: 500 }
    );
  }
}
