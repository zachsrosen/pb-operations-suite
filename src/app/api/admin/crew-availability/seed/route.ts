import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/auth";
import { prisma, getUserByEmail } from "@/lib/db";
import { logAdminActivity, extractRequestContext } from "@/lib/audit/admin-activity";

/**
 * Hardcoded crew schedules to seed into the database.
 * Matches the CREW_SCHEDULES in /api/zuper/availability/route.ts
 */
const SEED_SCHEDULES = [
  {
    name: "Drew Perry",
    location: "DTC",
    reportLocation: "DTC",
    schedule: [
      { day: 2, startTime: "12:00", endTime: "15:00" },
      { day: 4, startTime: "12:00", endTime: "15:00" },
    ],
    jobTypes: ["survey"],
  },
  {
    name: "Joe Lynch",
    location: "Westminster",
    reportLocation: "Westminster",
    schedule: [
      { day: 2, startTime: "11:00", endTime: "14:00" },
      { day: 4, startTime: "11:00", endTime: "14:00" },
    ],
    jobTypes: ["survey"],
  },
  {
    name: "Ryszard Szymanski",
    location: "Westminster",
    reportLocation: "Westminster",
    schedule: [
      { day: 2, startTime: "11:00", endTime: "14:00" },
      { day: 3, startTime: "09:00", endTime: "12:00" },
      { day: 4, startTime: "11:00", endTime: "14:00" },
    ],
    jobTypes: ["survey"],
  },
  {
    name: "Rolando",
    location: "Colorado Springs",
    reportLocation: "Colorado Springs",
    schedule: [
      { day: 1, startTime: "08:00", endTime: "12:00" },
      { day: 2, startTime: "08:00", endTime: "12:00" },
      { day: 3, startTime: "08:00", endTime: "12:00" },
      { day: 4, startTime: "08:00", endTime: "12:00" },
      { day: 5, startTime: "08:00", endTime: "12:00" },
    ],
    jobTypes: ["survey"],
  },
  {
    name: "Nick Scarpellino",
    location: "San Luis Obispo",
    reportLocation: "San Luis Obispo",
    timezone: "America/Los_Angeles",
    schedule: [
      { day: 1, startTime: "08:00", endTime: "09:00" },
      { day: 2, startTime: "08:00", endTime: "09:00" },
      { day: 4, startTime: "08:00", endTime: "09:00" },
    ],
    jobTypes: ["survey"],
  },
  {
    name: "Nick Scarpellino",
    location: "Camarillo",
    reportLocation: "Camarillo",
    timezone: "America/Los_Angeles",
    schedule: [
      { day: 3, startTime: "09:00", endTime: "10:00" },
    ],
    jobTypes: ["survey"],
  },
  {
    name: "Daniel Kelly",
    location: "DTC",
    reportLocation: "DTC",
    schedule: [
      { day: 2, startTime: "08:00", endTime: "15:00" },
      { day: 3, startTime: "08:00", endTime: "15:00" },
      { day: 4, startTime: "08:00", endTime: "15:00" },
      { day: 5, startTime: "08:00", endTime: "15:00" },
    ],
    jobTypes: ["inspection"],
  },
];

/**
 * POST /api/admin/crew-availability/seed
 * One-time idempotent seed of crew availability from hardcoded schedules
 */
export async function POST() {
  const session = await auth();

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const currentUser = await getUserByEmail(session.user.email);
  if (!currentUser || !currentUser.roles?.includes("ADMIN")) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    let created = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const crew of SEED_SCHEDULES) {
      // Look up crew member by name
      const crewMember = await prisma.crewMember.findUnique({
        where: { name: crew.name },
      });

      if (!crewMember) {
        errors.push(`Crew member not found: ${crew.name}`);
        continue;
      }

      for (const jobType of crew.jobTypes) {
        for (const slot of crew.schedule) {
          try {
            // Upsert to make this idempotent
            await prisma.crewAvailability.upsert({
              where: {
                crewMemberId_location_dayOfWeek_startTime: {
                  crewMemberId: crewMember.id,
                  location: crew.location,
                  dayOfWeek: slot.day,
                  startTime: slot.startTime,
                },
              },
              create: {
                crewMemberId: crewMember.id,
                location: crew.location,
                reportLocation: crew.reportLocation,
                jobType,
                dayOfWeek: slot.day,
                startTime: slot.startTime,
                endTime: slot.endTime,
                timezone: crew.timezone || "America/Denver",
                isActive: true,
                createdBy: currentUser.id,
                updatedBy: currentUser.id,
              },
              update: {
                // Don't overwrite existing records
              },
            });
            created++;
          } catch (err) {
            skipped++;
            console.warn(`Skipped slot for ${crew.name} at ${crew.location} day ${slot.day}: ${err}`);
          }
        }
      }
    }

    const headersList = await headers();
    const reqCtx = extractRequestContext(headersList);
    await logAdminActivity({
      type: "SETTINGS_CHANGED",
      description: `Seeded crew availability: ${created} created, ${skipped} skipped`,
      userId: currentUser.id,
      userEmail: currentUser.email,
      userName: currentUser.name || undefined,
      entityType: "crew_availability",
      requestPath: "/api/admin/crew-availability/seed",
      requestMethod: "POST",
      ...reqCtx,
    });

    return NextResponse.json({
      success: true,
      created,
      skipped,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("Error seeding crew availability:", error);
    return NextResponse.json({ error: "Failed to seed crew availability" }, { status: 500 });
  }
}
