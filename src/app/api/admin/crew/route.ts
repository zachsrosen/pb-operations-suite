/**
 * Crew Member Management API
 *
 * GET /api/admin/crew - List all crew members
 * POST /api/admin/crew - Create/update crew member
 * POST /api/admin/crew?action=seed - Seed initial crew data from hardcoded values
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

// Zuper Team UIDs by location
const ZUPER_TEAM_UIDS: Record<string, string> = {
  Westminster: "1c23adb9-cefa-44c7-8506-804949afc56f",
  Centennial: "76b94bd3-e2fc-4cfe-8c2a-357b9a850b3c",
  DTC: "76b94bd3-e2fc-4cfe-8c2a-357b9a850b3c", // DTC uses Centennial team
  "Colorado Springs": "1a914a0e-b633-4f12-8ed6-3348285d6b93",
  "San Luis Obispo": "699cec60-f9f8-4e57-b41a-bb29b1f3649c",
  Camarillo: "0168d963-84af-4214-ad81-d6c43cee8e65",
};

// Initial seed data (migrate from hardcoded values)
const SEED_DATA = [
  {
    name: "Drew Perry",
    zuperUserUid: "0ddc7e1d-62e1-49df-b89d-905a39c1e353",
    zuperTeamUid: ZUPER_TEAM_UIDS.Centennial,
    role: "surveyor",
    locations: ["DTC", "Centennial"],
  },
  {
    name: "Joe Lynch",
    zuperUserUid: "f203f99b-4aaf-488e-8e6a-8ee5e94ec217",
    zuperTeamUid: ZUPER_TEAM_UIDS.Westminster,
    role: "surveyor",
    locations: ["Westminster"],
  },
  {
    name: "Derek Pomar",
    zuperUserUid: "f3bb40c0-d548-4355-ab39-6c27532a6d36",
    zuperTeamUid: ZUPER_TEAM_UIDS.Centennial,
    role: "surveyor",
    locations: ["DTC", "Centennial"],
  },
  {
    name: "Rolando",
    zuperUserUid: "a89ed2f5-222b-4b09-8bb0-14dc45c2a51b",
    zuperTeamUid: ZUPER_TEAM_UIDS["Colorado Springs"],
    role: "technician",
    locations: ["Colorado Springs"],
  },
  {
    name: "Rich",
    zuperUserUid: "e043bf1d-006b-4033-a46e-3b5d06ed3d00",
    zuperTeamUid: ZUPER_TEAM_UIDS.Westminster,
    role: "technician",
    locations: ["Westminster"],
  },
];

// Verify admin role
async function verifyAdmin(request: NextRequest): Promise<{ authorized: boolean; error?: string }> {
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

  // Seed initial data
  if (action === "seed") {
    try {
      const results = [];
      for (const data of SEED_DATA) {
        const existing = await getCrewMemberByName(data.name);
        if (!existing) {
          const created = await upsertCrewMember(data);
          results.push({ name: data.name, status: "created", data: created });
        } else {
          results.push({ name: data.name, status: "exists", data: existing });
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

  // Create/update single crew member
  try {
    const body = await request.json();

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
      email: body.email,
      zuperUserUid: body.zuperUserUid,
      zuperTeamUid: body.zuperTeamUid,
      role: body.role,
      locations: body.locations,
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
