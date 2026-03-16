/**
 * TEMPORARY: Send retroactive survey reassignment emails for
 * Derek Pomar → Samuel Paro reassignments on 2026-03-16.
 *
 * POST /api/admin/send-retroactive-reassignment-emails
 * POST /api/admin/send-retroactive-reassignment-emails?dry_run=1
 *
 * Admin-only. Remove after use.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail, prisma, getCrewMemberByName, getCrewMemberByZuperUserUid, UserRole } from "@/lib/db";
import { sendReassignmentNotification } from "@/lib/email";
import { getDealOwnerContact } from "@/lib/hubspot";
import { zuper } from "@/lib/zuper";
import { normalizeEmail } from "@/lib/email-utils";

const TODAY = "2026-03-16";
const PREVIOUS_SURVEYOR_NAME = "Derek Pomar";
const NEW_SURVEYOR_NAME = "Samuel Paro";

function deriveCustomerDetails(projectName: string) {
  const parts = projectName.split(" | ");
  const customerName =
    parts.length >= 2 ? parts[1]?.trim() : parts[0]?.trim() || "Customer";
  const customerAddress =
    parts.length >= 3
      ? parts[2]?.trim()
      : parts.length >= 2 && !parts[0].includes("PROJ-")
        ? parts[1]?.trim()
        : "See Zuper for address";
  return { customerName, customerAddress };
}

async function resolveSurveyorEmail(name: string): Promise<string | null> {
  const crew = await getCrewMemberByName(name);
  const crewEmail = normalizeEmail(crew?.email);
  if (crewEmail) return crewEmail;

  if (prisma) {
    const appUser = await prisma.user.findFirst({
      where: { name },
      select: { email: true },
    });
    const appEmail = normalizeEmail(appUser?.email);
    if (appEmail) return appEmail;
  }

  if (crew?.zuperUserUid) {
    const result = await zuper.getUser(crew.zuperUserUid);
    if (result.type === "success") {
      const zuperEmail = normalizeEmail(result.data?.email);
      if (zuperEmail) return zuperEmail;
    }
  }

  return null;
}

export async function POST(request: NextRequest) {
  // Admin-only gate
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dbUser = await getUserByEmail(session.user.email);
  if (!dbUser || !["ADMIN", "OWNER"].includes(dbUser.role as string)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const dryRun = request.nextUrl.searchParams.get("dry_run") === "1";
  const log: string[] = [];

  // Resolve emails
  const derekEmail = (await resolveSurveyorEmail(PREVIOUS_SURVEYOR_NAME)) || "derek@photonbrothers.com";
  const samEmail = (await resolveSurveyorEmail(NEW_SURVEYOR_NAME)) || "sam.paro@photonbrothers.com";

  log.push(`Previous surveyor: ${PREVIOUS_SURVEYOR_NAME} <${derekEmail}>`);
  log.push(`New surveyor: ${NEW_SURVEYOR_NAME} <${samEmail}>`);

  // Find reassignments: Derek records cancelled/rescheduled + Sam records created today for same projects
  const startOfDay = new Date(`${TODAY}T00:00:00Z`);
  const endOfDay = new Date(`${TODAY}T23:59:59Z`);

  const allToday = await prisma.scheduleRecord.findMany({
    where: {
      scheduleType: "survey",
      OR: [
        { updatedAt: { gte: startOfDay, lte: endOfDay } },
        { createdAt: { gte: startOfDay, lte: endOfDay } },
      ],
    },
    orderBy: { updatedAt: "desc" },
  });

  const allDerek = await prisma.scheduleRecord.findMany({
    where: {
      scheduleType: "survey",
      assignedUser: { contains: "Derek", mode: "insensitive" },
    },
  });

  const derekProjectIds = new Set(allDerek.map((r) => r.projectId));

  const reassigned = allToday.filter(
    (r) =>
      (r.assignedUser || "").toLowerCase().includes("sam") &&
      ["scheduled", "tentative"].includes(r.status) &&
      derekProjectIds.has(r.projectId)
  );

  log.push(`Found ${reassigned.length} reassigned surveys`);

  if (reassigned.length === 0) {
    return NextResponse.json({ mode: dryRun ? "dry_run" : "live", log, sent: 0, errors: 0 });
  }

  let sent = 0;
  let errors = 0;

  for (const record of reassigned) {
    const { customerName, customerAddress } = deriveCustomerDetails(record.projectName);

    let dealOwnerName: string | undefined;
    try {
      const owner = await getDealOwnerContact(record.projectId);
      dealOwnerName = owner.ownerName || undefined;
    } catch {
      // Non-critical
    }

    const schedulerEmail =
      normalizeEmail(record.scheduledByEmail) ||
      normalizeEmail(record.scheduledBy) ||
      "noreply@photonbrothers.com";
    const schedulerName =
      (record.scheduledBy && !record.scheduledBy.includes("@")
        ? record.scheduledBy
        : null) || "PB Operations";

    log.push(`${record.projectId}: ${customerName} | ${record.scheduledDate} | by ${schedulerName}`);

    if (dryRun) {
      log.push(`  → [DRY RUN] Would send OUTGOING to ${derekEmail}`);
      log.push(`  → [DRY RUN] Would send INCOMING to ${samEmail}`);
      continue;
    }

    // Outgoing to Derek
    try {
      const outgoing = await sendReassignmentNotification({
        to: derekEmail,
        crewMemberName: PREVIOUS_SURVEYOR_NAME,
        reassignedByName: schedulerName,
        reassignedByEmail: schedulerEmail,
        otherSurveyorName: NEW_SURVEYOR_NAME,
        direction: "outgoing",
        customerName,
        customerAddress,
        scheduledDate: record.scheduledDate,
        scheduledStart: record.scheduledStart || undefined,
        scheduledEnd: record.scheduledEnd || undefined,
        projectId: record.projectId,
        zuperJobUid: record.zuperJobUid || undefined,
        dealOwnerName,
        notes: record.notes || undefined,
      });
      if (outgoing.success) {
        log.push(`  ✅ Outgoing to ${derekEmail}`);
        sent++;
      } else {
        log.push(`  ⚠️ Outgoing failed: ${outgoing.error}`);
        errors++;
      }
    } catch (err) {
      log.push(`  ❌ Outgoing error: ${err}`);
      errors++;
    }

    // Incoming to Sam
    try {
      const incoming = await sendReassignmentNotification({
        to: samEmail,
        crewMemberName: NEW_SURVEYOR_NAME,
        reassignedByName: schedulerName,
        reassignedByEmail: schedulerEmail,
        otherSurveyorName: PREVIOUS_SURVEYOR_NAME,
        direction: "incoming",
        customerName,
        customerAddress,
        scheduledDate: record.scheduledDate,
        scheduledStart: record.scheduledStart || undefined,
        scheduledEnd: record.scheduledEnd || undefined,
        projectId: record.projectId,
        zuperJobUid: record.zuperJobUid || undefined,
        dealOwnerName,
        notes: record.notes || undefined,
      });
      if (incoming.success) {
        log.push(`  ✅ Incoming to ${samEmail}`);
        sent++;
      } else {
        log.push(`  ⚠️ Incoming failed: ${incoming.error}`);
        errors++;
      }
    } catch (err) {
      log.push(`  ❌ Incoming error: ${err}`);
      errors++;
    }
  }

  return NextResponse.json({
    mode: dryRun ? "dry_run" : "live",
    surveys: reassigned.length,
    sent,
    errors,
    log,
  });
}
