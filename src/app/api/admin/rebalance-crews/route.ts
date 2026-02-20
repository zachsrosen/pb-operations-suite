/**
 * Rebalance Crew Assignments API
 *
 * POST /api/admin/rebalance-crews         - Dry run (preview changes)
 * POST /api/admin/rebalance-crews?apply=1 - Apply changes to DB
 *
 * Problem: The scheduler defaulted all projects to the first crew (Alpha),
 * causing Alpha crews to be double/triple booked while Beta crews sat idle.
 * This endpoint round-robins tentative installation records across crews
 * per location.
 *
 * Admin-only endpoint.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

// Crew definitions per location (must match CREWS in scheduler/page.tsx)
const CREWS: Record<string, string[]> = {
  Westminster: ["WESTY Alpha", "WESTY Bravo"],
  Centennial: ["DTC Alpha", "DTC Bravo"],
  "Colorado Springs": ["COSP Alpha"],
  "San Luis Obispo": ["SLO Solar", "SLO Electrical 1", "SLO Electrical 2"],
  Camarillo: ["CAM Crew"],
};

// Map crew names to their location
const CREW_TO_LOCATION: Record<string, string> = {};
for (const [loc, crews] of Object.entries(CREWS)) {
  for (const crew of crews) {
    CREW_TO_LOCATION[crew] = loc;
  }
}

// Director names to location mapping (for records without crew in notes).
// Only include directors who manage a single location to avoid misclassification.
// Nick Scarpellino is omitted: he directs both SLO and Camarillo.
const DIRECTOR_TO_LOCATION: Record<string, string> = {
  "Joe Lynch": "Westminster",
  "Drew Perry": "Centennial",
  "Rolando": "Colorado Springs",
};

interface ScheduleRec {
  id: string;
  projectName: string;
  scheduledDate: string;
  notes: string | null;
  assignedUser: string | null;
}

function extractCrew(record: { notes: string | null; assignedUser: string | null }): string | null {
  // Try notes first: "[AUTO_OPTIMIZED] (balanced) — WESTY Alpha"
  if (record.notes) {
    const m = record.notes.match(/—\s*(.+)$/);
    if (m && CREW_TO_LOCATION[m[1].trim()]) return m[1].trim();
  }
  // Try assignedUser
  if (record.assignedUser && CREW_TO_LOCATION[record.assignedUser]) {
    return record.assignedUser;
  }
  return null;
}

function resolveLocation(record: { notes: string | null; assignedUser: string | null }): string | null {
  const crew = extractCrew(record);
  if (crew && CREW_TO_LOCATION[crew]) return CREW_TO_LOCATION[crew];

  // Try to infer from assignedUser (director name)
  if (record.assignedUser && DIRECTOR_TO_LOCATION[record.assignedUser]) {
    return DIRECTOR_TO_LOCATION[record.assignedUser];
  }

  return null;
}

export async function POST(req: NextRequest) {
  // Admin-only auth
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }
  const db = prisma; // narrowed non-null reference
  const user = await db.user.findUnique({
    where: { email: session.user.email },
    select: { role: true },
  });
  if (user?.role !== "ADMIN" && user?.role !== "OWNER") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const apply = req.nextUrl.searchParams.get("apply") === "1";

  try {
    // Fetch all tentative installation records
    const records = await db.scheduleRecord.findMany({
      where: {
        status: "tentative",
        scheduleType: "installation",
      },
      orderBy: { scheduledDate: "asc" },
    });

    if (records.length === 0) {
      return NextResponse.json({ message: "No tentative installation records to rebalance.", changes: [] });
    }

    // Group records by location
    const byLocation: Record<string, ScheduleRec[]> = {};
    const unmapped: ScheduleRec[] = [];
    for (const rec of records) {
      const loc = resolveLocation(rec);
      if (!loc) {
        unmapped.push(rec);
        continue;
      }
      if (!byLocation[loc]) byLocation[loc] = [];
      byLocation[loc].push(rec);
    }

    const allChanges: Array<{
      id: string;
      projectName: string;
      date: string;
      location: string;
      from: string;
      to: string;
      newNotes: string;
    }> = [];

    const locationSummaries: Array<{
      location: string;
      recordCount: number;
      crewCount: number;
      changeCount: number;
      before: Record<string, number>;
      after: Record<string, number>;
    }> = [];

    // Rebalance each location
    for (const [location, recs] of Object.entries(byLocation)) {
      const crews = CREWS[location];
      if (!crews || crews.length <= 1) {
        locationSummaries.push({
          location,
          recordCount: recs.length,
          crewCount: crews?.length || 0,
          changeCount: 0,
          before: {},
          after: {},
        });
        continue;
      }

      // Current distribution
      const currentDist: Record<string, number> = {};
      for (const c of crews) currentDist[c] = 0;
      for (const r of recs) {
        const crew = extractCrew(r);
        if (crew) currentDist[crew] = (currentDist[crew] || 0) + 1;
      }

      // Round-robin assign: sort records by date, alternate crews
      const sorted = [...recs].sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
      let crewIdx = 0;
      const changes: Array<{
        id: string;
        projectName: string;
        date: string;
        from: string;
        to: string;
        newNotes: string;
      }> = [];

      // Track crew assignments per date to avoid same-day conflicts
      const dateAssignments: Record<string, Set<number>> = {};

      for (const rec of sorted) {
        const currentCrew = extractCrew(rec);

        if (!dateAssignments[rec.scheduledDate]) dateAssignments[rec.scheduledDate] = new Set();
        const usedOnDate = dateAssignments[rec.scheduledDate];

        // Try to find a crew not yet used on this date
        let assignedIdx = crewIdx;
        for (let attempt = 0; attempt < crews.length; attempt++) {
          const tryIdx = (crewIdx + attempt) % crews.length;
          if (!usedOnDate.has(tryIdx)) {
            assignedIdx = tryIdx;
            break;
          }
        }

        const newCrew = crews[assignedIdx];
        usedOnDate.add(assignedIdx);
        crewIdx = (assignedIdx + 1) % crews.length;

        if (currentCrew !== newCrew) {
          let newNotes = rec.notes || "";
          if (newNotes.includes("—")) {
            newNotes = newNotes.replace(/—\s*.+$/, `— ${newCrew}`);
          } else if (newNotes) {
            newNotes += ` — ${newCrew}`;
          } else {
            newNotes = `Rebalanced — ${newCrew}`;
          }

          changes.push({
            id: rec.id,
            projectName: rec.projectName,
            date: rec.scheduledDate,
            from: currentCrew || rec.assignedUser || "unknown",
            to: newCrew,
            newNotes,
          });
        }
      }

      // New distribution
      const newDist: Record<string, number> = {};
      for (const c of crews) newDist[c] = 0;
      for (const rec of sorted) {
        const change = changes.find(ch => ch.id === rec.id);
        const crew = change ? change.to : extractCrew(rec);
        if (crew) newDist[crew] = (newDist[crew] || 0) + 1;
      }

      locationSummaries.push({
        location,
        recordCount: recs.length,
        crewCount: crews.length,
        changeCount: changes.length,
        before: currentDist,
        after: newDist,
      });

      if (apply && changes.length > 0) {
        for (const ch of changes) {
          await db.scheduleRecord.update({
            where: { id: ch.id },
            data: { notes: ch.newNotes },
          });
        }
      }

      for (const ch of changes) {
        allChanges.push({ ...ch, location });
      }
    }

    return NextResponse.json({
      mode: apply ? "applied" : "dry-run",
      totalRecords: records.length,
      totalChanges: allChanges.length,
      unmappedCount: unmapped.length,
      unmapped: unmapped.map(r => ({
        projectName: r.projectName,
        assignedUser: r.assignedUser,
        notes: r.notes?.substring(0, 80),
      })),
      locations: locationSummaries,
      changes: allChanges,
    });
  } catch (error) {
    console.error("Rebalance error:", error);
    return NextResponse.json(
      { error: "Failed to rebalance crew assignments" },
      { status: 500 }
    );
  }
}